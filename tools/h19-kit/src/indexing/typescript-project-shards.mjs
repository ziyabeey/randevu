import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from '@typescript/typescript6';

function normalize(value) {
  return String(value).replaceAll('\\', '/');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function resolveReferenceConfig(rootDir, referencePath) {
  const candidate = path.resolve(rootDir, referencePath);
  if (path.extname(candidate).toLowerCase() === '.json') return candidate;
  if (await exists(candidate) && (await stat(candidate)).isDirectory()) {
    return path.join(candidate, 'tsconfig.json');
  }
  if (await exists(`${candidate}.json`)) return `${candidate}.json`;
  return candidate;
}

async function repoConfigClosure(cwd, configFile, seen = new Set()) {
  const full = path.resolve(configFile);
  if (seen.has(full)) return [];
  seen.add(full);

  const rel = normalize(path.relative(cwd, full));
  const rows = [rel];
  let raw;
  try {
    raw = JSON.parse(await readFile(full, 'utf8'));
  } catch {
    return rows;
  }

  const ext = raw?.extends;
  if (typeof ext === 'string' && (ext.startsWith('.') || ext.startsWith('/'))) {
    let target = path.resolve(path.dirname(full), ext);
    if (!path.extname(target)) target += '.json';
    if (await exists(target)) rows.push(...await repoConfigClosure(cwd, target, seen));
  }

  return rows;
}

function insideRepo(cwd, file) {
  const rel = path.relative(cwd, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function packageMetadataFiles(cwd) {
  const names = [
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ];
  const found = [];
  for (const name of names) {
    if (await exists(path.join(cwd, name))) found.push(name);
  }
  return found;
}

export async function resolveTypeScriptProjectShards({
  cwd = process.cwd(),
  rootConfig = 'tsconfig.json',
} = {}) {
  const repoRoot = path.resolve(cwd);
  const rootConfigFull = path.resolve(repoRoot, rootConfig);
  const rootRead = ts.readConfigFile(rootConfigFull, ts.sys.readFile);
  if (rootRead.error) {
    throw new Error(ts.flattenDiagnosticMessageText(rootRead.error.messageText, '\n'));
  }

  const refs = rootRead.config?.references ?? [];
  const referenceConfigs = refs.length
    ? await Promise.all(refs.map((ref) => resolveReferenceConfig(path.dirname(rootConfigFull), ref.path)))
    : [rootConfigFull];

  const packageFiles = await packageMetadataFiles(repoRoot);
  const shards = [];

  for (const configFull of referenceConfigs) {
    const read = ts.readConfigFile(configFull, ts.sys.readFile);
    if (read.error) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    }

    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(configFull),
      undefined,
      configFull,
    );
    if (parsed.errors.length) {
      throw new Error(parsed.errors.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    }

    const sourceFiles = parsed.fileNames
      .filter((file) => insideRepo(repoRoot, file))
      .filter((file) => !normalize(file).includes('/node_modules/'))
      .map((file) => normalize(path.relative(repoRoot, file)))
      .sort();

    const configFiles = [...new Set([
      ...(await repoConfigClosure(repoRoot, rootConfigFull)),
      ...(await repoConfigClosure(repoRoot, configFull)),
      ...packageFiles,
    ])].sort();

    const configPath = normalize(path.relative(repoRoot, configFull));
    shards.push(Object.freeze({
      id: configPath,
      configPath,
      projectRoot: '.',
      sourceFiles: Object.freeze(sourceFiles),
      configFiles: Object.freeze(configFiles),
      flags: Object.freeze(['-p', configPath]),
    }));
  }

  return Object.freeze(shards.sort((a, b) => a.id.localeCompare(b.id)));
}

export function shardForChangedFile(shards, changedFile) {
  const target = normalize(changedFile);
  return shards
    .filter((shard) => shard.sourceFiles.includes(target))
    .map((shard) => shard.id)
    .sort();
}
