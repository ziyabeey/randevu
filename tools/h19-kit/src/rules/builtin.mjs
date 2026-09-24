import { finding, ruleCard } from '../core/contracts.mjs';

export function semanticRiskWithoutTestRule({
  semanticEvidence = 'semantic.risk.high',
  testEvidence = 'tests.impacted',
} = {}) {
  return ruleCard({
    id: 'H19.SEMANTIC_TEST_GAP',
    version: '0.1.0',
    consumes: [semanticEvidence, testEvidence],
    evaluate: ({ evidence }) => {
      const risk = evidence[semanticEvidence];
      const tests = evidence[testEvidence];
      if (risk.state !== 'present') return null;
      if (tests.state === 'unknown') return finding({
        id: 'H19.TEST_IMPACT_UNKNOWN',
        title: 'High semantic risk but test impact is unknown',
        severity: 'warning',
        source: 'builtin:semanticRiskWithoutTestRule',
        action: 'escalate',
        evidenceIds: [semanticEvidence, testEvidence],
      });
      if (tests.state === 'absent') return finding({
        id: 'H19.SEMANTIC_TEST_GAP',
        title: 'High semantic risk has no impacted test',
        severity: 'warning',
        source: 'builtin:semanticRiskWithoutTestRule',
        action: 'targeted-test',
        evidenceIds: [semanticEvidence, testEvidence],
      });
      return null;
    },
  });
}

export function missingHistoricalCompanionRule({
  semanticEvidence = 'semantic.risk.high',
  couplingEvidence = 'history.companion.missing',
} = {}) {
  return ruleCard({
    id: 'H19.HISTORICAL_COMPANION_MISSING',
    version: '0.1.0',
    consumes: [semanticEvidence, couplingEvidence],
    evaluate: ({ evidence }) => {
      if (evidence[semanticEvidence].state !== 'present') return null;
      if (evidence[couplingEvidence].state !== 'present') return null;
      return finding({
        id: 'H19.HISTORICAL_COMPANION_MISSING',
        title: 'High semantic risk change omits a strongly coupled companion',
        severity: 'warning',
        source: 'builtin:missingHistoricalCompanionRule',
        action: 'escalate',
        evidenceIds: [semanticEvidence, couplingEvidence],
      });
    },
  });
}
