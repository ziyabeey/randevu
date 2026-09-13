import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../scripts/ci-docs.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const states = new Map(Array.from({ length: 8 }, (_, index) => [`S${String(index + 1).padStart(2, '0')}`, index < 5 ? 'Tamamlandı' : 'Planlandı']));
const phaseCounts = new Map([[9, 5], [10, 6], [11, 4], [12, 5], [13, 4], [14, 5], [15, 4], [16, 8], [17, 5]]);

function taskMarkdown(change = () => {}) {
  const tasks = [];
  for (const [id, state] of states) tasks.push({ id, dep: id === 'S01' ? 'TEMEL' : `S${String(Number(id.slice(1)) - 1).padStart(2, '0')}`, state });
  for (const [phase, count] of phaseCounts) {
    for (let number = 1; number <= count; number += 1) {
      const id = `F${String(phase).padStart(2, '0')}-${String(number).padStart(2, '0')}`;
      tasks.push({ id, dep: number === 1 ? 'TEMEL' : `F${String(phase).padStart(2, '0')}-${String(number - 1).padStart(2, '0')}`, state: phase === 9 ? 'Tamamlandı' : 'Planlandı' });
    }
  }
  change(tasks);
  const technical = tasks.filter(({ id }) => id.startsWith('S'));
  const features = tasks.filter(({ id }) => id.startsWith('F'));
  const rows = (items) => items.map(({ id, dep, state }) => `| [${id}](plan.md#${id.toLowerCase()}) | İş | ${dep} | ${state} | — | — |`).join('\n');
  const gates = [
    '| GS | S01…S08 | Açık |',
    ...[...phaseCounts].map(([phase, count]) => `| G${String(phase).padStart(2, '0')} | F${String(phase).padStart(2, '0')}-01…F${String(phase).padStart(2, '0')}-${String(count).padStart(2, '0')} | ${phase === 9 ? 'Tarihsel kapalı' : 'Açık'} |`),
  ];
  return `# Tasks\n\n## Teknik düzeltmeler\n\n| Kimlik | İş | Önkoşullar | Durum | Sahip | Kanıt |\n| --- | --- | --- | --- | --- | --- |\n${rows(technical)}\n\n## Korunan MVP işleri\n\n| Kimlik | İş | Önkoşullar | Durum | Sahip | Kanıt |\n| --- | --- | --- | --- | --- | --- |\n${rows(features)}\n\n## Kabul kapıları\n\n| Kapı | Kapsam | Durum / kanıt |\n| --- | --- | --- |\n${gates.join('\n')}\n`;
}

