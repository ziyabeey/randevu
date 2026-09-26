export function evidenceMap(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

export function runRules({ rules = [], evidences = [], context = {} } = {}) {
  const map = evidenceMap(evidences);
  const findings = [];

  for (const rule of rules) {
    const scoped = Object.fromEntries(
      rule.consumes.map((id) => [id, map.get(id) ?? { id, state: 'unknown', details: {} }]),
    );
    const result = rule.evaluate(Object.freeze({ evidence: scoped, context }));
    if (!result) continue;
    if (Array.isArray(result)) findings.push(...result);
    else findings.push(result);
  }

  return findings;
}

export function route(findings = []) {
  if (findings.some((f) => f.action === 'escalate')) return 'escalate';
  if (findings.some((f) => f.action === 'targeted-test')) return 'targeted-test';
  return 'observe';
}
