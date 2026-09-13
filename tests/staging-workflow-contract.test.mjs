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

const deploy = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');

test('staging serializes runs and uses an explicit operation with routine as default', () => {
  assert.match(workflow, /group: randevu-staging/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /default: deploy/);
  assert.match(workflow, /options: \[deploy, rotate, resume, rollback, bootstrap\]/);
  assert.match(workflow, /node scripts\/staging-deploy\.mjs resolve/);
  assert.match(workflow, /run: node scripts\/staging-deploy\.mjs\n/);
  assert.doesNotMatch(workflow, /staging:config|staging:reset|staging:seed|PUBLIC_BOOKING_GATE_SECRET: randomBytes/);
});

test('staging keeps ephemeral owner passwords but moves critical key handling into the tested coordinator', () => {
  assert.match(workflow, /STAGING_OWNER_A_PASSWORD: `Rdv!/);
  assert.match(workflow, /STAGING_OWNER_B_PASSWORD: `Rdv!/);
  assert.match(workflow, /::add-mask::/);
  assert.match(deploy, /inheritBindings\(config, source, supplied\)/);
  assert.match(deploy, /\['wrangler', 'versions', 'upload'/);
  assert.match(deploy, /\['wrangler', 'triggers', 'deploy'\]/);
  assert.doesNotMatch(deploy, /\['wrangler', 'deploy'/);
  assert.match(deploy, /mode === 'bootstrap'/);
  assert.match(deploy, /mode === 'rotate'/);
  assert.match(deploy, /mode !== 'resume' && mode !== 'rollback'/);
});

test('staging resolves runtime before migrations and runs existing real acceptance after smoke', () => {
  assert.ok(workflow.indexOf('Resolve Cloudflare staging runtime') < workflow.indexOf('Apply staging migrations'));
  assert.ok(workflow.indexOf('Apply staging migrations') < workflow.indexOf('Deploy and verify consistent staging generation'));
  const smoke = deploy.indexOf("command('npm', ['run', 'staging:smoke'])");
  for (const gate of ['staging:f09-acceptance', 'staging:f10-auth-acceptance', 'staging:s01-acceptance']) {
    assert.ok(deploy.indexOf(gate) > smoke);
  }
  assert.match(workflow, /inputs\.run_f09_acceptance \|\| inputs\.operation == 'rotate' \|\| inputs\.operation == 'resume'/);
  assert.match(workflow, /RUN_F10_ACCEPTANCE: \$\{\{ inputs\.run_f10_auth_acceptance/);
  assert.match(workflow, /RUN_S01_ACCEPTANCE: \$\{\{ inputs\.run_s01_acceptance/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f \/tmp\/randevu-staging-secrets\.json/);
});
