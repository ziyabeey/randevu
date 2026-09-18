import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/;
const TASK_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const WALL_TIME_RE = /^(?:[1-9]\d*)(?:\.\d+)?(?:s|m|h)?$/;
const SAFE_APPROVAL_MODES = new Set(['auto-edit']);
const SAFE_OUTPUT_MODES = new Set(['json']);
const MAX_WALL_TIME_MS = 2 * 60 * 60 * 1000;
const MAX_VALIDATION_TOTAL_MS = 20 * 60 * 1000;
const MAX_SCOPE_ENTRIES = 64;
const MAX_SCOPE_BYTES = 8 * 1024;
const MAX_VALIDATION_ARG_BYTES = 2 * 1024;
const MAX_VALIDATION_COMMAND_BYTES = 8 * 1024;
const DEFAULT_QWEN_ENV_ALLOWLIST = ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'];
const QWEN_PROVIDER_ENV = new Set(DEFAULT_QWEN_ENV_ALLOWLIST);
const BASE_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
const QWEN_BASE_ENV_ALLOWLIST = ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP'];
const GIT_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const GH_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const VALIDATION_EXECUTABLE = 'node';
const QWEN_CORE_TOOLS = ['read_file', 'grep_search', 'glob', 'edit', 'write_file'];
const QWEN_DISABLED_TOOLS = ['run_shell_command', 'monitor', 'web_fetch', 'task', 'agent', 'skill', 'tool_search'];

