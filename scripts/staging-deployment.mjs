import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const KEY_NAMES = ['PUBLIC_BOOKING_GATE_SECRET', 'NOTIFICATION_DISPATCH_SECRET', 'MANAGEMENT_LINK_ENCRYPTION_KEY_V1'];
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const sign = (hash, value) => createHmac('sha256', Buffer.from(hash, 'hex')).update(value).digest('hex');
const equal = (a, b) => /^[a-f0-9]{64}$/.test(a ?? '') && /^[a-f0-9]{64}$/.test(b ?? '') && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Wrangler's API defaults inherit to latest *uploaded* version, not active.
// Pin all omitted critical bindings, including management, to the proven version.
export function pinBindings(config, version, supplied) {
  if (version !== null && !UUID.test(version)) throw new Error('Invalid inheritance version');
  const required = config.secrets?.required ?? [];
  if (!KEY_NAMES.every((name) => required.includes(name))) throw new Error('Critical required-secret contract missing');
  const inherited = KEY_NAMES.filter((name) => !Object.hasOwn(supplied, name));
  if (inherited.length && !version) throw new Error('Bootstrap requires all critical secrets');
  const existing = config.unsafe?.bindings ?? [];
  if (existing.some((binding) => KEY_NAMES.includes(binding.name))) throw new Error('Conflicting critical binding');
  // Wrangler rejects a name declared both in secrets.required and unsafe.
  // Explicit inherit with bindings_inherit=strict validates existence instead.
  return { ...config, secrets: { ...config.secrets, required: required.filter((name) => !inherited.includes(name)) }, unsafe: { ...config.unsafe, bindings: [
    ...existing, ...inherited.map((name) => ({ name, type: 'inherit', version_id: version })),
  ] } };
}

