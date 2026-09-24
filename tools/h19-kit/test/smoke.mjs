import assert from 'node:assert/strict';
import { evidence, finding, ruleCard } from '../src/core/contracts.mjs';
import { runRules, route } from '../src/core/dispatcher.mjs';
import { normalizeTestImpact, hasBlindSpot } from '../src/adapters/test-impact.mjs';
import { toSarif } from '../src/reporters/sarif.mjs';

const e = evidence('semantic.d5.high', 'present', { score: 0.91 });
const rule = ruleCard({
  id: 'test-gap-on-d5',
  version: '0.1.0',
  consumes: ['semantic.d5.high', 'tests.impact.known'],
  evaluate: ({ evidence: x }) => {
    if (x['semantic.d5.high'].state === 'present' && x['tests.impact.known'].state === 'absent') {
      return finding({
        id: 'H19.TEST_GAP',
        title: 'High semantic risk has no impacted test',
        severity: 'warning',
        source: 'rule:test-gap-on-d5',
        action: 'targeted-test',
        evidenceIds: ['semantic.d5.high', 'tests.impact.known'],
      });
    }
  },
});

const fs = runRules({
  rules: [rule],
  evidences: [e, evidence('tests.impact.known', 'absent')],
});
assert.equal(fs.length, 1);
assert.equal(route(fs), 'targeted-test');

const impact = normalizeTestImpact({ changedUnits: ['a'], impactedTests: [], unknownUnits: [] });
assert.equal(hasBlindSpot(impact), true);

const sarif = toSarif(fs);
assert.equal(sarif.version, '2.1.0');
assert.equal(sarif.runs[0].results[0].ruleId, 'H19.TEST_GAP');

console.log('h19-kit smoke: ok');
