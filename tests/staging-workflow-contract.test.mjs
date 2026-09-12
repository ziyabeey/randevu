import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');

const externalSettings = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'STAGING_DATABASE_URL',
  'SUPABASE_ADMIN_KEY',
  'MANAGEMENT_LINK_ENCRYPTION_KEY_V1',
  'PUBLIC_BOOKING_GATE_SECRET',
  'NOTIFICATION_DISPATCH_SECRET',
  'RESEND_API_KEY',
  'NOTIFICATION_FROM_EMAIL',
];

test('staging workflow keeps the external provisioning surface at nine values', () => {
  const match = workflow.match(/const requiredExternal = \[([\s\S]*?)\];/);
  assert.ok(match, 'requiredExternal contract must remain explicit');
  const actual = [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((entry) => entry[1]);
  assert.deepEqual(actual, externalSettings);

  for (const name of externalSettings) {
    assert.match(workflow, new RegExp(`secrets\\.${name}`), `${name} must come from GitHub staging secrets`);
  }
});

test('public staging metadata and fixture identities are not treated as GitHub secrets', () => {
  assert.match(workflow, /STAGING_SUPABASE_PROJECT_REF: smizhsagjpqexveitbqu/);
  assert.match(workflow, /SUPABASE_URL: https:\/\/smizhsagjpqexveitbqu\.supabase\.co/);
  assert.match(workflow, /SUPABASE_ANON_KEY: eyJ/);
  assert.match(workflow, /STAGING_OWNER_A_EMAIL: randevu-staging-owner-a@example\.com/);
  assert.match(workflow, /STAGING_OWNER_B_EMAIL: randevu-staging-owner-b@example\.com/);

  assert.doesNotMatch(workflow, /secrets\.STAGING_SUPABASE_PROJECT_REF/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE_ANON_KEY/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_OWNER_[AB]_(?:EMAIL|PASSWORD)/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_APP_ORIGIN/);
});

test('fixture owner passwords are generated per run and masked before use', () => {
  assert.match(workflow, /Prepare ephemeral staging owner passwords/);
  assert.match(workflow, /randomBytes\(24\)/);
  assert.match(workflow, /::add-mask::\$\{value\}/);
  assert.match(workflow, /GITHUB_ENV/);
  assert.match(workflow, /STAGING_OWNER_A_PASSWORD/);
  assert.match(workflow, /STAGING_OWNER_B_PASSWORD/);
});

test('workers.dev staging origin is resolved before any database mutation', () => {
  assert.match(workflow, /Resolve Cloudflare staging origin/);
  assert.match(workflow, /dist\/yzt_randevu\/wrangler\.json/);
  assert.match(workflow, /generated\.workers_dev !== true/);
  assert.match(workflow, /workers\/subdomain/);
  assert.match(workflow, /STAGING_APP_ORIGIN=\$\{origin\}/);

  const buildIndex = workflow.indexOf('- name: Build Cloudflare staging environment');
  const originIndex = workflow.indexOf('- name: Resolve Cloudflare staging origin');
  const psqlIndex = workflow.indexOf('- name: Install PostgreSQL client');
  const migrationIndex = workflow.indexOf('- name: Apply staging migrations');
  assert.ok(buildIndex >= 0 && originIndex > buildIndex, 'origin lookup must happen after generated staging config exists');
  assert.ok(psqlIndex > originIndex && migrationIndex > originIndex, 'Cloudflare origin lookup must fail closed before DB work');
});
