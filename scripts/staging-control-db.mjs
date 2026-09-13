import { spawnSync } from 'node:child_process';

// A libpq environment default is a database name, not an expanded connection
// string. Pass the URI as an explicit dbname argument, as the credential smoke
// and migration CLI do. Never emit the URI, SQL, or captured stderr on failure.
export function controlSql(databaseUrl, statement, env = process.env, run = spawnSync) {
  if (!databaseUrl) throw new Error('Missing STAGING_DATABASE_URL');
  const result = run('psql', ['--dbname', databaseUrl, '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
    input: statement, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024,
    env: { ...env, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=10000' },
  });
  if (result.error || result.status !== 0) {
    // Only fixed diagnostics cross the logging boundary. Even a spawn error
    // can contain command arguments, so the original Error is never attached.
    const state = result.stderr?.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)/)?.[1];
    const processCode = result.error?.code;
    const reason = processCode === 'ENOENT' ? 'psql unavailable'
      : processCode === 'ETIMEDOUT' ? 'psql timed out'
      : state ? `SQLSTATE ${state}`
      : Number.isInteger(result.status) ? `psql exit ${result.status}` : 'psql process failed';
    throw new Error(`Staging control-plane SQL failed (${reason}); details suppressed to protect verifiers`);
  }
  return result.stdout.trim();
}