export class DispatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
    this.details = details;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DispatchError('INVALID_PACKET', `${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new DispatchError('INVALID_PACKET', `${label} contains unsupported key: ${key}`);
  }
}

function isSafeRelativePath(value, { allowDirectory = true } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return false;
  if (/[\0\r\n\\]/.test(value) || path.posix.isAbsolute(value) || value.startsWith('~')) return false;
  const directory = allowDirectory && value.endsWith('/');
  const body = directory ? value.slice(0, -1) : value;
  const parts = body.split('/');
  if (!body || body === '.' || parts.some((part) => !part || part === '.' || part === '..' || part === '.git')) return false;
  return path.posix.normalize(body) === body;
}

function normalizeScopeEntry(value) {
  return value.endsWith('/') ? value : value;
}

function pathMatchesScope(file, scopeEntry) {
  if (scopeEntry.endsWith('/')) return file.startsWith(scopeEntry);
  return file === scopeEntry;
}

function scopesOverlap(left, right) {
  const leftDir = left.endsWith('/');
  const rightDir = right.endsWith('/');
  const leftBody = leftDir ? left.slice(0, -1) : left;
  const rightBody = rightDir ? right.slice(0, -1) : right;
  if (!leftDir && !rightDir) return leftBody === rightBody;
  if (leftDir && rightDir) return leftBody === rightBody || leftBody.startsWith(`${rightBody}/`) || rightBody.startsWith(`${leftBody}/`);
  if (leftDir) return rightBody === leftBody || rightBody.startsWith(`${leftBody}/`);
  return leftBody === rightBody || leftBody.startsWith(`${rightBody}/`);
}

function assertSafeBranch(branch) {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 180 || !SAFE_BRANCH_RE.test(branch)) return false;
  if (branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.startsWith('.') || branch.endsWith('.') || branch.includes('..')) return false;
  if (branch.includes('@{') || branch.includes('//') || branch.endsWith('.lock')) return false;
  return branch.split('/').every((part) => part && part !== '.' && part !== '..');
}

function assertString(value, label, { min = 1, max = 10_000, pattern, singleLine = false } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0') || (singleLine && /[\r\n]/.test(value)) || (pattern && !pattern.test(value))) {
    throw new DispatchError('INVALID_PACKET', `${label} is invalid`);
  }
}

function assertStringArray(value, label, { min = 1, max = MAX_SCOPE_ENTRIES, scope = false } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new DispatchError('INVALID_PACKET', `${label} must contain ${min}-${max} item(s)`);
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const item of value) {
    if (typeof item !== 'string' || (scope && !isSafeRelativePath(item))) throw new DispatchError('INVALID_PACKET', `${label} contains an unsafe value`);
    totalBytes += Buffer.byteLength(item);
    if (totalBytes > MAX_SCOPE_BYTES) throw new DispatchError('INVALID_PACKET', `${label} exceeds the bounded scope size`);
    if (seen.has(item)) throw new DispatchError('INVALID_PACKET', `${label} contains duplicate value: ${item}`);
    seen.add(item);
  }
  return [...seen].map(normalizeScopeEntry);
}

function assertValidation(value) {
  if (!Array.isArray(value) || value.length > 20) {
    throw new DispatchError('INVALID_PACKET', 'validation must contain 0-20 static preflight argv arrays');
  }
  return value.map((argv, index) => {
    if (!Array.isArray(argv) || argv.length !== 3) {
      throw new DispatchError('INVALID_PACKET', `validation[${index}] must be exactly: node --check <relative-file>`);
    }
    let totalBytes = 0;
    for (const item of argv) {
      if (typeof item !== 'string' || item.length === 0 || /[\0\r\n]/.test(item) || Buffer.byteLength(item) > MAX_VALIDATION_ARG_BYTES) {
        throw new DispatchError('INVALID_PACKET', `validation[${index}] contains an invalid or oversized argument`);
      }
      totalBytes += Buffer.byteLength(item);
    }
    if (totalBytes > MAX_VALIDATION_COMMAND_BYTES) throw new DispatchError('INVALID_PACKET', `validation[${index}] exceeds the command byte budget`);
    if (argv[0] !== VALIDATION_EXECUTABLE || argv[1] !== '--check' || !isSafeRelativePath(argv[2], { allowDirectory: false })) {
      throw new DispatchError('INVALID_PACKET', `validation[${index}] must be exactly: node --check <relative-file>`);
    }
    return [...argv];
  });
}

export function validatePacket(raw) {
  assertPlainObject(raw, 'packet');
  assertExactKeys(raw, new Set(['version', 'repository', 'task_id', 'base_sha', 'base_branch', 'branch', 'writable', 'forbidden', 'prompt', 'model', 'approval_mode', 'output_mode', 'budgets', 'validation']), 'packet');
  if (raw.version !== 1) throw new DispatchError('INVALID_PACKET', 'version must be 1');
  assertString(raw.repository, 'repository', { max: 180, pattern: REPOSITORY_RE });
  assertString(raw.task_id, 'task_id', { max: 80, pattern: TASK_ID_RE });
  assertString(raw.base_sha, 'base_sha', { min: 40, max: 40, pattern: SHA_RE });
  assertString(raw.base_branch, 'base_branch', { max: 120 });
  if (!assertSafeBranch(raw.base_branch)) throw new DispatchError('INVALID_PACKET', 'base_branch is unsafe');
  if (!assertSafeBranch(raw.branch)) throw new DispatchError('INVALID_PACKET', 'branch is unsafe');
  if (raw.branch === raw.base_branch) throw new DispatchError('INVALID_PACKET', 'task branch must differ from base branch');

  const writable = assertStringArray(raw.writable, 'writable', { scope: true });
  const forbidden = assertStringArray(raw.forbidden, 'forbidden', { scope: true });
  for (const allowedPath of writable) {
    if (forbidden.some((blocked) => scopesOverlap(allowedPath, blocked))) {
      throw new DispatchError('INVALID_PACKET', `writable/forbidden scope overlaps at ${allowedPath}`);
    }
  }

  assertString(raw.prompt, 'prompt', { max: 30_000 });
  assertString(raw.model, 'model', { max: 160, pattern: MODEL_RE });
  if (raw.model.startsWith('-')) throw new DispatchError('INVALID_PACKET', 'model may not begin with an option prefix');
  if (!SAFE_APPROVAL_MODES.has(raw.approval_mode)) throw new DispatchError('INVALID_PACKET', 'approval_mode must be auto-edit');
  if (!SAFE_OUTPUT_MODES.has(raw.output_mode)) throw new DispatchError('INVALID_PACKET', 'output_mode must be json');

  assertPlainObject(raw.budgets, 'budgets');
  assertExactKeys(raw.budgets, new Set(['max_wall_time', 'max_tool_calls', 'max_session_turns']), 'budgets');
  assertString(raw.budgets.max_wall_time, 'budgets.max_wall_time', { max: 16, pattern: WALL_TIME_RE });
  const wallTimeMs = parseWallTimeMs(raw.budgets.max_wall_time);
  if (!Number.isFinite(wallTimeMs) || wallTimeMs < 1_000 || wallTimeMs > MAX_WALL_TIME_MS) {
    throw new DispatchError('INVALID_PACKET', 'budgets.max_wall_time must be between 1s and 2h');
  }
  if (!Number.isInteger(raw.budgets.max_tool_calls) || raw.budgets.max_tool_calls < 1 || raw.budgets.max_tool_calls > 500) {
    throw new DispatchError('INVALID_PACKET', 'budgets.max_tool_calls must be an integer from 1 to 500');
  }
  if (!Number.isInteger(raw.budgets.max_session_turns) || raw.budgets.max_session_turns < 1 || raw.budgets.max_session_turns > 100) {
    throw new DispatchError('INVALID_PACKET', 'budgets.max_session_turns must be an integer from 1 to 100');
  }

  const validation = assertValidation(raw.validation);
  for (const argv of validation) {
    if (!writable.some((entry) => pathMatchesScope(argv[2], entry))) {
      throw new DispatchError('INVALID_PACKET', `validation target is outside writable scope: ${argv[2]}`);
    }
  }

  return {
    ...raw,
    writable,
    forbidden,
    validation,
    budgets: { ...raw.budgets },
  };
}

export function buildQwenPrompt(packet) {
  return [
    'You are a scoped IMPLEMENTER inside the Kepenk Development Engine.',
    `Task: ${packet.task_id}`,
    `Repository: ${packet.repository}`,
    `Exact base SHA: ${packet.base_sha}`,
    `Task branch: ${packet.branch}`,
    '',
    'Authority boundaries:',
    '- You are not DANIŞMA/coordinator.',
    '- You are not R1 or R2 and may not issue an R1/R2 verdict.',
    '- Do not commit, push, create/update a PR, mark ready, approve, or merge. The dispatcher owns Git/GitHub delivery.',
    '- Do not run shell commands. The dispatcher owns validation.',
    '- Do not widen scope or invent dependencies.',
    '- If required context, authority, or scope is missing/conflicting, stop and return exactly MORE_CONTEXT | ESCALATE plus a short reason.',
    '',
    'Writable scope:',
    ...packet.writable.map((item) => `- ${item}`),
    '',
    'Forbidden scope:',
    ...packet.forbidden.map((item) => `- ${item}`),
    '',
    'Read repository guidance including QWEN.md/AGENTS.md and canonical Development Engine sources when available.',
    'Prefer the smallest valid implementation. Edit only the writable scope.',
    '',
    'Assignment:',
    packet.prompt,
  ].join('\n');
}

export function buildQwenArgs(packet) {
  return [
    '--prompt', buildQwenPrompt(packet),
    '--model', packet.model,
    '--approval-mode', packet.approval_mode,
    '--output-format', packet.output_mode,
    '--max-wall-time', packet.budgets.max_wall_time,
    '--max-tool-calls', String(packet.budgets.max_tool_calls),
    '--max-session-turns', String(packet.budgets.max_session_turns),
    '--core-tools', QWEN_CORE_TOOLS.join(','),
    '--exclude-tools', QWEN_DISABLED_TOOLS.join(','),
    '--sandbox',
  ];
}

function hasGitMetadataComponent(file) {
  return file.split('/').some((part) => part === '.git');
}

export function inspectChangedPaths(changedPaths, packet) {
  const unique = [...new Set(changedPaths)].sort();
  const outsideWritable = unique.filter((file) => !packet.writable.some((entry) => pathMatchesScope(file, entry)));
  const forbidden = [...new Set(unique.filter((file) =>
    hasGitMetadataComponent(file) || packet.forbidden.some((entry) => pathMatchesScope(file, entry))
  ))].sort();
  return { changed: unique, outsideWritable, forbidden, ok: outsideWritable.length === 0 && forbidden.length === 0 };
}

export function sensitiveValues(env) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (/(TOKEN|SECRET|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY|AUTH)/i.test(name)) values.push(value);
  }
  return values.sort((a, b) => b.length - a.length);
}

export function redactText(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

export function isDeniedQwenEnvName(name) {
  return !QWEN_PROVIDER_ENV.has(name);
}

function childEnv({ includeProviderSecrets = false, isolatedHome = null } = {}) {
  const env = {};
  const baseNames = isolatedHome ? QWEN_BASE_ENV_ALLOWLIST : BASE_ENV_ALLOWLIST;
  for (const name of baseNames) if (process.env[name] !== undefined) env[name] = process.env[name];
  if (isolatedHome) {
    const configHome = path.join(isolatedHome, 'config');
    const cacheHome = path.join(isolatedHome, 'cache');
    const runtimeHome = path.join(isolatedHome, 'runtime');
    for (const dir of [isolatedHome, configHome, cacheHome, runtimeHome]) mkdirSync(dir, { recursive: true, mode: 0o700 });
    env.HOME = isolatedHome;
    env.XDG_CONFIG_HOME = configHome;
    env.XDG_CACHE_HOME = cacheHome;
    env.QWEN_RUNTIME_DIR = runtimeHome;
  }
  if (includeProviderSecrets) {
    const names = (process.env.DEV_DISPATCH_QWEN_ENV_ALLOWLIST ?? DEFAULT_QWEN_ENV_ALLOWLIST.join(','))
      .split(',').map((item) => item.trim()).filter(Boolean);
    for (const name of names) {
      if (isDeniedQwenEnvName(name)) throw new DispatchError('UNSAFE_CONFIG', `Qwen environment allowlist may not contain GitHub credential: ${name}`);
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
  }
  return env;
}

function run(command, args, { cwd, env = childEnv(), timeout = 120_000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false, timeout, maxBuffer: 8 * 1024 * 1024 });
  if (result.error && !allowFailure) throw new DispatchError('PROCESS_ERROR', `${command} could not start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new DispatchError('PROCESS_FAILED', `${command} exited with ${result.status ?? 'unknown'}`, {
      command, status: result.status, stdout_bytes: Buffer.byteLength(result.stdout ?? ''), stderr_bytes: Buffer.byteLength(result.stderr ?? ''),
    });
  }
  return result;
}

