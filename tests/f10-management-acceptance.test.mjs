import assert from 'node:assert/strict';
import test from 'node:test';
import { runManagementAcceptance } from '../scripts/browser-f10-management-acceptance.mjs';

test('F10-06 real-browser management choreography preserves current authority across navigation and session changes', { timeout: 60_000 }, async () => {
  try {
    const receipt = await runManagementAcceptance();
    assert.equal(receipt.ok, true);
    assert.ok(receipt.scenarios.includes('browser back/forward'));
    assert.ok(receipt.scenarios.includes('second-tab role downgrade'));
    assert.ok(receipt.scenarios.includes('logout/session expiry'));
  } catch (error) {
    const failures = error && typeof error === 'object' && Array.isArray(error.acceptanceFailures)
      ? error.acceptanceFailures
      : [];
    if (failures.length > 0) {
      const summary = failures.map((failure) => `${failure.code}: ${failure.message}`).join('\n- ');
      const blocker = new Error(`F10-06 runtime acceptance blockers:\n- ${summary}`);
      blocker.acceptanceFailures = failures;
      blocker.cause = error;
      throw blocker;
    }
    throw error;
  }
});
