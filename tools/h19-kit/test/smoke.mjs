import assert from 'node:assert/strict';
import { evidence } from '../src/core/contracts.mjs';
import { runRules, route } from '../src/core/dispatcher.mjs';
import { normalizeTestImpact, hasBlindSpot } from '../src/adapters/test-impact.mjs';
import { packUnits, semanticUnit } from '../src/context/packer.mjs';
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

const sarif = toSarif(findings);
assert.equal(sarif.version, '2.1.0');
assert.equal(sarif.runs[0].results.length, 2);

console.log('h19-kit smoke: ok');
