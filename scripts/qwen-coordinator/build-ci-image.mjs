import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { depotCustomImageRef } from './depot.mjs';

const root = path.resolve(
  process.env.QWEN_COORDINATOR_HOME
    ?? path.join(homedir(), '.local', 'share', 'qwen-coordinator'),
);
const configFile = path.join(root, 'config.json');

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, file);
}

function run(binary, args, cwd) {
  const result = spawnSync(binary, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (!config.repoRoot || !config.repoSlug || !config.depotBinary || !config.depotOrgId) {
    throw new Error('Depot image build requires repoRoot, repoSlug, depotBinary and depotOrgId in config.json');
  }

  const image = depotCustomImageRef(config);
  const templateFile = path.resolve(
    config.depotBuildImageWorkflowFile ?? path.join(root, 'depot-build-ci-image.yml'),
  );
  const template = readFileSync(templateFile, 'utf8');
  if (!template.includes('__DEPOT_CI_IMAGE__')) {
    throw new Error('Depot build-image workflow is missing __DEPOT_CI_IMAGE__');
  }

  mkdirSync(path.join(root, 'state'), { recursive: true });
  const runtimeFile = path.join(root, 'state', 'depot-build-ci-image-runtime.yml');
  atomicWrite(runtimeFile, template.replaceAll('__DEPOT_CI_IMAGE__', image));

  const preflightStatus = run(config.depotBinary, [
    'ci', 'migrate', 'preflight',
    '--yes',
    '--org', config.depotOrgId,
  ], config.repoRoot);
  if (preflightStatus !== 0) {
    throw new Error(
      'Depot Code Access preflight failed. Reconnect/authorize the current GitHub repository using the URL printed by Depot, then rerun this command.',
    );
  }

  const buildStatus = run(config.depotBinary, [
    'ci', 'run',
    '--workflow', runtimeFile,
    '--job', 'build-image',
    '--repo', config.repoSlug,
    '--org', config.depotOrgId,
    '--follow',
  ], config.repoRoot);
  if (buildStatus !== 0) throw new Error('Depot custom CI image build failed');

  if (process.argv.includes('--enable')) {
    config.depotCustomImageEnabled = true;
    atomicWrite(configFile, `${JSON.stringify(config, null, 2)}\n`);
    process.stdout.write(`Depot custom image enabled: ${image}\n`);
  } else {
    process.stdout.write(`Depot custom image built: ${image}\n`);
    process.stdout.write('Set depotCustomImageEnabled=true after validating one shadow run.\n');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
