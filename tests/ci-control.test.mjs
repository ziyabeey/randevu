import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifyPaths, diffPaths, findTrustedPreviousHead, selectScope } from '../scripts/ci-scope.mjs';
import { gateResult } from '../scripts/ci-result.mjs';
import { stages, runCode } from '../scripts/ci-code.mjs';

test('CI accepts only explicit Markdown changes for the inexpensive path', () => {
  assert.equal(classifyPaths(['README.md', 'docs/plan/phase-10.md', 'TASKS.md']), 'docs');
  for (const paths of [[], ['README.md', 'worker/app.ts'], ['package.json'], ['unknown.md'],
    ['docs/../worker/app.ts'], ['../README.md'], ['docs/reference.png'], ['.github/workflows/ci.yml']]) {
    assert.equal(classifyPaths(paths), 'code', JSON.stringify(paths));
  }
});

test('NUL diff includes deleted files and both rename sides without newline ambiguity', () => {
  assert.deepEqual(diffPaths('D\0docs/old.md\0R100\0worker/old.ts\0docs/new.md\0M\0docs/two words.md\0'),
    ['docs/old.md', 'worker/old.ts', 'docs/new.md', 'docs/two words.md']);
  assert.equal(classifyPaths(diffPaths('R100\0worker/old.ts\0docs/new.md\0')), 'code');
  assert.equal(classifyPaths(diffPaths('D\0worker/old.ts\0M\0README.md\0')), 'code');
  assert.equal(classifyPaths(diffPaths('M\0docs/new\nline.md\0')), 'code');
  assert.throws(() => diffPaths('M\0README.md'), /Incomplete/);
  assert.throws(() => diffPaths('R100\0README.md\0'), /Missing/);
});

test('missing, unknown or unreadable event data always falls back to full checks', () => {
  const base = 'a'.repeat(40), head = 'b'.repeat(40);
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  const git = (args) => args[0] === 'merge-base' ? base : 'M\0README.md\0';
  assert.equal(selectScope({ eventName: 'pull_request', event, git }).mode, 'docs');
  assert.equal(selectScope({ eventName: 'push', event: { before: base, after: head }, git }).mode, 'docs');
  for (const options of [{}, { eventName: 'workflow_dispatch', event },
    { eventName: 'push', event: { before: '0'.repeat(40), after: head } },
    { eventName: 'pull_request', event, git: () => { throw new Error('missing object'); } }]) {
    assert.equal(selectScope(options).mode, 'code');
  }
});



test('green exact-head CI on the same PR and base is the only trusted carry-forward source', () => {
  const previous = 'c'.repeat(40);
  const base = 'a'.repeat(40);
  const current = 'd'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    before: previous,
    pull_request: { number: 187, base: { sha: base }, head: { sha: current } },
  };
  const good = {
    id: 1234,
    name: 'CI',
    conclusion: 'success',
    head_sha: previous,
    pull_requests: [{ number: 187, base: { sha: base } }],
  };
  assert.deepEqual(findTrustedPreviousHead({ event, runs: [good], complete: true }),
    { sha: previous, baseSha: base, runId: 1234 });

  for (const runs of [
    [{ ...good, conclusion: 'failure' }],
    [{ ...good, name: 'Other workflow' }],
    [{ ...good, head_sha: 'e'.repeat(40) }],
    [{ ...good, pull_requests: [{ number: 188, base: { sha: base } }] }],
    [{ ...good, pull_requests: [{ number: 187, base: { sha: 'f'.repeat(40) } }] }],
  ]) assert.equal(findTrustedPreviousHead({ event, runs, complete: true }), null);

  assert.equal(findTrustedPreviousHead({ event, runs: [good], complete: false }), null);
});

