import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { controlSql } from './staging-control-db.mjs';

// CI-only fake credentials. Exercise the exact helper used by staging against
// a real PostgreSQL service, without depending on a preconfigured PGHOST/socket.
// Keep the fake URI below PostgreSQL's 63-byte database-name limit so the
// legacy failure reports the entire literal value instead of a truncation.
const uri = 'postgresql://postgres:postgres@127.0.0.1:5432/yzt_test';
const env = { PATH: process.env.PATH, LANG: 'C', PGCONNECT_TIMEOUT: '2' };
// Supply known TCP defaults only to the legacy arm. Its failure must be the
// literal URI database name, not an absent local socket or failed password.
const legacy = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: 'select current_database();', encoding: 'utf8', timeout: 5000,
  env: { ...env, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGDATABASE: uri },
});
assert.notEqual(legacy.status, 0, 'PGDATABASE-only URI must reproduce the missing explicit connection parameters');
assert.ok(!legacy.error, 'psql must actually run for the reproduction');
assert.ok(legacy.stderr.includes(`database "${uri}" does not exist`),
  'the real server must reject the unexpanded URI database name');

const connected = JSON.parse(controlSql(uri, `select json_build_object('database',current_database(), 'role',current_user,
  'statement_timeout',current_setting('statement_timeout'), 'lock_timeout',current_setting('lock_timeout'));`, env));
assert.deepEqual(connected, { database: 'yzt_test', role: 'postgres', statement_timeout: '15s', lock_timeout: '10s' });
const result = JSON.parse(controlSql(uri, `select json_build_object(
  'gate_present',exists(select 1 from public.public_booking_abuse_config where config_key='default'),
  'dispatch_present',exists(select 1 from public.notification_dispatch_config where config_key='default'),
  'pending',(select count(*) from public.staging_key_transition));`, env));
assert.deepEqual(result, { gate_present: true, dispatch_present: true, pending: 0 });
assert.throws(() => controlSql(uri, "select * from public.s05_private_verifier_must_not_be_logged;", env),
  (error) => error.message.includes('SQLSTATE 42P01') && !String(error.stack).includes('s05_private_verifier_must_not_be_logged'));
console.log('S05 real psql URI connection, runtime-state query, budgets and sanitized SQL errors passed.');
