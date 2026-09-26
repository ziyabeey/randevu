import { evidence } from '../core/contracts.mjs';

export function blastRadiusEvidence(report) {
  const out = [];

  out.push(evidence(
    'impact.references.present',
    report.referenceSiteCount > 0 ? 'present' : 'absent',
    {
      referenceSiteCount: report.referenceSiteCount,
      impactedPathCount: report.impactedPathCount,
      impactedPaths: report.impactedPaths,
    },
  ));

  const coverageState = !report.coverageComplete
    ? 'unknown'
    : report.uncoveredPaths.length > 0 ? 'present' : 'absent';
  out.push(evidence('impact.coverage_gap.present', coverageState, {
    coveredPaths: report.coveredPaths,
    uncoveredPaths: report.uncoveredPaths,
    unknownCoveragePaths: report.unknownCoveragePaths,
  }));

  out.push(evidence(
    'impact.test_references.present',
    report.testReferencePathCount > 0 ? 'present' : 'absent',
    { testReferencePaths: report.testReferencePaths },
  ));

  out.push(evidence(
    'history.companion.missing',
    report.historicalCompanionsMissing.length > 0 ? 'present' : 'absent',
    { companions: report.historicalCompanionsMissing },
  ));

  return out;
}
