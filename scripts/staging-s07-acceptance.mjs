import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.STAGING_DATABASE_URL?.trim() ?? '';
if (!databaseUrl) throw new Error('Missing STAGING_DATABASE_URL for S07 staging acceptance');

const files = [
  'supabase/tests/s07_terminal_pii_retention.sql',
  'supabase/tests/s07_list_pagination.sql',
  'supabase/tests/s07_snapshot_overflow.sql',
  'supabase/tests/s07_load_measurement.sql',
];

for (const file of files) {
  if (!existsSync(file)) throw new Error('S07 staging acceptance file is missing');
  console.log(`S07 staging acceptance: ${file.split('/').at(-1)}`);
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', databaseUrl,
    '--file', file,
  ], {
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('S07 staging database acceptance failed');
  }
}

console.log('S07 staging database acceptance passed: retention, pagination/snapshots and load receipts.');