function pickEnv(names) {
  const env = {};
  for (const name of names) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

function gitEnv() {
  return { ...pickEnv(GIT_ENV_ALLOWLIST), GIT_TERMINAL_PROMPT: '0' };
}

function ghEnv() {
  return pickEnv(GH_ENV_ALLOWLIST);
}

function git(cwd, args, options = {}) {
  return run('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: gitEnv(), ...options });
}

function gitOutput(cwd, args) {
  return git(cwd, args).stdout.trim();
}

function parseNullList(value) {
  return value ? value.split('\0').filter(Boolean) : [];
}

function stageableChangedPaths(worktree, baseSha) {
  const tracked = parseNullList(git(worktree, ['diff', '--name-only', '-z', baseSha, '--']).stdout);
  const untracked = parseNullList(git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']).stdout);
  return [...new Set([...tracked, ...untracked])];
}

function ignoredUntrackedPaths(worktree) {
  return parseNullList(git(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).stdout);
}

function assertHeadAtBase(worktree, baseSha, actor = 'worker') {
  const head = gitOutput(worktree, ['rev-parse', 'HEAD']);
  if (head !== baseSha) throw new DispatchError('UNAUTHORIZED_COMMIT', `${actor} changed HEAD; expected exact base ${baseSha}`);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPathHasNoSymlink(worktree, relativePath) {
  const rootReal = realpathSync(worktree);
  const body = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
  let current = worktree;
  for (const part of body.split('/')) {
    current = path.join(current, part);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new DispatchError('SYMLINK_VIOLATION', `symlink is not allowed in worker path: ${relativePath}`);
    const resolved = realpathSync(current);
    if (!isInside(rootReal, resolved)) throw new DispatchError('PATH_ESCAPE', `worker path escapes worktree: ${relativePath}`);
  }
}

function assertFilesystemFence(worktree, paths) {
  const tracked = git(worktree, ['ls-files', '-s', '-z']).stdout.split('\0').filter(Boolean);
  const symlink = tracked.find((entry) => entry.startsWith('120000 '));
  if (symlink) throw new DispatchError('SYMLINK_VIOLATION', 'tracked repository symlinks are not allowed in Qwen worker worktrees');
  for (const relativePath of paths) assertPathHasNoSymlink(worktree, relativePath);
}

function captureWorktreeMetadata(worktree) {
  const marker = path.join(worktree, '.git');
  if (!existsSync(marker) || !lstatSync(marker).isFile()) throw new DispatchError('GIT_METADATA', 'linked worktree .git marker must be a regular file');
  return readFileSync(marker, 'utf8');
}

function assertWorktreeMetadata(worktree, expected) {
  const marker = path.join(worktree, '.git');
  if (!existsSync(marker) || !lstatSync(marker).isFile() || readFileSync(marker, 'utf8') !== expected) {
    throw new DispatchError('GIT_METADATA', 'worker changed linked-worktree Git metadata');
  }
}

export function auditWorkerState(worktree, packet, { rejectIgnored = true, actor = 'worker', requireChanges = true } = {}) {
  assertHeadAtBase(worktree, packet.base_sha, actor);
  if (rejectIgnored) {
    const ignored = ignoredUntrackedPaths(worktree);
    if (ignored.length > 0) throw new DispatchError('IGNORED_PATH_WRITE', `${actor} created ignored untracked paths`, { count: ignored.length });
  }
  const paths = stageableChangedPaths(worktree, packet.base_sha);
  assertFilesystemFence(worktree, paths);
  const scope = inspectChangedPaths(paths, packet);
  if (!scope.ok) throw new DispatchError('SCOPE_VIOLATION', `${actor} changed paths outside the authorized scope`, scope);
  if (requireChanges && scope.changed.length === 0) throw new DispatchError('NO_CHANGES', `${actor} left no authorized change`);
  return scope;
}

function normalizeGithubRemote(value) {
  return value.trim().toLowerCase()
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^ssh:\/\/git@github\.com\//, '');
}

function assertLocalRepository(repoRoot, packet) {
  const top = gitOutput(repoRoot, ['rev-parse', '--show-toplevel']);
  if (path.resolve(top) !== path.resolve(repoRoot)) throw new DispatchError('REPO_MISMATCH', 'repoRoot is not the git top-level');
  const status = gitOutput(repoRoot, ['status', '--porcelain']);
  if (status) throw new DispatchError('DIRTY_REPO', 'dispatcher source repository must be clean');
  git(repoRoot, ['cat-file', '-e', `${packet.base_sha}^{commit}`]);
  let localBase = null;
  for (const ref of [`refs/heads/${packet.base_branch}`, `refs/remotes/origin/${packet.base_branch}`]) {
    const result = git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true });
    if (result.status === 0) {
      localBase = result.stdout.trim();
      break;
    }
  }
  if (!localBase) throw new DispatchError('LOCAL_BASE_REF_UNAVAILABLE', `local/cached base ref is unavailable: ${packet.base_branch}`);
  if (localBase !== packet.base_sha) throw new DispatchError('STALE_LOCAL_BASE', `local/cached ${packet.base_branch} does not match exact base SHA`);
  const expected = packet.repository.toLowerCase();
  const fetchUrls = git(repoRoot, ['remote', 'get-url', '--all', 'origin']).stdout.split(/\r?\n/).filter(Boolean);
  const pushUrls = git(repoRoot, ['remote', 'get-url', '--push', '--all', 'origin']).stdout.split(/\r?\n/).filter(Boolean);
  if (fetchUrls.length === 0 || pushUrls.length === 0) throw new DispatchError('REPO_MISMATCH', 'origin must have fetch and push URLs');
  for (const remote of [...fetchUrls, ...pushUrls]) {
    if (normalizeGithubRemote(remote) !== expected) throw new DispatchError('REPO_MISMATCH', `origin fetch/push URL does not match ${packet.repository}`);
  }
}

function assertRemoteRepositoryState(repoRoot, packet) {
  const baseRef = git(repoRoot, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${packet.base_branch}`], { allowFailure: true, timeout: 60_000 });
  if (baseRef.status !== 0) throw new DispatchError('BASE_REF_UNAVAILABLE', `could not resolve origin/${packet.base_branch}`);
  const remoteBaseSha = baseRef.stdout.trim().split(/\s+/)[0];
  if (remoteBaseSha !== packet.base_sha) throw new DispatchError('STALE_BASE', `origin/${packet.base_branch} does not match exact base SHA`);
}

function branchExists(repoRoot, branch) {
  const result = git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
  return result.status === 0;
}

function remoteBranchExists(repoRoot, branch) {
  const result = git(repoRoot, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], { allowFailure: true, timeout: 60_000 });
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new DispatchError('REMOTE_CHECK_FAILED', `could not verify remote task branch: ${branch}`);
}

function createWorktree(repoRoot, packet) {
  if (branchExists(repoRoot, packet.branch)) throw new DispatchError('BRANCH_EXISTS', `local branch already exists: ${packet.branch}`);
  if (remoteBranchExists(repoRoot, packet.branch)) throw new DispatchError('BRANCH_EXISTS', `remote branch already exists: ${packet.branch}`);
  const parent = mkdtempSync(path.join(tmpdir(), 'kepenk-dispatch-'));
  const worktree = path.join(parent, 'worktree');
  let created = false;
  try {
    git(repoRoot, ['worktree', 'add', '-b', packet.branch, worktree, packet.base_sha], { timeout: 180_000 });
    created = true;
    const head = gitOutput(worktree, ['rev-parse', 'HEAD']);
    const current = gitOutput(worktree, ['branch', '--show-current']);
    if (head !== packet.base_sha || current !== packet.branch) throw new DispatchError('BASE_MISMATCH', 'created worktree does not match exact base/branch');
    return { parent, worktree };
  } catch (error) {
    if (created) {
      git(repoRoot, ['worktree', 'remove', '--force', worktree], { allowFailure: true, timeout: 120_000 });
      git(repoRoot, ['branch', '-D', packet.branch], { allowFailure: true });
    } else {
      rmSync(worktree, { recursive: true, force: true });
    }
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function cleanupWorktree(repoRoot, worktreeState, packet, { deleteBranch = false } = {}) {
  if (!worktreeState) return;
  git(repoRoot, ['worktree', 'remove', '--force', worktreeState.worktree], { allowFailure: true, timeout: 120_000 });
  rmSync(worktreeState.parent, { recursive: true, force: true });
  if (deleteBranch) git(repoRoot, ['branch', '-D', packet.branch], { allowFailure: true });
}

function parseWallTimeMs(value) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(value);
  if (!match) return Number.NaN;
  const number = Number(match[1]);
  const multiplier = match[2] === 'h' ? 3_600_000 : match[2] === 'm' ? 60_000 : 1_000;
  return Math.ceil(number * multiplier);
}

function runValidations(worktree, packet, validationHome) {
  const results = [];
  const started = Date.now();
  for (const argv of packet.validation) {
    const elapsed = Date.now() - started;
    const remaining = MAX_VALIDATION_TOTAL_MS - elapsed;
    if (remaining <= 0) throw new DispatchError('VALIDATION_TIMEOUT', 'static validation exceeded the 20 minute total deadline', { validation: results });
    const result = run(VALIDATION_EXECUTABLE, ['--check', argv[2]], {
      cwd: worktree,
      env: childEnv({ isolatedHome: validationHome }),
      timeout: remaining,
      allowFailure: true,
    });
    results.push({ command: 'node --check', target: argv[2], status: result.status, stdout_bytes: Buffer.byteLength(result.stdout ?? ''), stderr_bytes: Buffer.byteLength(result.stderr ?? '') });
    if (result.error?.code === 'ETIMEDOUT') throw new DispatchError('VALIDATION_TIMEOUT', 'static validation exceeded the 20 minute total deadline', { validation: results });
    if (result.error || result.status !== 0) {
      throw new DispatchError('VALIDATION_FAILED', `static validation failed: ${argv[2]}`, { validation: results });
    }
  }
  const diffCheck = git(worktree, ['diff', '--check'], { allowFailure: true, timeout: 60_000 });
  results.push({ command: 'git diff --check', target: null, status: diffCheck.status, stdout_bytes: Buffer.byteLength(diffCheck.stdout ?? ''), stderr_bytes: Buffer.byteLength(diffCheck.stderr ?? '') });
  if (diffCheck.error || diffCheck.status !== 0) throw new DispatchError('VALIDATION_FAILED', 'git diff --check failed', { validation: results });
  return results;
}

function safeReceiptText(value) {
  return redactText(value, sensitiveValues(process.env));
}

function buildPrBody(packet, headSha, changed, validations) {
  const validationLines = validations.map(({ command, target, status }) => `- \`${command}${target ? ` ${target}` : ''}\` -> ${status === 0 ? 'PASS' : `exit ${status}`}`);
  return [
    'Coordinator-authored task packet executed by the bounded dispatcher.',
    '',
    '## Dispatcher receipt',
    `- Task: \`${packet.task_id}\``,
    `- Base: \`${packet.base_sha}\``,
    `- Exact head: \`${headSha}\``,
    `- Branch: \`${packet.branch}\``,
    `- Model: \`${packet.model}\``,
    '- Worker role: implementer only; no readiness/merge/R1/R2 authority',
    '- Changed paths:',
    ...changed.map((file) => `  - \`${file}\``),
    '- Validation:',
    ...validationLines,
    '',
    'R0/Copilot review is advisory. Coordinator alone decides readiness/merge.',
  ].join('\n');
}

function acquireLock() {
  const lockPath = path.join(tmpdir(), 'kepenk-dev-dispatcher.lock');
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return lockPath;
  } catch (error) {
    if (error?.code === 'EEXIST') throw new DispatchError('BUSY', 'another dispatcher process holds the single-worker lock');
    throw error;
  }
}

function releaseLock(lockPath) {
  if (lockPath && existsSync(lockPath)) unlinkSync(lockPath);
}

export function buildDryRun(packet, qwenBin = 'qwen') {
  return {
    status: 'DRY_RUN',
    task_id: packet.task_id,
    repository: packet.repository,
    base_sha: packet.base_sha,
    branch: packet.branch,
    writable: packet.writable,
    forbidden: packet.forbidden,
    qwen: { executable: qwenBin, args: buildQwenArgs(packet).map((value, index, args) => args[index - 1] === '--prompt' ? '[PROMPT]' : value) },
    validation: packet.validation.map((argv) => ({ command: argv[0] })),
  };
}

export function parseQwenCompletion(text) {
  const qwenText = String(text ?? '');
  let events;
  try {
    events = JSON.parse(qwenText);
  } catch {
    throw new DispatchError('QWEN_PROTOCOL', 'Qwen JSON output could not be parsed', { stdout_bytes: Buffer.byteLength(qwenText) });
  }
  if (!Array.isArray(events) || events.length === 0) throw new DispatchError('QWEN_PROTOCOL', 'Qwen JSON output must be a non-empty event array');
  const finalEvent = events[events.length - 1];
  if (!finalEvent || finalEvent.type !== 'result' || finalEvent.subtype !== 'success' || finalEvent.is_error !== false) {
    throw new DispatchError('QWEN_PROTOCOL', 'Qwen did not finish with an explicit success result');
  }
  const finalText = typeof finalEvent.result === 'string' ? finalEvent.result : JSON.stringify(finalEvent.result ?? '');
  if (finalText.includes('MORE_CONTEXT | ESCALATE')) throw new DispatchError('QWEN_ESCALATED', 'Qwen requested coordinator escalation');
  return finalEvent;
}

export function buildCreateOnlyPushArgs(branch) {
  const remoteRef = `refs/heads/${branch}`;
  return [
    `--force-with-lease=${remoteRef}:`,
    '--set-upstream',
    'origin',
    `HEAD:${remoteRef}`,
  ];
}

export function dispatch(packet, {
  repoRoot = process.cwd(),
  qwenBin = 'qwen',
  ghBin = 'gh',
  dryRun = false,
  localGuard = assertLocalRepository,
  remoteGuard = assertRemoteRepositoryState,
} = {}) {
  const validated = validatePacket(packet);
  if (dryRun) {
    localGuard(repoRoot, validated);
    if (branchExists(repoRoot, validated.branch)) throw new DispatchError('BRANCH_EXISTS', `local branch already exists: ${validated.branch}`);
    return buildDryRun(validated, qwenBin);
  }

  let lockPath;
  let worktreeState;
  try {
    lockPath = acquireLock();
    localGuard(repoRoot, validated);
    remoteGuard(repoRoot, validated);
    worktreeState = createWorktree(repoRoot, validated);

    assertFilesystemFence(worktreeState.worktree, validated.writable);
    const metadataSnapshot = captureWorktreeMetadata(worktreeState.worktree);
    const qwenHome = path.join(worktreeState.parent, 'qwen-home');
    mkdirSync(qwenHome, { recursive: true, mode: 0o700 });
    const qwenArgs = buildQwenArgs(validated);
    const qwenResult = run(qwenBin, qwenArgs, {
      cwd: worktreeState.worktree,
      env: childEnv({ includeProviderSecrets: true, isolatedHome: qwenHome }),
      timeout: parseWallTimeMs(validated.budgets.max_wall_time),
      allowFailure: true,
    });
    if (qwenResult.error?.code === 'ETIMEDOUT') throw new DispatchError('QWEN_TIMEOUT', 'Qwen exceeded the declared wall-time budget');
    if (qwenResult.error) throw new DispatchError('QWEN_UNAVAILABLE', `Qwen could not start: ${qwenResult.error.message}`);
    if (qwenResult.status !== 0) {
      throw new DispatchError('QWEN_FAILED', `Qwen exited with ${qwenResult.status ?? 'unknown'}`, {
        status: qwenResult.status,
        stdout_bytes: Buffer.byteLength(qwenResult.stdout ?? ''),
        stderr_bytes: Buffer.byteLength(qwenResult.stderr ?? ''),
      });
    }

    parseQwenCompletion(qwenResult.stdout);
    assertWorktreeMetadata(worktreeState.worktree, metadataSnapshot);
    auditWorkerState(worktreeState.worktree, validated, { rejectIgnored: true, actor: 'Qwen' });

    const validationHome = path.join(worktreeState.parent, 'validation-home');
    mkdirSync(validationHome, { recursive: true, mode: 0o700 });
    const validations = runValidations(worktreeState.worktree, validated, validationHome);
    assertWorktreeMetadata(worktreeState.worktree, metadataSnapshot);
    const scope = auditWorkerState(worktreeState.worktree, validated, { rejectIgnored: false, actor: 'validation' });

    git(worktreeState.worktree, ['add', '--all']);
    const stagedPaths = parseNullList(git(worktreeState.worktree, ['diff', '--cached', '--name-only', '-z', validated.base_sha, '--']).stdout);
    const stagedScope = inspectChangedPaths(stagedPaths, validated);
    if (!stagedScope.ok) throw new DispatchError('SCOPE_VIOLATION', 'staged delivery exceeds authorized scope', stagedScope);
    git(worktreeState.worktree, [
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgSign=false',
      'commit', '--no-verify', '-m', `feat(dispatch): ${validated.task_id} Qwen implementation`,
    ], { timeout: 120_000 });
    const headSha = gitOutput(worktreeState.worktree, ['rev-parse', 'HEAD']);
    const parentSha = gitOutput(worktreeState.worktree, ['rev-parse', 'HEAD^']);
    if (parentSha !== validated.base_sha) throw new DispatchError('BASE_MISMATCH', 'dispatcher commit is not a direct child of the exact base');
    assertWorktreeMetadata(worktreeState.worktree, metadataSnapshot);
    const committedPaths = parseNullList(git(worktreeState.worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', parentSha, headSha]).stdout);
    const committedScope = inspectChangedPaths(committedPaths, validated);
    if (!committedScope.ok || committedScope.changed.length === 0) {
      throw new DispatchError('SCOPE_VIOLATION', 'committed tree exceeds authorized scope', committedScope);
    }
    localGuard(repoRoot, { ...validated, base_sha: headSha });
    remoteGuard(repoRoot, validated);
    if (remoteBranchExists(repoRoot, validated.branch)) throw new DispatchError('BRANCH_EXISTS', `remote branch appeared before push: ${validated.branch}`);
    const push = git(worktreeState.worktree, ['push', ...buildCreateOnlyPushArgs(validated.branch)], { timeout: 180_000, allowFailure: true });
    if (push.error || push.status !== 0) {
      throw new DispatchError('PUSH_FAILED', 'create-only task branch push failed', {
        branch: validated.branch, status: push.status,
        stdout_bytes: Buffer.byteLength(push.stdout ?? ''), stderr_bytes: Buffer.byteLength(push.stderr ?? ''),
      });
    }
    const prBody = buildPrBody(validated, headSha, committedScope.changed, validations);
    const pr = run(ghBin, ['pr', 'create', '--draft', '--repo', validated.repository, '--base', validated.base_branch, '--head', validated.branch,
      '--title', `${validated.task_id}: Qwen implementation`, '--body', prBody], { cwd: worktreeState.worktree, env: ghEnv(), timeout: 120_000, allowFailure: true });
    if (pr.error || pr.status !== 0) {
      throw new DispatchError('PR_CREATE_FAILED', 'branch was pushed but draft PR creation failed', {
        head_sha: headSha, branch: validated.branch, status: pr.status,
      });
    }

    const prUrl = safeReceiptText(pr.stdout.trim());
    const expectedPrPrefix = `https://github.com/${validated.repository}/pull/`;
    const prNumber = prUrl.startsWith(expectedPrPrefix) ? prUrl.slice(expectedPrPrefix.length) : '';
    if (!/^[1-9]\d*$/.test(prNumber)) {
      throw new DispatchError('PR_CREATE_PROTOCOL', 'gh returned an unexpected PR URL', {
        status: pr.status, stdout_bytes: Buffer.byteLength(pr.stdout ?? ''),
      });
    }

    return {
      status: 'DRAFT_PR_CREATED', task_id: validated.task_id, repository: validated.repository,
      base_sha: validated.base_sha, head_sha: headSha, branch: validated.branch,
      changed_paths: committedScope.changed, validation: validations.map(({ command, target, status }) => ({ command, target, status })),
      pr_url: prUrl, qwen_exit: qwenResult.status,
      qwen_io: {
        output_mode: validated.output_mode,
        stdout_bytes: Buffer.byteLength(qwenResult.stdout ?? ''),
        stderr_bytes: Buffer.byteLength(qwenResult.stderr ?? ''),
      },
    };
  } finally {
    cleanupWorktree(repoRoot, worktreeState, validated, { deleteBranch: true });
    releaseLock(lockPath);
  }
}

function parseCli(argv) {
  const options = { dryRun: false, repoRoot: process.cwd(), qwenBin: 'qwen' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (['--packet', '--repo-root', '--qwen-bin'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new DispatchError('USAGE', `${arg} requires a value`);
      index += 1;
      if (arg === '--packet') options.packetPath = value;
      if (arg === '--repo-root') options.repoRoot = path.resolve(value);
      if (arg === '--qwen-bin') options.qwenBin = value;
    } else throw new DispatchError('USAGE', `unknown argument: ${arg}`);
  }
  if (!options.packetPath) throw new DispatchError('USAGE', '--packet is required');
  return options;
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const options = parseCli(process.argv.slice(2));
    const packet = JSON.parse(readFileSync(path.resolve(options.packetPath), 'utf8'));
    const receipt = dispatch(packet, options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const secrets = sensitiveValues(process.env);
    const receipt = error instanceof DispatchError
      ? { status: 'MORE_CONTEXT | ESCALATE', code: error.code, message: redactText(error.message, secrets), details: JSON.parse(redactText(JSON.stringify(error.details ?? {}), secrets)) }
      : { status: 'MORE_CONTEXT | ESCALATE', code: 'UNEXPECTED', message: redactText(error instanceof Error ? error.message : String(error), secrets) };
    process.stderr.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = 1;
  }
}
