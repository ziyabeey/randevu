import assert from 'node:assert/strict';
import test from 'node:test';
import { controlSql } from '../scripts/staging-control-db.mjs';
const uri = 'postgresql://fixture:private-password@127.0.0.1:5432/fixture';
const statement = "select 'private-verifier'";

test('S05 SQL failures expose only fixed diagnostics without URI, SQL, password or verifier', () => {
  const cases = [
    { status: 3, stderr: `ERROR: 42P01\nDETAIL: private-verifier ${uri} ${statement}`, expected: 'SQLSTATE 42P01' },
    { status: 2, stderr: `connection failed ${uri}`, expected: 'psql exit 2' },
    { status: null, error: { code: 'ETIMEDOUT', message: `${uri} ${statement}` }, expected: 'psql timed out' },
    { status: null, error: { code: 'ENOENT', message: `${uri} ${statement}` }, expected: 'psql unavailable' },
  ];
  for (const result of cases) {
    let failure;
    try { controlSql(uri, statement, {}, () => result); } catch (error) { failure = error; }
    assert.ok(failure.message.includes(result.expected));
    for (const secret of [uri, statement, 'private-password', 'private-verifier']) {
      assert.equal(String(failure.stack).includes(secret), false);
    }
    assert.equal(failure.cause, undefined);
  }
});

test('S05 missing database configuration cannot fall back to a local default connection', () => {
  let spawned = false;
  assert.throws(() => controlSql('', statement, {}, () => { spawned = true; }), /Missing STAGING_DATABASE_URL/);
  assert.equal(spawned, false);
});
