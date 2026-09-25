#!/usr/bin/env node
// FANOUT-002 — exploratory follow-up to FANOUT-001 (not pre-registered).
// Question: in a 20-question shared state, does each answer follow its case or its position?
// The same 20 FANOUT-001 cases are sent in batch order twice and in reversed order twice (4 requests).
//
//   node perf/run-fanout-binding-probe.mjs --proxy-injected-key --out perf/baselines/FANOUT-002.<env>.json

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { JEV_RELATIONAL_MODEL, RELATION_CHOICE_DOMAIN, TYPESAFE_SYSTEMONE_URL, normalizeRelationProbabilities } from '../src/adapters/jev-relational.mjs';
import { buildRelationalFanoutRequest } from '../src/relations/relational-judgment-batch.mjs';
import { buildCaseSet } from './run-fanout-characterization.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const apiKey = process.env.TYPESAFE_API_KEY?.trim() || (process.argv.includes('--proxy-injected-key') ? 'proxy-injected' : '');
if (!apiKey) throw new Error('TYPESAFE_API_KEY or --proxy-injected-key required');

const { batch, relationalCases } = buildCaseSet();
const forward = batch.cases.map((s) => relationalCases.find((c) => c.caseSha256 === s.caseSha256));
const reversed = [...forward].reverse();

async function ask(order) {
  const request = buildRelationalFanoutRequest({ model: JEV_RELATIONAL_MODEL, selected: order.map((relationalCase) => ({ relationalCase })) });
  const response = await fetch(TYPESAFE_SYSTEMONE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await response.json();
  if (!response.ok || json.model !== JEV_RELATIONAL_MODEL) throw new Error(`request failed: ${response.status}`);
  const ids = Object.keys(request.questions);
  // position i → { caseSha256, probabilities }
  return ids.map((id, i) => ({ caseSha256: order[i].caseSha256, probabilities: normalizeRelationProbabilities(json.answers[id]?.probabilities) }));
}

const D = RELATION_CHOICE_DOMAIN;
const l1 = (a, b) => D.reduce((s, c) => s + Math.abs(a[c] - b[c]), 0) / D.length;
const argmax = (p) => D.reduce((b, c) => (p[c] > p[b] ? c : b), D[0]);
const summarize = (pairs) => ({
  n: pairs.length,
  meanAbsDelta: pairs.reduce((s, [a, b]) => s + l1(a, b), 0) / pairs.length,
  argmaxAgreement: pairs.filter(([a, b]) => argmax(a) === argmax(b)).length / pairs.length,
});

const runs = { forward: [await ask(forward), await ask(forward)], reversed: [await ask(reversed), await ask(reversed)] };
const byCase = (answers) => Object.fromEntries(answers.map((a) => [a.caseSha256, a.probabilities]));
const n = forward.length;
const report = {
  id: 'FANOUT-002',
  status: 'exploratory follow-up to FANOUT-001; not pre-registered',
  model: JEV_RELATIONAL_MODEL,
  environment: arg('--env') ?? 'unspecified',
  caseSetSha256: batch.batchSha256,
  providerRequests: 4,
  comparisons: {
    // Noise floor: same order, same case, same position.
    forwardVsForward: summarize(runs.forward[0].map((a, i) => [a.probabilities, runs.forward[1][i].probabilities])),
    reversedVsReversed: summarize(runs.reversed[0].map((a, i) => [a.probabilities, runs.reversed[1][i].probabilities])),
    // Same case, different position.
    sameCaseAcrossOrders: summarize(forward.map((c) => [byCase(runs.forward[0])[c.caseSha256], byCase(runs.reversed[0])[c.caseSha256]])),
    // Same position, different case.
    samePositionAcrossOrders: summarize(runs.forward[0].map((a, i) => [a.probabilities, runs.reversed[0][i].probabilities])),
  },
  runs,
};
if (report.comparisons.forwardVsForward.n !== n) throw new Error('incomplete answers');
const json = `${JSON.stringify(report, null, 2)}\n`;
const out = arg('--out');
if (out) {
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), json);
}
process.stdout.write(`${JSON.stringify(report.comparisons, null, 2)}\n`);
