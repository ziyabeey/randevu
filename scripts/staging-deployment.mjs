import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const KEY_NAMES = ['PUBLIC_BOOKING_GATE_SECRET', 'NOTIFICATION_DISPATCH_SECRET', 'MANAGEMENT_LINK_ENCRYPTION_KEY_V1'];
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const sign = (hash, value) => createHmac('sha256', Buffer.from(hash, 'hex')).update(value).digest('hex');
const equal = (a, b) => /^[a-f0-9]{64}$/.test(a ?? '') && /^[a-f0-9]{64}$/.test(b ?? '') && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// The hosted API accepts only latest (observed 10057 for explicit UUIDs).
// Inheritance is not proof: only deployCandidate may activate the uploaded code,
// after source lineage and its actual runtime keys have been verified.
export function inheritBindings(config, source, supplied) {
  if (source !== null && (!UUID.test(source?.id) || !Number.isSafeInteger(source?.number) || source.number < 1)) throw new Error('Invalid inheritance source');
  const required = config.secrets?.required ?? [];
  if (!KEY_NAMES.every((name) => required.includes(name))) throw new Error('Critical required-secret contract missing');
  const inherited = KEY_NAMES.filter((name) => !Object.hasOwn(supplied, name));
  if (inherited.length && !source) throw new Error('Bootstrap requires all critical secrets');
  const existing = config.unsafe?.bindings ?? [];
  if (existing.some((binding) => KEY_NAMES.includes(binding.name))) throw new Error('Conflicting critical binding');
  // Wrangler rejects a name declared both in secrets.required and unsafe.
  // Explicit inherit with bindings_inherit=strict validates existence instead.
  return { ...config, secrets: { ...config.secrets, required: required.filter((name) => !inherited.includes(name)) }, unsafe: { ...config.unsafe, bindings: [
    ...existing, ...inherited.map((name) => ({ name, type: 'inherit', version_id: 'latest' })),
  ] } };
}

export function captureUploadSource(cloud) {
  if (!cloud.version && cloud.versions.length === 0) return null;
  const source = cloud.versions[0]; // Provider contract: newest version first.
  if (!UUID.test(source?.id) || !Number.isSafeInteger(source?.number) || source.number < 1) throw new Error('Missing upload source sequence');
  if (cloud.legacy && source.id !== cloud.version) throw new Error('Legacy baseline requires latest to be active; resolve the orphan without changing management keys');
  return { id: source.id, number: source.number };
}

export function uploadedCandidate(cloud, state, source) {
  if (cloud.version !== state.previous) throw new Error('Active deployment changed during upload');
  const matches = cloud.versions.filter((version) => version.annotations?.['workers/tag'] === state.operation);
  if (matches.length !== 1 || matches[0].id !== cloud.versions[0]?.id || !UUID.test(matches[0].id)) throw new Error('Uploaded candidate is missing, ambiguous or no longer latest');
  const candidate = matches[0];
  if (!Number.isSafeInteger(candidate.number) || candidate.number !== (source?.number ?? 0) + 1
      || (source ? cloud.versions[1]?.id !== source.id : cloud.versions.length !== 1)) throw new Error('Concurrent upload or incomplete source lineage; candidate stays inactive');
  return candidate.id;
}

export function previewOrigin(origin, version) {
  if (!UUID.test(version)) throw new Error('Invalid preview version');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)) throw new Error('Invalid staging preview origin');
  return `https://${version.slice(0, 8)}-${url.hostname}`;
}

// The provider upload and activation are intentionally separate. Unknown old
// code is never asked to attest: prove the bindings in our fresh reviewed build.
export async function deployCandidate(io, state) {
  const before = await io.cloudState();
  if (before.version !== state.previous && (!state.target || before.version !== state.target)) throw new Error('Unrelated active deployment before candidate verification');
  if (state.previous && !state.legacy && !state.evidence.canary) throw new Error('Modern deployment requires the old management canary');
  if (!state.target) {
    const source = captureUploadSource(before);
    await io.upload(state, source);
    state.target = uploadedCandidate(await io.cloudState(), state, source);
  }
  await io.configureTriggers();
  await io.verifyCandidate(state);
  const current = await io.cloudState();
  if (current.version !== state.previous && current.version !== state.target) throw new Error('Active deployment changed before activation');
  await io.verifyDatabase(state);
  if (current.version !== state.target) await io.activate(state.target);
}

export function secretBundle(env, generated = {}) {
  const payload = {
    SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    COOKIE_SECURE: 'true', RESEND_API_KEY: env.RESEND_API_KEY,
    NOTIFICATION_FROM_EMAIL: env.NOTIFICATION_FROM_EMAIL, PUBLIC_APP_ORIGIN: env.STAGING_APP_ORIGIN,
  };
  const zernioNames = ['ZERNIO_API_KEY', 'ZERNIO_WHATSAPP_ACCOUNT_ID', 'ZERNIO_WHATSAPP_TEMPLATE_NAME'];
  const zernioValues = zernioNames.map((name) => typeof env[name] === 'string' ? env[name].trim() : '');
  const configuredZernio = zernioValues.filter(Boolean).length;
  if (configuredZernio !== 0 && configuredZernio !== zernioNames.length) {
    throw new Error('Zernio WhatsApp Worker settings must be supplied as a complete tuple');
  }
  if (configuredZernio === zernioNames.length) {
    for (let index = 0; index < zernioNames.length; index += 1) payload[zernioNames[index]] = zernioValues[index];
    payload.ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE =
      typeof env.ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE === 'string' && env.ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE.trim()
        ? env.ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE.trim()
        : 'tr';
  }
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

export async function readCloudState(cf, scriptRoot, allowEmptyBootstrap = false) {
  const versions = (await cf(`${scriptRoot}/versions`, {}, true))?.items ?? [];
  if (!versions.length) return { version: null, versions, legacy: false };
  const deployments = (await cf(`${scriptRoot}/deployments`))?.deployments ?? [];
  if (allowEmptyBootstrap && deployments.length === 0) return { version: null, versions, legacy: false };
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
