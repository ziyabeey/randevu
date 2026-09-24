export function normalizeTestImpact({
  changedUnits = [],
  impactedTests = [],
  unknownUnits = [],
  provider = 'custom',
} = {}) {
  return Object.freeze({
    provider,
    changedUnits: [...changedUnits],
    impactedTests: [...impactedTests],
    unknownUnits: [...unknownUnits],
    coverageKnown: unknownUnits.length === 0,
  });
}

export function hasBlindSpot(impact) {
  return impact.changedUnits.length > 0
    && impact.impactedTests.length === 0
    && impact.unknownUnits.length === 0;
}
