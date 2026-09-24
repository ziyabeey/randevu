import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { discoverFiles } from '../scripts/ci-files.mjs';
import {
  defaultPostgresPlanPath,
  flattenPostgresPlan,
  postgresArgsForStep,
  readPostgresPlan,
  runPostgresPlan,
  validatePostgresPlan,
} from '../scripts/ci-postgres.mjs';
import { discoverHttpTests, runHttpTests } from '../scripts/run-http-tests.mjs';
import { verifyCiCoverage } from '../scripts/verify-ci-coverage.mjs';

const silentLogger = { log() {} };

function fixturePlan(extraSteps = []) {
  return {
    version: 1,
    groups: [{
      name: 'fixture',
      steps: [
        { database: 'fixture', file: 'supabase/migrations/001_fixture.sql' },
        { database: 'fixture', file: 'supabase/tests/nested/acceptance.sql' },
        ...extraSteps,
      ],
    }],
  };
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'randevu-ci-coverage-'));
  await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
  await mkdir(path.join(root, 'supabase/tests/nested'), { recursive: true });
  await mkdir(path.join(root, 'tests/http/nested'), { recursive: true });
  await writeFile(path.join(root, 'supabase/migrations/001_fixture.sql'), '-- migration\n');
  await writeFile(path.join(root, 'supabase/tests/nested/acceptance.sql'), '-- acceptance\n');
  await writeFile(path.join(root, 'tests/http/nested/example.test.mjs'), "import test from 'node:test'; test('ok', () => {});\n");
  const planPath = path.join(root, 'ci-postgres-plan.json');
  await writeFile(planPath, `${JSON.stringify(fixturePlan(), null, 2)}\n`);
  return { root, planPath };
}

async function removeFixture(root) {
  await rm(root, { recursive: true, force: true });
}

test('recursive discovery returns nested files in stable order', async () => {
  const { root } = await makeFixture();
  try {
    await writeFile(path.join(root, 'tests/a.test.mjs'), '// first\n');
    assert.deepEqual(await discoverFiles(root, 'tests', '.test.mjs'), [
      'tests/a.test.mjs',
      'tests/http/nested/example.test.mjs',
    ]);
    assert.deepEqual(await discoverHttpTests(root), [
      'tests/a.test.mjs',
      'tests/http/nested/example.test.mjs',
    ]);
  } finally {
    await removeFixture(root);
  }
});

test('recursive discovery rejects traversal and symlinks', async () => {
  const { root } = await makeFixture();
  try {
    await assert.rejects(discoverFiles(root, '../outside', '.sql'), /stay inside/);
    await mkdir(path.join(root, 'external'));
    await symlink(path.join(root, 'external'), path.join(root, 'tests/http/link'));
    await assert.rejects(discoverFiles(root, 'tests', '.test.mjs'), /symlinks are not allowed/);
    assert.throws(
      () => validatePostgresPlan({
        version: 1,
        groups: [{ name: 'bad', steps: [{ database: 'fixture', file: 'supabase/tests/../outside.sql' }] }],
      }),
      /stay inside/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('coverage comes only from executable plan steps, not YAML comments or unused package scripts', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await mkdir(path.join(root, '.github/workflows'), { recursive: true });
    await writeFile(path.join(root, '.github/workflows/ci.yml'), '# supabase/tests/nested/acceptance.sql\n');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      scripts: { unused: 'psql -f supabase/tests/nested/acceptance.sql' },
    }));
    await writeFile(planPath, `${JSON.stringify({
      version: 1,
      groups: [{ name: 'fixture', steps: [{ database: 'fixture', file: 'supabase/migrations/001_fixture.sql' }] }],
    }, null, 2)}\n`);

    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /SQL files missing[\s\S]*supabase\/tests\/nested\/acceptance\.sql/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('coverage accepts recursively discovered SQL and Node tests from a valid executable plan', async () => {
  const { root, planPath } = await makeFixture();
  try {
    assert.deepEqual(await verifyCiCoverage({ root, planPath }), {
      sqlFiles: 2,
      sqlInvocations: 2,
      inlineSqlSteps: 0,
      nodeTests: 1,
    });
  } finally {
    await removeFixture(root);
  }
});

test('coverage follows transitive psql relative includes from a planned integrity gate', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await mkdir(path.join(root, 'supabase/seeds'), { recursive: true });
    await writeFile(path.join(root, 'supabase/tests/nested/child.sql'), '\\ir grandchild.sql\n');
    await writeFile(path.join(root, 'supabase/tests/nested/grandchild.sql'), '-- transitive scenario\n');
    await writeFile(path.join(root, 'supabase/seeds/support.sql'), '-- support fixture, not part of coverage discovery\n');
    await writeFile(
      path.join(root, 'supabase/tests/nested/acceptance.sql'),
      '\\ir child.sql\n\\ir ../../seeds/support.sql\n',
    );

    assert.deepEqual(await verifyCiCoverage({ root, planPath }), {
      sqlFiles: 4,
      sqlInvocations: 2,
      inlineSqlSteps: 0,
      nodeTests: 1,
    });
  } finally {
    await removeFixture(root);
  }
});

