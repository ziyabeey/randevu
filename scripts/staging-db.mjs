import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const mode = process.argv[2];
const dbUrl = process.env.STAGING_DATABASE_URL;
if (!dbUrl) throw new Error('Missing STAGING_DATABASE_URL');

function runPsql(file, variables = {}) {
  const args = [dbUrl, '-v', 'ON_ERROR_STOP=1'];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-v', `${key}=${value}`);
  }
  args.push('-f', path.resolve(file));
  const result = spawnSync('psql', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'seed') {
  const ownerA = process.env.STAGING_OWNER_A_ID;
  const ownerB = process.env.STAGING_OWNER_B_ID;
  if (!ownerA || !ownerB) throw new Error('seed requires STAGING_OWNER_A_ID and STAGING_OWNER_B_ID');
  runPsql('supabase/seeds/staging_fixture.sql', { owner_a: ownerA, owner_b: ownerB });
} else if (mode === 'reset') {
  runPsql('supabase/seeds/staging_reset.sql');
} else if (mode === 'config') {
  const gateSecret = process.env.PUBLIC_BOOKING_GATE_SECRET;
  const dispatchSecret = process.env.NOTIFICATION_DISPATCH_SECRET;
  if (!gateSecret || !dispatchSecret) {
    throw new Error('config requires PUBLIC_BOOKING_GATE_SECRET and NOTIFICATION_DISPATCH_SECRET');
  }
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  runPsql('supabase/seeds/staging_runtime_config.sql', {
    gate_hash: sha256(gateSecret),
    dispatch_hash: sha256(dispatchSecret),
  });
} else {
  throw new Error('Usage: node scripts/staging-db.mjs <seed|reset|config>');
}
