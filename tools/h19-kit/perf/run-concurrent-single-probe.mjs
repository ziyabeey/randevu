#!/usr/bin/env node
// FANOUT-003 — exploratory follow-up to FANOUT-001/002 (not pre-registered).
// Question: can per-case requests (each case its own state, the M8 single-case shape) recover the fan-out
// latency win through concurrency, while keeping answers bound to their case?
// Concurrency 1/5/10/20 × 2 repeats over the FANOUT-001 cases (72 requests).
//
//   node perf/run-concurrent-single-probe.mjs --proxy-injected-key --out perf/baselines/FANOUT-003.<env>.json

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { JEV_RELATIONAL_MODEL, RELATION_CHOICE_DOMAIN, TYPESAFE_SYSTEMONE_URL, normalizeRelationProbabilities } from '../src/adapters/jev-relational.mjs';
import { RELATION_DIRECTION_QUESTION, relationalJevState } from '../src/relations/relational-evidence.mjs';
import { buildCaseSet } from './run-fanout-characterization.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const apiKey = process.env.TYPESAFE_API_KEY?.trim() || (process.argv.includes('--proxy-injected-key') ? 'proxy-injected' : '');
if (!apiKey) throw new Error('TYPESAFE_API_KEY or --proxy-injected-key required');

const { batch, relationalCases } = buildCaseSet();
const cases = batch.cases.map((s) => relationalCases.find((c) => c.caseSha256 === s.caseSha256));
const D = RELATION_CHOICE_DOMAIN;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function askOne(relationalCase) {
  const started = performance.now();
  const response = await fetch(TYPESAFE_SYSTEMONE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: JEV_RELATIONAL_MODEL,
      state: relationalJevState(relationalCase),
      questions: { relation: { type: RELATION_DIRECTION_QUESTION.type, instructions: RELATION_DIRECTION_QUESTION.instructions, criteria: structuredClone(RELATION_DIRECTION_QUESTION.criteria) } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await response.json().catch(() => null);
  return {
    caseSha256: relationalCase.caseSha256,
    status: response.status,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: json?.usage?.input_tokens ?? null,
    probabilities: response.ok && json?.model === JEV_RELATIONAL_MODEL ? normalizeRelationProbabilities(json.answers?.relation?.probabilities) : null,
  };
}

const lanes = [];
for (let repeat = 1; repeat <= 2; repeat += 1) {
  for (const concurrency of [1, 5, 10, 20]) {
    const subset = cases.slice(0, concurrency);
    const started = performance.now();
    const answers = await Promise.all(subset.map(askOne));
    const wallMs = Math.round(performance.now() - started);
    lanes.push({
      concurrency,
      repeat,
      wallMs,
      medianRequestLatencyMs: median(answers.map((a) => a.latencyMs)),
      statuses: [...new Set(answers.map((a) => a.status))],
      valid: answers.filter((a) => a.probabilities).length,
      inputTokens: answers.reduce((s, a) => s + (a.inputTokens ?? 0), 0),
      answers,
    });
    process.stderr.write(`concurrency ${concurrency} r${repeat}: wall ${wallMs} ms, valid ${answers.filter((a) => a.probabilities).length}/${concurrency}, statuses ${[...new Set(answers.map((a) => a.status))]}\n`);
  }
}
const l1 = (a, b) => D.reduce((s, c) => s + Math.abs(a[c] - b[c]), 0) / D.length;
const argmax = (p) => D.reduce((b, c) => (p[c] > p[b] ? c : b), D[0]);
const full = lanes.filter((l) => l.concurrency === 20).map((l) => Object.fromEntries(l.answers.map((a) => [a.caseSha256, a.probabilities])));
const ids = Object.keys(full[0]).filter((id) => full[0][id] && full[1][id]);
const report = {
  id: 'FANOUT-003',
  status: 'exploratory follow-up to FANOUT-001/002; not pre-registered',
  model: JEV_RELATIONAL_MODEL,
  environment: arg('--env') ?? 'unspecified',
  caseSetSha256: batch.batchSha256,
  providerRequests: lanes.reduce((s, l) => s + l.concurrency, 0),
  summary: lanes.map(({ answers: _a, ...rest }) => rest),
  concurrent20RepeatAgreement: {
    n: ids.length,
    meanAbsDelta: ids.reduce((s, id) => s + l1(full[0][id], full[1][id]), 0) / ids.length,
    argmaxAgreement: ids.filter((id) => argmax(full[0][id]) === argmax(full[1][id])).length / ids.length,
  },
  lanes,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
const out = arg('--out');
if (out) {
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), json);
}
process.stdout.write(`${JSON.stringify({ summary: report.summary, concurrent20RepeatAgreement: report.concurrent20RepeatAgreement }, null, 2)}\n`);
