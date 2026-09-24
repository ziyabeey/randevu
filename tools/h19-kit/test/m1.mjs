import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { extractTypeScriptUnits } from '../src/extractors/typescript-units.mjs';
import { extractPythonUnits } from '../src/extractors/python-units.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';
import { TestImpactStore } from '../src/adapters/test-impact-store.mjs';
import { istanbulLines, coveragePyLines, applyTestCoverage } from '../src/adapters/coverage-impact.mjs';
import { temporalCoupling } from '../src/adapters/git-history.mjs';
import { gitHotspots, missingCompanions } from '../src/adapters/git-hotspots.mjs';
import { historySnapshot } from '../src/adapters/history-cache.mjs';
import { FileCache } from '../src/core/cache.mjs';

const tsUnits = extractTypeScriptUnits(`
export function outer(x: number) {
  const inner = (y: number) => y + x;
  return inner(x);
}
class Demo {
  run() { return 1; }
}
`, { path: 'demo.ts' });
assert.equal(tsUnits.some((x) => x.symbol === 'outer'), true);
assert.equal(tsUnits.some((x) => x.symbol.includes('inner')), true);
assert.equal(tsUnits.some((x) => x.symbol === 'Demo.run'), true);

const pyUnits = await extractPythonUnits(`
def outer(x):
    def inner(y):
        return x + y
    return inner(x)

class Demo:
    def run(self):
        return 1
`, { path: 'demo.py' });
assert.equal(pyUnits.some((x) => x.symbol === 'outer'), true);
assert.equal(pyUnits.some((x) => x.symbol === 'outer.inner'), true);
assert.equal(pyUnits.some((x) => x.symbol === 'Demo.run'), true);

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-kit-m1-'));
try {
  const repoRoot = path.join(temp, 'repo');
  await mkdir(repoRoot, { recursive: true });
  await writeFile(path.join(repoRoot, 'demo.ts'), 'export function run(){ return 1 }\n');
  await writeFile(path.join(repoRoot, 'demo.py'), 'def run():\n    return 1\n');
  await writeFile(path.join(repoRoot, 'demo.sql'), `
create or replace function public.demo()
returns void language plpgsql as $x$
begin
  perform 1;
end
$x$;
`);

  const inventory = await repositoryInventory(repoRoot);
  assert.equal(inventory.filesScanned, 3);
  assert.equal(inventory.errors.length, 0);
  assert.equal(inventory.units.some((x) => x.language === 'typescript'), true);
  assert.equal(inventory.units.some((x) => x.language === 'python'), true);
  assert.equal(inventory.units.some((x) => x.language === 'sql'), true);

  const impactFile = path.join(temp, 'impact.json');
  const impact = await new TestImpactStore(impactFile).load();
  const unit = {
    id: 'demo.ts::run@1',
    path: 'demo.ts',
    startLine: 1,
    endLine: 1,
    digest: 'c'.repeat(64),
  };
  const istanbul = istanbulLines({
    'demo.ts': {
      statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
      s: { '0': 1 },
    },
  });
  assert.deepEqual(applyTestCoverage(impact, {
    testId: 'unit-test',
    units: [unit],
    coverageByFile: istanbul,
    provider: 'istanbul',
  }), ['demo.ts::run@1']);

  const pyCoverage = coveragePyLines({ files: { 'demo.py': { executed_lines: [1] } } });
  assert.equal(pyCoverage.get('demo.py').has(1), true);
  await impact.save();
  const reloaded = await new TestImpactStore(impactFile).load();
  assert.deepEqual(reloaded.impacted(['c'.repeat(64)]).impactedTests, ['unit-test']);

  const gitRoot = path.join(temp, 'git');
  await mkdir(gitRoot, { recursive: true });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: gitRoot, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  };
  git('init');
  git('config', 'user.name', 'H19 Test');
  git('config', 'user.email', 'h19@example.invalid');
  await writeFile(path.join(gitRoot, 'a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(gitRoot, 'b.ts'), 'export const b = 1;\n');
  git('add', '.'); git('commit', '-m', 'initial');
  await writeFile(path.join(gitRoot, 'a.ts'), 'export const a = 2;\n');
  await writeFile(path.join(gitRoot, 'b.ts'), 'export const b = 2;\n');
  git('add', '.'); git('commit', '-m', 'coupled change');
  await writeFile(path.join(gitRoot, 'a.ts'), 'export const a = 3;\n');
  await writeFile(path.join(gitRoot, 'b.ts'), 'export const b = 3;\n');
  git('add', '.'); git('commit', '-m', 'coupled again');

  const couplings = await temporalCoupling({ cwd: gitRoot, since: '10 years ago', minShared: 2 });
  assert.equal(couplings.some((x) => x.a === 'a.ts' && x.b === 'b.ts' && x.shared >= 2), true);
  const missing = missingCompanions(couplings, ['a.ts'], { minConfidence: 0.5, minShared: 2 });
  assert.equal(missing.some((x) => x.missing === 'b.ts'), true);

  const hotspots = await gitHotspots({ cwd: gitRoot, since: '10 years ago' });
  assert.equal(hotspots[0].commits >= 3, true);

  const cache = new FileCache(path.join(temp, 'history-cache'));
  const first = await historySnapshot({ cwd: gitRoot, since: '10 years ago', cache });
  const second = await historySnapshot({ cwd: gitRoot, since: '10 years ago', cache });
  assert.equal(first.cache, 'miss');
  assert.equal(second.cache, 'hit');
  assert.equal(JSON.parse(await readFile(path.join(temp, 'impact.json'), 'utf8')).version, 1);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M1 smoke: ok');
