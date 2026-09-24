export function indexExperiments(ledger) {
  const experiments = Array.isArray(ledger?.experiments) ? ledger.experiments : [];
  return new Map(experiments.map((x) => [x.id, x]));
}

export function failedPatterns(ledger) {
  return (ledger?.experiments ?? [])
    .filter((x) => ['failed', 'incomparable'].includes(x.status))
    .flatMap((x) => (x.anti_patterns ?? []).map((pattern) => ({
      experiment: x.id,
      pattern,
      result: x.result ?? null,
    })));
}

export function priorEvidenceFor(ledger, predicate) {
  return (ledger?.experiments ?? []).filter(predicate);
}

export function shouldBlockProposal(ledger, normalizedPattern) {
  const needle = String(normalizedPattern ?? '').trim().toLowerCase();
  if (!needle) return null;
  return failedPatterns(ledger).find((x) => x.pattern.toLowerCase().includes(needle)) ?? null;
}
