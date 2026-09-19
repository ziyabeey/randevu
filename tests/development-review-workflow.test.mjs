import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const escalation = await readFile(new URL('../.github/workflows/development-escalation-router.yml', import.meta.url), 'utf8');
const review = await readFile(new URL('../.github/workflows/development-review-router.yml', import.meta.url), 'utf8');

test('Development Escalation Router calls review delivery only for deterministic required-review work', () => {
  assert.doesNotMatch(escalation, /actions: write/);
  assert.match(escalation, /needs\.route\.outputs\.disposition == 'DETERMINISTIC_ACTION'/);
  assert.match(escalation, /needs\.route\.outputs\.suggested_action == 'request_required_reviews'/);
  assert.match(escalation, /uses: \.\/\.github\/workflows\/development-review-router\.yml/);
  assert.match(escalation, /expected_case_fingerprint: \$\{\{ needs\.route\.outputs\.case_fingerprint \}\}/);
  assert.match(escalation, /CLAUDE_R1_ROUTINE_TOKEN/);
  assert.match(escalation, /CLAUDE_R2_ROUTINE_TOKEN/);
});

test('independent review delivery is reusable-only and cannot be directly Actions-dispatched', () => {
  assert.match(review, /workflow_call:/);
  assert.doesNotMatch(review, /workflow_dispatch:|pull_request(?:_target)?:|push:|schedule:/);
  assert.match(review, /expected_case_fingerprint/);
  assert.match(review, /request_required_reviews/);
  assert.match(review, /secrets:\n\s+CLAUDE_R1_ROUTINE_TOKEN:/);
  assert.match(review, /CLAUDE_R2_ROUTINE_TOKEN:/);
});

test('R1 and R2 have separate role endpoints and secrets without model names in repository routing', () => {
  assert.match(review, /vars\.CLAUDE_R1_ROUTINE_URL/);
  assert.match(review, /secrets\.CLAUDE_R1_ROUTINE_TOKEN/);
  assert.match(review, /vars\.CLAUDE_R2_ROUTINE_URL/);
  assert.match(review, /secrets\.CLAUDE_R2_ROUTINE_TOKEN/);
  assert.doesNotMatch(review, /Sonnet|Opus/);
});

test('review delivery rechecks live GitHub PR and main identity before role credentials are used', () => {
  assert.match(review, /repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{pr_number\}/);
  assert.match(review, /repos\/\$\{GITHUB_REPOSITORY\}\/branches\/main/);
  assert.match(review, /test "\$\{live_head\}" = "\$\{head_sha\}"/);
  assert.match(review, /test "\$\{live_base\}" = "\$\{expected_base\}"/);
  assert.match(review, /test "\$\{live_main\}" = "\$\{expected_main\}"/);
  assert.match(review, /pull-requests: read/);
});

test('role-specific reservation plus exact-head concurrency prevents duplicate Routine spend', () => {
  assert.match(review, /development-review-launch:r1:\$\{REQUEST_FINGERPRINT\}/);
  assert.match(review, /development-review-launch:r2:\$\{REQUEST_FINGERPRINT\}/);
  assert.match(review, /group: development-review-r1-/);
  assert.match(review, /group: development-review-r2-/);
  assert.match(review, /cancel-in-progress: false/);
  assert.match(review, /refusing duplicate Routine fire/);
  assert.match(review, /LAUNCH_UNCERTAIN/);
  assert.match(review, /automatic retry is blocked to avoid duplicate Routine sessions/);
  assert.match(review, /launch receipt only; R1 remains open/);
  assert.match(review, /launch receipt only; R2 remains open/);
  assert.doesNotMatch(review, /- status: \`RESERVED\`/);
});
