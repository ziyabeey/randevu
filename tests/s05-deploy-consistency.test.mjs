import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import app from '../worker/app.ts';
import { recordStagingHeartbeat } from '../worker/deployment-health.ts';
import { KEY_NAMES, newKeys, keyPair, challenge, verifyProof, pinBindings, secretBundle, executeCutover, requireResumeContract } from '../scripts/staging-deployment.mjs';
const oldVersion = '50500000-0000-4000-8000-000000000001';
const nextVersion = '50500000-0000-4000-8000-000000000002';
const keys = newKeys(true);
const pair = keyPair(keys);
const env = { ...keys, DEPLOYMENT_PROBE_ENABLED: 'true', WORKER_VERSION: { id: oldVersion } };
function request(proof) {
  return new Request('https://staging.example/api/deployment-health', { headers: proof.headers });
}

test('S05 authenticated probe proves the pair and decrypts a pre-deploy canary after rotation', async () => {
  const first = challenge(pair, oldVersion);
  const response = await app.fetch(request(first), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  const evidence = verifyProof(pair, first, body);
  const nextKeys = { ...keys, ...newKeys() };
  const nextPair = keyPair(nextKeys);
  const next = challenge(nextPair, nextVersion, evidence);
  const nextResponse = await app.fetch(request(next), { ...env, ...nextKeys, WORKER_VERSION: { id: nextVersion } });
  assert.equal(nextResponse.status, 200);
  assert.deepEqual(verifyProof(nextPair, next, await nextResponse.json(), evidence).canary, evidence.canary);
  const serialized = JSON.stringify(body);
  for (const secret of [...Object.values(keys), ...Object.values(pair)]) assert.equal(serialized.includes(secret), false);
});

test('S05 probe rejects absent/forged/expired/version-mismatched challenges and is disabled outside staging', async () => {
  const valid = challenge(pair, oldVersion);
  const cases = [
    new Request('https://staging.example/api/deployment-health'),
    request({ headers: { ...valid.headers, Authorization: `Deployment ${'0'.repeat(64)}` } }),
    request(challenge(pair, oldVersion, {}, Date.now() - 120000)),
    request(challenge(pair, oldVersion, {}, Date.now() + 120000)),
    request(challenge(pair, nextVersion)),
    request({ headers: { ...valid.headers, 'X-Deployment-Challenge': 'a'.repeat(2049) } }),
  ];
  for (const req of cases) {
    const result = await app.fetch(req, env);
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { error: 'DEPLOYMENT_PROBE_DENIED' });
  }
  assert.equal((await app.fetch(request(valid), { ...env, DEPLOYMENT_PROBE_ENABLED: undefined })).status, 404);
});

test('S05 proof refuses mixed generations, altered responses and changed management key', async () => {
  const proof = challenge(pair, oldVersion);
  const body = await (await app.fetch(request(proof), env)).json();
  assert.throws(() => verifyProof({ ...pair, dispatch: 'f'.repeat(64) }, proof, body));
  assert.throws(() => verifyProof(pair, proof, { ...body, version: nextVersion }));
  assert.throws(() => verifyProof(pair, proof, { ...body, canary: { ...body.canary, iv: 'x'.repeat(16) } }));
  const evidence = verifyProof(pair, proof, body);
  const post = challenge(pair, oldVersion, evidence);
  const changedKey = { ...env, MANAGEMENT_LINK_ENCRYPTION_KEY_V1: randomBytes(32).toString('base64url') };
  assert.equal((await app.fetch(request(post), changedKey)).status, 403, 'old AES-GCM canary must no longer decrypt');
});

