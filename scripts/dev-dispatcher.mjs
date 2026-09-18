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
const DEFAULT_QWEN_ENV_ALLOWLIST = ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'];
const QWEN_ENV_HARD_DENY = /^(?:GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i;
const BASE_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
const QWEN_BASE_ENV_ALLOWLIST = ['PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP'];
const DEFAULT_VALIDATION_EXECUTABLES = new Set(['node', 'npm', 'npx', 'git']);

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
  if (!body || body === '.' || body.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  return path.posix.normalize(body) === body;
}

function normalizeScopeEntry(value) {
  return value.endsWith('/') ? value : value;
}

function pathMatchesScope(file, scopeEntry) {
  if (scopeEntry.endsWith('/')) return file.startsWith(scopeEntry);
  return file === scopeEntry;
}

function assertSafeBranch(branch) {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 180 || !SAFE_BRANCH_RE.test(branch)) return false;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.startsWith('.') || branch.endsWith('.') || branch.includes('..')) return false;
  if (branch.includes('@{') || branch.includes('//') || branch.endsWith('.lock')) return false;
  return branch.split('/').every((part) => part && part !== '.' && part !== '..');
}

function assertString(value, label, { min = 1, max = 10_000, pattern, singleLine = false } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0') || (singleLine && /[\r\n]/.test(value)) || (pattern && !pattern.test(value))) {
    throw new DispatchError('INVALID_PACKET', `${label} is invalid`);
  }
}

function assertStringArray(value, label, { min = 1, scope = false } = {}) {
  if (!Array.isArray(value) || value.length < min) throw new DispatchError('INVALID_PACKET', `${label} must contain at least ${min} item(s)`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || (scope && !isSafeRelativePath(item))) throw new DispatchError('INVALID_PACKET', `${label} contains an unsafe value`);
    if (seen.has(item)) throw new DispatchError('INVALID_PACKET', `${label} contains duplicate value: ${item}`);
    seen.add(item);
  }
  return [...seen].map(normalizeScopeEntry);
}

function assertValidation(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new DispatchError('INVALID_PACKET', 'validation must contain 1-20 argv arrays');
  }
  const allowed = new Set((process.env.DEV_DISPATCH_ALLOWED_EXECUTABLES ?? [...DEFAULT_VALIDATION_EXECUTABLES].join(','))
    .split(',').map((item) => item.trim()).filter(Boolean));
  return value.map((argv, index) => {
    if (!Array.isArray(argv) || argv.length === 0 || argv.length > 32 || argv.some((item) => typeof item !== 'string' || item.length === 0 || /[\0\r\n]/.test(item))) {
      throw new DispatchError('INVALID_PACKET', `validation[${index}] must be a bounded argv array`);
    }
    if (!allowed.has(argv[0])) throw new DispatchError('INVALID_PACKET', `validation executable is not allowed: ${argv[0]}`);
    return [...argv];
  });
}

export function validatePacket(raw) {
  assertPlainObject(raw, 'packet');
  assertExactKeys(raw, new Set(['version', 'repository', 'task_id', 'base_sha', 'base_branch', 'branch', 'writable', 'forbidden', 'prompt', 'model', 'approval_mode', 'output_mode', 'budgets', 'validation', 'commit_message', 'pr']), 'packet');
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
    if (forbidden.some((blocked) => pathMatchesScope(allowedPath.replace(/\/$/, ''), blocked) || pathMatchesScope(blocked.replace(/\/$/, ''), allowedPath))) {
      throw new DispatchError('INVALID_PACKET', `writable/forbidden scope overlaps at ${allowedPath}`);
    }
  }

  assertString(raw.prompt, 'prompt', { max: 30_000 });
  assertString(raw.model, 'model', { max: 160, pattern: MODEL_RE });
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
  assertString(raw.commit_message, 'commit_message', { max: 160, singleLine: true });

  assertPlainObject(raw.pr, 'pr');
  assertExactKeys(raw.pr, new Set(['title', 'body']), 'pr');
  assertString(raw.pr.title, 'pr.title', { max: 160, singleLine: true });
  assertString(raw.pr.body, 'pr.body', { max: 20_000 });

  return {
    ...raw,
    writable,
    forbidden,
    validation,
    budgets: { ...raw.budgets },
    pr: { ...raw.pr },
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
    '--exclude-tools', 'agent,shell',
    '--sandbox',
  ];
}

export function inspectChangedPaths(changedPaths, packet) {
  const unique = [...new Set(changedPaths)].sort();
  const outsideWritable = unique.filter((file) => !packet.writable.some((entry) => pathMatchesScope(file, entry)));
  const forbidden = unique.filter((file) => packet.forbidden.some((entry) => pathMatchesScope(file, entry)));
  return { changed: unique, outsideWritable, forbidden, ok: outsideWritable.length === 0 && forbidden.length === 0 };
}

