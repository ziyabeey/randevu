import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.STAGING_DATABASE_URL?.trim() ?? '';
if (!databaseUrl) throw new Error('Missing STAGING_DATABASE_URL for S07 staging acceptance');

const files = Object.freeze([
  'supabase/tests/s07_terminal_pii_retention.sql',
  'supabase/tests/s07_list_pagination.sql',
  'supabase/tests/s07_snapshot_overflow.sql',
  'supabase/tests/s07_load_measurement.sql',
]);

const metrics = [];
for (const file of files) {
  if (!existsSync(file)) throw new Error('S07 staging acceptance file is missing');
  const name = file.split('/').at(-1);
  console.log(`S07 staging acceptance started: ${name}`);
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--set', 'VERBOSITY=terse',
    '--dbname', databaseUrl,
    '--file', file,
  ], {
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`S07 staging database acceptance failed: ${name}`);
  }

  for (const line of `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split(/\r?\n/)) {
    const index = line.indexOf('S07_C3_METRIC ');
    if (index >= 0) {
      const metric = line.slice(index).trim();
      metrics.push(metric);
      console.log(metric);
    }
  }
  console.log(`S07 staging acceptance passed: ${name}`);
}

if (metrics.length !== 2
    || !metrics.some((line) => line.includes('workload=catalog_snapshot') && line.includes('errors=0'))
    || !metrics.some((line) => line.includes('workload=booking_page') && line.includes('errors=0'))) {
  throw new Error('S07 staging load acceptance did not emit both required metric receipts');
}

console.log('S07 staging database acceptance passed: retention, pagination/snapshots and load receipts.');
