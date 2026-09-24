export class PluginRegistry {
  #plugins = new Map();

  register(plugin) {
    if (!plugin?.id || !plugin?.kind || typeof plugin.run !== 'function') {
      throw new TypeError('plugin requires id, kind and run(input, ctx)');
    }
    const key = `${plugin.kind}:${plugin.id}`;
    if (this.#plugins.has(key)) throw new Error(`duplicate plugin: ${key}`);
    const frozen = Object.freeze({
      id: plugin.id,
      kind: plugin.kind,
      version: plugin.version ?? '0.1.0',
      capabilities: Object.freeze([...(plugin.capabilities ?? [])]),
      produces: Object.freeze([...(plugin.produces ?? [])]),
      run: plugin.run,
    });
    this.#plugins.set(key, frozen);
    return frozen;
  }

  get(kind, id) {
    return this.#plugins.get(`${kind}:${id}`) ?? null;
  }

  list(kind = null) {
    return [...this.#plugins.values()]
      .filter((x) => !kind || x.kind === kind)
      .map(({ run, ...meta }) => meta);
  }
}
