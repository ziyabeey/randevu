import { evidence } from '../core/contracts.mjs';

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function hypothesisId(parts) {
  return ['coverage', ...parts.map((x) => String(x).replace(/[^a-zA-Z0-9._-]+/g, '_'))].join(':');
}

function pathHypothesis(path, reason, evidenceIds, priority) {
  return Object.freeze({
    id: hypothesisId([reason, path]),
    target: Object.freeze({ kind: 'path', path }),
    reason,
    priority,
    evidenceIds: Object.freeze(unique(evidenceIds)),
    validation: Object.freeze({
      preferred: 'targeted-test-or-mutation',
      requiresRuntimeEvidence: true,
    }),
  });
}

export function discoverCoverageHypotheses({
  impact,
  survivingMutants = [],
  existingTests = [],
} = {}) {
  if (!impact) throw new TypeError('impact analysis is required');

  const testSet = new Set(existingTests.map((x) => typeof x === 'string' ? x : x?.path).filter(Boolean));
  const hypotheses = [];

  for (const path of impact.symbolImpact?.report?.uncoveredPaths ?? []) {
    hypotheses.push(pathHypothesis(
      path,
      'explicit-runtime-coverage-gap',
      ['impact.coverage_gap.present', 'impact.references.present'],
      'high',
    ));
  }

  for (const path of impact.symbolImpact?.report?.unknownCoveragePaths ?? []) {
    hypotheses.push(pathHypothesis(
      path,
      'unknown-runtime-coverage-on-impacted-reference',
      ['impact.coverage_gap.present', 'impact.references.present'],
      'medium',
    ));
  }

  for (const companion of impact.symbolImpact?.report?.historicalCompanionsMissing ?? []) {
    hypotheses.push(pathHypothesis(
      companion.missing,
      'historical-companion-not-changed',
      ['history.companion.missing'],
      'medium',
    ));
  }

  for (const mutant of survivingMutants) {
    if (!mutant?.path) continue;
    hypotheses.push(Object.freeze({
      id: hypothesisId(['surviving-mutant', mutant.id ?? mutant.path, mutant.path]),
      target: Object.freeze({
        kind: mutant.unitId ? 'semantic-unit' : 'path',
        path: String(mutant.path),
        unitId: mutant.unitId ?? null,
      }),
      reason: 'surviving-mutant',
      priority: 'high',
      evidenceIds: Object.freeze(unique([
        'mutation.survivor.present',
        ...(mutant.evidenceIds ?? []),
      ])),
      validation: Object.freeze({
        preferred: 'test-that-kills-mutant',
        mutatorId: mutant.mutatorId ?? null,
        mutationId: mutant.id ?? null,
        requiresRuntimeEvidence: true,
      }),
    }));
  }

  const dedup = new Map();
  for (const h of hypotheses) {
    const key = `${h.target.kind}:${h.target.path}:${h.target.unitId ?? ''}:${h.reason}`;
    if (!dedup.has(key)) dedup.set(key, h);
  }

  const ordered = [...dedup.values()].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)
      || a.target.path.localeCompare(b.target.path)
      || a.reason.localeCompare(b.reason);
  });

  const missingTestTargets = unique(
    ordered
      .filter((h) => h.target.kind === 'path' && !testSet.has(h.target.path))
      .map((h) => h.target.path),
  );

  return Object.freeze({
    hypotheses: Object.freeze(ordered),
    highPriorityCount: ordered.filter((h) => h.priority === 'high').length,
    missingTestTargets: Object.freeze(missingTestTargets),
    evidence: Object.freeze([
      evidence(
        'coverage.discovery.present',
        ordered.length > 0 ? 'present' : 'absent',
        {
          hypothesisCount: ordered.length,
          highPriorityCount: ordered.filter((h) => h.priority === 'high').length,
        },
      ),
      evidence(
        'mutation.survivor.present',
        survivingMutants.length > 0 ? 'present' : 'absent',
        { survivorCount: survivingMutants.length },
      ),
    ]),
    caveats: Object.freeze([
      'A coverage hypothesis is not proof of a bug.',
      'Unknown runtime coverage is distinct from confirmed missing coverage.',
      'A surviving mutant is evidence that the current executed suite did not distinguish that mutation under the recorded run.',
      'Generated hypotheses require validation before promotion to permanent regression tests.',
    ]),
  });
}
