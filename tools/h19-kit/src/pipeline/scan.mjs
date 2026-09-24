import { evidence } from '../core/contracts.mjs';
import { runRules, route } from '../core/dispatcher.mjs';
import { semanticRiskWithoutTestRule, missingHistoricalCompanionRule } from '../rules/builtin.mjs';
import { toSarif } from '../reporters/sarif.mjs';

export function scan(input = {}) {
  const evidences = [];

  if (input.semantic?.high === true) {
    evidences.push(evidence('semantic.risk.high', 'present', input.semantic));
  } else if (input.semantic?.high === false) {
    evidences.push(evidence('semantic.risk.high', 'absent', input.semantic));
  } else {
    evidences.push(evidence('semantic.risk.high', 'unknown', input.semantic ?? {}));
  }

  const impacted = input.testImpact?.known === false
    ? 'unknown'
    : (input.testImpact?.impactedTests?.length ? 'present' : 'absent');
  evidences.push(evidence('tests.impacted', impacted, input.testImpact ?? {}));

  const companion = input.history?.companionMissing === true
    ? 'present'
    : input.history?.companionMissing === false ? 'absent' : 'unknown';
  evidences.push(evidence('history.companion.missing', companion, input.history ?? {}));

  const findings = runRules({
    rules: [
      semanticRiskWithoutTestRule(),
      missingHistoricalCompanionRule(),
    ],
    evidences,
    context: input.context ?? {},
  });

  return Object.freeze({
    route: route(findings),
    evidences,
    findings,
    sarif: toSarif(findings),
  });
}
