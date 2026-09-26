import assert from 'node:assert/strict';
import test from 'node:test';

import { runF17DatabaseRestoreDrill } from '../scripts/f17-db-restore-drill.mjs';

const fingerprint = {
  businesses: 2,
  memberships: 2,
  services: 2,
  staff: 2,
  staff_services: 2,
  business_hours: 12,
  staff_hours: 12,
  public_settings: 2,
  linked_businesses: 2,
};

function fakeRunner({ failRestore = false } = {}) {
  const calls = [];
  const execute = (name, args, options) => {
    calls.push({ name, args: [...args], options });
    if (name === 'pg_restore' && failRestore) return { status: 2, stdout: '', stderr: 'restore failed' };
    if (name === 'psql' && args.includes('-Atqc')) {
      return { status: 0, stdout: JSON.stringify(fingerprint), stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, execute };
}

test('F17-03B1 performs a real-command-shape dump and restore into a separate disposable database', () => {
  const { calls, execute } = fakeRunner();
  const logs = [];
  const times = [100, 140, 200, 275];

  const result = runF17DatabaseRestoreDrill({
    execute,
    makeTempDir: () => '/tmp/f17-restore-test',
    remove: () => {},
    log: (line) => logs.push(line),
    now: () => times.shift(),
  });

  assert.deepEqual(result.sourceFingerprint, fingerprint);
  assert.deepEqual(result.restoredFingerprint, fingerprint);
  assert.equal(result.dumpMs, 40);
  assert.equal(result.restoreMs, 75);

  const dump = calls.find((call) => call.name === 'pg_dump');
  assert.ok(dump);
  assert.ok(dump.args.includes('yzt_test'));
  assert.ok(dump.args.includes('--format=custom'));
  assert.ok(dump.args.includes('--no-owner'));
  assert.ok(dump.args.includes('/tmp/f17-restore-test/randevu.dump'));

  const restore = calls.find((call) => call.name === 'pg_restore');
  assert.ok(restore);
  assert.ok(restore.args.includes('yzt_f17_restore'));
  assert.ok(restore.args.includes('--exit-on-error'));
  assert.ok(restore.args.includes('/tmp/f17-restore-test/randevu.dump'));

  assert.ok(calls.some((call) => call.name === 'psql'
    && call.args.includes('supabase/seeds/staging_fixture.sql')));
  assert.ok(calls.some((call) => call.name === 'psql'
    && call.args.includes('supabase/seeds/staging_reset.sql')));

  const receipt = logs.find((line) => line.startsWith('F17_DB_RESTORE_DRILL '));
  assert.ok(receipt);
  assert.match(receipt, /environment=ci_disposable_same_cluster/);
  assert.match(receipt, /dump_ms=40 restore_ms=75/);
  assert.match(receipt, /storage_bytes=NOT_COVERED/);
});

test('F17-03B1 cleans the source fixture and target database when restore fails', () => {
  const { calls, execute } = fakeRunner({ failRestore: true });
  const logs = [];
  const times = [100, 120, 200];

  assert.throws(() => runF17DatabaseRestoreDrill({
    execute,
    makeTempDir: () => '/tmp/f17-restore-failure',
    remove: () => {},
    log: (line) => logs.push(line),
    now: () => times.shift(),
  }), /F17 restore drill command failed: pg_restore status=2/);

  assert.ok(calls.some((call) => call.name === 'psql'
    && call.args.includes('supabase/seeds/staging_reset.sql')),
  'source fixture must be reset after restore failure');

  const dropCalls = calls.filter((call) => call.name === 'psql'
    && call.args.some((arg) => String(arg).includes('drop database if exists yzt_f17_restore')));
  assert.equal(dropCalls.length >= 2, true, 'target database must be dropped before and after the failed drill');
});
