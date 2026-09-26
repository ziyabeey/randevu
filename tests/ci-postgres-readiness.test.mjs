import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const marker = '      - name: Verify disposable PostgreSQL 17 readiness\n';
const section = workflow.split(marker)[1]?.split('      - name: ')[0];
assert.ok(section, 'test must execute the actual readiness workflow step');
const run = section.split('        run: |\n')[1];
assert.ok(run, 'readiness step must contain an executable Bash block');
const script = run.split('\n').map((line) => {
  assert.ok(!line || line.startsWith('          '), 'unexpected workflow block indentation');
  return line.slice(10);
}).join('\n');

// Replace only external commands, never copy the readiness implementation.
// The fixtures invoke no database, Docker daemon, network or real sleep.
const fakeCommand = `#!/bin/bash
set -eu
name="\${0##*/}"
count_file="\${RUNNER_TEMP}/\${name}.count"
n=0
if [ -f "\${count_file}" ]; then n="$(<"\${count_file}")"; fi
n=$((n + 1))
printf '%s' "$n" > "\${count_file}"
printf '%s|%s|%s|%s\\n' "$name" "$n" "\${PGCONNECT_TIMEOUT-unset}" "$*" >> "\${RUNNER_TEMP}/calls"
case "$name" in
  docker)
    if [ "$1" != inspect ]; then exit 99; fi
    if [ "$n" -gt "\${FAKE_HEALTH_AFTER:-0}" ]; then printf 'healthy\\n'; else printf 'starting\\n'; fi
    exit "\${FAKE_INSPECT_EXIT:-0}"
    ;;
  psql)
    if [ "$n" -le "\${FAKE_PSQL_FAILURES:-0}" ]; then
      printf '%s' "\${FAKE_FAILURE_STDOUT:-}"
      printf 'synthetic startup connection failure\\n' >&2
      exit "\${FAKE_PSQL_EXIT:-2}"
    fi
    printf '%s\\n' "\${FAKE_PG_VERSION-170006}"
    ;;
  sleep) exit "\${FAKE_SLEEP_EXIT:-0}" ;;
  pg_isready) exit 0 ;;
  *) exit 99 ;;
esac
`;

function execute(t, config = {}, body = script) {
  const root = mkdtempSync(path.join(tmpdir(), 'randevu-pg-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  for (const command of ['docker', 'psql', 'sleep', 'pg_isready']) {
    writeFileSync(path.join(bin, command), fakeCommand, { mode: 0o755 });
  }
  writeFileSync(path.join(root, 'postgres-launch.log'), 'synthetic launch log\n');
  writeFileSync(path.join(root, 'calls'), '');
  // Allowlist environment input so credentials/provider configuration cannot enter this process.
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    RUNNER_TEMP: root,
    PGPASSWORD: 'synthetic-local-fixture',
    ...Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value)])),
  };
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', body], {
    env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'a harness timeout is not accepted as a negative-test PASS');
  const calls = readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(calls.length > 0, 'scenario must reach the actual external-command boundary');
  return { ...result, calls, count: (command) => calls.filter((line) => line.startsWith(`${command}|`)).length };
}

for (const failures of [0, 1, 3, 29]) {
  test(`F17-02 readiness succeeds after ${failures} transient host failures`, (t) => {
    const r = execute(t, { FAKE_PSQL_FAILURES: failures });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.count('psql'), failures + 1);
    assert.equal(r.count('sleep'), failures);
  });
}

test('F17-02 waits for container health before probing the host', (t) => {
  const r = execute(t, { FAKE_HEALTH_AFTER: 2 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.count('docker'), 3);
  assert.equal(r.count('psql'), 1);
  assert.equal(r.count('sleep'), 2);
});

test('F17-02 permanent host failure exhausts the finite loop and stays red', (t) => {
  const r = execute(t, { FAKE_PSQL_FAILURES: 99 });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.count('psql'), 30);
  assert.doesNotMatch(r.stdout, /CI_POSTGRES_READY/);
});

test('F17-02 an unhealthy container cannot pass without a host check', (t) => {
  const r = execute(t, { FAKE_HEALTH_AFTER: 99 });
  assert.equal(r.status, 1);
  assert.equal(r.count('docker'), 30);
  assert.equal(r.count('psql'), 0);
});

test('F17-02 failed docker inspect cannot masquerade as healthy through stdout', (t) => {
  const r = execute(t, { FAKE_INSPECT_EXIT: 1 });
  assert.equal(r.status, 1);
  assert.equal(r.count('psql'), 0);
  assert.doesNotMatch(r.stdout, /CI_POSTGRES_READY/);
});

for (const version of ['160006', '180000', '17', '17invalid', '170006\nextra', '']) {
  test(`F17-02 wrong or malformed version ${JSON.stringify(version)} fails immediately`, (t) => {
    const r = execute(t, { FAKE_PG_VERSION: version });
    assert.equal(r.status, 1);
    assert.equal(r.count('psql'), 1);
    assert.equal(r.count('sleep'), 0, 'wrong version is not a transient connection error');
    assert.doesNotMatch(r.stdout, /CI_POSTGRES_READY/);
  });
}

test('F17-02 successful-looking stdout on a failed psql is not acceptance', (t) => {
  const r = execute(t, { FAKE_PSQL_FAILURES: 2, FAKE_FAILURE_STDOUT: '170006' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.count('psql'), 3);
});

test('F17-02 missing psql stays red after the finite attempt budget', (t) => {
  const r = execute(t, { FAKE_PSQL_FAILURES: 99, FAKE_PSQL_EXIT: 127 });
  assert.equal(r.status, 1);
  assert.equal(r.count('psql'), 30);
});

test('F17-02 unexpected sleep failure is not swallowed', (t) => {
  const r = execute(t, { FAKE_HEALTH_AFTER: 99, FAKE_SLEEP_EXIT: 7 });
  assert.equal(r.status, 7);
  assert.equal(r.count('docker'), 1);
  assert.equal(r.count('psql'), 0);
});

test('F17-02 host probe is bounded, noninteractive and pinned to the local TCP endpoint', (t) => {
  const r = execute(t);
  assert.equal(r.status, 0);
  const probe = r.calls.find((line) => line.startsWith('psql|'));
  assert.match(probe, /^psql\|1\|2\|/);
  for (const argument of ['--no-psqlrc', '--no-password', '-h 127.0.0.1', '-p 5432', '-d yzt_test', '-v ON_ERROR_STOP=1']) {
    assert.ok(probe.includes(argument), `missing probe argument ${argument}`);
  }
  assert.match(section, /timeout-minutes: 1\n/);
  assert.match(section, /if: \$\{\{ steps\.scope\.outputs\.mode == 'code' \}\}/);
});

test('F17-02 Docker health uses TCP rather than the initialization-only Unix socket', (t) => {
  const health = workflow.match(/--health-cmd='([^']+)'/);
  assert.ok(health, 'Docker health command must exist');
  const r = execute(t, {}, health[1]);
  assert.equal(r.status, 0);
  assert.equal(r.count('pg_isready'), 1);
  assert.match(r.calls[0], /-h 127\.0\.0\.1 -p 5432 -U postgres -d yzt_test/);
});
