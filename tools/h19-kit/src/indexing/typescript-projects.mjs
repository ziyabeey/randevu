import path from 'node:path';
import ts from '@typescript/typescript6';

function formatDiagnostics(rows = []) {
  return ts.formatDiagnostics(rows, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

function relativeInside(root, absolute) {
  const rel = path.relative(root, absolute).replaceAll('\\', '/');
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return rel;
}

function resolveReferencedConfig(baseDir, referencePath) {
  const absolute = path.resolve(baseDir, referencePath);
  const candidates = path.extname(absolute)
    ? [absolute]
    : [absolute, `${absolute}.json`, path.join(absolute, 'tsconfig.json')];

  for (const candidate of candidates) {
    if (ts.sys.fileExists(candidate)) return candidate;
  }

  throw new Error(`TypeScript project reference not found: ${referencePath}`);
}

function readConfig(absoluteConfig) {
  const read = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
  if (read.error) throw new Error(formatDiagnostics([read.error]));

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(absoluteConfig),
    undefined,
    absoluteConfig,
  );

  const errors = (parsed.errors ?? []).filter((error) => error.code !== 18003);
  if (errors.length) throw new Error(formatDiagnostics(errors));

  const refs = (read.config?.references ?? [])
    .map((ref) => ref?.path)
    .filter(Boolean)
    .map((ref) => resolveReferencedConfig(path.dirname(absoluteConfig), ref));

  return {
    absoluteConfig,
    parsed,
    references: refs,
  };
}

export function discoverTypeScriptProjectShards({
  cwd = process.cwd(),
  rootConfig = 'tsconfig.json',
} = {}) {
  const root = path.resolve(cwd);
  const absoluteRoot = path.resolve(root, rootConfig);
  if (!ts.sys.fileExists(absoluteRoot)) {
    return Object.freeze({
      rootConfig: null,
      shards: Object.freeze([]),
      indexedFiles: Object.freeze([]),
    });
  }

  const cache = new Map();
  const load = (config) => {
    const key = path.resolve(config);
    if (!cache.has(key)) cache.set(key, readConfig(key));
    return cache.get(key);
  };

  const rootRow = load(absoluteRoot);
  const topLevel = rootRow.references.length ? rootRow.references : [absoluteRoot];

  const closure = (config, seen = new Set()) => {
    const absolute = path.resolve(config);
    if (seen.has(absolute)) return { configs: [], files: [] };
    seen.add(absolute);

    const row = load(absolute);
    const configs = [absolute];
    const files = [...row.parsed.fileNames];

    for (const ref of row.references) {
      const nested = closure(ref, seen);
      configs.push(...nested.configs);
      files.push(...nested.files);
    }

    return { configs, files };
  };

  const shards = topLevel.map((config) => {
    const row = load(config);
    const closed = closure(config);
    const sourceFiles = [...new Set(
      closed.files
        .map((file) => relativeInside(root, file))
        .filter(Boolean),
    )].sort();

    const configFiles = [...new Set([
      absoluteRoot,
      ...closed.configs,
    ].map((file) => relativeInside(root, file)).filter(Boolean))].sort();

    const configPath = relativeInside(root, config);
    if (!configPath) {
      throw new Error(`TypeScript project config outside repository: ${config}`);
    }

    return Object.freeze({
      id: configPath,
      configPath,
      sourceFiles: Object.freeze(sourceFiles),
      configFiles: Object.freeze(configFiles),
      directReferences: Object.freeze(
        row.references
          .map((file) => relativeInside(root, file))
          .filter(Boolean)
          .sort(),
      ),
    });
  }).sort((a, b) => a.id.localeCompare(b.id));

  const indexedFiles = [...new Set(shards.flatMap((shard) => shard.sourceFiles))].sort();

  return Object.freeze({
    rootConfig: relativeInside(root, absoluteRoot),
    shards: Object.freeze(shards),
    indexedFiles: Object.freeze(indexedFiles),
  });
}
