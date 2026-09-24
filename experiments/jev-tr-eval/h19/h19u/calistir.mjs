#!/usr/bin/env node
// H19u çalıştırıcı (H19U-PROTOKOL v0.1 §5). Dondurulmuş 80 vakada:
//   V1     : DE-JEV-H19-R0 v0.1'in altı eksen `noul` sorusu aynen (facts yok, direction yok)
//   R1, R2 : §1 Aşama 2 D1/D5 ayrıştırıcı Choice; yalnız aynı diff, V skoru/bayrak/facts YOK
// R1/R2 bütün vakalarda çalışır; bileşik router yalnız belirsiz mahallede R1'i kullanır (analiz.mjs).
// 80 × 3 = 240 canlı çağrı.
//
//   H19U_CASES_SHA256=<sha> NODE_USE_ENV_PROXY=1 node h19/h19u/calistir.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'jev-1.13.0';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const casesText = readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8');
const casesSha = sha(casesText);
if (!process.env.H19U_CASES_SHA256) throw new Error('H19U_CASES_SHA256 gerekli (donmuş vaka dosyasının özeti)');
if (process.env.H19U_CASES_SHA256 !== casesSha) throw new Error(`vaka dosyası değişmiş: ${casesSha}`);
const { cases } = JSON.parse(casesText);
const bankText = readFileSync(path.join(here, '../kaynak/soru-bankasi.v0.1.json'), 'utf8');
const bank = JSON.parse(bankText);

const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const V_QUESTIONS = Object.fromEntries(bank.axes.map((axis) => [axis.id, { type: 'noul', instructions: axis.question, criteria: V01_CRITERIA }]));
const AXES = bank.axes.map((axis) => axis.id);

// §1 Aşama 2, protokoldeki metin aynen (satır sonları boşlukla birleştirildi).
const RESOLVER_QUESTION = {
  type: 'choice',
  instructions: 'Which description best matches the behavioral effect of the added and removed lines?',
  criteria: {
    D1_ONLY: 'The change materially affects idempotency, command identity, replay/receipt semantics, request identity, '
      + 'or duplicate-command handling, but does not materially change concurrency, optimistic-version, locking, '
      + 'serialization, or race-sensitive behavior.',
    D5_ONLY: 'The change materially affects concurrency, optimistic-version, locking, serialization, stale-write '
      + 'protection, or race-sensitive behavior, but does not materially change idempotency/command identity.',
    BOTH: 'The change materially affects both the D1 family (idempotency/command identity/replay) and the D5 family '
      + '(concurrency/version/locking/serialization).',
    NEITHER_OR_OTHER: 'It affects neither family materially, or the supplied diff is insufficient to determine either.',
  },
};
const RESOLVER_SHA = sha(JSON.stringify(RESOLVER_QUESTION));

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
  return { json, latency_ms: Math.round(performance.now() - started) };
}

const RUNS = [
  ['V1', V_QUESTIONS, 'DE-JEV-H19-AXIS v0.1', sha(bankText)],
  ['R1', { resolver: RESOLVER_QUESTION }, 'H19U-RESOLVER v0.1', RESOLVER_SHA],
  ['R2', { resolver: RESOLVER_QUESTION }, 'H19U-RESOLVER v0.1', RESOLVER_SHA],
];

const out = path.join(here, 'sonuc', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
for (const [run, questions, questionId, questionSha] of RUNS) {
  const rows = [];
  for (let i = 0; i < cases.length; i += 8) {
    rows.push(...await Promise.all(cases.slice(i, i + 8).map(async (c) => {
      const state = { files: c.files };
      const { json, latency_ms } = await ask(state, questions);
      const row = {
        case_id: c.case_id,
        model: json.model,
        question: questionId,
        question_sha256: questionSha,
        case_sha256: casesSha,
        input_digest: sha(JSON.stringify(state)),
        input_tokens: json.usage?.input_tokens ?? 0,
        latency_ms,
      };
      if (questions.resolver) row.resolver = json.answers.resolver;
      else row.axis_probabilities = Object.fromEntries(AXES.map((a) => [a, json.answers[a].noul]));
      return row;
    })));
  }
  writeFileSync(path.join(out, `${run}.json`), `${JSON.stringify({ run, model: MODEL, cases_sha256: casesSha, rows }, null, 2)}\n`);
  process.stderr.write(`${run} ${rows.length} ok\n`);
}
console.log(out);
