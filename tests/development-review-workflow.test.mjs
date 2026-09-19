import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const escalation = await readFile(new URL('../.github/workflows/development-escalation-router.yml', import.meta.url), 'utf8');
const review = await readFile(new URL('../.github/workflows/development-review-router.yml', import.meta.url), 'utf8');

test('Development Escalation Router dispatches review delivery only for deterministic required-review work', () => {
  assert.match(escalation, /actions: write/);
  assert.match(escalation, /steps\.route\.outputs\.disposition == 'DETERMINISTIC_ACTION'/);
  assert.match(escalation, /request_required_reviews/);
  assert.match(escalation, /development-review-router\.yml\/dispatches/);
  assert.match(escalation, /ref: 'main'/);
  assert.doesNotMatch(escalation, /CLAUDE_R1_ROUTINE_TOKEN|CLAUDE_R2_ROUTINE_TOKEN/);
});

test('independent review delivery is API-dispatched from canonical main, never PR-event triggered', () => {
  assert.match(review, /workflow_dispatch:/);
  assert.doesNotMatch(review, /pull_request(?:_target)?:|push:|schedule:/);
  assert.match(review, /test "\$\{GITHUB_REF\}" = "refs\/heads\/main"/);
  assert.match(review, /expected_case_fingerprint/);
  assert.match(review, /request_required_reviews/);
});

test('R1 and R2 have separate role endpoints and secrets without model names in repository routing', () => {
  assert.match(review, /vars\.CLAUDE_R1_ROUTINE_URL/);
  assert.match(review, /secrets\.CLAUDE_R1_ROUTINE_TOKEN/);
  assert.match(review, /vars\.CLAUDE_R2_ROUTINE_URL/);
  assert.match(review, /secrets\.CLAUDE_R2_ROUTINE_TOKEN/);
  assert.doesNotMatch(review, /Sonnet|Opus/);
});

test('exact-case reservation prevents automatic duplicate Routine spend and never claims a verdict', () => {
  assert.match(review, /development-review-launch:r1:\$\{CASE_FINGERPRINT\}/);
  assert.match(review, /development-review-launch:r2:\$\{CASE_FINGERPRINT\}/);
  assert.match(review, /refusing duplicate Routine fire/);
  assert.match(review, /LAUNCH_UNCERTAIN/);
  assert.match(review, /automatic retry is blocked to avoid duplicate Routine sessions/);
  assert.match(review, /launch receipt only; R1 remains open/);
  assert.match(review, /launch receipt only; R2 remains open/);
});
