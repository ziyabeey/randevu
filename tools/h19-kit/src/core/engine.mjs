import { EvidenceStore } from './evidence-store.mjs';
import { runRules, route } from './dispatcher.mjs';
import { toSarif } from '../reporters/sarif.mjs';
import { createRunManifest } from './run-manifest.mjs';

function normalizeProduced(plugin, item, inputDigest = null) {
  if (!item?.id || !['present','absent','unknown'].includes(item.state)) {
    throw new Error(`plugin ${plugin.id} returned invalid evidence`);
  }
  return {
    id: item.id,
    state: item.state,
    producer: plugin.id,
    producerVersion: plugin.version,
    inputDigest: item.inputDigest ?? inputDigest,
    source: item.source ?? null,
    details: item.details ?? {},
    observedAt: item.observedAt ?? null,
  };
}

export class H19Engine {
  constructor({
    registry,
    rules = [],
    config = {},
    failurePolicy = 'unknown',
    tool = { name: '@h19/kit', version: '0.0.1-alpha.0' },
  } = {}) {
    if (!registry) throw new TypeError('engine requires plugin registry');
    if (!['unknown','throw'].includes(failurePolicy)) throw new TypeError('invalid failurePolicy');
    this.registry = registry;
    this.rules = [...rules];
    this.config = structuredClone(config);
    this.failurePolicy = failurePolicy;
    this.tool = tool;
  }

  async analyze({
    unit,
    pluginRefs = [],
    repository = {},
    context = {},
    startedAt = null,
  } = {}) {
    if (!unit?.id) throw new TypeError('analyze requires semantic unit');
    const store = new EvidenceStore();
    const adapters = [];
    const pluginErrors = [];

    for (const ref of pluginRefs) {
      const plugin = this.registry.get(ref.kind, ref.id);
      if (!plugin) throw new Error(`plugin not registered: ${ref.kind}:${ref.id}`);
      adapters.push(plugin);
      try {
        const output = await plugin.run(unit, Object.freeze({
          config: this.config,
          context,
          options: ref.options ?? {},
        }));
        const rows = Array.isArray(output) ? output : output ? [output] : [];
        for (const item of rows) store.put(normalizeProduced(plugin, item, unit.digest ?? null));
      } catch (error) {
        if (this.failurePolicy === 'throw') throw error;
        pluginErrors.push({
          plugin: `${plugin.kind}:${plugin.id}`,
          error: error instanceof Error ? error.message : String(error),
        });
        for (const id of plugin.produces ?? []) {
          store.put({
            id,
            state: 'unknown',
            producer: plugin.id,
            producerVersion: plugin.version,
            inputDigest: unit.digest ?? null,
            details: { reason: 'plugin-error' },
          });
        }
      }
    }

    const evidences = store.list();
    const findings = runRules({
      rules: this.rules,
      evidences,
      context: { ...context, unit },
    });
    const decision = route(findings);
    const manifest = createRunManifest({
      tool: this.tool,
      repository,
      config: this.config,
      adapters,
      units: [{ id: unit.id, digest: unit.digest }],
      startedAt,
    });

    return Object.freeze({
      manifest,
      unit,
      evidence: store.snapshot(),
      findings,
      route: decision,
      pluginErrors,
      sarif: toSarif(findings, { toolName: this.tool.name, version: this.tool.version }),
    });
  }
}
