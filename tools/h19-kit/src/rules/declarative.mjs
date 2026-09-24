import { finding, ruleCard } from '../core/contracts.mjs';

function matches(actual, expected) {
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function evalClause(clause, evidence) {
  const item = evidence[clause.evidence] ?? { state: 'unknown', details: {} };
  if ('state' in clause && !matches(item.state, clause.state)) return false;
  if (clause.detail) {
    const actual = clause.detail.path
      .split('.')
      .reduce((value, key) => value?.[key], item.details);
    if ('equals' in clause.detail && actual !== clause.detail.equals) return false;
    if ('gte' in clause.detail && !(Number(actual) >= Number(clause.detail.gte))) return false;
    if ('lte' in clause.detail && !(Number(actual) <= Number(clause.detail.lte))) return false;
  }
  return true;
}

function evaluateWhen(when, evidence) {
  if (!when) return false;
  if (Array.isArray(when.all) && !when.all.every((c) => evalClause(c, evidence))) return false;
  if (Array.isArray(when.any) && when.any.length && !when.any.some((c) => evalClause(c, evidence))) return false;
  if (Array.isArray(when.none) && when.none.some((c) => evalClause(c, evidence))) return false;
  return true;
}

export function declarativeRule(card) {
  if (!card?.emit?.id || !card?.emit?.title) {
    throw new TypeError('declarative rule requires emit.id and emit.title');
  }
  return ruleCard({
    id: card.id,
    version: card.version,
    consumes: [...new Set([
      ...(card.consumes ?? []),
      ...(card.when?.all ?? []).map((x) => x.evidence),
      ...(card.when?.any ?? []).map((x) => x.evidence),
      ...(card.when?.none ?? []).map((x) => x.evidence),
    ])],
    evaluate: ({ evidence, context }) => {
      if (!evaluateWhen(card.when, evidence)) return null;
      return finding({
        id: card.emit.id,
        title: card.emit.title,
        severity: card.emit.severity ?? 'warning',
        source: `rule-card:${card.id}@${card.version}`,
        action: card.emit.action ?? 'observe',
        evidenceIds: Object.keys(evidence),
        location: context.location ?? null,
        metadata: {
          ruleCard: card.id,
          ruleVersion: card.version,
          ...(card.emit.metadata ?? {}),
        },
      });
    },
  });
}

export function validateDeclarativeCard(card) {
  if (!card?.id || !card?.version) throw new Error('rule card requires id and version');
  if (!card.when || typeof card.when !== 'object') throw new Error('rule card requires when');
  if (!card.emit?.id || !card.emit?.title) throw new Error('rule card requires emit.id/title');
  const clauses = [...(card.when.all ?? []), ...(card.when.any ?? []), ...(card.when.none ?? [])];
  for (const clause of clauses) {
    if (!clause?.evidence) throw new Error('rule clause requires evidence');
    if (!('state' in clause) && !clause.detail) throw new Error('rule clause requires state or detail test');
  }
  return card;
}
