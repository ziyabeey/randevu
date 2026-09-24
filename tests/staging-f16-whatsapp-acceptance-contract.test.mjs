import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-f16-whatsapp-acceptance.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('F16-02 hosted WhatsApp acceptance is an operator command against a deployed Worker', () => {
  assert.equal(pkg.scripts['staging:f16-whatsapp-acceptance'], 'node scripts/staging-f16-whatsapp-acceptance.mjs');
  assert.match(script, /\/api\/public\/verify\/whatsapp\/start/);
  assert.match(script, /\/api\/public\/verify\/whatsapp\/check/);
  assert.match(script, /createInterface/);
  assert.match(script, /TWILIO_TEST_RECIPIENT/);
});

test('F16-02 hosted WhatsApp acceptance proves rejection paths and never prints secrets', () => {
  assert.match(script, /Unverified public booking was not rejected/);
  assert.match(script, /An approved WhatsApp code was accepted twice/);
  assert.match(script, /The proof was accepted for another phone/);
  assert.match(script, /rejected a freshly approved WhatsApp proof/);
  for (const line of script.split('\n').filter((item) => /console\.log/.test(item))) {
    assert.doesNotMatch(line, /\$\{(?:recipient|code|token|otherPhone)\}/, `secret-bearing value logged: ${line.trim()}`);
  }
  assert.doesNotMatch(script, /PHONE_VERIFICATION_PROOF_SECRET|stagingPhoneProofSecret/);
});
