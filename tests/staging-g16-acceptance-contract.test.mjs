import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('G16 hosted acceptance is explicit opt-in and keeps recipient discovery private', () => {
  assert.equal(pkg.scripts['staging:g16-acceptance'], 'node scripts/staging-g16-acceptance.mjs');
  assert.match(workflow, /run_g16_acceptance:/);
  assert.match(workflow, /RUN_G16_ACCEPTANCE: \$\{\{ inputs\.run_g16_acceptance \}\}/);
  assert.match(workflow, /ZERNIO_ACCEPTANCE_PHONE: \$\{\{ secrets\.ZERNIO_ACCEPTANCE_PHONE \}\}/);
  assert.doesNotMatch(workflow, /zernio_acceptance_phone:\s*\n\s*description:/i);
  assert.match(script, /\/v1\/whatsapp\/sandbox\/sessions/);
  assert.match(script, /exactly one active verified Zernio sandbox recipient/);
});

test('G16 Zernio proof reuses production transport and requires delivered or read status', () => {
  assert.match(script, /sendWhatsappVerificationCode\(process\.env, acceptancePhone, code\)/);
  assert.match(script, /\/v1\/inbox\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages/);
  assert.match(script, /deliveryStatus/);
  assert.match(script, /createdAt >= sentAfterMs/);
  assert.match(script, /item\.message\.includes\(code\)/);
  assert.match(script, /lastStatus === 'delivered' \|\| lastStatus === 'read'/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(acceptancePhone|\bcode\b)/);
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
