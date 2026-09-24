import { readFile } from 'node:fs/promises';

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  cacheDir: '.h19/cache',
  adapters: {
    static: [],
    testImpact: [],
    history: ['git-temporal-coupling'],
    semantic: [],
  },
  reporting: {
    formats: ['json', 'sarif'],
  },
  policy: {
    unknown: 'escalate',
  },
});

function merge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (base && extra && typeof base === 'object' && typeof extra === 'object') {
    return Object.fromEntries(new Set([...Object.keys(base), ...Object.keys(extra)]).values().map((key) => [
      key,
      key in extra ? merge(base[key], extra[key]) : base[key],
    ]));
  }
  return extra ?? base;
}

export function validateConfig(config) {
  if (config?.version !== 1) throw new Error('h19 config version must be 1');
  if (!['escalate', 'observe'].includes(config.policy?.unknown)) {
    throw new Error('policy.unknown must be escalate or observe');
  }
  for (const key of ['static', 'testImpact', 'history', 'semantic']) {
    if (!Array.isArray(config.adapters?.[key])) throw new Error(`adapters.${key} must be an array`);
  }
  return config;
}

export async function loadConfig(file = null) {
  if (!file) return validateConfig(structuredClone(DEFAULT_CONFIG));
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  return validateConfig(merge(structuredClone(DEFAULT_CONFIG), parsed));
}