function sensitiveValues(env) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (/(TOKEN|SECRET|PASSWORD|API[-]?KEY|PRIVATE[-]?KEY|AUTH)/i.test(name)) values.push(value);
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
      if (QWEN_ENV_HARD_DENY.test(name)) throw new DispatchError('UNSAFE_CONFIG', `Qwen environment allowlist may not contain GitHub credential: ${name}`);
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

function git(cwd, args, options = {}) {
  return run('git', args, { cwd, env: process.env, ...options });
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
    if (!existsSync(current)) break;
    const info = lstatSync(current);
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

function normalizeGithubRemote(value) {
  return value.trim().toLowerCase()
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^ssh:\/\/git@github\.com\//, '');
}

function assertRepository(repoRoot, packet) {
  const top = gitOutput(repoRoot, ['rev-parse', '--show-toplevel']);
  if (path.resolve(top) !== path.resolve(repoRoot)) throw new DispatchError('REPO_MISMATCH', 'repoRoot is not the git top-level');
  const status = gitOutput(repoRoot, ['status', '--porcelain']);
  if (status) throw new DispatchError('DIRTY_REPO', 'dispatcher source repository must be clean');
  git(repoRoot, ['cat-file', '-e', `${packet.base_sha}^{commit}`]);
  const expected = packet.repository.toLowerCase();
  const fetchUrls = git(repoRoot, ['remote', 'get-url', '--all', 'origin']).stdout.split(/\r?\n/).filter(Boolean);
  const pushUrls = git(repoRoot, ['remote', 'get-url', '--push', '--all', 'origin']).stdout.split(/\r?\n/).filter(Boolean);
  if (fetchUrls.length === 0 || pushUrls.length === 0) throw new DispatchError('REPO_MISMATCH', 'origin must have fetch and push URLs');
  for (const remote of [...fetchUrls, ...pushUrls]) {
    if (normalizeGithubRemote(remote) !== expected) throw new DispatchError('REPO_MISMATCH', `origin fetch/push URL does not match ${packet.repository}`);
  }
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
  try {
    git(repoRoot, ['worktree', 'add', '-b', packet.branch, worktree, packet.base_sha], { timeout: 180_000 });
    const head = gitOutput(worktree, ['rev-parse', 'HEAD']);
    const current = gitOutput(worktree, ['branch', '--show-current']);
    if (head !== packet.base_sha || current !== packet.branch) throw new DispatchError('BASE_MISMATCH', 'created worktree does not match exact base/branch');
    return { parent, worktree };
  } catch (error) {
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

function runValidations(worktree, packet) {
  const results = [];
  for (const argv of packet.validation) {
    const result = run(argv[0], argv.slice(1), { cwd: worktree, env: childEnv(), timeout: 20 * 60_000, allowFailure: true });
    results.push({ command: argv[0], status: result.status, stdout_bytes: Buffer.byteLength(result.stdout ?? ''), stderr_bytes: Buffer.byteLength(result.stderr ?? '') });
    if (result.error || result.status !== 0) {
      throw new DispatchError('VALIDATION_FAILED', `validation failed: ${argv[0]}`, { validation: results });
    }
  }
  return results;
}

function safeReceiptText(value) {
  return redactText(value, sensitiveValues(process.env));
}

function buildPrBody(packet, headSha, changed, validations) {
  const validationLines = validations.map(({ command, status }) => `- \`${command}\` -> ${status === 0 ? 'PASS' : `exit ${status}`}`);
  return [
    packet.pr.body,
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

export function dispatch(packet, { repoRoot = process.cwd(), qwenBin = 'qwen', dryRun = false } = {}) {
  const validated = validatePacket(packet);
  if (dryRun) {
    assertRepository(repoRoot, validated);
    if (branchExists(repoRoot, validated.branch)) throw new DispatchError('BRANCH_EXISTS', `local branch already exists: ${validated.branch}`);
    return buildDryRun(validated, qwenBin);
  }

  let lockPath;
  let worktreeState;
  let pushed = false;
  try {
    lockPath = acquireLock();
    assertRepository(repoRoot, validated);
    worktreeState = createWorktree(repoRoot, validated);

    assertFilesystemFence(worktreeState.worktree, validated.writable);
    const qwenHome = path.join(worktreeState.parent, 'qwen-home');
    mkdirSync(qwenHome, { recursive: true, mode: 0o700 });
    const qwenArgs = buildQwenArgs(validated);
    const qwenResult = run(qwenBin, qwenArgs, {
      cwd: worktreeState.worktree,
      env: childEnv({ includeProviderSecrets: true, isolatedHome: qwenHome }),
      timeout: parseWallTimeMs(validated.budgets.max_wall_time) + 30_000,
      allowFailure: true,
    });
    if (qwenResult.error) throw new DispatchError('QWEN_UNAVAILABLE', `Qwen could not start: ${qwenResult.error.message}`);
    if (qwenResult.status !== 0) {
      throw new DispatchError('QWEN_FAILED', `Qwen exited with ${qwenResult.status ?? 'unknown'}`, {
        status: qwenResult.status,
        stdout_bytes: Buffer.byteLength(qwenResult.stdout ?? ''),
        stderr_bytes: Buffer.byteLength(qwenResult.stderr ?? ''),
      });
    }

    const qwenText = String(qwenResult.stdout ?? '');
    let qwenPayload = null;
    try { qwenPayload = JSON.parse(qwenText); } catch {}
    const serializedQwen = qwenPayload === null ? qwenText : JSON.stringify(qwenPayload);
    if (serializedQwen.includes('MORE_CONTEXT | ESCALATE')) {
      throw new DispatchError('QWEN_ESCALATED', 'Qwen requested coordinator escalation');
    }

    assertHeadAtBase(worktreeState.worktree, validated.base_sha, 'Qwen');
    const ignored = ignoredUntrackedPaths(worktreeState.worktree);
    if (ignored.length > 0) throw new DispatchError('IGNORED_PATH_WRITE', 'Qwen created ignored untracked paths', { count: ignored.length });
    const initialPaths = stageableChangedPaths(worktreeState.worktree, validated.base_sha);
    assertFilesystemFence(worktreeState.worktree, initialPaths);
    const initialScope = inspectChangedPaths(initialPaths, validated);
    if (!initialScope.ok) throw new DispatchError('SCOPE_VIOLATION', 'Qwen changed paths outside the authorized scope', initialScope);
    if (initialScope.changed.length === 0) throw new DispatchError('NO_CHANGES', 'Qwen completed without changing an authorized path');

    const validations = runValidations(worktreeState.worktree, validated);
    assertHeadAtBase(worktreeState.worktree, validated.base_sha, 'validation');
    const finalPaths = stageableChangedPaths(worktreeState.worktree, validated.base_sha);
    assertFilesystemFence(worktreeState.worktree, finalPaths);
    const scope = inspectChangedPaths(finalPaths, validated);
    if (!scope.ok) throw new DispatchError('SCOPE_VIOLATION', 'validation produced changes outside the authorized scope', scope);
    if (scope.changed.length === 0) throw new DispatchError('NO_CHANGES', 'validation left no authorized change to deliver');

    git(worktreeState.worktree, ['add', '--all']);
    const stagedPaths = parseNullList(git(worktreeState.worktree, ['diff', '--cached', '--name-only', '-z', validated.base_sha, '--']).stdout);
    const stagedScope = inspectChangedPaths(stagedPaths, validated);
    if (!stagedScope.ok) throw new DispatchError('SCOPE_VIOLATION', 'staged delivery exceeds authorized scope', stagedScope);
    git(worktreeState.worktree, ['commit', '-m', validated.commit_message], { timeout: 120_000 });
    const headSha = gitOutput(worktreeState.worktree, ['rev-parse', 'HEAD']);
    const parentSha = gitOutput(worktreeState.worktree, ['rev-parse', 'HEAD^']);
    if (parentSha !== validated.base_sha) throw new DispatchError('BASE_MISMATCH', 'dispatcher commit is not a direct child of the exact base');
    git(worktreeState.worktree, ['push', '--set-upstream', 'origin', validated.branch], { timeout: 180_000 });
    pushed = true;

    const prBody = buildPrBody(validated, headSha, scope.changed, validations);
    const pr = run('gh', ['pr', 'create', '--draft', '--repo', validated.repository, '--base', validated.base_branch, '--head', validated.branch,
      '--title', validated.pr.title, '--body', prBody], { cwd: worktreeState.worktree, env: process.env, timeout: 120_000, allowFailure: true });
    if (pr.error || pr.status !== 0) {
      throw new DispatchError('PR_CREATE_FAILED', 'branch was pushed but draft PR creation failed', {
        head_sha: headSha, branch: validated.branch, status: pr.status,
      });
    }

    return {
      status: 'DRAFT_PR_CREATED', task_id: validated.task_id, repository: validated.repository,
      base_sha: validated.base_sha, head_sha: headSha, branch: validated.branch,
      changed_paths: scope.changed, validation: validations.map(({ command, status }) => ({ command, status })),
      pr_url: pr.stdout.trim(), qwen_exit: qwenResult.status,
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