test('docs-only descendant of a same-base green PR head reuses full-code evidence', () => {
  const base = 'a'.repeat(40);
  const previous = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    before: previous,
    pull_request: { number: 187, base: { sha: base }, head: { sha: head } },
  };
  const git = (args) => {
    if (args[0] === 'merge-base' && args[1] === base && args[2] === head) return base;
    if (args[0] === 'merge-base' && args[1] === previous && args[2] === head) return previous;
    if (args[0] === 'diff' && args.includes(base) && args.includes(head))
      return 'M\0src/PublicBookingPage.tsx\0M\0TASKS.md\0';
    if (args[0] === 'diff' && args.includes(previous) && args.includes(head))
      return 'M\0TASKS.md\0M\0docs/handoffs/F12-05.md\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const trustedPreviousHead = { sha: previous, baseSha: base, runId: 35443459168 };
  const result = selectScope({ eventName: 'pull_request', event, git, trustedPreviousHead });
  assert.equal(result.mode, 'docs');
  assert.equal(result.reason, 'green-descendant-docs-only');
  assert.equal(result.inheritedFrom, previous);
  assert.equal(result.inheritedRunId, 35443459168);
});

test('docs-only latest commit still falls back to full code checks without trusted same-base green lineage', () => {
  const base = 'a'.repeat(40);
  const previous = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    before: previous,
    pull_request: { number: 187, base: { sha: base }, head: { sha: head } },
  };
  const git = (args) => {
    if (args[0] === 'merge-base' && args[1] === base && args[2] === head) return base;
    if (args[0] === 'diff' && args.includes(base) && args.includes(head))
      return 'M\0src/PublicBookingPage.tsx\0M\0TASKS.md\0';
    throw new Error('no descendant proof should be requested without trusted previous CI');
  };
  assert.equal(selectScope({ eventName: 'pull_request', event, git }).mode, 'code');
  assert.equal(selectScope({
    eventName: 'pull_request',
    event,
    git,
    trustedPreviousHead: { sha: previous, baseSha: 'd'.repeat(40), runId: 1 },
  }).mode, 'code');
});

test('actual Git history classifies multi-file pushes, rename and deletion conservatively', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'randevu-ci-diff-'));
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  try {
    git(['init', '-q']); git(['config', 'user.name', 'CI fixture']); git(['config', 'user.email', 'ci@example.com']);
    writeFileSync(path.join(root, 'README.md'), 'base\n'); writeFileSync(path.join(root, 'source.ts'), 'base\n');
    git(['add', '.']); git(['commit', '-qm', 'base']); const base = git(['rev-parse', 'HEAD']);
    writeFileSync(path.join(root, 'README.md'), 'docs\n'); git(['add', '.']); git(['commit', '-qm', 'docs']);
    const docs = git(['rev-parse', 'HEAD']);
    assert.equal(selectScope({ root, eventName: 'push', event: { before: base, after: docs } }).mode, 'docs');
    git(['rm', 'source.ts']); git(['commit', '-qm', 'remove code']); const head = git(['rev-parse', 'HEAD']);
    assert.equal(selectScope({ root, eventName: 'push', event: { before: base, after: head } }).mode, 'code');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('aggregate gate rejects every failed/cancelled/missing/unexpectedly skipped required result', () => {
  const statuses = ['success', 'failure', 'cancelled', 'skipped', undefined];
  for (const mode of ['docs', 'code', '', undefined]) for (const scope of statuses)
    for (const code of statuses) for (const complete of ['true', '', undefined]) for (const docsComplete of ['true', '', undefined]) {
      const expected = scope === 'success' && docsComplete === 'true' && ((mode === 'docs' && code === 'skipped' && !complete)
        || (mode === 'code' && code === 'success' && complete === 'true'));
      assert.equal(gateResult({ mode, scope, docsComplete, code, complete }), expected);
    }
});

test('full runner propagates a real failed child and cannot emit its success receipt', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'randevu-ci-stage-'));
  const output = path.join(root, 'output');
  writeFileSync(output, '');
  try {
    assert.throws(() => runCode({ root, output, log() {}, execute: () => spawnSync(process.execPath, ['-e', 'process.exit(7)']) }), /stage failed: inventory/);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.throws(() => runCode({ root, output, log() {}, selected: stages.filter(s => s.id !== 'postgres') }), /stage missing/);
    assert.equal(readFileSync(output, 'utf8'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
