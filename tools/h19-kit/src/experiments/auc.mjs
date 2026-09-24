export function auc(labels, scores) {
  if (labels.length !== scores.length || labels.length === 0) throw new Error('labels/scores mismatch');
  const rows = labels.map((label, i) => ({ label: Boolean(label), score: Number(scores[i]) }));
  if (rows.some((x) => !Number.isFinite(x.score))) throw new Error('scores must be finite');
  const positives = rows.filter((x) => x.label).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) return NaN;

  let wins = 0;
  for (const p of rows.filter((x) => x.label)) {
    for (const n of rows.filter((x) => !x.label)) {
      if (p.score > n.score) wins += 1;
      else if (p.score === n.score) wins += 0.5;
    }
  }
  return wins / (positives * negatives);
}

export function leakageGate({
  cases,
  label,
  features,
  minAuc = 0.30,
  maxAuc = 0.70,
} = {}) {
  const labels = cases.map(label);
  const results = [];
  for (const feature of features) {
    const scores = cases.map(feature.score);
    const value = auc(labels, scores);
    results.push({ id: feature.id, auc: value, pass: Number.isNaN(value) || (value >= minAuc && value <= maxAuc) });
  }
  return {
    pass: results.every((x) => x.pass),
    minAuc,
    maxAuc,
    results,
  };
}
