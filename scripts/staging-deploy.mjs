import { appendFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { controlSql } from './staging-control-db.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { UUID, newKeys, keyPair, inheritBindings, secretBundle, probe, previewOrigin, deployCandidate, requireResumeContract, executeCutover, readCloudState, rollbackTransition } from './staging-deployment.mjs';

const env = process.env;
const mode = env.STAGING_OPERATION ?? 'deploy';
const configPath = 'dist/yzt_randevu/wrangler.json';
const bundlePath = '/tmp/randevu-staging-secrets.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const workerName = String(config.name ?? '').trim();
if (!/^[a-z0-9-]+$/.test(workerName) || config.workers_dev !== true) throw new Error('Invalid generated staging Worker config');
if (!['deploy', 'bootstrap', 'rotate', 'resume', 'rollback'].includes(mode)) throw new Error('Unknown staging operation');
const root = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
const scriptRoot = `${root}/workers/scripts/${encodeURIComponent(workerName)}`;

async function cf(url, options = {}, allow404 = false) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json().catch(() => null);
  if (response.status === 404 && allow404) return null;
  if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare control-plane request failed (HTTP ${response.status})`);
  return payload.result;
}
const cloudState = () => readCloudState(cf, scriptRoot, mode === 'bootstrap');
const subdomain = String((await cf(`${root}/workers/subdomain`))?.subdomain ?? '');
if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error('Invalid Cloudflare subdomain');
const origin = `https://${workerName}.${subdomain}.workers.dev`;
env.STAGING_APP_ORIGIN = origin;
env.STAGING_WORKER_NAME = workerName;
if (process.argv[2] === 'resolve') {
  await cloudState(); // Missing established secret fails before migrations.
  appendFileSync(env.GITHUB_ENV, `STAGING_WORKER_NAME=${workerName}\nSTAGING_APP_ORIGIN=${origin}\n`);
  console.log(`Resolved staging origin: ${origin}`);
  process.exit(0);
}

// Never forward SQL text, error detail, verifiers, or credential-bearing output.
const literal = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const sql = (statement) => controlSql(env.STAGING_DATABASE_URL, statement, env);

function database() {
  return JSON.parse(sql(`select json_build_object(
    'gate', (select gate_secret_hash from public.public_booking_abuse_config where config_key = 'default'),
    'dispatch', (select secret_hash from public.notification_dispatch_config where config_key = 'default'),
    'pending', (select row_to_json(t) from public.staging_key_transition t),
    'fixtures', (select count(*) from public.businesses where id in ('f1700000-0000-4000-8000-000000000001','f1700000-0000-4000-8000-000000000002')),
    'businesses', (select count(*) from public.businesses),
    'encrypted', (select count(*) from public.public_booking_recoveries where management_token_ciphertext is not null),
    'now', clock_timestamp());`));
}
const samePair = (a, b) => a.gate === b.gate && a.dispatch === b.dispatch;
function command(name, args) {
  const result = spawnSync(name, args, { env, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (result.error || result.status !== 0) throw new Error(`Staging command failed: ${name} ${args.filter((v) => !v.startsWith('/tmp/')).join(' ')}`);
}
async function until(check, timeout, description) {
  const deadline = Date.now() + timeout;
  do {
    if (await check().catch(() => false)) return;
    if (Date.now() >= deadline) break;
    await delay(10000);
  } while (Date.now() < deadline);
  throw new Error(`${description} timed out`);
}
async function activate(version) {
  if (!UUID.test(version)) throw new Error('Invalid activation target');
  // Only an attested candidate or the recorded previous release reaches here.
  // Cloudflare requires force when their versioned secrets differ.
  await cf(`${scriptRoot}/deployments?force=true`, {
    method: 'POST', body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }],
      annotations: { 'workers/message': 'S05 verified version activation' } }),
  });
}
async function verifyRuntime(state, old = false) {
  const pair = old ? state.before : state.after;
  const version = old ? state.previous : state.target;
  await until(async () => {
    const cloud = await cloudState();
    if (cloud.version !== version) return false;
    if (old && state.legacy) {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      await response.body?.cancel();
      return response.ok;
    }
    state.evidence = await probe(fetch, origin, pair, version, state.evidence);
    return true;
  }, 120000, 'Worker version/key/management verification');
}
async function verifyCron(state, old = false) {
  if (old && state.legacy) return;
  const pair = old ? state.before : state.after;
  const version = old ? state.previous : state.target;
  console.log('Waiting for this Worker version to receive a real Cron event (startup budget 15 minutes).');
  await until(async () => sql(`select exists (select 1 from public.staging_cron_heartbeat
    where version_id = ${literal(version)}::uuid and dispatch_hash = ${literal(pair.dispatch)}
      and observed_at >= ${literal(state.since)}::timestamptz
      and observed_at > clock_timestamp() - interval '2 minutes');`) === 't', 15 * 60 * 1000, 'Cron startup readiness');
  console.log('Cron startup ready; the existing F09 delivery timeout is unchanged.');
}
function finish(state, promote) {
  sql(`select public.finish_staging_key_rotation(${literal(state.operation)}::uuid,
    ${literal(state.before.gate)}, ${literal(state.before.dispatch)}, ${promote});`);
}
const rollback = (state) => rollbackTransition({ database, cloudState, activate, verifyRuntime, verifyCron, finish, log: console.log }, state);

