import assert from 'node:assert/strict';
import test from 'node:test';

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
