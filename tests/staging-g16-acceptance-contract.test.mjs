import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('G16 hosted acceptance is explicit opt-in and keeps the recipient acceptance-only', () => {
  assert.equal(pkg.scripts['staging:g16-acceptance'], 'node scripts/staging-g16-acceptance.mjs');
  assert.match(workflow, /run_g16_acceptance:/);
  assert.match(workflow, /RUN_G16_ACCEPTANCE: \$\{\{ inputs\.run_g16_acceptance \}\}/);
  assert.match(workflow, /NETGSM_ACCEPTANCE_PHONE: \$\{\{ secrets\.NETGSM_ACCEPTANCE_PHONE \}\}/);
  assert.doesNotMatch(workflow, /netgsm_acceptance_phone:\s*\n\s*description:/i);
  assert.match(script, /G16 Netgsm acceptance requires staging secret NETGSM_ACCEPTANCE_PHONE/);
});

test('G16 Netgsm proof reuses production OTP transport and requires provider success code 00', () => {
  assert.match(script, /sendWhatsappVerificationCode\(process\.env, acceptancePhone, code\)/);
  assert.match(script, /sent\.providerCode !== '00'/);
  assert.match(script, /Netgsm verified-recipient OTP send accepted by provider: code 00/);
  assert.doesNotMatch(script, /console\.log\([^\n]*acceptancePhone/);
  assert.doesNotMatch(script, /console\.log\([^\n]*\$\{code\}/);
  assert.doesNotMatch(script, /zernio/i);
});

test('G16 hosted Storage proof covers owner read, cross-tenant and anon denial, then delete', () => {
  assert.match(script, /appointment-private-media/);
  assert.match(script, /Cross-tenant Worker denial was not a fail-closed 4xx/);
  assert.match(script, /Hosted Storage cross-tenant RLS denial was not a fail-closed 4xx/);
  assert.match(script, /Hosted Storage anonymous denial was not a fail-closed 4xx/);
  assert.match(script, /Hosted Storage post-delete read was not a fail-closed 4xx/);
  assert.match(script, /G16 hosted private-media Storage smoke passed/);
});

test('staging coordinator runs G16 only after the base smoke when requested', () => {
  assert.match(deploy, /g16: env\.RUN_G16_ACCEPTANCE === 'true'/);
  const smoke = deploy.indexOf("command('npm', ['run', 'staging:smoke'])");
  const gate = deploy.indexOf("if (gates.g16) command('npm', ['run', 'staging:g16-acceptance'])");
  assert.ok(smoke >= 0 && gate > smoke);
});
