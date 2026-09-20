import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCi } from '../scripts/ci-observer.mjs';
import { deriveDispatcherResult } from '../scripts/development-dispatcher.mjs';
const head = 'a'.repeat(40), main = 'b'.repeat(40);
function input(conclusion = 'failure') {
  const pr = { number: 200, state: 'open', head: { sha: head, ref: 'feature', repo: { full_name: 'owner/repo' } },
    base: { sha: main, repo: { full_name: 'owner/repo' } }, html_url: 'https://github.com/owner/repo/pull/200' };
  return { repository: 'owner/repo', pr, finalPr: structuredClone(pr), mainSha: main, finalMainSha: main,
    run: { id: 42, run_attempt: 2, head_sha: head, path: '.github/workflows/ci.yml', status: 'completed',
      event: 'pull_request', conclusion, repository: { full_name: 'owner/repo' },
      head_repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 200 }] },
    jobs: [{ id: 91, run_id: 42, run_attempt: 2, head_sha: head, name: 'CI gate', status: 'completed' }] };
}
test('observer delegates every CI conclusion and preserves unknown provenance', () => {
  for (const state of ['success', 'failure', 'cancelled', 'skipped', 'timed_out']) {
    const out = observeCi(input(state));
    assert.deepEqual(out.dispatcher, deriveDispatcherResult(out.observation));
    assert.equal(out.observation.ci.testedCheckoutSha, null);
    assert.equal(out.observation.ci.baseMainSha, null);
    assert.equal(out.dispatcher.recommendation.suggestedAction, 'confirm_writer_state');
    assert.notEqual(out.disposition.disposition, 'REASONING_REQUIRED');
  }
});
test('head movement is routed by Dispatcher and stale CI is never repair authority', () => {
  const i = input(); i.finalPr.head.sha = 'c'.repeat(40);
  assert.equal(observeCi(i).dispatcher.recommendation.suggestedAction, 'refresh_snapshot');
  const stale = input(); stale.run.head_sha = 'd'.repeat(40); stale.jobs[0].head_sha = 'd'.repeat(40);
  assert.equal(observeCi(stale).dispatcher.state.ci.headApplicability, 'stale');
});
test('wrong repo, workflow, PR, run, attempt or ambiguous gate cannot produce a receipt', () => {
  const corruptions = [
    (i) => i.run.head_repository.full_name = 'fork/repo',
    (i) => i.run.path = '.github/workflows/other.yml',
    (i) => i.run.pull_requests = [{ number: 201 }],
    (i) => i.jobs[0].run_id = 9,
    (i) => i.jobs[0].run_attempt = 1,
    (i) => i.jobs[0].head_sha = 'e'.repeat(40),
    (i) => i.jobs.push({ ...i.jobs[0] }),
    (i) => i.finalPr.base.sha = 'c'.repeat(40),
  ];
  for (const corrupt of corruptions) { const i = input(); corrupt(i); assert.throws(() => observeCi(i)); }
});
