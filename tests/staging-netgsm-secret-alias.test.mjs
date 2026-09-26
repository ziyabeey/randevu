import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');

// Configuration-contract tests only: GitHub evaluates this expression. These
// checks do not read secrets, execute Actions or contact the OTP provider.
test('G16 accepts NETGSM_USERNAME as a secret alias with USERCODE precedence', () => {
  const bindings = [...workflow.matchAll(/^      NETGSM_USERCODE:\s*(.+)$/gm)];
  assert.equal(bindings.length, 1, 'Exactly one canonical job binding is required');
  assert.equal(bindings[0][1], '${{ secrets.NETGSM_USERCODE || secrets.NETGSM_USERNAME }}');
});

test('G16 keeps password and test recipient separate from the username alias', () => {
  assert.match(workflow, /^      NETGSM_PASSWORD: \$\{\{ secrets\.NETGSM_PASSWORD \}\}$/m);
  assert.match(workflow, /^      NETGSM_ACCEPTANCE_PHONE: \$\{\{ secrets\.NETGSM_ACCEPTANCE_PHONE \}\}$/m);
  assert.doesNotMatch(workflow, /^      NETGSM_USERNAME:/m);
  const inputBlock = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
  assert.doesNotMatch(inputBlock, /NETGSM_/i, 'Credentials and recipient must not become workflow inputs');
});
