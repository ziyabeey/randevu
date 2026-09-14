import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../worker/app.ts', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../worker/snapshot-reads.ts', import.meta.url), 'utf8');

const directBusinessEmbed = 'businesses!memberships_business_id_fkey(id,name,slug,timezone)';

test('active session route uses the direct memberships-to-businesses FK hint', () => {
  const snapshotRoute = app.indexOf("app.route('/', snapshotReads);");
  const legacyRoute = app.indexOf("app.route('/', coreApp);");
  assert.ok(snapshotRoute >= 0 && legacyRoute > snapshotRoute, 'bounded snapshot reads must stay ahead of legacy routes');

  const sessionStart = snapshot.indexOf("snapshotReads.get('/api/session'");
  const sessionEnd = snapshot.indexOf("snapshotReads.get('/api/catalog'", sessionStart);
  assert.ok(sessionStart >= 0 && sessionEnd > sessionStart, 'active session handler must remain inspectable');
  const sessionSource = snapshot.slice(sessionStart, sessionEnd);

  assert.match(sessionSource, new RegExp(directBusinessEmbed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(
    sessionSource,
    /select:\s*'id,business_id,role,active,businesses\(id,name,slug,timezone\)'/,
    'bare PostgREST embedding is ambiguous once another memberships-to-businesses relationship path exists',
  );
});
