import { spawn } from 'node:child_process';

const versionCache = new Map();

function runVersionCommand(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 1000)}`)));
  });
}

function normalizeVersionText(stdout, stderr) {
  const text = `${stdout ?? ''}\n${stderr ?? ''}`
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean);
  if (!text) throw new Error('indexer version probe returned no version text');
  return text.slice(0, 256);
}

export async function probeIndexerVersion({
  command,
  args = ['--version'],
  cwd = process.cwd(),
  env = process.env,
  execute = runVersionCommand,
  cache = true,
} = {}) {
  if (!command) throw new TypeError('version probe command required');
  const key = JSON.stringify([command, args, cwd]);
  if (cache && versionCache.has(key)) return versionCache.get(key);

  const { stdout, stderr } = await execute(command, args, { cwd, env });
  const version = normalizeVersionText(stdout, stderr);
  if (cache) versionCache.set(key, version);
  return version;
}

export async function resolveIndexerIdentity(indexer, {
  cwd = process.cwd(),
  env = process.env,
  executeVersion,
} = {}) {
  if (!indexer?.id || !indexer?.command) throw new TypeError('indexer id/command required');

  if (indexer.version && indexer.version !== 'auto') return indexer;

  const version = await probeIndexerVersion({
    command: indexer.command,
    args: indexer.versionArgs ?? ['--version'],
    cwd,
    env,
    ...(executeVersion ? { execute: executeVersion } : {}),
  });

  return Object.freeze({
    ...indexer,
    version,
  });
}

export function externalScipIndexer({
  id,
  command,
  version = 'auto',
  versionArgs = ['--version'],
  flags = [],
  priority = 0,
  languages = [],
  buildArgs,
} = {}) {
  if (!id || !command || typeof buildArgs !== 'function') {
    throw new TypeError('external SCIP indexer requires id, command and buildArgs');
  }
  const supported = new Set(languages.map((x) => String(x).toLowerCase()));
  return Object.freeze({
    id,
    command,
    version,
    versionArgs: [...versionArgs],
    flags: [...flags],
    priority,
    languages: [...supported],
    supports(context = {}) {
      if (!supported.size) return true;
      return (context.languages ?? []).some((x) => supported.has(String(x).toLowerCase()));
    },
    buildArgs,
  });
}

export class ScipIndexerRegistry {
  #items = new Map();

  register(indexer) {
    if (!indexer?.id || typeof indexer.buildArgs !== 'function') {
      throw new TypeError('indexer requires id and buildArgs');
    }
    if (this.#items.has(indexer.id)) throw new Error(`duplicate SCIP indexer: ${indexer.id}`);
    this.#items.set(indexer.id, indexer);
    return indexer;
  }

  get(id) {
    return this.#items.get(id) ?? null;
  }

  list() {
    return [...this.#items.values()]
      .map(({ buildArgs, supports, ...meta }) => meta)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  }

  candidates(context = {}) {
    return [...this.#items.values()]
      .filter((item) => typeof item.supports !== 'function' || item.supports(context))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  }

  select(context = {}) {
    return this.candidates(context)[0] ?? null;
  }

  async selectResolved(context = {}, options = {}) {
    const selected = this.select(context);
    if (!selected) return null;
    return resolveIndexerIdentity(selected, options);
  }
}

export function clearIndexerVersionProbeCacheForTests() {
  versionCache.clear();
}
