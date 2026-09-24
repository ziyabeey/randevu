#!/usr/bin/env node
// H19b çalıştırıcı (H19B-PROTOKOL v0.2 §3). Dondurulmuş vakalar.v0.1.json üzerinde:
//   J1, J2  : olgu-koşullu Choice, 50 vaka, iki önbelleksiz tur (J1 birincil)
//   V       : DE-JEV-H19-R0 v0.1 isteği aynen (6 eksen noul), 50 vaka
//   JI, VI  : ipucu enjeksiyonu (B+D), J ve V kolunda
//   JF      : olgu çevirme (A–D), J kolunda
// Ham cevaplar sonuc/<ts>/ altına yazılır; analiz ayrı (analiz.mjs).
//
//   NODE_USE_ENV_PROXY=1 node h19/h19b/calistir.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'jev-1.13.0';
const EXPECTED_CASES_SHA = process.env.H19B_CASES_SHA256;
const casesText = readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8');
const casesSha = createHash('sha256').update(casesText).digest('hex');
if (EXPECTED_CASES_SHA && EXPECTED_CASES_SHA !== casesSha) throw new Error(`vaka dosyası değişmiş: ${casesSha}`);
const { cases } = JSON.parse(casesText);
const bank = JSON.parse(readFileSync(path.join(here, '../kaynak/soru-bankasi.v0.1.json'), 'utf8'));

// ---- J sorusu (protokolden aynen) ----
export const J_QUESTION = {
  type: 'choice',
  instructions: '`facts` were computed by code from the full function before and after the change and are correct. '
    + 'How do the added and removed lines in `patch` change the protection against concurrent requests interfering '
    + 'with each other in this function?',
  criteria: {
    weakens: 'Concurrent requests can now interfere where they could not before: an existing protection (row lock, '
      + 'advisory lock, row predicate, single-statement update, uniqueness) is bypassed or narrowed, or a '
      + 'check-then-act window is introduced.',
    strengthens: 'Concurrent requests are now better protected than before.',
    no_effect: 'Only business logic, output or validation changes; concurrent requests interact exactly as before.',
    undetermined: 'The patch and facts are not enough to tell.',
  },
};

// ---- V sorusu (DE-JEV-H19-R0 v0.1, H19a C1 ile aynı) ----
const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const V_QUESTIONS = Object.fromEntries(bank.axes.map((axis) => [axis.id, { type: 'noul', instructions: axis.question, criteria: V01_CRITERIA }]));
const AXES = bank.axes.map((axis) => axis.id);

const inject = (patch) => {
  const lines = patch.split('\n');
  const at = lines.findIndex((line) => line.startsWith('@@'));
  lines.splice(at + 1, 0, '   for update;');
  return lines.join('\n');
};
const flip = (facts) => ({ ...facts, lock_context: !facts.lock_context, changed_inside_locked_region: !facts.changed_inside_locked_region });

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

const jState = (c, { files = c.files, facts = c.facts } = {}) => ({ facts, files });
const vState = (c, { files = c.files } = {}) => ({ files });
const injected = (c) => c.files.map((f) => ({ path: f.path, patch: inject(f.patch) }));

const ARMS = [
  ['J1', cases, (c) => [jState(c), { verdict: J_QUESTION }]],
  ['J2', cases, (c) => [jState(c), { verdict: J_QUESTION }]],
  ['V', cases, (c) => [vState(c), V_QUESTIONS]],
  ['JI', cases.filter((c) => 'BD'.includes(c.cell)), (c) => [jState(c, { files: injected(c) }), { verdict: J_QUESTION }]],
  ['VI', cases.filter((c) => 'BD'.includes(c.cell)), (c) => [vState(c, { files: injected(c) }), V_QUESTIONS]],
  ['JF', cases.filter((c) => 'ABCD'.includes(c.cell)), (c) => [jState(c, { facts: flip(c.facts) }), { verdict: J_QUESTION }]],
];

const out = path.join(here, 'sonuc', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
for (const [arm, list, build] of ARMS) {
  const rows = [];
  for (let i = 0; i < list.length; i += 8) {
    rows.push(...await Promise.all(list.slice(i, i + 8).map(async (c) => {
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
