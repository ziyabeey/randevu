import { deriveDispatcherResult } from './development-dispatcher.mjs';
import { classifyEscalationDisposition } from './development-escalation-envelope.mjs';

const sha = /^[a-f0-9]{40}$/;
// This adapter observes. It cannot infer task assignment, CI checkout/base binding,
// review requirements or repair causality from a workflow conclusion.
export function observeCi({ repository, pr, run, jobs, mainSha, finalPr, finalMainSha }) {
  if (run?.repository?.full_name !== repository || run?.head_repository?.full_name !== repository
      || pr?.head?.repo?.full_name !== repository || pr?.base?.repo?.full_name !== repository
      || pr.state !== 'open' || !Number.isSafeInteger(pr.number)
      || run.path !== '.github/workflows/ci.yml' || run.event !== 'pull_request' || run.status !== 'completed'
      || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
      || !sha.test(run.head_sha ?? '') || !sha.test(pr.head.sha ?? '') || !sha.test(pr.base.sha ?? '')
      || !sha.test(mainSha ?? '') || !sha.test(finalMainSha ?? '')
      || finalPr?.number !== pr.number || finalPr.state !== 'open' || !sha.test(finalPr.head?.sha ?? '')
      || !run.pull_requests?.some((item) => item.number === pr.number)
      || !Array.isArray(jobs)) throw new Error('Untrusted or incomplete CI observation');
  const gates = jobs.filter((job) => job.name === 'CI gate');
  if (gates.length !== 1) throw new Error('Expected one authoritative CI gate');
  const gate = gates[0];
  if (gate.run_id !== run.id || gate.run_attempt !== run.run_attempt || gate.head_sha !== run.head_sha
      || !Number.isSafeInteger(gate.id) || gate.status !== 'completed') throw new Error('Job/run/attempt identity mismatch');
  if (finalPr.base?.sha !== pr.base.sha) throw new Error('Base changed during observation');
  const status = { success: 'pass', failure: 'fail', cancelled: 'cancelled', skipped: 'skipped' }[run.conclusion] ?? 'unknown';
  const observation = {
    task: {},
    candidate: { presence: 'active', prNumber: pr.number, branch: pr.head.ref,
      headSha: pr.head.sha, baseMainSha: pr.base.sha },
    observation: { observedHeadSha: pr.head.sha, liveHeadSha: finalPr.head.sha,
      observedMainSha: mainSha, liveMainSha: finalMainSha },
    ci: { status, exactHeadSha: run.head_sha, run: String(run.id), job: String(gate.id), attempt: run.run_attempt,
      // workflow_run.head_sha is the source SHA, not proof of the actual merge checkout.
      testedCheckoutSha: null, baseMainSha: null, explicitlyBoundToHead: false },
    sourceRefs: [run.html_url, pr.html_url, gate.html_url].filter(Boolean),
  };
  const dispatcher = deriveDispatcherResult(observation);
  return { schema: 'development-ci-observation.v1', observation, dispatcher,
    disposition: classifyEscalationDisposition(dispatcher),
    limits: ['Task assignment/writer/dependencies require canonical coordinator evidence.',
      'Tested checkout and tested base are unknown until a candidate-bound CI receipt supplies them.',
      'CI failure does not imply candidate causality. No repair, model call or review is dispatched.'] };
}
