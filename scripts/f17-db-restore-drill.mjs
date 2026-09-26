import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_DB = 'yzt_test';
const TARGET_DB = 'yzt_f17_restore';
const OWNER_A = 'f1740000-0000-4000-8000-000000000001';
const OWNER_B = 'f1740000-0000-4000-8000-000000000002';

const fingerprintSql = `
select json_build_object(
  'businesses', (
    select count(*) from public.businesses
    where id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'memberships', (
    select count(*) from public.memberships
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'services', (
    select count(*) from public.services
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'staff', (
    select count(*) from public.staff_profiles
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'staff_services', (
    select count(*) from public.staff_services
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'business_hours', (
    select count(*) from public.business_hours
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'staff_hours', (
    select count(*) from public.staff_hours
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'public_settings', (
    select count(*) from public.public_booking_settings
    where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    ) and enabled
  ),
  'linked_businesses', (
    select count(distinct b.id)
    from public.businesses b
    join public.memberships m on m.business_id = b.id and m.active
    join public.services s on s.business_id = b.id and s.active
    join public.staff_profiles sp on sp.business_id = b.id and sp.active
    join public.staff_services ss
      on ss.business_id = b.id
     and ss.staff_id = sp.id
     and ss.service_id = s.id
     and ss.active
    where b.id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  )
)::text;
`;

const expectedFingerprint = Object.freeze({
  businesses: 2,
  memberships: 2,
  services: 2,
  staff: 2,
  staff_services: 2,
  business_hours: 12,
  staff_hours: 12,
  public_settings: 2,
  linked_businesses: 2,
});

