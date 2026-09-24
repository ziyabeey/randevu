#!/usr/bin/env node
// H19s gölge çalıştırıcı (H19S-PROTOKOL-v0.2 §1, §4). PR/CI/merge kararına dokunmaz.
// Kohort `cikar.mjs` ile deterministik çıkarılır (v0.2 başlangıcından sonraki merge'ler, §3 stop rule).
// Her birim için:
//   V        : DE-JEV-H19-R0 v0.1 altı eksen `noul` sorusu aynen (H19u V1 ile aynı özet)
//   resolver : yalnız P(D5) >= .64 && P(D1) >= .64 ise H19U-RESOLVER v0.1 Choice aynen (yalnız diff)
//   route    : !high_D5 → hayır · !high_D1 → evet · aksi hâlde resolver ∈ {D5_ONLY, BOTH}
// Artımlıdır: çıktı dizinindeki kayıtlı birimler yeniden çağrılmaz. golge.jsonl, referans etiketler ve
// gözlenen actionable D5 eşlemesi commit'lenene kadar KAPALI tutulur (v0.2 §4–§6).
//
//   NODE_USE_ENV_PROXY=1 node h19/h19s/golge.mjs --out <dizin> [--dry-run]

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './cikar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const MODEL = 'jev-1.13.0';
const TAU = 0.64;
// v0.2 kohort başlangıcı: bütün v0.2 artifact'lerinden sonraki kayıt (START-v0.2.md, 159e74c).
export const V02_START = '159e74ca7dacb6acc7d28fd47377d8524be5dc27';

const bankText = readFileSync(path.join(here, '../kaynak/soru-bankasi.v0.1.json'), 'utf8');
const bank = JSON.parse(bankText);
const AXES = bank.axes.map((axis) => axis.id);
const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const V_QUESTIONS = Object.fromEntries(bank.axes.map((axis) => [axis.id, { type: 'noul', instructions: axis.question, criteria: V01_CRITERIA }]));
export const V_SHA = sha(bankText);

// H19u calistir.mjs ile birebir aynı (H19U-PROTOKOL §1 Aşama 2).
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
export const RESOLVER_SHA = sha(JSON.stringify(RESOLVER_QUESTION));

// Donmuş özetler H19u koşusundaki kayıtlarla aynı olmalı.
const H19U_RUN = path.join(here, '../h19u/sonuc/2026-09-24T11-58-13-607Z');
for (const [file, expected] of [['V1.json', V_SHA], ['R1.json', RESOLVER_SHA]]) {
  const recorded = JSON.parse(readFileSync(path.join(H19U_RUN, file), 'utf8')).rows[0].question_sha256;
  if (recorded !== expected) throw new Error(`${file} soru özeti H19u ile uyuşmuyor: ${expected} ≠ ${recorded}`);
}

export const route = (p, resolver) => (p.D5 < TAU ? false : p.D1 < TAU ? true : ['D5_ONLY', 'BOTH'].includes(resolver?.choice));

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
  return { json, latency_ms: Math.round(performance.now() - started), usage: json.usage ?? null };
}

async function shadow(unit, pr) {
  const state = { files: unit.files };
  const digest = sha(JSON.stringify(state));
  if (digest !== unit.input_digest) throw new Error(`girdi özeti uyuşmuyor: ${unit.unit_id}`);
  const v = await ask(state, V_QUESTIONS);
  const p = Object.fromEntries(AXES.map((a) => [a, v.json.answers[a].noul]));
  const ambiguous = p.D5 >= TAU && p.D1 >= TAU;
  const r = ambiguous ? await ask(state, { resolver: RESOLVER_QUESTION }) : null;
  const resolver = r ? r.json.answers.resolver : null;
  return {
    unit_id: unit.unit_id,
    pr: pr.pr,
    merge_sha: pr.merge_sha,
    path: unit.path,
    symbol: unit.symbol,
    change: unit.change,
    input_digest: digest,
    model: MODEL,
    v: { question: 'DE-JEV-H19-AXIS v0.1', question_sha256: V_SHA, axis_probabilities: p, usage: v.usage, latency_ms: v.latency_ms },
    ambiguous,
    resolver: r ? { question: 'H19U-RESOLVER v0.1', question_sha256: RESOLVER_SHA, ...resolver, usage: r.usage, latency_ms: r.latency_ms } : null,
    candidate_route: route(p, resolver),
    shadowed_at: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const out = arg('--out');
  if (!out) throw new Error('--out <dizin> gerekli');
  const after = arg('--after') ?? V02_START; // --after yalnız kalibrasyon/deneme içindir
  mkdirSync(out, { recursive: true });
  const cohort = collect(arg('--ref') ?? 'origin/main', after, { stop: true });
  // Kohort dosyası H19 çıktısı içermez; okuyucu paketleri bundan üretilir.
  writeFileSync(path.join(out, 'kohort.json'), `${JSON.stringify(cohort, null, 2)}\n`);
  const ledger = path.join(out, 'golge.jsonl');
  const done = new Map(existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.unit_id, r.input_digest])
    : []);
  const pending = cohort.prs.flatMap((pr) => pr.units.map((unit) => ({ unit, pr })))
    .filter(({ unit }) => {
      if (!done.has(unit.unit_id)) return true;
      if (done.get(unit.unit_id) !== unit.input_digest) throw new Error(`kayıtlı birimin girdisi değişmiş: ${unit.unit_id}`);
      return false;
    });
  process.stderr.write(`kohort: ${cohort.prs_with_units} birimli PR / ${cohort.units} birim · stop rule ${cohort.stop_rule_met ? 'sağlandı' : 'henüz değil'} · bekleyen ${pending.length}\n`);
  if (!process.argv.includes('--dry-run')) {
    for (let i = 0; i < pending.length; i += 8) {
      const rows = await Promise.all(pending.slice(i, i + 8).map(({ unit, pr }) => shadow(unit, pr)));
      for (const row of rows) appendFileSync(ledger, `${JSON.stringify(row)}\n`);
    }
    process.stderr.write(`gölge: ${pending.length} birim yazıldı (sonuçlar kapalı tutulur)\n`);
  }
}
