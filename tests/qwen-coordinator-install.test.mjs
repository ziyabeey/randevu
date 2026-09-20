import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const installer = path.resolve('scripts/qwen-coordinator/install-local.mjs');

test('installer creates a portable shadow-default layout and preserves config', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-install-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const userHome = path.join(root, 'home');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(userHome, { recursive: true });

  const args = [
    installer,
    '--repo-root', repoRoot,
    '--home', userHome,
    '--node', process.execPath,
    '--depot', path.join(userHome, '.local', 'bin', 'depot'),
    '--depot-org', 'example-org',
  ];
  const firstRun = await execFileAsync(process.execPath, args);
  assert.match(firstRun.stdout, /Config created:/);
  assert.match(firstRun.stdout, /shadow\/read-only by default/);

  const coordinatorHome = path.join(userHome, '.local', 'share', 'qwen-coordinator');
  const configFile = path.join(coordinatorHome, 'config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(config.mode, 'shadow');
  assert.equal(config.writeActionsEnabled, false);
  assert.equal(config.autoMergeEnabled, false);
  assert.equal(config.depotShadowEnabled, false);
  assert.equal(config.repoRoot, repoRoot);
  assert.equal(config.depotOrgId, 'example-org');

  const plist = await readFile(
    path.join(userHome, 'Library', 'LaunchAgents', 'ai.yzt.qwen-coordinator.plist'),
    'utf8',
  );
  assert.match(plist, /QWEN_COORDINATOR_HOME/);
  assert.match(plist, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plist, new RegExp(userHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  config.projectName = 'preserve-me';
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const secondRun = await execFileAsync(process.execPath, args);
  assert.match(secondRun.stdout, /Config preserved:/);
  assert.doesNotMatch(secondRun.stdout, /shadow\/read-only by default/);
  const preserved = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(preserved.projectName, 'preserve-me');
});

test('generated wrapper paths are shell-quoted literally', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-shell-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const userHome = path.join(root, 'home');
  const coordinatorHome = path.join(root, 'coord "quoted" \\backslash $(touch injected) $HOME `touch injected-too`');
  const binRoot = path.join(root, 'bin');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(userHome, { recursive: true });

  await execFileAsync(process.execPath, [
    installer,
    '--repo-root', repoRoot,
    '--home', userHome,
    '--coordinator-home', coordinatorHome,
    '--bin-dir', binRoot,
    '--node', process.execPath,
  ]);
  const report = '# literal path works\n';
  const config = JSON.parse(await readFile(path.join(coordinatorHome, 'config.json'), 'utf8'));
  assert.equal(config.repoRoot, repoRoot);
  assert.equal(config.depotWorkflowFile, path.join(coordinatorHome, 'depot-full-ci.yml'));
  const nowWrapper = await readFile(path.join(binRoot, 'qwen-coordinator-now'), 'utf8');
  assert.match(nowWrapper, /export QWEN_COORDINATOR_HOME=/);
  assert.ok(nowWrapper.includes(`'${coordinatorHome.replaceAll("'", `'"'"'`)}'`));
  await writeFile(path.join(coordinatorHome, 'reports', 'latest.md'), report);
  const wrapper = path.join(binRoot, 'qwen-coordinator-status');
  const result = await execFileAsync('/bin/sh', [wrapper], { cwd: root });
  assert.equal(result.stdout, report);
  if (process.platform === 'darwin') {
    const nativeResult = await execFileAsync(wrapper, [], { cwd: root });
    assert.equal(nativeResult.stdout, report);
  }
  await assert.rejects(readFile(path.join(root, 'injected')), /ENOENT/);
  await assert.rejects(readFile(path.join(root, 'injected-too')), /ENOENT/);
});
