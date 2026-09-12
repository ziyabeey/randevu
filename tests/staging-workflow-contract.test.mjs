import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');

const externalSettings = [
  'CLOUDFLARE_API_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ADMIN_KEY',
  'RESEND_API_KEY',
];

const ephemeralSettings = [
  'STAGING_OWNER_A_PASSWORD',
  'STAGING_OWNER_B_PASSWORD',
  'PUBLIC_BOOKING_GATE_SECRET',
  'NOTIFICATION_DISPATCH_SECRET',
];

test('staging workflow keeps the external provisioning surface at four secrets', () => {
  const match = workflow.match(/const requiredExternal = \[([\s\S]*?)\];/);
  assert.ok(match, 'requiredExternal contract must remain explicit');
  const actual = [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((entry) => entry[1]);
  assert.deepEqual(actual, externalSettings);

  for (const name of externalSettings) {
    assert.match(workflow, new RegExp(`secrets\\.${name}`), `${name} must come from GitHub staging secrets`);
  }
});

test('public staging metadata and generated job values are not treated as GitHub secrets', () => {
  assert.match(workflow, /STAGING_SUPABASE_PROJECT_REF: smizhsagjpqexveitbqu/);
  assert.match(workflow, /STAGING_SUPABASE_POOLER_HOST: aws-0-eu-central-1\.pooler\.supabase\.com/);
  assert.match(workflow, /SUPABASE_URL: https:\/\/smizhsagjpqexveitbqu\.supabase\.co/);
  assert.match(workflow, /SUPABASE_ANON_KEY: sb_publishable_/);
  assert.match(workflow, /STAGING_OWNER_A_EMAIL: randevu-staging-owner-a@example\.com/);
  assert.match(workflow, /STAGING_OWNER_B_EMAIL: randevu-staging-owner-b@example\.com/);
  assert.match(workflow, /NOTIFICATION_FROM_EMAIL: randevu@notify\.kepenk\.ai/);

  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /secrets\.NOTIFICATION_FROM_EMAIL/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_DATABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_SUPABASE_PROJECT_REF/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE_ANON_KEY/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_OWNER_[AB]_(?:EMAIL|PASSWORD)/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_APP_ORIGIN/);
  assert.doesNotMatch(workflow, /secrets\.PUBLIC_BOOKING_GATE_SECRET/);
  assert.doesNotMatch(workflow, /secrets\.NOTIFICATION_DISPATCH_SECRET/);
  assert.doesNotMatch(workflow, /secrets\.MANAGEMENT_LINK_ENCRYPTION_KEY_V1/);
});

test('staging database URL is derived from a raw password instead of stored as a GitHub secret', () => {
  assert.match(workflow, /Build staging database URL/);
  assert.match(workflow, /SUPABASE_DB_PASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/);
  assert.match(workflow, /const encodedPassword = encodeURIComponent\(password\)/);
  assert.match(workflow, /`postgresql:\/\/\$\{user\}:\$\{encodedPassword\}@\$\{host\}:5432\/postgres\?sslmode=require`/);
  assert.match(workflow, /STAGING_DATABASE_URL=\$\{databaseUrl\}/);
  assert.match(workflow, /::add-mask::\$\{databaseUrl\}/);
  assert.match(workflow, /Verify staging database credentials/);
  assert.match(workflow, /psql "\$STAGING_DATABASE_URL"/);

  const validateIndex = workflow.indexOf('- name: Validate staging external contract');
  const dbUrlIndex = workflow.indexOf('- name: Build staging database URL');
  const dbVerifyIndex = workflow.indexOf('- name: Verify staging database credentials');
  const migrationIndex = workflow.indexOf('- name: Apply staging migrations');
  assert.ok(validateIndex >= 0 && dbUrlIndex > validateIndex, 'database URL must be built only after external secret validation');
  assert.ok(dbVerifyIndex > dbUrlIndex && migrationIndex > dbVerifyIndex, 'database credentials must be proven before migrations');
});

test('Cloudflare account is derived from a single-account Wrangler token before runtime checks', () => {
  assert.match(workflow, /Resolve Cloudflare account/);
  assert.match(workflow, /npx wrangler whoami --json/);
  assert.match(workflow, /payload\.loggedIn !== true/);
  assert.match(workflow, /accounts\.length !== 1/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID=\$\{accountId\}/);
  assert.match(workflow, /\^\[a-f0-9\]\{32\}\$/i);

  const validateIndex = workflow.indexOf('- name: Validate staging external contract');
  const accountIndex = workflow.indexOf('- name: Resolve Cloudflare account');
  const buildIndex = workflow.indexOf('- name: Build Cloudflare staging environment');
  const migrationIndex = workflow.indexOf('- name: Apply staging migrations');
  assert.ok(validateIndex >= 0 && accountIndex > validateIndex, 'external secret validation must happen before account lookup');
  assert.ok(buildIndex > accountIndex && migrationIndex > accountIndex, 'Cloudflare account resolution must fail closed before build/DB work');
});

