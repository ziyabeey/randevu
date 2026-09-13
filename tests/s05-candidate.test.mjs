import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { captureUploadSource, uploadedCandidate, previewOrigin, deployCandidate, newKeys, keyPair, probe } from '../scripts/staging-deployment.mjs';

const previous = '50500000-0000-4000-8000-000000000001';
const orphan = '50500001-0000-4000-8000-000000000002';
const target = '50500002-0000-4000-8000-000000000003';
const foreign = '50500003-0000-4000-8000-000000000004';
const origin = 'https://staging.fixture.workers.dev';
const keys = newKeys(true);
const pair = keyPair(keys);
const activeEnv = { ...keys, PUBLIC_APP_ORIGIN: origin, DEPLOYMENT_PROBE_ENABLED: 'true', WORKER_VERSION: { id: previous } };

test('S05 preview quarantine blocks every non-probe route before auth, booking or DB access', async () => {
  const original = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('preview reached an external API'); };
  try {
    for (const [method, path] of [
      ['GET', '/api/health'], ['GET', '/api/auth/session'], ['POST', '/api/auth/sign-in'],
      ['POST', '/api/public/business/fixture/book'], ['POST', '/api/public/booking/recover'],
      ['POST', '/api/manage/cancel'], ['POST', '/api/deployment-health'], ['GET', '/future-route'],
      ['POST', '/api/%70ublic/business/fixture/book'], ['OPTIONS', '/api/auth/session'],
    ]) {
      const request = new Request(`https://preview.fixture.workers.dev${path}`, { method, headers: { Origin: origin } });
      const response = await app.fetch(request, activeEnv);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await app.fetch(new Request(`${origin}/api/health`), activeEnv)).status, 200);
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = original; }
});

test('S05 upload lineage rejects missing sequence, concurrent uploads and legacy orphans', () => {
  const cloud = { version: previous, legacy: true, versions: [{ id: previous, number: 10 }] };
  const source = captureUploadSource(cloud);
  assert.deepEqual(source, { id: previous, number: 10 });
  assert.throws(() => captureUploadSource({ ...cloud, versions: [{ id: orphan, number: 11 }, ...cloud.versions] }), /Legacy baseline/);
  assert.throws(() => captureUploadSource({ ...cloud, versions: [{ id: previous }] }), /sequence/);
  const uploaded = { version: previous, versions: [{ id: target, number: 11, annotations: { 'workers/tag': 'op' } }, ...cloud.versions] };
  assert.equal(uploadedCandidate(uploaded, { previous, operation: 'op' }, source), target);
  assert.throws(() => uploadedCandidate({ ...uploaded, version: foreign }, { previous, operation: 'op' }, source), /Active deployment/);
  assert.throws(() => uploadedCandidate({ ...uploaded, versions: [{ ...uploaded.versions[0], number: 12 }, { id: foreign, number: 11 }, ...cloud.versions] }, { previous, operation: 'op' }, source), /Concurrent upload/);
  assert.throws(() => uploadedCandidate({ ...uploaded, versions: [{ id: foreign, number: 12 }, ...uploaded.versions] }, { previous, operation: 'op' }, source), /no longer latest/);
  assert.equal(previewOrigin(origin, target), 'https://50500002-staging.fixture.workers.dev');
  assert.throws(() => previewOrigin('https://evil.example', target), /preview origin/);
});

async function fixture(candidateKeys = keys, latestIsOrphan = true) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(new URL(url).origin);
    const id = new URL(url).origin === origin ? previous : target;
    return app.fetch(new Request(url, options), { ...activeEnv, ...(id === target ? candidateKeys : {}), WORKER_VERSION: { id } });
  };
  const evidence = await probe(fetcher, origin, pair, previous);
  calls.length = 0;
  const source = latestIsOrphan ? { id: orphan, number: 11 } : { id: previous, number: 10 };
  let cloud = { version: previous, legacy: false, versions: [source] };
  let activations = 0;
  const events = [];
  const state = { previous, target: null, operation: 'op', legacy: false, evidence, after: pair };
  const io = {
    async cloudState() { return cloud; },
    async upload(_state, selected) {
      assert.deepEqual(selected, source);
      events.push('upload');
      cloud = { ...cloud, versions: [{ id: target, number: source.number + 1, annotations: { 'workers/tag': 'op' } }, source] };
    },
    async configureTriggers() { events.push('triggers'); },
    async verifyCandidate(s) {
      events.push('candidate proof');
      s.evidence = await probe(fetcher, previewOrigin(origin, s.target), s.after, s.target, s.evidence);
    },
    async verifyDatabase() { events.push('DB ownership'); },
    async activate(id) { assert.equal(id, target); activations++; events.push('activate'); cloud.version = target; },
  };
  return { io, state, calls, events, activations: () => activations, setCloud: (value) => { cloud = value; } };
}

test('S05 fresh trusted candidate proves same-key orphan inheritance before exact activation', async () => {
  const f = await fixture();
  await deployCandidate(f.io, f.state);
  assert.deepEqual(f.events, ['upload', 'triggers', 'candidate proof', 'DB ownership', 'activate']);
  assert.equal(f.activations(), 1);
  assert.deepEqual(f.calls, [previewOrigin(origin, target)], 'never execute the orphan to establish trust');
});

for (const [name, candidateKeys] of [
  ['aborted rotation gate pair', { ...keys, ...newKeys() }],
  ['changed management key', { ...keys, MANAGEMENT_LINK_ENCRYPTION_KEY_V1: newKeys(true).MANAGEMENT_LINK_ENCRYPTION_KEY_V1 }],
]) {
  test(`S05 ${name} inherited from latest is rejected without activation`, async () => {
    const f = await fixture(candidateKeys);
    await assert.rejects(deployCandidate(f.io, f.state), /Runtime probe unavailable/);
    assert.equal(f.activations(), 0);
    assert.equal(f.events.includes('DB ownership'), false);
  });
}

test('S05 explicit rotation after proven abort can replace the pair while preserving old management', async () => {
  const next = { ...keys, ...newKeys() };
  const f = await fixture(next);
  f.state.after = keyPair(next);
  await deployCandidate(f.io, f.state);
  assert.equal(f.activations(), 1);
});

test('S05 DB ownership or active-release changes after proof prevent activation', async () => {
  const dbChanged = await fixture();
  await assert.rejects(deployCandidate({ ...dbChanged.io, verifyDatabase() { throw new Error('DB changed'); } }, dbChanged.state), /DB changed/);
  assert.equal(dbChanged.activations(), 0);
  const activeChanged = await fixture();
  const verify = activeChanged.io.verifyCandidate;
  activeChanged.io.verifyCandidate = async (state) => {
    await verify(state);
    activeChanged.setCloud({ version: foreign, versions: [] });
  };
  await assert.rejects(deployCandidate(activeChanged.io, activeChanged.state), /Active deployment changed/);
  assert.equal(activeChanged.activations(), 0);
});

test('S05 resume proves its existing candidate and preserves DB checks without another upload', async () => {
  const f = await fixture();
  f.state.target = target;
  f.io.upload = async () => { throw new Error('resume uploaded again'); };
  await deployCandidate(f.io, f.state);
  assert.deepEqual(f.events, ['triggers', 'candidate proof', 'DB ownership', 'activate']);
});
