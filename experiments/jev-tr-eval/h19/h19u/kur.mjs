#!/usr/bin/env node
// H19u vaka setini kurar, protokol §2–§3'e göre doğrular ve ancak bütün kapılar geçerse dondurur:
// vakalar.mjs → vakalar.v0.1.json. Betimleyici alanlar hesaplanır ama Jev girdisine VERİLMEZ.
// Jev çağrısı YAPMAZ.
//
//   node h19/h19u/kur.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASES as H19B } from '../h19b/vakalar.mjs';
import { CASES as H19BP } from '../h19b-prime/vakalar.mjs';
import { CASES as H19D } from '../h19d/vakalar.mjs';
import { CASES as H19T } from '../h19t/vakalar.mjs';
import { CASES } from './vakalar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
// H19U-PROTOKOL §3 ipucu sözlüğü (H19a sözlüğü + D1 kelimeleri); yol dahil diff metninde aranır.
const CUE = /for update|lock|version|advisory|serializ|idempoten|request_hash|receipt|replay/i;
const LOCK = /\bfor\s+update\b|\bfor\s+no\s+key\s+update\b|\bpg_advisory_xact_lock\b|\bpg_advisory_lock\b|\bskip\s+locked\b/i;
const LEAK = [/\bH19\b/i, /EXP-H19/i, /exp\/h19/i, /\bD[0-5]\s*[x×]\s*D[0-5]\b/i];
const tmp = mkdtempSync(path.join(tmpdir(), 'h19u-'));
export const auc = (pos, neg) => {
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
};

// ../h19b/extractor.mjs'deki functionBodies'in genişletilmiş kopyası (o dosya H19b için dondurulmuş):
// `create function` (or replace olmadan), `core.` şeması ve rakam içeren $etiket$'ler de okunur.
// Dosyada aynı ad birden çok kez tanımlıysa son tanım geçerlidir.
function functionBodies(sql) {
  const out = new Map();
  const re = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const tag = /as\s+(\$[a-z0-9_]*\$)/i.exec(sql.slice(m.index));
    if (!tag) continue;
    const start = m.index + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], start);
    if (end < 0) continue;
    out.set(m[1].toLowerCase(), { start, end, body: sql.slice(start, end) });
  }
  return out;
}
const qualified = (fn) => (fn.includes('.') ? fn : `public.${fn}`);

function gitDiff(before, after) {
  const a = path.join(tmp, 'a.sql');
  const b = path.join(tmp, 'b.sql');
  writeFileSync(a, before);
  writeFileSync(b, after);
  let out = '';
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { encoding: 'utf8' });
  } catch (error) {
    out = error.stdout;
  }
  const lines = out.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('@@'))).join('\n').replace(/\n+$/, '');
}

// Önceki setlerde kullanılmış fonksiyon tanımları ve mutasyonlar (tekrar yasağı, protokol §2):
// - H19b, H19b′, H19d, H19t: fonksiyon + bul + değiştir üçlüsü;
// - R0/H19a, H19b, H19b′, H19d, H19t: donmuş girdilerdeki değişen satır kümesi.
const PRIOR = [...H19B, ...H19BP, ...H19D, ...H19T];
const priorUse = new Set(PRIOR.map((c) => `${c.file}|${qualified(c.fn)}`));
const priorMutations = new Set(PRIOR.flatMap((c) => c.mutations.map((m) => `${qualified(c.fn)}|${m.find}|${m.replace}`)));
const changedSet = (patch) => patch.split('\n').filter((l) => /^[+-]/.test(l)).map((l) => l.trim()).sort().join('\n');
const priorInputs = [
  ['R0', '../kaynak/h19-axis-inputs.v0.1.json'],
  ['H19b', '../h19b/vakalar.v0.1.json'],
  ['H19b′', '../h19b-prime/vakalar.v0.1.json'],
  ['H19d', '../h19d/vakalar.v0.1.json'],
  ['H19t', '../h19t/vakalar.v0.1.json'],
];
const priorChanged = new Map();
for (const [name, file] of priorInputs) {
  for (const c of JSON.parse(readFileSync(path.join(here, file), 'utf8')).cases) {
    for (const f of c.files) priorChanged.set(changedSet(f.patch), `${name} ${c.case_id}`);
  }
}

