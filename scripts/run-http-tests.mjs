import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverFiles } from './ci-files.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');

export async function discoverHttpTests(root = repoRoot) {
  return discoverFiles(root, 'tests', '.test.mjs');
}

export async function runHttpTests(options = {}) {
  const root = path.resolve(options.root ?? repoRoot);
  const spawn = options.spawn ?? spawnSync;
  const executable = options.executable ?? process.execPath;
  const files = await discoverHttpTests(root);
  if (files.length === 0) throw new Error('No HTTP test files were discovered');

  const result = spawn(executable, ['--test', '--experimental-strip-types', ...files], {
    cwd: root,
    shell: false,
    stdio: 'inherit',
  });
  if (result?.error) {
    const error = new Error('Node HTTP test process could not start');
    error.exitCode = 1;
    throw error;
  }
  if (result?.status !== 0) {
    const error = new Error(`Node HTTP tests failed with exit ${result?.status ?? 1}`);
    error.exitCode = Number.isInteger(result?.status) && result.status > 0 ? result.status : 1;
    throw error;
  }
  return files;
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === modulePath;
}

if (isMain()) {
  try {
    const files = await runHttpTests();
    console.log(`HTTP tests passed (${files.length} files).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error?.exitCode ?? 1;
  }
}
