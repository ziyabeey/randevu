const STATES = new Set(['present', 'absent', 'unknown']);

export function evidence(id, state, details = {}) {
  if (!id || typeof id !== 'string') throw new TypeError('evidence id must be a string');
  if (!STATES.has(state)) throw new TypeError(`invalid evidence state: ${state}`);
  return Object.freeze({ id, state, details: structuredClone(details) });
}

export function finding({
  id,
  title,
  severity = 'note',
  source,
  location = null,
  evidenceIds = [],
  action = 'observe',
  metadata = {},
}) {
  if (!id || !title || !source) throw new TypeError('finding requires id, title and source');
  if (!['note', 'warning', 'error'].includes(severity)) throw new TypeError('invalid severity');
  if (!['observe', 'targeted-test', 'escalate'].includes(action)) throw new TypeError('invalid action');
  return Object.freeze({
    id, title, severity, source, location,
    evidenceIds: [...evidenceIds],
    action,
    metadata: structuredClone(metadata),
  });
}

export function ruleCard(card) {
  if (!card?.id || !card?.version) throw new TypeError('rule card requires id and version');
  if (!Array.isArray(card.consumes)) throw new TypeError('rule card consumes must be an array');
  if (typeof card.evaluate !== 'function') throw new TypeError('rule card requires evaluate(ctx)');
  return Object.freeze({
    id: card.id,
    version: card.version,
    consumes: [...card.consumes],
    evaluate: card.evaluate,
  });
}