function argsForPsql(database, extra = []) {
  return ['-h', '127.0.0.1', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', ...extra];
}

function commandFailure(name, result) {
  const code = result?.error?.code ? ` code=${result.error.code}` : '';
  const status = Number.isInteger(result?.status) ? ` status=${result.status}` : '';
  return new Error(`F17 restore drill command failed: ${name}${code}${status}`);
}

function run(execute, name, args, options = {}) {
  const result = execute(name, args, {
    shell: false,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: options.timeout ?? 5 * 60 * 1000,
    ...options.spawnOptions,
  });
  if (result?.error || result?.status !== 0) throw commandFailure(name, result);
  return result;
}

function readFingerprint(execute, database) {
  const result = run(execute, 'psql', argsForPsql(database, ['-Atqc', fingerprintSql]), { capture: true });
  const text = String(result.stdout ?? '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`F17 restore drill returned an invalid fingerprint for ${database}`);
  }
  return parsed;
}

function assertFingerprint(actual, label) {
  for (const [key, expected] of Object.entries(expectedFingerprint)) {
    if (Number(actual?.[key]) !== expected) {
      throw new Error(`F17 restore drill ${label} fingerprint mismatch: ${key}`);
    }
  }
}

function seedFixture(execute) {
  run(execute, 'psql', argsForPsql(SOURCE_DB, ['-c', `
    insert into auth.users(id, email, raw_user_meta_data)
    values
      ('${OWNER_A}'::uuid, 'owner-a@restore.invalid', '{"full_name":"Restore Owner A"}'::jsonb),
      ('${OWNER_B}'::uuid, 'owner-b@restore.invalid', '{"full_name":"Restore Owner B"}'::jsonb)
    on conflict (id) do update
    set email = excluded.email,
        raw_user_meta_data = excluded.raw_user_meta_data;
  `]));
  run(execute, 'psql', argsForPsql(SOURCE_DB, [
    '-v', `owner_a=${OWNER_A}`,
    '-v', `owner_b=${OWNER_B}`,
    '-f', 'supabase/seeds/staging_fixture.sql',
  ]));
}

function cleanupFixture(execute) {
  run(execute, 'psql', argsForPsql(SOURCE_DB, ['-f', 'supabase/seeds/staging_reset.sql']));
  run(execute, 'psql', argsForPsql(SOURCE_DB, ['-c', `
    delete from auth.users
    where id in ('${OWNER_A}'::uuid, '${OWNER_B}'::uuid);
  `]));
}

function dropTarget(execute) {
  run(execute, 'psql', argsForPsql('postgres', ['-c', `
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = '${TARGET_DB}' and pid <> pg_backend_pid();
  `]));
  run(execute, 'psql', argsForPsql('postgres', ['-c', `drop database if exists ${TARGET_DB};`]));
}

export function runF17DatabaseRestoreDrill({
  execute = spawnSync,
  makeTempDir = () => mkdtempSync(path.join(tmpdir(), 'randevu-f17-restore-')),
  remove = rmSync,
  log = console.log,
  now = () => Date.now(),
  toolContainer = null,
} = {}) {
  const temp = toolContainer ? null : makeTempDir();
  const dumpPath = toolContainer
    ? `/tmp/randevu-f17-restore-${process.pid}.dump`
    : path.join(temp, 'randevu.dump');
  let seeded = false;

  try {
    dropTarget(execute);
    seedFixture(execute);
    seeded = true;

    const sourceFingerprint = readFingerprint(execute, SOURCE_DB);
    assertFingerprint(sourceFingerprint, 'source');

    const dumpStarted = now();
    if (toolContainer) {
      run(execute, 'docker', [
        'exec', toolContainer,
        'pg_dump',
        '-U', 'postgres',
        '-d', SOURCE_DB,
        '--format=custom',
        '--no-owner',
        '--file', dumpPath,
      ], { timeout: 10 * 60 * 1000 });
    } else {
      run(execute, 'pg_dump', [
        '-h', '127.0.0.1',
        '-U', 'postgres',
        '-d', SOURCE_DB,
        '--format=custom',
        '--no-owner',
        '--file', dumpPath,
      ], { timeout: 10 * 60 * 1000 });
    }
    const dumpMs = Math.max(0, now() - dumpStarted);

    run(execute, 'psql', argsForPsql('postgres', ['-c', `create database ${TARGET_DB};`]));

    const restoreStarted = now();
    if (toolContainer) {
      run(execute, 'docker', [
        'exec', toolContainer,
        'pg_restore',
        '-U', 'postgres',
        '-d', TARGET_DB,
        '--no-owner',
        '--exit-on-error',
        dumpPath,
      ], { timeout: 10 * 60 * 1000 });
    } else {
      run(execute, 'pg_restore', [
        '-h', '127.0.0.1',
        '-U', 'postgres',
        '-d', TARGET_DB,
        '--no-owner',
        '--exit-on-error',
        dumpPath,
      ], { timeout: 10 * 60 * 1000 });
    }
    const restoreMs = Math.max(0, now() - restoreStarted);

    const restoredFingerprint = readFingerprint(execute, TARGET_DB);
    assertFingerprint(restoredFingerprint, 'restored');
    if (JSON.stringify(restoredFingerprint) !== JSON.stringify(sourceFingerprint)) {
      throw new Error('F17 restore drill source/restored fingerprints differ');
    }

    log(
      `F17_DB_RESTORE_DRILL environment=ci_disposable_same_cluster ` +
      `businesses=2 memberships=2 services=2 linked_businesses=2 ` +
      `dump_ms=${dumpMs} restore_ms=${restoreMs} storage_bytes=NOT_COVERED`
    );

    return { sourceFingerprint, restoredFingerprint, dumpMs, restoreMs };
  } finally {
    if (seeded) {
      try { cleanupFixture(execute); } catch (error) { log(`F17 restore source cleanup failed: ${error.message}`); }
    }
    try { dropTarget(execute); } catch (error) { log(`F17 restore target cleanup failed: ${error.message}`); }
    if (toolContainer) {
      try {
        run(execute, 'docker', ['exec', toolContainer, 'rm', '-f', dumpPath], { capture: true });
      } catch (error) {
        log(`F17 restore archive cleanup failed: ${error.message}`);
      }
    } else {
      remove(temp, { recursive: true, force: true });
    }
  }
}
