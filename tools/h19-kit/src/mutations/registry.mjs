const registry = new Map();

export function registerMutator(mutator) {
  if (!mutator?.id || !mutator?.axis || typeof mutator.apply !== 'function') {
    throw new TypeError('mutator requires id, axis and apply(input)');
  }
  if (registry.has(mutator.id)) throw new Error(`duplicate mutator: ${mutator.id}`);
  registry.set(mutator.id, Object.freeze({
    id: mutator.id,
    version: mutator.version ?? '0.1.0',
    axis: mutator.axis,
    family: mutator.family ?? 'unspecified',
    appliesTo: mutator.appliesTo ?? (() => true),
    apply: mutator.apply,
  }));
}

export function listMutators() {
  return [...registry.values()].map(({ apply, appliesTo, ...meta }) => meta);
}

export function getMutator(id) {
  return registry.get(id) ?? null;
}

export function clearMutatorsForTests() {
  registry.clear();
}