test('S05 pins omitted secrets to the proven active version, including after an orphan candidate upload', () => {
  const config = { secrets: { required: KEY_NAMES } };
  const routine = pinBindings(config, oldVersion, {});
  assert.deepEqual(routine.unsafe.bindings, KEY_NAMES.map((name) => ({ name, type: 'inherit', version_id: oldVersion })));
  const rotation = pinBindings(config, oldVersion, newKeys());
  assert.deepEqual(rotation.unsafe.bindings, [{ name: KEY_NAMES[2], type: 'inherit', version_id: oldVersion }]);
  assert.deepEqual(pinBindings(config, null, newKeys(true)).unsafe.bindings, []);
  assert.throws(() => pinBindings(config, null, {}));
  assert.throws(() => pinBindings(config, 'latest', {}));
  const supplied = secretBundle({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public', RESEND_API_KEY: 'sending',
    NOTIFICATION_FROM_EMAIL: 'test@example.com', STAGING_APP_ORIGIN: 'https://example.com', SUPABASE_ADMIN_KEY: 'never-deploy', ...keys });
  assert.equal('SUPABASE_ADMIN_KEY' in supplied, false);
  for (const name of KEY_NAMES) assert.equal(name in supplied, false, 'routine must not source critical keys from ambient env');
});

