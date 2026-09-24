#!/usr/bin/env node
// H19b′ çalıştırıcı (H19B-PRIME-PROTOKOL v0.1 §5). Dondurulmuş vakalar.v0.1.json üzerinde:
//   JF1, JF2 : facts + directional Choice (JF1 birincil, JF2 önbelleksiz kararlılık turu)
//   J0       : aynı Choice, facts yok (instructions'tan yalnız ilk facts cümlesi çıkarılır)
//   V        : DE-JEV-H19-R0 v0.1 6-eksen noul isteği aynen
// 64 vaka × 4 kol = 256 canlı çağrı. Analiz ayrı (analiz.mjs).
//
//   H19BP_CASES_SHA256=<sha> NODE_USE_ENV_PROXY=1 node h19/h19b-prime/calistir.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'jev-1.13.0';
const casesText = readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8');
const casesSha = createHash('sha256').update(casesText).digest('hex');
if (!process.env.H19BP_CASES_SHA256) throw new Error('H19BP_CASES_SHA256 gerekli (donmuş vaka dosyasının özeti)');
if (process.env.H19BP_CASES_SHA256 !== casesSha) throw new Error(`vaka dosyası değişmiş: ${casesSha}`);
const { cases } = JSON.parse(casesText);
const bank = JSON.parse(readFileSync(path.join(here, '../kaynak/soru-bankasi.v0.1.json'), 'utf8'));

const FACTS_SENTENCE = '`facts` were computed by code from the full function before and after the change and are correct. ';
const CORE_INSTRUCTIONS = 'How do the added and removed lines in `patch` change the protection against concurrent requests '
  + 'interfering with each other in this function?';
const CRITERIA = {
  weakens: 'Concurrent requests can now interfere where they could not before: an existing protection (row lock, '
    + 'advisory lock, row predicate, single-statement update, uniqueness) is bypassed or narrowed, or a '
    + 'check-then-act window is introduced.',
  strengthens: 'Concurrent requests are now better protected than before.',
  no_effect: 'Only business logic, output or validation changes; concurrent requests interact exactly as before.',
  undetermined: 'The patch and facts are not enough to tell.',
};
export const JF_QUESTION = { type: 'choice', instructions: FACTS_SENTENCE + CORE_INSTRUCTIONS, criteria: CRITERIA };
export const J0_QUESTION = { type: 'choice', instructions: CORE_INSTRUCTIONS, criteria: CRITERIA };

const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const V_QUESTIONS = Object.fromEntries(bank.axes.map((axis) => [axis.id, { type: 'noul', instructions: axis.question, criteria: V01_CRITERIA }]));
const AXES = bank.axes.map((axis) => axis.id);

async function ask(state, questions) {
  const started = performance.now();
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected'}` },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if (!res.ok) throw new Error(`TypeSafe ${res.status}`);
  const json = await res.json();
  if (json.model !== MODEL) throw new Error(`served ${json.model}`);
  return { answers: json.answers, input_tokens: json.usage?.input_tokens ?? 0, latency_ms: Math.round(performance.now() - started) };
}

const ARMS = [
  ['JF1', (c) => [{ facts: c.facts, files: c.files }, { verdict: JF_QUESTION }]],
  ['JF2', (c) => [{ facts: c.facts, files: c.files }, { verdict: JF_QUESTION }]],
  ['J0', (c) => [{ files: c.files }, { verdict: J0_QUESTION }]],
  ['V', (c) => [{ files: c.files }, V_QUESTIONS]],
];

const out = path.join(here, 'sonuc', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
for (const [arm, build] of ARMS) {
  const rows = [];
  for (let i = 0; i < cases.length; i += 8) {
    rows.push(...await Promise.all(cases.slice(i, i + 8).map(async (c) => {
      const [state, questions] = build(c);
      const answer = await ask(state, questions);
      const row = { case_id: c.case_id, input_digest: createHash('sha256').update(JSON.stringify(state)).digest('hex'), input_tokens: answer.input_tokens, latency_ms: answer.latency_ms };
      if (questions.verdict) row.verdict = answer.answers.verdict;
      else row.axis_probabilities = Object.fromEntries(AXES.map((a) => [a, answer.answers[a].noul]));
      return row;
    })));
  }
  writeFileSync(path.join(out, `${arm}.json`), `${JSON.stringify({ arm, model: MODEL, cases_sha256: casesSha, rows }, null, 2)}\n`);
  process.stderr.write(`${arm} ${rows.length} ok\n`);
}
console.log(out);
