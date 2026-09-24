#!/usr/bin/env node
// H19d çalıştırıcı (H19D-PROTOKOL v0.1 §9): dondurulmuş 80 vakada DE-JEV-H19-R0 v0.1'in altı eksen
// sorusu aynen; facts yok, yön yok. İki bağımsız önbelleksiz tur: V1 (birincil) ve V2 (kararlılık).
// 160 canlı çağrı. Skorlar ve analiz ayrı (analiz.mjs).
//
//   H19D_CASES_SHA256=<sha> NODE_USE_ENV_PROXY=1 node h19/h19d/calistir.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'jev-1.13.0';
const casesText = readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8');
const casesSha = createHash('sha256').update(casesText).digest('hex');
if (!process.env.H19D_CASES_SHA256) throw new Error('H19D_CASES_SHA256 gerekli (donmuş vaka dosyasının özeti)');
if (process.env.H19D_CASES_SHA256 !== casesSha) throw new Error(`vaka dosyası değişmiş: ${casesSha}`);
const { cases } = JSON.parse(casesText);
const bankText = readFileSync(path.join(here, '../kaynak/soru-bankasi.v0.1.json'), 'utf8');
const bank = JSON.parse(bankText);
const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const QUESTIONS = Object.fromEntries(bank.axes.map((axis) => [axis.id, { type: 'noul', instructions: axis.question, criteria: V01_CRITERIA }]));
const AXES = bank.axes.map((axis) => axis.id);

async function ask(state) {
  const started = performance.now();
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected'}` },
    body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }),
  });
  if (!res.ok) throw new Error(`TypeSafe ${res.status}`);
  const json = await res.json();
  if (json.model !== MODEL) throw new Error(`served ${json.model}`);
  return { json, latency_ms: Math.round(performance.now() - started) };
}

const out = path.join(here, 'sonuc', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
for (const run of ['V1', 'V2']) {
  const rows = [];
  for (let i = 0; i < cases.length; i += 8) {
    rows.push(...await Promise.all(cases.slice(i, i + 8).map(async (c) => {
      const state = { files: c.files };
      const { json, latency_ms } = await ask(state);
      return {
        case_id: c.case_id,
        model: json.model,
        question_bank: `${bank.id ?? 'DE-JEV-H19-AXIS'} ${bank.version ?? 'v0.1'}`,
        question_bank_sha256: createHash('sha256').update(bankText).digest('hex'),
        case_sha256: casesSha,
        input_digest: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
        axis_probabilities: Object.fromEntries(AXES.map((a) => [a, json.answers[a].noul])),
        input_tokens: json.usage?.input_tokens ?? 0,
        latency_ms,
      };
    })));
  }
  writeFileSync(path.join(out, `${run}.json`), `${JSON.stringify({ run, model: MODEL, cases_sha256: casesSha, rows }, null, 2)}\n`);
  process.stderr.write(`${run} ${rows.length} ok\n`);
}
console.log(out);