export function secretBundle(env, generated = {}) {
  const payload = {
    SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    COOKIE_SECURE: 'true', RESEND_API_KEY: env.RESEND_API_KEY,
    NOTIFICATION_FROM_EMAIL: env.NOTIFICATION_FROM_EMAIL, PUBLIC_APP_ORIGIN: env.STAGING_APP_ORIGIN,
  };
  for (const name of KEY_NAMES) if (Object.hasOwn(generated, name)) payload[name] = generated[name];
  if (Object.values(payload).some((value) => typeof value !== 'string' || !value)) throw new Error('Worker configuration incomplete');
  return payload;
}
export function newKeys(bootstrap = false) {
  return {
    PUBLIC_BOOKING_GATE_SECRET: randomBytes(48).toString('base64url'),
    NOTIFICATION_DISPATCH_SECRET: randomBytes(48).toString('base64url'),
    ...(bootstrap ? { MANAGEMENT_LINK_ENCRYPTION_KEY_V1: randomBytes(32).toString('base64url') } : {}),
  };
}
export function keyPair(keys) {
  return { gate: sha256(keys.PUBLIC_BOOKING_GATE_SECRET), dispatch: sha256(keys.NOTIFICATION_DISPATCH_SECRET) };
}
export function challenge(pair, version, evidence = {}, now = Date.now()) {
  const value = { nonce: evidence.nonce ?? randomBytes(32).toString('hex'), expires: Math.floor(now / 1000) + 60, version,
    ...(evidence.canary ? { canary: evidence.canary } : {}) };
  const raw = Buffer.from(JSON.stringify(value)).toString('base64url');
  return { value, raw, headers: { 'X-Deployment-Challenge': raw, Authorization: `Deployment ${sign(pair.gate, `s05:request:${raw}`)}` } };
}
export function verifyProof(pair, request, response, evidence = {}) {
  if (!response || response.version !== request.value.version) throw new Error('Runtime version proof mismatch');
  const payload = { version: response.version, dispatch: response.dispatch, management: response.management, canary: response.canary };
  if (!equal(response.proof, sign(pair.gate, `s05:response:${request.raw}:${JSON.stringify(payload)}`))
      || !equal(response.dispatch, sign(pair.dispatch, `s05:dispatch:${request.value.nonce}:${response.version}`))
      || !/^[a-f0-9]{64}$/.test(response.management ?? '')
      || (evidence.management && !equal(response.management, evidence.management))
      || !/^[A-Za-z0-9_-]{16}$/.test(response.canary?.iv ?? '')
      || !/^[A-Za-z0-9_-]{107}$/.test(response.canary?.ciphertext ?? '')) throw new Error('Runtime key or management proof mismatch');
  return { ...evidence, nonce: request.value.nonce, management: response.management, canary: response.canary };
}
export async function probe(fetcher, origin, pair, version, evidence = {}) {
  const request = challenge(pair, version, evidence);
  const response = await fetcher(`${origin}/api/deployment-health`, {
    headers: request.headers, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Runtime probe unavailable');
  return verifyProof(pair, request, await response.json(), evidence);
}

export function requireResumeContract(pending, commit, gates) {
  if (pending.commit_sha !== commit) throw new Error('Resume must run the original rotation commit; use rollback before deploying a repair');
  for (const name of ['f10', 's01']) {
    if (pending.evidence.gates[name] && !gates[name]) throw new Error('Resume cannot drop a required acceptance gate');
  }
  if (pending.evidence.gates.s01 && gates.mailbox !== pending.evidence.gates.mailbox) throw new Error('Resume requires the original S01 mailbox');
}

// Same state machine used by the live adapter and injected failure tests.
// Rollback never revokes either generation until old version + proofs are known.
export async function executeCutover(io, state) {
  let committed = false;
  try {
    await io.prepare(state);
    await io.deploy(state);
    await io.verifyRuntime(state);
    await io.verifyCron(state);
    await io.accept(state);
    await io.verifyRuntime(state);
    await io.commit(state);
    committed = true;
  } catch (error) {
    if (!committed) {
      try { await io.rollback(state); }
      catch { throw new Error('Deployment failed; rollback is unproven. Both key generations are retained. Use the S05 recovery runbook.'); }
    }
    throw error;
  } finally {
    await io.clean();
  }
}

export async function readCloudState(cf, scriptRoot) {
  const versions = (await cf(`${scriptRoot}/versions`, {}, true))?.items ?? [];
  if (!versions.length) return { version: null, versions, legacy: false };
  const deployments = (await cf(`${scriptRoot}/deployments`))?.deployments ?? [];
  const traffic = deployments[0]?.versions ?? [];
  if (traffic.length !== 1 || traffic[0].percentage !== 100) throw new Error('Staging requires one active version at 100%; resolve unassigned/split traffic first');
  const version = traffic[0].version_id;
  if (!UUID.test(version)) throw new Error('Invalid Cloudflare version');
  const detail = await cf(`${scriptRoot}/versions/${version}`);
  const bindings = detail.resources?.bindings ?? [];
  if (!KEY_NAMES.every((name) => bindings.some((binding) => binding.name === name && binding.type === 'secret_text'))) {
    throw new Error('Existing Worker is missing a critical secret; bootstrap cannot replace established keys');
  }
  const legacy = !bindings.some((binding) => binding.name === 'WORKER_VERSION' && binding.type === 'version_metadata');
  return { version, versions, detail, legacy };
}

const pairsEqual = (a, b) => a.gate === b.gate && a.dispatch === b.dispatch;
export async function rollbackTransition(io, state) {
  const { database, cloudState, activate, verifyRuntime, verifyCron, finish, log } = io;
  if (!state.prepared || !state.previous) return; // Empty bootstrap has no prior release to invent.
  const db = database();
  if (state.rotating && !db.pending && pairsEqual(db, state.after)) {
    // A lost commit acknowledgement must never roll back an already revoked key.
    log('Rotation already finalized; keeping the verified candidate version.');
    return;
  }
  if (!pairsEqual(db, state.before) || (db.pending && db.pending.operation_id !== state.operation)) throw new Error('Rollback DB state conflict');
  const cloud = await cloudState();
  const ownCandidate = cloud.detail?.annotations?.['workers/tag'] === state.operation;
  if (cloud.version !== state.previous && !ownCandidate) throw new Error('Rollback found an unrelated deployment');
  state.since = db.now;
  if (cloud.version !== state.previous) await activate(state.previous);
  await verifyRuntime(state, true);
  await verifyCron(state, true);
  if (state.rotating && database().pending) finish(state, false);
  log(`Previous version ${state.previous} verified; current DB keys retained.`);
}