test('H19 manifest integrity accepts one canonical gate with matched expect/include/pass registration', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/h19_test_support.sql'), '-- support\n');
    await writeFile(path.join(root, 'supabase/tests/h19_alpha.sql'), '-- scenario alpha\n');
    await writeFile(path.join(root, 'supabase/tests/h19_beta.sql'), '-- scenario beta\n');
    await writeFile(path.join(root, 'supabase/tests/h19_gamma.sql'), '-- scenario gamma\n');
    await writeFile(
      path.join(root, 'supabase/tests/h19_integrity_gate.sql'),
      [
        '\\ir h19_test_support.sql',
        "select pg_temp.h19_expect('booking.alpha','booking','D0','D1','prospective',1001,1002,1003);",
        "select pg_temp.h19_expect('inventory.beta','inventory','D2','D5','holdout',2001,2002,2003);",
        "select pg_temp.h19_expect('customers.gamma','customers','D0','D2','coverage-first',3001,3002,3003);",
        '\\ir h19_alpha.sql',
        "select pg_temp.h19_pass('booking.alpha');",
        '\\ir h19_beta.sql',
        "select pg_temp.h19_pass('inventory.beta');",
        '\\ir h19_gamma.sql',
        "select pg_temp.h19_pass('customers.gamma');",
        'select pg_temp.h19_assert_complete(3);',
        '',
      ].join('\n'),
    );
    const plan = fixturePlan([{ database: 'fixture', file: 'supabase/tests/h19_integrity_gate.sql' }]);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    await assert.doesNotReject(verifyCiCoverage({ root, planPath }));
  } finally {
    await removeFixture(root);
  }
});