function verifyDatabase(state) {
  const current = database();
  const expected = mode === 'bootstrap' ? state.after : state.before;
  if (!samePair(current, expected)) throw new Error('DB key generation changed before activation');
  if (state.rotating) {
    if (current.pending?.operation_id !== state.operation
        || current.pending.gate_hash !== state.after.gate || current.pending.dispatch_hash !== state.after.dispatch
        || current.pending.previous_version !== state.previous || current.pending.commit_sha !== env.GITHUB_SHA) {
      throw new Error('Pending rotation ownership changed before activation');
    }
  } else if (current.pending) throw new Error('Unexpected pending rotation before activation');
}

const beforeCloud = await cloudState();
const db = database();
const gates = {
  f09: env.RUN_F09_ACCEPTANCE === 'true',
  f10: env.RUN_F10_ACCEPTANCE === 'true',
  f10team: env.RUN_F10_TEAM_ACCEPTANCE === 'true',
  f16sms: env.RUN_F16_SMS_ACCEPTANCE === 'true',
  s01: env.RUN_S01_ACCEPTANCE === 'true',
  mailbox: env.S01_RECOVERY_EMAIL ?? '',
};
const commit = env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Missing exact workflow commit');
const state = {
  operation: randomUUID(), before: { gate: db.gate, dispatch: db.dispatch }, after: { gate: db.gate, dispatch: db.dispatch },
  previous: beforeCloud.version, legacy: beforeCloud.legacy, evidence: {}, target: null, prepared: false, rotating: false,
  since: db.now, keys: {},
};
if (db.pending) {
  if (mode !== 'resume' && mode !== 'rollback') throw new Error('Unfinished key rotation: choose resume or rollback; routine deploy is blocked');
  const pending = db.pending;
  state.operation = pending.operation_id;
  state.previous = pending.previous_version;
  state.legacy = false;
  state.evidence = pending.evidence;
  state.after = { gate: pending.gate_hash, dispatch: pending.dispatch_hash };
  state.rotating = true;
  state.prepared = true;
  if (mode === 'rollback') {
    await rollback(state);
    process.exit(0);
  }
  requireResumeContract(pending, commit, gates);
  const candidates = beforeCloud.versions.filter((version) => version.annotations?.['workers/tag'] === pending.operation_id);
  if (candidates.length !== 1) throw new Error('Resume needs one uploaded candidate; choose rollback to return to the proven previous version');
  state.target = candidates[0].id;
} else {
  if (mode === 'rollback') throw new Error('No unfinished rotation to roll back');
  if (mode === 'bootstrap') {
    if (beforeCloud.version || beforeCloud.versions.length || db.encrypted || db.businesses) throw new Error('Bootstrap requires an empty environment; existing encryption material must be preserved');
    state.keys = newKeys(true);
    state.after = keyPair(state.keys);
  } else {
    if (!beforeCloud.version || !db.gate || !db.dispatch) throw new Error('Established deployment requires an active Worker and both DB verifiers');
    if (!state.legacy) state.evidence = await probe(fetch, origin, state.before, state.previous);
    if (mode === 'rotate') {
      if (state.legacy) throw new Error('First deploy the S05 routine baseline; rotation requires the authenticated probe');
      state.keys = newKeys();
      state.after = keyPair(state.keys);
      state.rotating = true;
    }
  }
}
if ((state.rotating || mode === 'resume') && !gates.f09) throw new Error('Rotation/resume requires the real F09 acceptance gate');
if (gates.f09 && !env.RESEND_ACCEPTANCE_API_KEY) throw new Error('Missing F09 provider acceptance read key');
state.evidence = { ...state.evidence, gates };
for (const value of Object.values(state.keys)) console.log(`::add-mask::${value}`);