const LABEL = { A: 'D1_ONLY', B: 'D5_ONLY', C: 'BOTH', D: 'NEITHER_OR_OTHER' };
const errors = [];
const built = [];
const seenFns = new Set();
const seenChanged = new Map();
for (const spec of CASES) {
  const fail = (message) => errors.push(`${spec.id}: ${message}`);
  const rel = `supabase/migrations/${spec.file}`;
  const sql = readFileSync(path.join(repo, rel), 'utf8');
  const name = qualified(spec.fn);
  const fn = functionBodies(sql).get(name);
  if (!fn) { fail(`fonksiyon yok ${name}`); continue; }
  let body = fn.body;
  let applied = true;
  for (const { find, replace } of spec.mutations) {
    const count = body.split(find).length - 1;
    if (count !== 1) { fail(`mutasyon ${count} kez eşleşti: ${find.slice(0, 80).replace(/\n/g, '⏎')}`); applied = false; continue; }
    body = body.replace(find, () => replace);
    if (priorMutations.has(`${name}|${find}|${replace}`)) fail('önceki setten mutasyon tekrarı');
  }
  if (!applied) continue;
  const patch = gitDiff(sql, sql.slice(0, fn.start) + body + sql.slice(fn.end));
  if (!patch.startsWith('@@')) { fail('diff üretilmedi'); continue; }
  const changed = changedSet(patch);
  if (priorChanged.has(changed)) fail(`önceki girdiyle aynı değişiklik (${priorChanged.get(changed)})`);
  if (seenChanged.has(changed)) fail(`bu sette tekrar (${seenChanged.get(changed)})`);
  seenChanged.set(changed, spec.id);
  const files = [{ path: rel, patch }];
  const text = JSON.stringify(files);
  const leak = LEAK.find((p) => p.test(text));
  if (leak) fail(`sızıntı ${leak}`);
  const lines = patch.split('\n');
  const added = lines.filter((l) => l.startsWith('+'));
  const removed = lines.filter((l) => l.startsWith('-'));
  const key = `${spec.file}|${name}`;
  built.push({
    case_id: spec.id,
    layer: spec.layer,
    label: LABEL[spec.layer],
    d1: spec.layer === 'A' || spec.layer === 'C',
    d5: spec.layer === 'B' || spec.layer === 'C',
    axes: spec.axes ?? [],
    direction: spec.direction ?? null,
    family: spec.family,
    family_group: spec.group ?? null,
    function_family: spec.fnFamily,
    function_reused: priorUse.has(key) || seenFns.has(key),
    rationale: spec.rationale,
    source: { file: rel, function: name },
    files,
    input_digest: sha(text),
    descriptive: {
      lock_context: LOCK.test(fn.body),
      cue: CUE.test(text),
      added: added.length,
      removed: removed.length,
      changed: added.length + removed.length,
      removed_where_and: removed.filter((l) => /^-\s*(and|where)\b/i.test(l)).length,
      added_exists_select: added.filter((l) => /\b(exists|select)\b/i.test(l)).length,
      removed_predicate: removed.some((l) => /^-\s*(and|where)\b/i.test(l)) ? 1 : 0,
    },
  });
  seenFns.add(key);
}

// ---- matris (protokol §2) ----
const layer = (name) => built.filter((c) => c.layer === name);
for (const name of ['A', 'B', 'C', 'D']) if (layer(name).length !== 20) errors.push(`${name}: ${layer(name).length} vaka (20 olmalı)`);
const receiptFamily = layer('A').filter((c) => c.family_group === 'receipt_hash_replay').length;
if (receiptFamily < 8) errors.push(`A: receipt/request-hash/replay ailesi ${receiptFamily} (en az 8)`);
if (new Set(layer('A').filter((c) => c.family_group !== 'receipt_hash_replay').map((c) => c.family)).size < 3) errors.push('A: kalan vakalar farklı D1 ailelerinden olmalı');
const bDir = { weakens: layer('B').filter((c) => c.direction === 'weakens').length, strengthens: layer('B').filter((c) => c.direction === 'strengthens').length };
if (bDir.weakens !== 10 || bDir.strengthens !== 10) errors.push(`B yön: ${bDir.weakens} weakens + ${bDir.strengthens} strengthens (10 + 10 olmalı)`);
const cMech = new Set(layer('C').map((c) => c.family)).size;
if (cMech < 4) errors.push(`C: ${cMech} mekanizma ailesi (en az 4)`);
for (const axis of ['D0', 'D2', 'D3', 'D4']) {
  const n = layer('D').filter((c) => c.axes.length === 1 && c.axes[0] === axis).length;
  if (n !== 5) errors.push(`D ${axis}: ${n} (5 olmalı)`);
}

