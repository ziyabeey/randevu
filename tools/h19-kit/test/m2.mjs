import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { evidence } from '../src/core/contracts.mjs';
import { runRules } from '../src/core/dispatcher.mjs';
import { semgrepEvidence } from '../src/adapters/semgrep-evidence.mjs';
import { loadRuleCard } from '../src/rules/loader.mjs';

const mappingUrl = new URL('../rules/semgrep/sql-transaction-facts.mapping.json', import.meta.url);
const rulesUrl = new URL('../rules/semgrep/sql-transaction-facts.yml', import.meta.url);
const mapping = JSON.parse(await readFile(mappingUrl, 'utf8'));
const rulesText = await readFile(rulesUrl, 'utf8');

const ids = [...rulesText.matchAll(/^\s*-\s+id:\s*([^\s]+)\s*$/gm)].map((m) => m[1]).sort();
const mapped = mapping.checks.map((x) => x.checkId).sort();
assert.deepEqual(mapped, ids);
assert.equal(new Set(mapping.checks.map((x) => x.evidenceId)).size, mapping.checks.length);

const facts = semgrepEvidence({
  results: [{
    checkId: 'h19.sql.row-lock-present',
    path: 'demo.sql',
    start: { line: 4 },
    end: { line: 4 },
    message: 'row lock',
  }],
  checks: mapping.checks,
});
const byId = new Map(facts.map((x) => [x.id, x]));
assert.equal(byId.get('static.sql.row_lock.present').state, 'present');
assert.equal(byId.get('static.sql.idempotency.present').state, 'absent');
assert.equal(byId.get('static.sql.row_lock.present').details.matchCount, 1);

const loaded = await loadRuleCard(new URL('../rules/semantic-test-gap.v0.1.json', import.meta.url));
assert.equal(loaded.metadata.id, 'semantic-test-gap');
const findings = runRules({
  rules: [loaded.rule],
  evidences: [
    evidence('semantic.risk.high', 'present', { axis: 'D5', score: 0.91 }),
    evidence('tests.impacted', 'absent'),
  ],
});
assert.equal(findings.length, 1);
assert.equal(findings[0].id, 'H19.SEMANTIC_TEST_GAP');
assert.equal(findings[0].action, 'targeted-test');

const noFinding = runRules({
  rules: [loaded.rule],
  evidences: [
    evidence('semantic.risk.high', 'present'),
    evidence('tests.impacted', 'present'),
  ],
});
assert.equal(noFinding.length, 0);

console.log('h19-kit M2 smoke: ok');
