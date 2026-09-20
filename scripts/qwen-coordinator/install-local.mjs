import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key === 'replace-config') {
      result.replaceConfig = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function requiredDirectory(value, flag) {
  if (!value) throw new Error(`${flag} is required`);
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`${flag} does not exist: ${resolved}`);
  return resolved;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function atomicWrite(file, content, mode = 0o600) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, file);
}

function commandScript(content) {
  return `#!/bin/zsh\nset -euo pipefail\n${content}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const userHome = path.resolve(args.home ?? homedir());
  const repoRoot = requiredDirectory(args['repo-root'], '--repo-root');
  const nodeBinary = path.resolve(args.node ?? process.execPath);
  const coordinatorHome = path.resolve(
    args['coordinator-home'] ?? path.join(userHome, '.local', 'share', 'qwen-coordinator'),
  );
  const binRoot = path.resolve(args['bin-dir'] ?? path.join(userHome, '.local', 'bin'));
  const launchAgentsRoot = path.resolve(
    args['launch-agents-dir'] ?? path.join(userHome, 'Library', 'LaunchAgents'),
  );
  const depotBinary = path.resolve(args.depot ?? path.join(binRoot, 'depot'));
  const depotOrgId = args['depot-org'] ?? '';

  for (const directory of [coordinatorHome, binRoot, launchAgentsRoot]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const directory of ['logs', 'reports', 'state']) {
    mkdirSync(path.join(coordinatorHome, directory), { recursive: true });
  }

  for (const file of ['policy.mjs', 'depot.mjs', 'run-once.mjs', 'depot-full-ci.yml']) {
    copyFileSync(path.join(sourceRoot, file), path.join(coordinatorHome, file));
  }

  const configFile = path.join(coordinatorHome, 'config.json');
  if (!existsSync(configFile) || args.replaceConfig === true) {
    if (existsSync(configFile)) {
      copyFileSync(configFile, `${configFile}.backup-${Date.now()}`);
    }
    const source = readFileSync(path.join(sourceRoot, 'config.example.json'), 'utf8')
      .replaceAll('__REPO_ROOT__', repoRoot)
      .replaceAll('__COORDINATOR_HOME__', coordinatorHome)
      .replaceAll('__DEPOT_BINARY__', depotBinary)
      .replaceAll('__DEPOT_ORG_ID__', depotOrgId);
    JSON.parse(source);
    atomicWrite(configFile, source);
  }

  const reportFile = path.join(coordinatorHome, 'reports', 'latest.md');
  const queueFile = path.join(coordinatorHome, 'reports', 'action-queue.json');
  const wrappers = {
    'qwen-coordinator-now': commandScript(`exec ${JSON.stringify(nodeBinary)} ${JSON.stringify(path.join(coordinatorHome, 'run-once.mjs'))}`),
    'qwen-coordinator-status': commandScript(`[ -f ${JSON.stringify(reportFile)} ] || { echo "Henüz koordinatör raporu yok."; exit 1; }\nexec /bin/cat ${JSON.stringify(reportFile)}`),
    'qwen-coordinator-actions': commandScript(`[ -f ${JSON.stringify(queueFile)} ] || { echo "Henüz aksiyon kuyruğu yok."; exit 1; }\nexec /bin/cat ${JSON.stringify(queueFile)}`),
  };
  for (const [name, source] of Object.entries(wrappers)) {
    const target = path.join(binRoot, name);
    atomicWrite(target, source, 0o755);
    chmodSync(target, 0o755);
  }

  const executablePath = [
    path.dirname(nodeBinary),
    binRoot,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.yzt.qwen-coordinator</string>
  <key>ProgramArguments</key>
  <array><string>${xmlEscape(nodeBinary)}</string><string>${xmlEscape(path.join(coordinatorHome, 'run-once.mjs'))}</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xmlEscape(userHome)}</string>
    <key>PATH</key><string>${xmlEscape(executablePath)}</string>
    <key>QWEN_COORDINATOR_HOME</key><string>${xmlEscape(coordinatorHome)}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xmlEscape(repoRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>15</integer>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(coordinatorHome, 'logs', 'coordinator.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(coordinatorHome, 'logs', 'coordinator.err.log'))}</string>
</dict>
</plist>
`;
  const plistFile = path.join(launchAgentsRoot, 'ai.yzt.qwen-coordinator.plist');
  atomicWrite(plistFile, plist, 0o644);

  process.stdout.write([
    `Installed coordinator sources: ${coordinatorHome}`,
    existsSync(configFile) ? `Config preserved/created: ${configFile}` : '',
    `LaunchAgent generated: ${plistFile}`,
    '',
    'The generated config is shadow/read-only by default.',
    'Validate config and run qwen-coordinator-now before loading the LaunchAgent.',
  ].filter(Boolean).join('\n') + '\n');
}

main();