// ---- yapısal denge (protokol §3): dört katmanda oranlar arası en büyük fark ≤ 25 puan ----
const count = (list, f) => list.filter(f).length;
const share = (name, f) => count(layer(name), f) / layer(name).length;
const LAYERS = ['A', 'B', 'C', 'D'];
const cueRates = Object.fromEntries(LAYERS.map((n) => [n, share(n, (c) => c.descriptive.cue)]));
const lockRates = Object.fromEntries(LAYERS.map((n) => [n, share(n, (c) => c.descriptive.lock_context)]));
const spread = (rates) => Math.max(...Object.values(rates)) - Math.min(...Object.values(rates));
if (spread(cueRates) > 0.25 + 1e-9) errors.push(`ipucu oranı farkı ${(spread(cueRates) * 100).toFixed(0)} puan > 25: ${JSON.stringify(cueRates)}`);
if (spread(lockRates) > 0.25 + 1e-9) errors.push(`lock_context oranı farkı ${(spread(lockRates) * 100).toFixed(0)} puan > 25: ${JSON.stringify(lockRates)}`);
for (const name of LAYERS) {
  const tally = {};
  for (const c of layer(name)) tally[c.function_family] = (tally[c.function_family] ?? 0) + 1;
  for (const [family, n] of Object.entries(tally)) if (n > 10) errors.push(`${name}: "${family}" ailesi ${n}/20 (> %50)`);
}

// ---- naif özellik kapısı (protokol §3) ----
const FEATURES = {
  'diff boyutu': (c) => c.descriptive.changed,
  'eklenen satır': (c) => c.descriptive.added,
  'silinen satır': (c) => c.descriptive.removed,
  'silinen where/and': (c) => c.descriptive.removed_where_and,
  'eklenen exists/select': (c) => c.descriptive.added_exists_select,
  'ipucu var': (c) => +c.descriptive.cue,
  lock_context: (c) => +c.descriptive.lock_context,
  'removed-predicate var': (c) => c.descriptive.removed_predicate,
};
// Protokolün üç karşılaştırması. Yön keyfi olduğu için iki yön birden sınanır: AUC ∈ [0.30, 0.70].
const COMPARISONS = {
  'A–C': [layer('C'), layer('A')],
  'B–C': [layer('C'), layer('B')],
  'BC–AD': [[...layer('B'), ...layer('C')], [...layer('A'), ...layer('D')]],
};
const features = Object.entries(FEATURES).map(([name, f]) => ({
  name,
  ...Object.fromEntries(Object.entries(COMPARISONS).map(([k, [p, n]]) => [k, auc(p.map(f), n.map(f))])),
}));
for (const f of features) {
  for (const k of Object.keys(COMPARISONS)) {
    if (f[k] > 0.7 || f[k] < 0.3) errors.push(`naif özellik "${f.name}" ${k} AUC ${f[k].toFixed(2)} [0.30, 0.70] dışında`);
  }
}

const pctR = (r) => `${(r * 100).toFixed(0)}%`;
const report = [
  `ipucu: ${LAYERS.map((n) => `${n} ${pctR(cueRates[n])}`).join(' · ')} (fark ${pctR(spread(cueRates))})`,
  `lock_context: ${LAYERS.map((n) => `${n} ${pctR(lockRates[n])}`).join(' · ')} (fark ${pctR(spread(lockRates))})`,
  `yeniden kullanılan fonksiyon: ${count(built, (c) => c.function_reused)}/80 · A receipt/hash/replay: ${receiptFamily} · C mekanizma: ${cMech} · B yön: ${bDir.weakens}+${bDir.strengthens}`,
  '', '| Naif özellik | A–C | B–C | BC–AD |', '|---|---|---|---|',
  ...features.map((f) => `| ${f.name} | ${f['A–C'].toFixed(2)} | ${f['B–C'].toFixed(2)} | ${f['BC–AD'].toFixed(2)} |`),
];
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${report.join('\n')}`);
  console.error('\nboyutlar:', built.map((c) => `${c.case_id}=${c.descriptive.changed}${c.descriptive.lock_context ? 'L' : ''}${c.descriptive.cue ? 'c' : ''}${c.descriptive.removed_predicate ? 'p' : ''}`).join(' '));
  console.error('\nset dondurulmadı (protokol §3).');
  process.exit(1);
}

const protocol = readFileSync(path.join(here, '../H19U-PROTOKOL.md'), 'utf8');
const json = `${JSON.stringify({
  version: 'H19U-CASES-0.1',
  protocol: 'H19U-PROTOKOL v0.1',
  protocol_sha256: sha(protocol),
  question_bank: 'DE-JEV-H19-AXIS v0.1.0 (../kaynak/soru-bankasi.v0.1.json)',
  label_policy: 'function-level: caller-held locks are ignored; protection provided by helpers the function itself calls counts',
  descriptive_fields_note: 'descriptive fields are computed for balance checks only and are never sent to Jev',
  cue_dictionary: CUE.source,
  balance: { cue: cueRates, lock_context: lockRates },
  naive_features: features,
  cases: built,
}, null, 2)}\n`;
writeFileSync(path.join(here, 'vakalar.v0.1.json'), json);
console.log(report.join('\n'));
console.log(`\nvakalar.v0.1.json sha256 ${sha(json)}`);