await executeCutover({
  async prepare(s) {
    if (s.prepared) return;
    const latest = await cloudState();
    if (latest.version !== s.previous) throw new Error('Active deployment changed during preflight');
    if (s.rotating) {
      sql(`select public.begin_staging_key_rotation(${literal(s.operation)}::uuid, ${literal(s.before.gate)}, ${literal(s.before.dispatch)},
        ${literal(s.after.gate)}, ${literal(s.after.dispatch)}, ${literal(s.previous)}::uuid, ${literal(commit)}, ${literal(JSON.stringify(s.evidence))}::jsonb);`);
    } else if (mode === 'bootstrap') {
      sql(`begin; select pg_advisory_xact_lock(505,1);
        do $$ begin if exists(select 1 from public.businesses) or exists(select 1 from public.staging_key_transition)
          then raise exception 'BOOTSTRAP_NOT_EMPTY'; end if; end $$;
        insert into public.public_booking_abuse_config(config_key,gate_secret_hash) values ('default',${literal(s.after.gate)})
          on conflict(config_key) do update set gate_secret_hash = excluded.gate_secret_hash, updated_at = clock_timestamp();
        insert into public.notification_dispatch_config(config_key,secret_hash) values ('default',${literal(s.after.dispatch)})
          on conflict(config_key) do update set secret_hash = excluded.secret_hash, updated_at = clock_timestamp(); commit;`);
    }
    s.prepared = true;
  },
  async deploy(s) {
    await deployCandidate({
      cloudState, activate, verifyDatabase,
      async upload(candidate, source) {
        const supplied = secretBundle(env, candidate.keys);
        writeFileSync(configPath, JSON.stringify(inheritBindings(config, source, supplied)), { mode: 0o600 });
        writeFileSync(bundlePath, JSON.stringify(supplied), { mode: 0o600 });
        command('npx', ['wrangler', 'versions', 'upload', '--secrets-file', bundlePath, '--tag', candidate.operation]);
      },
      async configureTriggers() {
        // versions upload does not apply workers.dev/preview/Cron settings.
        // This command keeps the existing trigger contract and uploads no code.
        command('npx', ['wrangler', 'triggers', 'deploy']);
      },
      async verifyCandidate(candidate) {
        const preview = previewOrigin(origin, candidate.target);
        await until(async () => {
          candidate.evidence = await probe(fetch, preview, candidate.after, candidate.target, candidate.evidence);
          return true;
        }, 120000, 'Inactive candidate key/management verification');
        console.log(`Candidate ${candidate.target} verified before activation; source commit: ${commit}`);
      },
    }, s);
  },
  verifyRuntime,
  verifyCron,
  async accept() {
    const current = database();
    if (current.fixtures === 0 && !state.rotating && mode !== 'resume') command('npm', ['run', 'staging:seed']);
    else if (current.fixtures !== 2) throw new Error('Staging fixtures incomplete; never reset encrypted data during rotation');
    command('npm', ['run', 'staging:smoke']);
    if (gates.f09) command('npm', ['run', 'staging:f09-acceptance']);
    if (gates.f10) command('npm', ['run', 'staging:f10-auth-acceptance']);
    if (gates.f10team) command('npm', ['run', 'staging:f10-team-acceptance']);
    if (gates.f16sms) command('npm', ['run', 'staging:f16-sms-acceptance']);
    if (gates.s01) command('npm', ['run', 'staging:s01-acceptance']);
    if (mode === 'deploy' && gates.f09 && gates.f10 && gates.s01) {
      command('npm', ['run', 'staging:s07-acceptance']);
      const readback = database();
      if (readback.pending || readback.fixtures !== 2) throw new Error('S07 C4 staging readback failed');
      const active = await cloudState();
      if (active.version !== state.target) throw new Error('S07 C4 active Worker version changed during acceptance');
      console.log(`S07 C4 staging readback passed: fixtures=2, pending=0, Worker ${state.target}, source commit ${commit}.`);
    }
  },
  async commit(s) {
    if (s.rotating) {
      finish(s, true);
      const current = database();
      if (current.pending || !samePair(current, s.after)) throw new Error('Finalized DB generation mismatch');
    }
    console.log(`S05 ${mode} accepted: Worker ${s.target}, database key pair, management canary and Cron match.`);
  },
  rollback,
  async clean() { rmSync(bundlePath, { force: true }); },
}, state);