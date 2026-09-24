function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function check(id, actual, limit, predicate, note = null) {
  const ok = predicate(actual, limit);
  return Object.freeze({
    id,
    ok,
    actual,
    limit,
    ...(note ? { note } : {}),
  });
}

export function evaluatePerformanceRegression(report, contract) {
  if (!report || !contract) throw new TypeError('report and contract are required');
  const m = report.measurements ?? {};
  const scip = m.scipTypescript ?? {};
  const shards = scip.projectShards ?? {};
  const shardChange = shards.singleFileChange ?? {};
  const limits = contract.limits ?? {};
  const invariants = contract.invariants ?? {};
  const monolithicChanged = finite(scip.singleFileChange?.reindexMs);
  const shardedChanged = finite(shardChange.totalMs);
  const changedRatio = monolithicChanged && shardedChanged
    ? shardedChanged / monolithicChanged
    : null;

  const checks = [
    check(
      'inventory.repeat-p95',
      finite(m.inventory?.repeatP95Ms),
      limits.inventoryRepeatP95MsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'history.warm-hit',
      finite(m.history?.warmHitMs),
      limits.historyWarmHitMsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'm4.impact-p95',
      finite(m.syntheticScale?.impactP95Ms),
      limits.syntheticImpactP95MsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'm5.discovery-p95',
      finite(m.syntheticScale?.discoveryP95Ms),
      limits.syntheticDiscoveryP95MsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'scip.exact-warm-hit',
      finite(scip.exactContentWarmHitMs),
      limits.scipExactWarmHitMsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'scip.shard-cold-overhead-ratio',
      finite(shards.coldVsMonolithicRatio),
      limits.scipShardColdVsMonolithicRatioMax,
      (actual, limit) => actual != null && actual <= limit,
      'Sharded cold startup may be slower than one monolithic index, but must remain bounded.',
    ),
    check(
      'scip.sharded-change-vs-monolithic-ratio',
      changedRatio,
      limits.scipShardedChangedVsMonolithicRatioMax,
      (actual, limit) => actual != null && actual <= limit,
      'Lower is better. This is an in-run relative comparison to reduce hosted-runner noise.',
    ),
    check(
      'scip.shard-warm-total',
      finite(shards.warmHitTotalMs),
      limits.scipShardWarmTotalMsMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'scip.status',
      scip.status ?? null,
      invariants.scipStatus,
      (actual, expected) => actual === expected,
    ),
    check(
      'scip.sharded-change-status',
      shardChange.status ?? null,
      invariants.shardedChangeStatus,
      (actual, expected) => actual === expected,
    ),
    check(
      'scip.sharded-change-misses',
      finite(shardChange.misses),
      invariants.shardedChangeMissesMax,
      (actual, limit) => actual != null && actual <= limit,
    ),
    check(
      'scip.sharded-change-hits',
      finite(shardChange.hits),
      invariants.shardedChangeHitsMin,
      (actual, limit) => actual != null && actual >= limit,
    ),
  ];

  return Object.freeze({
    schemaVersion: 1,
    contractId: contract.id,
    baselineFamily: contract.baselineFamily,
    pass: checks.every((row) => row.ok),
    checks: Object.freeze(checks),
    reportOnly: Object.freeze({
      scipFirstIndexMs: finite(scip.firstIndexMs),
      scipRepeatCacheMissMs: finite(scip.repeatH19CacheMissMs),
      monolithicChangedFileMs: monolithicChanged,
      shardedChangedFileMs: shardedChanged,
      shardedChangedVsMonolithicRatio: changedRatio,
    }),
    productTargetsFrozen: contract.productTargets != null,
  });
}