test('owner passwords and non-persistent gate secrets are generated per run and masked', () => {
  assert.match(workflow, /Prepare ephemeral staging job secrets/);
  assert.match(workflow, /STAGING_OWNER_A_PASSWORD: `Rdv!\$\{randomBytes\(24\)/);
  assert.match(workflow, /STAGING_OWNER_B_PASSWORD: `Rdv!\$\{randomBytes\(24\)/);
  assert.match(workflow, /PUBLIC_BOOKING_GATE_SECRET: randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(workflow, /NOTIFICATION_DISPATCH_SECRET: randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(workflow, /::add-mask::\$\{value\}/);
  assert.match(workflow, /GITHUB_ENV/);

  for (const name of ephemeralSettings) {
    assert.match(workflow, new RegExp(name), `${name} must be generated or consumed by the workflow`);
  }
});

test('management encryption key is bootstrapped once and persisted only in Cloudflare', () => {
  assert.match(workflow, /workers\/scripts\/\$\{encodeURIComponent\(workerName\)\}\/secrets\/MANAGEMENT_LINK_ENCRYPTION_KEY_V1/);
  assert.match(workflow, /secretResponse\.status === 404/);
  assert.match(workflow, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(workflow, /MANAGEMENT_LINK_ENCRYPTION_KEY_V1_BOOTSTRAP=\$\{bootstrapKey\}/);
  assert.match(workflow, /payload\.MANAGEMENT_LINK_ENCRYPTION_KEY_V1 = process\.env\.MANAGEMENT_LINK_ENCRYPTION_KEY_V1_BOOTSTRAP/);
  assert.match(workflow, /Verify persistent management secret/);
  assert.doesNotMatch(workflow, /secrets\.MANAGEMENT_LINK_ENCRYPTION_KEY_V1/);
  assert.doesNotMatch(workflow, /MANAGEMENT_LINK_ENCRYPTION_KEY_V1: process\.env\.MANAGEMENT_LINK_ENCRYPTION_KEY_V1,/);
});

test('workers.dev staging runtime is resolved before any database mutation', () => {
  assert.match(workflow, /Resolve Cloudflare staging runtime/);
  assert.match(workflow, /dist\/yzt_randevu\/wrangler\.json/);
  assert.match(workflow, /generated\.workers_dev !== true/);
  assert.match(workflow, /workers\/subdomain/);
  assert.match(workflow, /STAGING_WORKER_NAME=\$\{workerName\}/);
  assert.match(workflow, /STAGING_APP_ORIGIN=\$\{origin\}/);

  const buildIndex = workflow.indexOf('- name: Build Cloudflare staging environment');
  const runtimeIndex = workflow.indexOf('- name: Resolve Cloudflare staging runtime');
  const psqlIndex = workflow.indexOf('- name: Install PostgreSQL client');
  const migrationIndex = workflow.indexOf('- name: Apply staging migrations');
  assert.ok(buildIndex >= 0 && runtimeIndex > buildIndex, 'runtime lookup must happen after generated staging config exists');
  assert.ok(psqlIndex > runtimeIndex && migrationIndex > runtimeIndex, 'Cloudflare runtime checks must fail closed before DB work');
});

test('generated gate secrets feed both DB hashes and Worker runtime in the same job', () => {
  const generatedIndex = workflow.indexOf('- name: Prepare ephemeral staging job secrets');
  const configIndex = workflow.indexOf('- name: Provision staging DB runtime hashes');
  const bundleIndex = workflow.indexOf('- name: Build temporary Worker secret bundle');
  const deployIndex = workflow.indexOf('- name: Deploy Cloudflare staging Worker');
  assert.ok(generatedIndex >= 0 && configIndex > generatedIndex, 'DB hash provisioning must use generated secrets');
  assert.ok(bundleIndex > configIndex && deployIndex > bundleIndex, 'the same generated secrets must reach the deployed Worker');
  assert.match(workflow, /PUBLIC_BOOKING_GATE_SECRET: process\.env\.PUBLIC_BOOKING_GATE_SECRET/);
  assert.match(workflow, /NOTIFICATION_DISPATCH_SECRET: process\.env\.NOTIFICATION_DISPATCH_SECRET/);
});

test('staging deploy verifies the persistent management key before smoke', () => {
  const deployIndex = workflow.indexOf('- name: Deploy Cloudflare staging Worker');
  const verifyIndex = workflow.indexOf('- name: Verify persistent management secret');
  const smokeIndex = workflow.indexOf('- name: Verify real staging login and catalog');
  assert.ok(deployIndex >= 0 && verifyIndex > deployIndex && smokeIndex > verifyIndex);
  assert.match(workflow, /payload\?\.result\?\.name !== 'MANAGEMENT_LINK_ENCRYPTION_KEY_V1'/);
});

test('F09 real delivery gate is explicit opt-in and runs only after base staging smoke', () => {
  assert.match(workflow, /run_f09_acceptance:/);
  assert.match(workflow, /type: boolean/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /Verify F09 failure and recovery contracts/);
  assert.match(workflow, /Verify F09-05 real booking and notification delivery/);
  assert.match(workflow, /npm run staging:f09-acceptance/);

  const smokeIndex = workflow.indexOf('- name: Verify real staging login and catalog');
  const acceptanceIndex = workflow.indexOf('- name: Verify F09-05 real booking and notification delivery');
  assert.ok(smokeIndex >= 0 && acceptanceIndex > smokeIndex, 'real F09 acceptance must run after the base staging smoke');

  const guardedSteps = workflow.match(/if: \$\{\{ inputs\.run_f09_acceptance \}\}/g) ?? [];
  assert.equal(guardedSteps.length, 2, 'only the F09 contract and real-delivery steps should be opt-in');
});
