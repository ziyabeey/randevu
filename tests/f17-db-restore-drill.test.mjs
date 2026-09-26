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

test('F17-03B1 uses the PostgreSQL 17 CI container tools when explicitly selected', () => {
  const { calls, execute } = fakeRunner();
  const times = [100, 140, 200, 275];

  runF17DatabaseRestoreDrill({
    execute,
    makeTempDir: () => { throw new Error('container mode must not create a host archive directory'); },
    remove: () => { throw new Error('container mode must not remove a host archive directory'); },
    log: () => {},
    now: () => times.shift(),
    toolContainer: 'randevu-ci-postgres',
  });

  const dump = calls.find((call) => call.name === 'docker' && call.args.includes('pg_dump'));
  assert.ok(dump);
  assert.deepEqual(dump.args.slice(0, 3), ['exec', 'randevu-ci-postgres', 'pg_dump']);
  assert.ok(dump.args.includes('yzt_test'));
  assert.ok(dump.args.some((arg) => String(arg).startsWith('/tmp/randevu-f17-restore-')));

  const restore = calls.find((call) => call.name === 'docker' && call.args.includes('pg_restore'));
  assert.ok(restore);
  assert.deepEqual(restore.args.slice(0, 3), ['exec', 'randevu-ci-postgres', 'pg_restore']);
  assert.ok(restore.args.includes('yzt_f17_restore'));

  const cleanup = calls.find((call) => call.name === 'docker' && call.args.includes('rm'));
  assert.ok(cleanup, 'container archive must be removed after the drill');
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

// Inject failures into the actual orchestration without invoking a database.
function observeDrill({ failSteps = [], toolContainer = null } = {}) {
  const runner = fakeRunner();
  const events = [];
  const logs = [];
  let drops = 0;
  const failed = new Set(failSteps);
  const options = {
    toolContainer,
    makeTempDir: () => '/tmp/f17-cleanup-regression',
    now: () => 0,
    log: (line) => {
      logs.push(line);
      if (line.startsWith('F17_DB_RESTORE_DRILL ')) events.push('receipt');
    },
    remove: () => {
      events.push('host_archive');
      if (failed.has('host_archive')) throw new Error('injected archive removal failure');
    },
    execute: (name, args, options) => {
      const result = runner.execute(name, args, options);
      const sql = args[args.indexOf('-c') + 1] ?? '';
      let step;
      if (name === 'psql' && String(sql).includes('drop database if exists')) {
        step = ++drops === 1 ? 'preflight' : 'target_database';
      } else if (name === 'psql' && String(sql).includes('insert into auth.users')) {
        step = 'seed_users';
      } else if (args.includes('supabase/seeds/staging_fixture.sql')) {
        step = 'seed_fixture';
      } else if (args.includes('supabase/seeds/staging_reset.sql')) {
        step = 'source_fixture';
      } else if (name === 'psql' && String(sql).includes('delete from auth.users')) {
        step = 'source_users';
      } else if (name === 'pg_restore' || (name === 'docker' && args[2] === 'pg_restore')) {
        step = 'restore';
      } else if (name === 'docker' && args[2] === 'rm') {
        step = 'container_archive';
      }
      if (step) events.push(step);
      if (failed.has(step)) return { status: 2, stdout: '', stderr: 'injected failure' };
      return result;
    },
  };
  return { events, logs, options };
}

for (const step of ['seed_users', 'seed_fixture']) {
  test(`F17-03B1 cleans partial source state when ${step} fails`, () => {
    const { events, logs, options } = observeDrill({ failSteps: [step] });
    assert.throws(() => runF17DatabaseRestoreDrill(options), /command failed: psql status=2/);
    assert.ok(events.includes('source_fixture'), 'partial fixture must be reset');
    assert.ok(events.includes('source_users'), 'partial auth users must be removed');
    assert.ok(events.includes('target_database'));
    assert.ok(events.includes('host_archive'));
    assert.equal(logs.some((line) => line.startsWith('F17_DB_RESTORE_DRILL ')), false);
  });
}

for (const step of ['source_fixture', 'source_users', 'target_database', 'host_archive', 'container_archive']) {
  test(`F17-03B1 fails closed and withholds success when ${step} cleanup fails`, () => {
    const toolContainer = step === 'container_archive' ? 'randevu-ci-postgres' : null;
    const { events, logs, options } = observeDrill({ failSteps: [step], toolContainer });
    assert.throws(() => runF17DatabaseRestoreDrill(options), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, new RegExp(`cleanup failed: ${step}`));
      assert.equal(error.errors.length, 1);
      return true;
    });
    // One failed cleanup must not suppress independent cleanup attempts.
    assert.ok(events.includes('source_fixture'));
    assert.ok(events.includes('source_users'));
    assert.ok(events.includes('target_database'));
    assert.ok(events.includes(toolContainer ? 'container_archive' : 'host_archive'));
    assert.equal(logs.some((line) => line.startsWith('F17_DB_RESTORE_DRILL ')), false);
  });
}

test('F17-03B1 emits success only after every cleanup completes', () => {
  const { events, options } = observeDrill();
  runF17DatabaseRestoreDrill(options);
  assert.deepEqual(events.slice(-5), [
    'source_fixture', 'source_users', 'target_database', 'host_archive', 'receipt',
  ]);
});

test('F17-03B1 retains the restore failure together with all cleanup failures', () => {
  const { events, logs, options } = observeDrill({
    failSteps: ['restore', 'source_fixture', 'target_database', 'host_archive'],
  });
  assert.throws(() => runF17DatabaseRestoreDrill(options), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 4);
    assert.strictEqual(error.cause, error.errors[0]);
    assert.match(error.cause.message, /command failed: pg_restore status=2/);
    assert.match(error.message, /command failed: pg_restore status=2/);
    for (const step of ['source_fixture', 'target_database', 'host_archive']) {
      assert.match(error.message, new RegExp(`cleanup failed: ${step}`));
    }
    return true;
  });
  assert.ok(events.includes('source_users'));
  assert.ok(events.includes('host_archive'));
  assert.equal(logs.some((line) => line.startsWith('F17_DB_RESTORE_DRILL ')), false);
});

test('F17-03B1 never resets source fixtures if preflight fails before seeding', () => {
  const { events, options } = observeDrill({ failSteps: ['preflight'] });
  assert.throws(() => runF17DatabaseRestoreDrill(options), /command failed: psql status=2/);
  assert.equal(events.includes('seed_users'), false);
  assert.equal(events.includes('source_fixture'), false);
  assert.equal(events.includes('source_users'), false);
  assert.ok(events.includes('host_archive'));
});