function fixture({ change, extra = {}, projectState = '# State\n\nS01…S05 tamamlandı; S06…S08 açıktır.\n' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ci-docs-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const files = {
    'TASKS.md': taskMarkdown(change),
    'PROJECT_STATE.md': projectState,
    'plan.md': '# Plan\n\n' + [...states.keys(), ...[...phaseCounts].flatMap(([phase, count]) => Array.from({ length: count }, (_, index) => `F${String(phase).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`))].map((id) => `## ${id}\n`).join('\n'),
    ...extra,
  };
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

test('validates the repository documentation', () => {
  assert.deepEqual(validate(repositoryRoot), []);
});

test('CLI writes its successful completion receipt for GitHub Actions', () => {
  const root = fixture();
  const output = path.join(root, 'github-output');
  execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts/ci-docs.mjs')], {
    cwd: root,
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  assert.equal(readFileSync(output, 'utf8'), 'complete=true\n');
});

test('reports broken and repository-escaping local links while ignoring fenced examples', () => {
  const root = fixture({ extra: {
    'links.md': '[encoded](space%20file.md)\n[missing](nope.ts)\n[escape](../outside.md)\n```md\n[example](absent.md)\n```\n',
    'space file.md': '# Tracked\n',
  } });
  const errors = validate(root);
  assert.ok(errors.some((error) => error.includes('missing local link target nope.ts')));
  assert.ok(errors.some((error) => error.includes('link escapes repository: ../outside.md')));
  assert.ok(!errors.some((error) => error.includes('space%20file.md')));
  assert.ok(!errors.some((error) => error.includes('absent.md')));
});

test('reports an existing link target that is not tracked', () => {
  const root = fixture({ extra: { 'links.md': '[draft](draft.md)\n' } });
  writeFileSync(path.join(root, 'draft.md'), '# Draft\n');
  assert.ok(validate(root).includes('links.md: local link target is not tracked: draft.md'));
});

test('checks reference-style links and rejects a tracked symlink target', () => {
  const root = fixture({ extra: { 'links.md': 'See [outside][artifact].\n\n[artifact]: linked.md\n' } });
  const outside = path.join(root, '..', `${path.basename(root)}-outside.md`);
  writeFileSync(outside, '# Outside\n');
  symlinkSync(outside, path.join(root, 'linked.md'));
  execFileSync('git', ['add', 'linked.md'], { cwd: root });
  assert.ok(validate(root).includes('links.md: local link traverses symlink linked.md: linked.md'));
});

test('rejects a tracked Markdown source symlink without reading its contents', () => {
  const root = fixture();
  const outside = path.join(root, '..', `${path.basename(root)}-source.md`);
  writeFileSync(outside, '[must not parse](missing-from-repository.md)\n');
  mkdirSync(path.join(root, 'docs'));
  symlinkSync(outside, path.join(root, 'docs', 'new.md'));
  execFileSync('git', ['add', 'docs/new.md'], { cwd: root });
  const errors = validate(root);
  assert.ok(errors.includes('docs/new.md: tracked Markdown source traverses symlink docs/new.md'));
  assert.ok(!errors.some((error) => error.includes('missing-from-repository.md')));
});

test('reports a missing task node', () => {
  const errors = validate(fixture({ change: (tasks) => tasks.splice(tasks.findIndex(({ id }) => id === 'F12-03'), 1) }));
  assert.ok(errors.includes('TASKS.md: missing task F12-03'));
});

test('reports dependency cycles', () => {
  const errors = validate(fixture({ change: (tasks) => { tasks.find(({ id }) => id === 'S01').dep = 'S02'; } }));
  assert.ok(errors.some((error) => error.includes('dependency cycle S01 -> S02 -> S01')));
});

test('reports an invalid task state', () => {
  const errors = validate(fixture({ change: (tasks) => { tasks.find(({ id }) => id === 'S06').state = 'Bitti'; } }));
  assert.ok(errors.includes('TASKS.md: invalid state for S06: Bitti'));
});

test('rejects a prematurely closed GS gate', () => {
  const root = fixture();
  const tasksPath = path.join(root, 'TASKS.md');
  writeFileSync(tasksPath, readFileSync(tasksPath, 'utf8').replace('| GS | S01…S08 | Açık |', '| GS | S01…S08 | Kapalı |'));
  const errors = validate(root);
  assert.ok(errors.some((error) => error.includes('closed gate GS has incomplete member S06')));
});

test('accepts all stabilization tasks completed with GS closed', () => {
  const root = fixture({
    change: (tasks) => {
      for (const task of tasks.filter(({ id }) => id.startsWith('S'))) task.state = 'Tamamlandı';
    },
    projectState: '# State\n\nS01…S08 tamamlandı; GS kapalıdır.\n',
  });
  const tasksPath = path.join(root, 'TASKS.md');
  writeFileSync(tasksPath, readFileSync(tasksPath, 'utf8').replace('| GS | S01…S08 | Açık |', '| GS | S01…S08 | Kapalı |'));
  assert.deepEqual(validate(root), []);
});

test('does not require a fixed PROJECT_STATE summary sentence', () => {
  const root = fixture({ projectState: '# State\n\nGüncel görev durumu TASKS belgesindedir.\n' });
  assert.deepEqual(validate(root), []);
});

for (const state of ['Çalışılıyor', 'İncelemede', "Main'de / kabul açık", 'Tamamlandı']) {
  test(`rejects ${state} tasks with open gates or incomplete task prerequisites`, () => {
    const errors = validate(fixture({ change: (tasks) => {
      Object.assign(tasks.find(({ id }) => id === 'F10-02'), { state, dep: 'F10-01, GS' });
    } }));
    assert.ok(errors.some((error) => error.includes('F10-02') && error.includes('incomplete dependency F10-01')));
    assert.ok(errors.some((error) => error.includes('F10-02') && error.includes('open gate GS')));
  });
}

for (const state of ['Planlandı', 'Üstlenildi', 'Engelli']) {
  test(`allows ${state} tasks to wait for prerequisites`, () => {
    assert.deepEqual(validate(fixture({ change: (tasks) => {
      Object.assign(tasks.find(({ id }) => id === 'F10-02'), { state, dep: 'F10-01, GS' });
    } })), []);
  });
}

test('allows work with accepted prerequisites and TEMEL design work while GS stays open', () => {
  assert.deepEqual(validate(fixture({ change: (tasks) => {
    Object.assign(tasks.find(({ id }) => id === 'F10-01'), { state: 'Çalışılıyor', dep: 'F09-05, G09' });
    tasks.find(({ id }) => id === 'F12-01').state = 'Çalışılıyor';
  } })), []);
});
