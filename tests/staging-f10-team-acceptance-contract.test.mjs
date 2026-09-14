import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-f10-team-acceptance.mjs', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('F10-02 real team acceptance command is wired through the staging coordinator', () => {
  assert.equal(pkg.scripts['staging:f10-team-acceptance'], 'node scripts/staging-f10-team-acceptance.mjs');
  assert.match(workflow, /run_f10_team_acceptance:/);
  assert.match(workflow, /RUN_F10_TEAM_ACCEPTANCE: \$\{\{ inputs\.run_f10_team_acceptance \}\}/);
  assert.match(deploy, /f10team: env\.RUN_F10_TEAM_ACCEPTANCE === 'true'/);
  assert.match(deploy, /if \(gates\.f10team\) command\('npm', \['run', 'staging:f10-team-acceptance'\]\)/);
});

test('F10-02 staging acceptance uses both real owners and only canonical fixture businesses', () => {
  for (const required of [
    'STAGING_OWNER_A_EMAIL',
    'STAGING_OWNER_A_PASSWORD',
    'STAGING_OWNER_B_EMAIL',
    'STAGING_OWNER_B_PASSWORD',
  ]) {
    assert.match(script, new RegExp(`'${required}'`));
  }
  assert.match(script, /f1700000-0000-4000-8000-000000000001/);
  assert.match(script, /f1700000-0000-4000-8000-000000000002/);
  assert.match(script, /F10-02 staging acceptance refused a non-canonical fixture membership/);
});

test('F10-02 staging acceptance preserves the security negatives and cleanup contract', () => {
  for (const code of [
    'INVITATION_EMAIL_MISMATCH',
    'INVITATION_ALREADY_USED',
    'MEMBERSHIP_NOT_FOUND',
    'NOT_ALLOWED',
    'OWNER_ROLE_REQUIRES_OWNER',
    'FINANCIAL_PERMISSION_OWNER_REQUIRED',
    'TENANT_REQUIRED',
    'INVITATION_REVOKED',
    'INVITATION_EXPIRED',
  ]) {
    assert.match(script, new RegExp(`'${code}'`));
  }
  assert.match(script, /Promise\.all\(/);
  assert.match(script, /active and role = 'owner'/);
  assert.match(script, /delete from public\.business_invitations/);
  assert.match(script, /delete from public\.memberships/);
  assert.match(script, /set membership_id = null/);
  assert.match(script, /1:1:0:0:0/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(inviteUrl|ownerAPassword|ownerBPassword|dbUrl)/);
});
