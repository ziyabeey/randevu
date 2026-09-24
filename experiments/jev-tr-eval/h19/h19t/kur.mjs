#!/usr/bin/env node
// H19t vaka setini kurar, protokol §2–§3'e göre doğrular ve ancak bütün kapılar geçerse dondurur:
// vakalar.mjs → vakalar.v0.1.json. Betimleyici alanlar hesaplanır ama Jev girdisine VERİLMEZ.
// Jev çağrısı YAPMAZ.
//
//   node h19/h19t/kur.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUE } from '../h19b/extractor.mjs';
import { CASES as H19B } from '../h19b/vakalar.mjs';
import { CASES as H19BP } from '../h19b-prime/vakalar.mjs';
import { CASES as H19D } from '../h19d/vakalar.mjs';
import { CASES } from './vakalar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const LOCK = /\bfor\s+update\b|\bfor\s+no\s+key\s+update\b|\bpg_advisory_xact_lock\b|\bpg_advisory_lock\b|\bskip\s+locked\b/i;
const LEAK = [/\bH19\b/i, /EXP-H19/i, /exp\/h19/i, /\bD[0-5]\s*[x×]\s*D[0-5]\b/i];
const tmp = mkdtempSync(path.join(tmpdir(), 'h19t-'));
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
// - H19b, H19b′, H19d: fonksiyon + bul + değiştir üçlüsü;
// - R0/H19a, H19b, H19b′, H19d: donmuş girdilerdeki değişen satır kümesi.
const PRIOR = [...H19B, ...H19BP, ...H19D];
const priorUse = new Set(PRIOR.map((c) => `${c.file}|${qualified(c.fn)}`));
const priorMutations = new Set(PRIOR.flatMap((c) => c.mutations.map((m) => `${qualified(c.fn)}|${m.find}|${m.replace}`)));
const changedSet = (patch) => patch.split('\n').filter((l) => /^[+-]/.test(l)).map((l) => l.trim()).sort().join('\n');
const priorInputs = [
  ['R0', '../kaynak/h19-axis-inputs.v0.1.json'],
  ['H19b', '../h19b/vakalar.v0.1.json'],
  ['H19b′', '../h19b-prime/vakalar.v0.1.json'],
  ['H19d', '../h19d/vakalar.v0.1.json'],
];
const priorChanged = new Map();
for (const [name, file] of priorInputs) {
  for (const c of JSON.parse(readFileSync(path.join(here, file), 'utf8')).cases) {
    for (const f of c.files) priorChanged.set(changedSet(f.patch), `${name} ${c.case_id}`);
  }
}

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
    d5: spec.layer.startsWith('P'),
    axes: spec.axes ?? [],
    direction: spec.direction ?? null,
    family: spec.family,
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
for (const name of ['PS', 'PP', 'NS', 'NP']) if (layer(name).length !== 20) errors.push(`${name}: ${layer(name).length} vaka (20 olmalı)`);
for (const dir of ['weakens', 'strengthens']) {
  const n = layer('PS').filter((c) => c.direction === dir).length;
  if (n !== 10) errors.push(`PS ${dir}: ${n} (10 olmalı)`);
}
for (const axis of ['D0', 'D1', 'D2', 'D3', 'D4']) {
  const pp = layer('PP').filter((c) => c.axes.length === 1 && c.axes[0] === axis).length;
  const ns = layer('NS').filter((c) => c.axes.length === 1 && c.axes[0] === axis).length;
  if (pp !== 4) errors.push(`PP D5×${axis}: ${pp} (4 olmalı)`);
  if (ns !== 4) errors.push(`NS ${axis}: ${ns} (4 olmalı)`);
}
const PAIRS = [];
for (let i = 0; i < 5; i += 1) for (let j = i + 1; j < 5; j += 1) PAIRS.push(`D${i}D${j}`);
for (const pair of PAIRS) {
  const n = layer('NP').filter((c) => c.axes.join('') === pair).length;
  if (n !== 2) errors.push(`NP ${pair}: ${n} (2 olmalı)`);
}

// ---- yapısal denge (protokol §3) ----
const pos = built.filter((c) => c.d5);
const neg = built.filter((c) => !c.d5);
const count = (list, f) => list.filter(f).length;
const lockPos = count(pos, (c) => c.descriptive.lock_context); const lockNeg = count(neg, (c) => c.descriptive.lock_context);
const cuePos = count(pos, (c) => c.descriptive.cue); const cueNeg = count(neg, (c) => c.descriptive.cue);
if (Math.abs(lockPos - lockNeg) > 4) errors.push(`lock_context dengesi: pozitif ${lockPos}, negatif ${lockNeg}`);
if (Math.abs(cuePos - cueNeg) > 4) errors.push(`ipucu dengesi: pozitif ${cuePos}, negatif ${cueNeg}`);
for (const name of ['PS', 'PP', 'NS', 'NP']) {
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
const features = Object.entries(FEATURES).map(([name, f]) => ({
  name,
  all: auc(pos.map(f), neg.map(f)),
  pair: auc(layer('PP').map(f), layer('NP').map(f)),
}));
for (const f of features) {
  if (f.all > 0.7) errors.push(`naif özellik "${f.name}" genel AUC ${f.all.toFixed(2)} > 0.70`);
  if (f.pair > 0.7) errors.push(`naif özellik "${f.name}" PP–NP AUC ${f.pair.toFixed(2)} > 0.70`);
}

const report = [
  `lock_context: pozitif ${lockPos} · negatif ${lockNeg} | ipucu: pozitif ${cuePos} · negatif ${cueNeg}`,
  `yeniden kullanılan fonksiyon: ${count(built, (c) => c.function_reused)}/80`,
  '', '| Naif özellik | genel AUC | PP–NP AUC |', '|---|---|---|',
  ...features.map((f) => `| ${f.name} | ${f.all.toFixed(2)} | ${f.pair.toFixed(2)} |`),
];
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${report.join('\n')}`);
  console.error('\nboyutlar:', built.map((c) => `${c.case_id}=${c.descriptive.changed}${c.descriptive.lock_context ? 'L' : ''}${c.descriptive.cue ? 'c' : ''}${c.descriptive.removed_predicate ? 'p' : ''}`).join(' '));
  console.error('\nset dondurulmadı (protokol §3).');
  process.exit(1);
}

const protocol = readFileSync(path.join(here, '../H19T-PROTOKOL.md'), 'utf8');
const json = `${JSON.stringify({
  version: 'H19T-CASES-0.1',
  protocol: 'H19T-PROTOKOL v0.1',
  protocol_sha256: sha(protocol),
  question_bank: 'DE-JEV-H19-AXIS v0.1.0 (../kaynak/soru-bankasi.v0.1.json)',
  label_policy: 'function-level: caller-held locks are ignored; protection provided by helpers the function itself calls counts',
  descriptive_fields_note: 'descriptive fields are computed for balance checks only and are never sent to Jev',
  balance: { lock_context: { positive: lockPos, negative: lockNeg }, cue: { positive: cuePos, negative: cueNeg } },
  naive_features: features,
  cases: built,
}, null, 2)}\n`;
writeFileSync(path.join(here, 'vakalar.v0.1.json'), json);
console.log(report.join('\n'));
console.log(`\nvakalar.v0.1.json sha256 ${sha(json)}`);
