import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { evidence } from '../src/core/contracts.mjs';
import { runRules, route } from '../src/core/dispatcher.mjs';
import { EvidenceStore } from '../src/core/evidence-store.mjs';
import { createRunManifest } from '../src/core/run-manifest.mjs';
import { FileCache, cacheKey } from '../src/core/cache.mjs';
import { PluginRegistry } from '../src/core/plugin-registry.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { normalizeTestImpact, hasBlindSpot } from '../src/adapters/test-impact.mjs';
import { packUnits, semanticUnit } from '../src/context/packer.mjs';
import { extractSqlRoutines, routineMap } from '../src/extractors/sql-routines.mjs';
import { diffRoutineMaps } from '../src/extractors/diff-units.mjs';
import { semanticRiskWithoutTestRule, missingHistoricalCompanionRule } from '../src/rules/builtin.mjs';
import { failedPatterns, shouldBlockProposal } from '../src/ledger/experiment-memory.mjs';
import { toSarif } from '../src/reporters/sarif.mjs';

const impact = normalizeTestImpact({ changedUnits: ['a'], impactedTests: [], unknownUnits: [] });
assert.equal(hasBlindSpot(impact), true);

const findings = runRules({
  rules: [
    semanticRiskWithoutTestRule(),
    missingHistoricalCompanionRule(),
  ],
  evidences: [
    evidence('semantic.risk.high', 'present', { axis: 'D5', score: 0.91 }),
    evidence('tests.impacted', 'absent'),
    evidence('history.companion.missing', 'present', { confidence: 0.82 }),
  ],
});
assert.equal(findings.length, 2);
assert.equal(route(findings), 'escalate');

const packed = packUnits([
  semanticUnit({ id: 'low', path: 'a.sql', patch: '+x', priority: 1 }),
  semanticUnit({ id: 'high', path: 'b.sql', patch: '+y', priority: 9 }),
], { maxTokens: 100, reserveTokens: 10 });
assert.equal(packed.selected[0].id, 'high');

const ledger = {
  experiments: [{
    id: 'H19t',
    status: 'failed',
    result: 'threshold did not fix overlap',
    anti_patterns: ['Threshold tuning as a fix for D1/D5 overlap.'],
  }],
};
assert.equal(failedPatterns(ledger).length, 1);
assert.equal(shouldBlockProposal(ledger, 'threshold tuning')?.experiment, 'H19t');

const sqlBefore = `
create or replace function public.demo(p_id uuid)
returns void
language plpgsql
as $demo$
begin
  perform 1 from public.items where id=p_id for update;
end
$demo$;
`;
const sqlAfter = `
create or replace function public.demo(p_id uuid)
returns void
language plpgsql
as $demo$
begin
  perform 1 from public.items where id=p_id;
end
$demo$;
`;
const beforeRoutines = extractSqlRoutines(sqlBefore, { path: 'before.sql' });
assert.equal(beforeRoutines.length, 1);
assert.equal(beforeRoutines[0].id, 'public.demo/1');
const changed = diffRoutineMaps(
  routineMap(sqlBefore, { path: 'before.sql' }),
  routineMap(sqlAfter, { path: 'after.sql' }),
);
assert.equal(changed.length, 1);
assert.equal(changed[0].changeKind, 'modified');

const store = new EvidenceStore();
const stored = store.put({
  id: 'static.row_lock_removed',
  state: 'present',
  producer: 'sql-extractor',
  producerVersion: '0.1.0',
  inputDigest: changed[0].afterBodySha256,
  source: 'after.sql',
});
assert.match(stored.provenanceDigest, /^[a-f0-9]{64}$/);
assert.equal(store.snapshot().items.length, 1);

const plugins = new PluginRegistry();
plugins.register({
  id: 'demo',
  kind: 'static',
  version: '1.0.0',
  run: async () => [],
});
assert.equal(plugins.list('static').length, 1);

const config = await loadConfig();
assert.equal(config.version, 1);
assert.equal(config.policy.unknown, 'escalate');

const manifestA = createRunManifest({
  repository: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
  config,
  adapters: plugins.list(),
  units: changed.map((x) => ({ id: x.id, digest: x.afterBodySha256 })),
});
const manifestB = createRunManifest({
  repository: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
  config,
  adapters: plugins.list(),
  units: changed.map((x) => ({ id: x.id, digest: x.afterBodySha256 })),
});
assert.equal(manifestA.runId, manifestB.runId);
assert.match(manifestA.runId, /^[a-f0-9]{64}$/);

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-kit-'));
try {
  const cache = new FileCache(temp);
  const key = cacheKey('demo', { b: 2, a: 1 });
  const file = await cache.set('demo', key, { ok: true });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).ok, true);
  assert.equal((await cache.get('demo', key)).ok, true);
} finally {
  await rm(temp, { recursive: true, force: true });
}

const sarif = toSarif(findings);
assert.equal(sarif.version, '2.1.0');
assert.equal(sarif.runs[0].results.length, 2);

console.log('h19-kit smoke: ok');