test('S05 scheduled heartbeat is bounded, carries actual version and cannot block delivery on network failure', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/record_staging_cron_heartbeat');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { p_dispatch_secret: keys.NOTIFICATION_DISPATCH_SECRET, p_version_id: oldVersion });
    assert.equal('Authorization' in options.headers, false);
    throw new Error('simulated network failure');
  };
  try {
    await recordStagingHeartbeat({ ...env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public' });
    await recordStagingHeartbeat({ ...env, DEPLOYMENT_PROBE_ENABLED: undefined });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

// Fault injection exercises the orchestration used by the live adapter. The SQL
// and provider-facing behavior have separate PG and real-staging acceptance.
for (const failure of ['prepare', 'deploy', 'verifyRuntime', 'verifyCron', 'accept']) {
  test(`S05 ${failure} failure keeps old keys until rollback proof, and rerun succeeds`, async () => {
    let active = 'old'; let pending = false; let current = 'old'; let cleaned = 0;
    let injected = true;
    const io = {
      async prepare() { pending = true; if (injected && failure === 'prepare') throw new Error('injected'); },
      async deploy() { if (injected && failure === 'deploy') throw new Error('injected after upload'); active = 'new'; },
      async verifyRuntime() { assert.ok(pending); if (injected && failure === 'verifyRuntime') throw new Error('injected'); },
      async verifyCron() { if (injected && failure === 'verifyCron') throw new Error('injected'); },
      async accept() { if (injected && failure === 'accept') throw new Error('injected'); },
      async commit() { assert.equal(active, 'new'); current = 'new'; pending = false; },
      async rollback() { assert.equal(current, 'old'); assert.ok(pending); active = 'old'; pending = false; },
      async clean() { cleaned++; },
    };
    await assert.rejects(executeCutover(io, {}), /injected/);
    assert.equal(active, 'old'); assert.equal(current, 'old'); assert.equal(pending, false);
    injected = false;
    await executeCutover(io, {});
    assert.equal(active, 'new'); assert.equal(current, 'new'); assert.equal(pending, false); assert.equal(cleaned, 2);
  });
}
test('S05 uncertain rollback retains overlap and does not invoke commit', async () => {
  let pending = false; let committed = false;
  const io = {
    async prepare() { pending = true; }, async deploy() { throw new Error('deploy failed'); },
    async rollback() { throw new Error('old proof unavailable'); }, async commit() { committed = true; }, async clean() {},
  };
  await assert.rejects(executeCutover(io, {}), /Both key generations are retained/);
  assert.equal(pending, true); assert.equal(committed, false);
});
test('S05 resume cannot lower the original acceptance contract or change source commit', () => {
  const pending = { commit_sha: 'a'.repeat(40), evidence: { gates: { f10: true, s01: true, mailbox: 'safe@example.com' } } };
  assert.throws(() => requireResumeContract(pending, 'b'.repeat(40), {}), /original rotation commit/);
  assert.throws(() => requireResumeContract(pending, pending.commit_sha, { f10: false }), /drop/);
  assert.throws(() => requireResumeContract(pending, pending.commit_sha, { f10: true, s01: true, mailbox: 'other@example.com' }), /mailbox/);
  requireResumeContract(pending, pending.commit_sha, pending.evidence.gates);
});

test('S05 real Cloudflare adapter fails closed for orphan bootstrap and split traffic, but resolves an active version despite orphan uploads', async () => {
  const { readCloudState } = await import('../scripts/staging-deployment.mjs');
  let traffic = [];
  const cf = async (url) => {
    if (url.endsWith('/versions')) return { items: [{ id: nextVersion }, { id: oldVersion }] };
    if (url.endsWith('/deployments')) return { deployments: [{ versions: traffic }] };
    if (url.endsWith(`/versions/${oldVersion}`)) return { resources: { bindings: KEY_NAMES.map((name) => ({ name, type: 'secret_text' })) } };
    throw new Error('unexpected control-plane request');
  };
  await assert.rejects(readCloudState(cf, 'https://local/script'), /resolve unassigned\/split traffic/);
  traffic = [{ version_id: oldVersion, percentage: 50 }, { version_id: nextVersion, percentage: 50 }];
  await assert.rejects(readCloudState(cf, 'https://local/script'), /100%/);
  traffic = [{ version_id: oldVersion, percentage: 100 }];
  const actual = await readCloudState(cf, 'https://local/script');
  assert.equal(actual.version, oldVersion);
  assert.equal(actual.versions[0].id, nextVersion, 'orphan uploaded latest must not become inheritance source');
  assert.equal(actual.legacy, true);
});

test('S05 real rollback adapter preserves finalized keys after lost commit acknowledgement', async () => {
  const { rollbackTransition } = await import('../scripts/staging-deployment.mjs');
  const after = { gate: 'new-gate-hash', dispatch: 'new-dispatch-hash' };
  let touched = false;
  await rollbackTransition({ database: () => ({ ...after, pending: null }), log() {},
    activate: async () => { touched = true; }, finish: () => { touched = true; } }, {
    prepared: true, previous: oldVersion, rotating: true, after,
  });
  assert.equal(touched, false, 'a commit response loss must not reactivate revoked old keys');
});

test('S05 real rollback adapter requires previous version and canary/Cron proof before removing overlap', async () => {
  const { rollbackTransition } = await import('../scripts/staging-deployment.mjs');
  const state = { prepared: true, previous: oldVersion, rotating: true, operation: 'op', before: pair, after: { gate: 'n', dispatch: 'd' } };
  const events = [];
  const db = { ...pair, pending: { operation_id: 'op' }, now: new Date().toISOString() };
  const io = {
    database: () => db,
    cloudState: async () => ({ version: nextVersion, detail: { annotations: { 'workers/tag': 'op' } } }),
    activate: async (id) => { assert.equal(id, oldVersion); events.push('activate old'); },
    verifyRuntime: async (_state, old) => { assert.equal(old, true); events.push('old HTTP/canary proof'); },
    verifyCron: async (_state, old) => { assert.equal(old, true); events.push('old Cron proof'); },
    finish: (_state, promote) => { assert.equal(promote, false); events.push('remove pending'); }, log() {},
  };
  await rollbackTransition(io, { ...state });
  assert.deepEqual(events, ['activate old', 'old HTTP/canary proof', 'old Cron proof', 'remove pending']);
  events.length = 0;
  await assert.rejects(rollbackTransition({ ...io, verifyRuntime: async () => { throw new Error('wrong key'); } }, { ...state }), /wrong key/);
  assert.deepEqual(events, ['activate old'], 'failed proof must retain both generations');
  events.length = 0;
  await assert.rejects(rollbackTransition({ ...io, cloudState: async () => ({ version: nextVersion, detail: {} }) }, { ...state }), /unrelated deployment/);
  assert.deepEqual(events, [], 'another operator deployment must not be overwritten');
});
