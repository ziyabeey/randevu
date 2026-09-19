import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifyPaths, diffPaths, normalizeTrustedReceipts, selectScope } from '../scripts/ci-scope.mjs';
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
  assert.equal(selectScope({ eventName: 'pull_request', event, git }).mode, 'code');
  assert.equal(selectScope({ eventName: 'push', event: { before: base, after: head }, git }).mode, 'docs');
  for (const options of [{}, { eventName: 'workflow_dispatch', event },
    { eventName: 'push', event: { before: '0'.repeat(40), after: head } },
    { eventName: 'pull_request', event, git: () => { throw new Error('missing object'); } }]) {
    assert.equal(selectScope(options).mode, 'code');
  }
});



test('trusted receipt normalization accepts only valid unique run identities', () => {
  const good = { headSha: 'b'.repeat(40), runId: 1234 };
  assert.deepEqual(normalizeTrustedReceipts([good]), [good]);
  assert.deepEqual(normalizeTrustedReceipts([
    good,
    { ...good, runId: 9999 },
    { headSha: 'not-a-sha', runId: 3 },
    { headSha: 'e'.repeat(40), runId: 0 },
  ]), [good]);
  assert.deepEqual(normalizeTrustedReceipts({}), []);
});

test('an unproven docs-only PR still runs full code checks', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const event = {
    action: 'opened',
    number: 187,
    pull_request: { number: 187, base: { sha: base }, head: { sha: head } },
  };
  const git = (args) => {
    if (args[0] === 'merge-base') return base;
    if (args[0] === 'diff') return 'M\0TASKS.md\0M\0docs/handoffs/F12-05.md\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const result = selectScope({ eventName: 'pull_request', event, git });
  assert.equal(result.mode, 'code');
  assert.equal(result.reason, 'git-diff');
});

test('docs-only descendant reuses a full-code receipt only when current base is already in that green head', () => {
  const base = 'a'.repeat(40);
  const previous = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    pull_request: { number: 187, base: { sha: base }, head: { sha: head } },
  };
  const git = (args) => {
    if (args[0] === 'merge-base' && args[1] === base && args[2] === head) return base;
    if (args[0] === 'merge-base' && args[1] === base && args[2] === previous) return base;
    if (args[0] === 'merge-base' && args[1] === previous && args[2] === head) return previous;
    if (args[0] === 'diff' && args.includes(base) && args.includes(head))
      return 'M\0src/PublicBookingPage.tsx\0M\0TASKS.md\0';
    if (args[0] === 'diff' && args.includes(previous) && args.includes(head))
      return 'M\0TASKS.md\0M\0docs/handoffs/F12-05.md\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const result = selectScope({
    eventName: 'pull_request',
    event,
    git,
    trustedReceipts: [{ headSha: previous, runId: 35443459168 }],
  });
  assert.equal(result.mode, 'docs');
  assert.equal(result.reason, 'green-descendant-docs-only');
  assert.equal(result.inheritedFrom, previous);
  assert.equal(result.inheritedRunId, 35443459168);
});

test('base drift invalidates an older green receipt even when the latest commit is docs-only', () => {
  const currentBase = 'd'.repeat(40);
  const oldBase = 'a'.repeat(40);
  const previous = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    pull_request: { number: 187, base: { sha: currentBase }, head: { sha: head } },
  };
  const git = (args) => {
    if (args[0] === 'merge-base' && args[1] === currentBase && args[2] === head) return currentBase;
    if (args[0] === 'merge-base' && args[1] === currentBase && args[2] === previous) return oldBase;
    if (args[0] === 'merge-base' && args[1] === previous && args[2] === head) return previous;
    if (args[0] === 'diff' && args.includes(currentBase) && args.includes(head))
      return 'M\0src/PublicBookingPage.tsx\0M\0TASKS.md\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const result = selectScope({
    eventName: 'pull_request',
    event,
    git,
    trustedReceipts: [{ headSha: previous, runId: 7 }],
  });
  assert.equal(result.mode, 'code');
});

test('non-ancestor or code-changing descendants cannot inherit a green receipt', () => {
  const base = 'a'.repeat(40);
  const previous = 'b'.repeat(40);
  const head = 'c'.repeat(40);
  const event = {
    action: 'synchronize',
    number: 187,
    pull_request: { number: 187, base: { sha: base }, head: { sha: head } },
  };
  const fullDiff = 'M\0src/PublicBookingPage.tsx\0M\0TASKS.md\0';

  const nonAncestorGit = (args) => {
    if (args[0] === 'merge-base' && args[1] === base && args[2] === head) return base;
    if (args[0] === 'merge-base' && args[1] === base && args[2] === previous) return base;
    if (args[0] === 'merge-base' && args[1] === previous && args[2] === head) return 'd'.repeat(40);
    if (args[0] === 'diff') return fullDiff;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  assert.equal(selectScope({
    eventName: 'pull_request',
    event,
    git: nonAncestorGit,
    trustedReceipts: [{ headSha: previous, runId: 8 }],
  }).mode, 'code');

  const codeDeltaGit = (args) => {
    if (args[0] === 'merge-base' && args[1] === base && args[2] === head) return base;
    if (args[0] === 'merge-base' && args[1] === base && args[2] === previous) return base;
    if (args[0] === 'merge-base' && args[1] === previous && args[2] === head) return previous;
    if (args[0] === 'diff' && args.includes(base) && args.includes(head)) return fullDiff;
    if (args[0] === 'diff' && args.includes(previous) && args.includes(head))
      return 'M\0src/PublicBookingPage.tsx\0';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  assert.equal(selectScope({
    eventName: 'pull_request',
    event,
    git: codeDeltaGit,
    trustedReceipts: [{ headSha: previous, runId: 9 }],
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

test('CI receipt lookup is anonymous, authoritative and requires prior full-code completion', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(workflow, /actions\/runs\/\$\{run_id\}\/jobs/);
  assert.match(workflow, /Run all required code checks/);
  assert.match(workflow, /Require the selected checks to complete/);
  assert.match(workflow, /Resolve trusted prior full-code CI receipts/);
  assert.doesNotMatch(workflow, /pull_requests\[\]\?; \.number == \$pr and \.base\.sha == \$base/);
  assert.doesNotMatch(workflow, /Authorization: Bearer|github\.token|GH_TOKEN|GITHUB_TOKEN/);
  assert.ok((workflow.match(/--connect-timeout 3 --max-time 10/g) ?? []).length >= 2);
  assert.match(workflow, /unexpected shape; full code checks remain required/);
  assert.match(workflow, /candidate parsing failed; full code checks remain required/);
  const scopeSection = workflow.split('- name: Select required checks')[1]?.split('- name: Check documentation')[0] ?? '';
  assert.match(scopeSection, /TRUSTED_CI_RECEIPTS_FILE/);
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
