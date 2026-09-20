import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const escalation = await readFile(new URL('../.github/workflows/development-escalation-router.yml', import.meta.url), 'utf8');
const review = await readFile(new URL('../.github/workflows/development-review-router.yml', import.meta.url), 'utf8');
const automation = await readFile(new URL('../.github/workflows/development-review-automation.yml', import.meta.url), 'utf8');

test('Development Escalation Router calls review delivery only for deterministic required-review work', () => {
  assert.doesNotMatch(escalation, /actions: write/);
  assert.match(escalation, /needs\.route\.outputs\.disposition == 'DETERMINISTIC_ACTION'/);
  assert.match(escalation, /needs\.route\.outputs\.suggested_action == 'request_required_reviews'/);
  assert.match(escalation, /uses: ziyabeey1-ai\/randevu\/\.github\/workflows\/development-review-router\.yml@main/);
  assert.doesNotMatch(escalation, /uses: \.\/\.github\/workflows\/development-review-router\.yml/);
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

test('authoritative live fence runs before role exposure, reservation and API fire', () => {
  assert.match(review, /verify-development-review-live-state\.mjs/);
  assert.ok((review.match(/verify-development-review-live-state\.mjs/g) ?? []).length >= 5);
  assert.match(review, /actions: read/);
  assert.match(review, /r1-review-request\.json/);
  assert.match(review, /r2-review-request\.json/);
  assert.match(review, /r1-fire-aborted-stale/);
  assert.match(review, /r2-fire-aborted-stale/);
  assert.match(review, /LAUNCH_ABORTED_STALE/);
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

test('review automation and role jobs receive the same trusted reviewer allowlist', () => {
  assert.match(automation, /DEVELOPMENT_REVIEWER_ALLOWLIST: \$\{\{ vars\.DEVELOPMENT_REVIEWER_ALLOWLIST \}\}/);
  assert.ok((review.match(/DEVELOPMENT_REVIEWER_ALLOWLIST: \$\{\{ vars\.DEVELOPMENT_REVIEWER_ALLOWLIST \}\}/g) ?? []).length >= 3);
});

test('review mutation permissions are PR-scoped and reusable workflows are canonical-main pinned', () => {
  assert.match(automation, /issues: read[\s\S]*pull-requests: write[\s\S]*development-escalation-router\.yml@main/);
  assert.match(escalation, /issues: read[\s\S]*pull-requests: write[\s\S]*development-review-router\.yml@main/);
  const roleSections = [
    review.split('  r1:')[1]?.split('  r2:')[0] ?? '',
    review.split('  r2:')[1] ?? '',
  ];
  for (const section of roleSections) {
    assert.match(section, /issues: read/);
    assert.match(section, /pull-requests: write/);
  }
});

test('green CI and a later R0 receipt both re-evaluate the trusted Dispatcher route', () => {
  assert.match(automation, /workflow_run:/);
  assert.match(automation, /workflows: \[CI\]/);
  assert.match(automation, /pull_request_review:/);
  assert.match(automation, /types: \[submitted\]/);
  assert.match(automation, /prepare-development-review-observation\.mjs build/);
  assert.match(automation, /suggestedAction/);
  assert.match(automation, /action === 'request_required_reviews'/);
  assert.match(automation, /uses: ziyabeey1-ai\/randevu\/\.github\/workflows\/development-escalation-router\.yml@main/);
  assert.doesNotMatch(automation, /uses: \.\/\.github\/workflows\/development-escalation-router\.yml/);
});

test('automatic review delivery uses canonical main code and fails closed before secrets', () => {
  assert.match(automation, /Checkout canonical main automation[\s\S]*ref: main/);
  assert.match(automation, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(automation, /pulls\/\$\{PR_NUMBER\}/);
  assert.match(automation, /actions\/runs\/\$\{run_id\}\/attempts\/\$\{run_attempt\}\/jobs/);
  assert.match(automation, /needs\.prepare\.outputs\.should_route == 'true'/);
  assert.match(escalation, /actions\/checkout@v4[\s\S]*ref: main/);
  assert.ok((review.match(/ref: main/g) ?? []).length >= 3);
});
