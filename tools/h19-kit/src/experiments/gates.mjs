function compare(value, op, threshold) {
  if (!Number.isFinite(value)) return false;
  if (op === '>=') return value >= threshold;
  if (op === '<=') return value <= threshold;
  if (op === '>') return value > threshold;
  if (op === '<') return value < threshold;
  if (op === '==') return value === threshold;
  throw new Error(`unsupported gate op: ${op}`);
}

export function evaluateGates(metrics, gates) {
  const results = gates.map((gate) => {
    const value = typeof gate.value === 'function' ? gate.value(metrics) : metrics[gate.metric];
    const pass = compare(Number(value), gate.op, Number(gate.threshold));
    return {
      id: gate.id,
      metric: gate.metric ?? null,
      value,
      op: gate.op,
      threshold: gate.threshold,
      pass,
    };
  });
  return {
    pass: results.every((x) => x.pass),
    results,
  };
}