test('H19 manifest integrity rejects orphan scenarios and standalone scenario plan steps', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/h19_test_support.sql'), '-- support\n');
    await writeFile(path.join(root, 'supabase/tests/h19_alpha.sql'), '-- scenario alpha\n');
    await writeFile(path.join(root, 'supabase/tests/h19_beta.sql'), '-- orphan scenario\n');
    await writeFile(
      path.join(root, 'supabase/tests/h19_integrity_gate.sql'),
      [
        '\\ir h19_test_support.sql',
        "select pg_temp.h19_expect('booking.alpha','booking','D0','D1','prospective',1001,1002,1003);",
        '\\ir h19_alpha.sql',
        "select pg_temp.h19_pass('booking.alpha');",
        'select pg_temp.h19_assert_complete(1);',
        '',
      ].join('\n'),
    );
    const plan = fixturePlan([
      { database: 'fixture', file: 'supabase/tests/h19_integrity_gate.sql' },
      { database: 'fixture', file: 'supabase/tests/h19_beta.sql' },
    ]);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /H19 manifest integrity violation[\s\S]*standalone PostgreSQL plan steps[\s\S]*missing from canonical gate/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('H19 manifest integrity rejects expect/pass/count drift', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/h19_test_support.sql'), '-- support\n');
    await writeFile(path.join(root, 'supabase/tests/h19_alpha.sql'), '-- scenario alpha\n');
    await writeFile(
      path.join(root, 'supabase/tests/h19_integrity_gate.sql'),
      [
        '\\ir h19_test_support.sql',
        "select pg_temp.h19_expect('booking.alpha','booking','D0','D1','prospective',1001,1002,1003);",
        '\\ir h19_alpha.sql',
        "select pg_temp.h19_pass('booking.other');",
        'select pg_temp.h19_assert_complete(2);',
        '',
      ].join('\n'),
    );
    const plan = fixturePlan([{ database: 'fixture', file: 'supabase/tests/h19_integrity_gate.sql' }]);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /missing pass registration[\s\S]*pass IDs without manifest registration[\s\S]*assert_complete count mismatch/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('H19 manifest integrity rejects entries without frozen three-arm evidence receipts', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/h19_test_support.sql'), '-- support\n');
    await writeFile(path.join(root, 'supabase/tests/h19_alpha.sql'), '-- scenario alpha\n');
    await writeFile(
      path.join(root, 'supabase/tests/h19_integrity_gate.sql'),
      [
        '\\ir h19_test_support.sql',
        "select pg_temp.h19_expect('booking.alpha','booking','D0','D1','prospective');",
        '\\ir h19_alpha.sql',
        "select pg_temp.h19_pass('booking.alpha');",
        'select pg_temp.h19_assert_complete(1);',
        '',
      ].join('\n'),
    );
    const plan = fixturePlan([{ database: 'fixture', file: 'supabase/tests/h19_integrity_gate.sql' }]);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /H19 manifest entries missing valid evidence receipts/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('H19 manifest integrity rejects frozen holdouts classified as prospective', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/h19_test_support.sql'), '-- support\n');
    await writeFile(path.join(root, 'supabase/tests/h19_holdout.sql'), '-- holdout scenario\n');
    await writeFile(
      path.join(root, 'supabase/tests/h19_integrity_gate.sql'),
      [
        '\\ir h19_test_support.sql',
        "select pg_temp.h19_expect('booking.holdout','booking','D0','D3','prospective',3001,3002,3003);",
        '\\ir h19_holdout.sql',
        "select pg_temp.h19_pass('booking.holdout');",
        'select pg_temp.h19_assert_complete(1);',
        '',
      ].join('\n'),
    );
    const plan = fixturePlan([{ database: 'fixture', file: 'supabase/tests/h19_integrity_gate.sql' }]);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /H19 frozen holdout origin mismatch/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('coverage fails closed when a psql relative include points at an unknown SQL file', async () => {
  const { root, planPath } = await makeFixture();
  try {
    await writeFile(path.join(root, 'supabase/tests/nested/acceptance.sql'), '\\ir missing.sql\n');
    await assert.rejects(
      verifyCiCoverage({ root, planPath }),
      /included SQL file does not exist: supabase\/tests\/nested\/missing\.sql/,
    );
  } finally {
    await removeFixture(root);
  }
});

test('missing, malformed, and unknown PostgreSQL plan files fail closed', async (t) => {
  const { root, planPath } = await makeFixture();
  try {
    await t.test('malformed JSON', async () => {
      await writeFile(planPath, '{');
      assert.throws(() => readPostgresPlan(planPath), /Malformed PostgreSQL plan JSON/);
    });
    await t.test('unknown SQL file', async () => {
      await writeFile(planPath, `${JSON.stringify(fixturePlan([
        { database: 'fixture', file: 'supabase/tests/unknown.sql' },
      ]), null, 2)}\n`);
      await assert.rejects(
        verifyCiCoverage({ root, planPath }),
        /Unknown SQL files[\s\S]*supabase\/tests\/unknown\.sql/,
      );
    });
    await t.test('missing plan', async () => {
      await rm(planPath);
      assert.throws(() => readPostgresPlan(planPath), /Cannot read PostgreSQL plan/);
    });
  } finally {
    await removeFixture(root);
  }
});

test('HTTP runner passes every recursive test filename to a Node test child without shell parsing', async () => {
  const { root } = await makeFixture();
  try {
    const calls = [];
    const files = await runHttpTests({
      root,
      executable: '/fixture/node',
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      },
    });
    assert.deepEqual(files, ['tests/http/nested/example.test.mjs']);
    assert.deepEqual(calls[0].args, [
      '--test',
      '--experimental-strip-types',
      'tests/http/nested/example.test.mjs',
    ]);
    assert.equal(calls[0].command, '/fixture/node');
    assert.equal(calls[0].options.cwd, root);
    assert.equal(calls[0].options.shell, false);
  } finally {
    await removeFixture(root);
  }
});

test('an actual failing recursive Node test makes the HTTP runner fail nonzero', async () => {
  const { root } = await makeFixture();
  try {
    await writeFile(
      path.join(root, 'tests/http/nested/example.test.mjs'),
      "import test from 'node:test'; test('fails', () => { throw new Error('fixture failure'); });\n",
    );
    const runnerUrl = new URL('../scripts/run-http-tests.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { runHttpTests } from ${JSON.stringify(runnerUrl)}; await runHttpTests({ root: process.cwd() });`,
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Node HTTP tests failed with exit 1/);
  } finally {
    await removeFixture(root);
  }
});

test('a failed psql subprocess propagates its status and uses fixed safe connection arguments', () => {
  const plan = {
    version: 1,
    groups: [{ name: 'lifecycle', steps: [{ database: 'postgres', sql: 'select 1;' }] }],
  };
  let invocation;
  assert.throws(
    () => runPostgresPlan(plan, {
      cwd: process.cwd(),
      logger: silentLogger,
      spawn(command, args, options) {
        invocation = { command, args, options };
        return { status: 17 };
      },
    }),
    (error) => error.exitCode === 17 && /psql failed/.test(error.message),
  );
  assert.equal(invocation.command, 'psql');
  assert.deepEqual(invocation.args, [
    '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'select 1;',
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env, undefined, 'omitting env makes spawnSync inherit PGPASSWORD and the remaining environment');
});

const legacyPsqlCommands = String.raw`
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911090000_phase2_auth_tenancy.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911100000_phase3_services_team.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911110000_phase4_availability.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911120000_phase5_booking_core.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911121000_phase5_booking_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911130000_phase6_public_booking.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911140000_phase7_customer_manage.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911150000_phase8_calendar.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911160000_phase9_booking_recovery.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170000_phase9_notification_outbox.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170100_phase9_notification_maintenance.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase3_services_team.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase4_availability.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase5_booking_core.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase6_public_booking.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase7_customer_manage.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase8_calendar.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_booking_recovery.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_notification_outbox.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_notification_outbox_concurrency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_booking_recovery_concurrency.sql
psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists yzt_upgrade;"
psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create database yzt_upgrade;"
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911090000_phase2_auth_tenancy.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911100000_phase3_services_team.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911110000_phase4_availability.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911120000_phase5_booking_core.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911121000_phase5_booking_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911130000_phase6_public_booking.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911140000_phase7_customer_manage.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911150000_phase8_calendar.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911160000_phase9_booking_recovery.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/phase9_notification_upgrade_fixture.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170000_phase9_notification_outbox.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170100_phase9_notification_maintenance.sql
psql -h 127.0.0.1 -U postgres -d yzt_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/phase9_notification_upgrade_assert.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180000_phase9_public_abuse_control.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180100_phase9_public_abuse_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180200_phase9_public_abuse_retention.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260912030000_f17_hosted_acl_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/f17_hosted_acl_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_public_abuse_recovery_probe.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_public_abuse_control.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/phase9_public_abuse_retention.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/f17_staging_fixture.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260912123000_s03_notification_consistency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s03_notification_consistency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s03_notification_concurrency.sql
psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists yzt_s03_upgrade;"
psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create database yzt_s03_upgrade;"
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911090000_phase2_auth_tenancy.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911100000_phase3_services_team.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911110000_phase4_availability.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911120000_phase5_booking_core.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911121000_phase5_booking_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911130000_phase6_public_booking.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911140000_phase7_customer_manage.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911150000_phase8_calendar.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911160000_phase9_booking_recovery.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170000_phase9_notification_outbox.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911170100_phase9_notification_maintenance.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180000_phase9_public_abuse_control.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180100_phase9_public_abuse_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260911180200_phase9_public_abuse_retention.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260912030000_f17_hosted_acl_hardening.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/s03_notification_upgrade_fixture.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/migrations/20260912123000_s03_notification_consistency.sql
psql -h 127.0.0.1 -U postgres -d yzt_s03_upgrade -v ON_ERROR_STOP=1 -f supabase/tests/s03_notification_upgrade_assert.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260913030912_s04_resource_limits.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s04_resource_limits.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s04_resource_limits_concurrency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s05_upgrade_fixture.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260913042902_s05_deploy_consistency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s05_deploy_consistency.sql
psql -h 127.0.0.1 -U postgres -d yzt_test -v ON_ERROR_STOP=1 -f supabase/tests/s05_deploy_concurrency.sql
`.trim().split('\n');

function parseLegacyCommand(command) {
  const match = command.match(/^psql -h 127\.0\.0\.1 -U postgres -d (\S+) -v ON_ERROR_STOP=1 -(f|c) (?:"([^"]+)"|(\S+))$/);
  assert.ok(match, `unparsed legacy command: ${command}`);
  const [, database, kind, quoted, bare] = match;
  return [
    '-h', '127.0.0.1', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1',
    kind === 'f' ? '-f' : '-c', quoted ?? bare,
  ];
}

function assertLegacyCommandSubsequence(plan) {
  const actual = flattenPostgresPlan(plan).map(postgresArgsForStep);
  const expected = legacyPsqlCommands.map(parseLegacyCommand);
  assert.equal(expected.length, 78, 'embedded legacy workflow snapshot');

  let searchFrom = 0;
  for (const [legacyIndex, legacyCommand] of expected.entries()) {
    const foundAt = actual.findIndex(
      (candidate, actualIndex) => actualIndex >= searchFrom && isDeepStrictEqual(candidate, legacyCommand),
    );
    assert.notEqual(
      foundAt,
      -1,
      `legacy command ${legacyIndex + 1} is missing or reordered: ${legacyPsqlCommands[legacyIndex]}`,
    );
    searchFrom = foundAt + 1;
  }
}

test('PostgreSQL plan preserves all 78 legacy commands as an ordered subsequence', () => {
  assertLegacyCommandSubsequence(readPostgresPlan(defaultPostgresPlanPath));
});

test('legacy sequence guard permits additions but rejects a missing or reordered command', () => {
  const source = readPostgresPlan(defaultPostgresPlanPath);

  const extended = structuredClone(source);
  extended.groups[0].steps.splice(1, 0, { database: 'yzt_test', sql: 'select 1;' });
  assert.doesNotThrow(() => assertLegacyCommandSubsequence(extended));

  const missing = structuredClone(source);
  missing.groups[0].steps.shift();
  assert.throws(() => assertLegacyCommandSubsequence(missing), /legacy command 1 is missing or reordered/);

  const reordered = structuredClone(source);
  [reordered.groups[0].steps[0], reordered.groups[0].steps[1]] = [
    reordered.groups[0].steps[1],
    reordered.groups[0].steps[0],
  ];
  assert.throws(() => assertLegacyCommandSubsequence(reordered), /legacy command 2 is missing or reordered/);
});
