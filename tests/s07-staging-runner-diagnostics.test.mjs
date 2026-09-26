import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundedS07DiagnosticTail,
  classifyS07PsqlResult,
  describeS07PsqlFailure,
  redactS07Diagnostic,
} from '../scripts/staging-s07-diagnostics.mjs';

test('F17-03A2 classifies S07 runner failures into distinct operational classes', () => {
  assert.equal(classifyS07PsqlResult({
    error: Object.assign(new Error('spawnSync psql ENOBUFS'), { code: 'ENOBUFS' }),
  }), 'ENOBUFS');

  assert.equal(classifyS07PsqlResult({
    error: Object.assign(new Error('spawnSync psql ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  }), 'timeout');

  assert.equal(classifyS07PsqlResult({
    error: Object.assign(new Error('spawn psql EACCES'), { code: 'EACCES' }),
  }), 'spawn_error');

  assert.equal(classifyS07PsqlResult({
    status: 2,
    stdout: '',
    stderr: 'psql: error: connection to server at "db.example" failed',
  }), 'psql_exit');

  assert.equal(classifyS07PsqlResult({
    status: 3,
    stdout: '',
    stderr: 'psql:s07.sql:204: ERROR: S07 C1 first maintenance batch expected 500 purges, got 499',
  }), 'sql_assertion');

  assert.equal(classifyS07PsqlResult({
    status: 3,
    stdout: '',
    stderr: 'psql:s07.sql:146: ERROR: C2b authenticated service boundary 100 was incomplete',
  }), 'sql_assertion');

  assert.equal(classifyS07PsqlResult({ status: 0, stdout: 'ok', stderr: '' }), null);
});

test('F17-03A2 diagnostic tail is bounded and redacts database credentials and tokens', () => {
  const databaseUrl = 'postgresql://postgres.ref:super-secret-password@db.example.com:5432/postgres?sslmode=require';
  const adminKey = 'sb_secret_THIS_MUST_NOT_LEAK';
  const bearer = 'Bearer abc.def-123/XYZ';

  const raw = [
    'first line should fall out of bounded tail',
    `database=${databaseUrl}`,
    'password=super-secret-password',
    `admin=${adminKey}`,
    `authorization=${bearer}`,
    'psql:s07.sql:188: ERROR: S07 C3 booking sample 3 exceeded measurement budget: 999 ms',
  ].join('\n');

  const redacted = redactS07Diagnostic(raw, [databaseUrl, adminKey, 'super-secret-password']);
  assert.doesNotMatch(redacted, /super-secret-password/);
  assert.doesNotMatch(redacted, /THIS_MUST_NOT_LEAK/);
  assert.doesNotMatch(redacted, /abc\.def-123\/XYZ/);
  assert.doesNotMatch(redacted, /postgresql:\/\//);
  assert.match(redacted, /\[REDACTED\]/);
  assert.match(redacted, /Bearer \[REDACTED\]/);

  const tail = boundedS07DiagnosticTail({
    stdout: '',
    stderr: raw,
  }, {
    secrets: [databaseUrl, adminKey, 'super-secret-password'],
    maxLines: 3,
    maxChars: 300,
  });

  assert.equal(tail.split('\n').length <= 3, true);
  assert.equal(tail.length <= 300, true);
  assert.doesNotMatch(tail, /first line should fall out/);
  assert.doesNotMatch(tail, /super-secret-password|THIS_MUST_NOT_LEAK|abc\.def-123\/XYZ/);
  assert.match(tail, /S07 C3 booking sample/);
});

test('F17-03A2 failure message carries class plus only the redacted bounded tail', () => {
  const message = describeS07PsqlFailure('s07_load_measurement.sql', {
    status: 3,
    stdout: '',
    stderr: [
      'postgresql://postgres:pw@db.example.com/postgres',
      'psql:s07.sql:188: ERROR: S07 C3 booking sample 3 exceeded measurement budget: 999 ms',
    ].join('\n'),
  }, {
    secrets: ['pw'],
    maxLines: 4,
    maxChars: 500,
  });

  assert.match(message, /class=sql_assertion/);
  assert.match(message, /S07_DIAGNOSTIC_TAIL_BEGIN/);
  assert.match(message, /S07_DIAGNOSTIC_TAIL_END/);
  assert.match(message, /S07 C3 booking sample/);
  assert.doesNotMatch(message, /postgresql:\/\/|postgres:pw/);
});

// All credential samples are synthetic; no provider calls or real secrets.
for (const [label, raw, hidden] of [
  ['libpq quoted value', "password='synthetic alpha omega' host=db.example", ['synthetic', 'alpha', 'omega']],
  ['JSON credential', '{"token": "synthetic JSON omega", "code": "E42"}', ['synthetic', 'JSON', 'omega']],
  ['escaped quoted value', String.raw`password='synthetic \'quoted\' omega' host=db.example`, ['synthetic', 'quoted', 'omega']],
  ['prefixed environment key', 'SUPABASE_DB_PASSWORD="synthetic env omega"', ['synthetic', 'env', 'omega']],
  ['multiline quoted value', 'password="synthetic\nsecond-line-omega"\nERROR: useful diagnostic', ['synthetic', 'second-line-omega']],
  ['unterminated quoted value', "password='synthetic truncated omega", ['synthetic', 'truncated', 'omega']],
]) {
  test(`F17-03A2 masks the whole ${label}`, () => {
    const redacted = redactS07Diagnostic(raw);
    for (const secret of hidden) assert.equal(redacted.includes(secret), false);
    assert.match(redacted, /\[REDACTED\]/);
    if (raw.includes('host=db.example')) assert.match(redacted, /host=db\.example/);
    if (raw.includes('useful diagnostic')) assert.match(redacted, /useful diagnostic/);
    if (raw.includes('E42')) assert.match(redacted, /E42/);
  });
}

test('F17-03A2 masks overlapping configured secrets without leaking a suffix', () => {
  assert.equal(redactS07Diagnostic('credential=sample-SUFFIX', ['sample', 'sample-SUFFIX']),
    'credential=[REDACTED]');
  assert.equal(redactS07Diagnostic('credential=a+b.[test]', ['a+b.[test]']),
    'credential=[REDACTED]');
});

test('F17-03A2 redacts complete credentials before taking a short tail', () => {
  const tail = boundedS07DiagnosticTail({
    stderr: `password='${'synthetic '.repeat(400)}LAST_PRIVATE_WORD'`,
  }, { maxChars: 30 });
  assert.equal(tail.includes('LAST_PRIVATE_WORD'), false);
  assert.equal(tail.includes('synthetic'), false);
  assert.ok(tail.length <= 30);
});

test('F17-03A2 does not confuse earlier S07 progress with a later SQL failure', () => {
  for (const output of [
    { stdout: 'S07 C1 completed', stderr: 'ERROR: connection lost' },
    { stderr: 'NOTICE: S07 C3 sampling\nERROR: permission denied for relation appointments' },
    { stderr: 'ERROR: permission denied\nCONTEXT: S07 C2a validation' },
  ]) {
    assert.equal(classifyS07PsqlResult({ status: 3, ...output }), 'psql_exit');
  }
  assert.equal(classifyS07PsqlResult({
    status: 3,
    stderr: 'psql:s07.sql:20: ERROR: P0001: S07 C2a invariant failed',
  }), 'sql_assertion');
});

for (const value of [1, 0, -1, NaN, Infinity, 100000]) {
  test(`F17-03A2 keeps diagnostic bounds for limit ${String(value)}`, () => {
    const tail = boundedS07DiagnosticTail({
      stderr: Array.from({ length: 30 }, (_, i) => `${i}:${'x'.repeat(300)}`).join('\n'),
    }, { maxChars: value, maxLines: value });
    assert.ok(tail.length <= 2400, 'hard character ceiling');
    assert.ok(tail.split('\n').length <= 12, 'hard line ceiling');
    if (Number.isFinite(value) && value <= 1) assert.ok(tail.length <= 1);
  });
}

function runOfflineAcceptance(result) {
  const cwd = mkdtempSync(path.join(tmpdir(), 's07-diagnostic-test-'));
  try {
    mkdirSync(path.join(cwd, 'supabase/tests'), { recursive: true });
    // The failing first call stops before the other SQL files; no SQL executes.
    writeFileSync(path.join(cwd, 'supabase/tests/s07_terminal_pii_retention.sql'), '');
    const preload = path.join(cwd, 'fake-psql.mjs');
    writeFileSync(preload, `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      childProcess.spawnSync = (name) => {
        if (name !== 'psql') throw new Error('Unexpected test subprocess');
        return ${JSON.stringify(result)};
      };
      syncBuiltinESMExports();
    `);
    const runner = fileURLToPath(new URL('../scripts/staging-s07-acceptance.mjs', import.meta.url));
    return spawnSync(process.execPath, ['--import', preload, runner], {
      cwd,
      env: { STAGING_DATABASE_URL: 'postgresql://postgres:fixture-only@db.invalid/test' },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 64 * 1024,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('F17-03A2 actual runner fails closed with a redacted, correctly classified simulated psql error', () => {
  const child = runOfflineAcceptance({
    status: 3,
    stdout: 'NOTICE: S07 C1 previous progress',
    stderr: 'ERROR: connection lost\n{"password": "synthetic-runner-omega"}',
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /class=psql_exit/);
  assert.match(child.stderr, /S07_DIAGNOSTIC_TAIL_BEGIN/);
  assert.doesNotMatch(child.stderr, /synthetic-runner-omega/);
  assert.doesNotMatch(child.stdout, /S07 staging acceptance passed/);
});

test('F17-03A2 actual runner preserves assertion identity without exposing a long quoted credential', () => {
  const child = runOfflineAcceptance({
    status: 3,
    stderr: `ERROR: S07 C1 retention invariant failed\npassword='${'synthetic '.repeat(400)}runner-private-omega'`,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /class=sql_assertion/);
  assert.match(child.stderr, /retention invariant failed/);
  assert.doesNotMatch(child.stderr, /runner-private-omega|synthetic/);
  const tail = child.stderr.match(/S07_DIAGNOSTIC_TAIL_BEGIN\n([\s\S]*?)\nS07_DIAGNOSTIC_TAIL_END/)?.[1];
  assert.ok(tail);
  assert.ok(tail.length <= 2400);
});
