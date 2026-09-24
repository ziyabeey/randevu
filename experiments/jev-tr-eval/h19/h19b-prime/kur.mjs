#!/usr/bin/env node
// H19b′ vaka setini kurar, protokol kurallarına göre doğrular ve dondurur: vakalar.mjs → vakalar.v0.1.json
// Olgular H19b v0.2'nin donmuş extractor'ından gelir. Jev çağrısı YAPMAZ.
//
//   node h19/h19b-prime/kur.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUE, changedLineNumbers, extractFacts, functionBodies, lineOf } from '../h19b/extractor.mjs';
import { CASES as H19B_CASES } from '../h19b/vakalar.mjs';
import { naiveFeatures } from './taban.mjs';
import { CASES } from './vakalar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const LEAK = [/\bH19\b/i, /EXP-H19/i, /exp\/h19/i, /\bD[0-5]\s*[x×]\s*D[0-5]\b/i];
const SHARE = /\bfor\s+(?:key\s+)?share\b/i;
const tmp = mkdtempSync(path.join(tmpdir(), 'h19bp-'));

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

const errors = [];
const built = [];
const h19bMutations = new Set(H19B_CASES.flatMap((c) => c.mutations.map((m) => `${c.fn}|${m.find}|${m.replace}`)));

for (const spec of CASES) {
  const fail = (message) => errors.push(`${spec.id}: ${message}`);
  const rel = `supabase/migrations/${spec.file}`;
  const sql = readFileSync(path.join(repo, rel), 'utf8');
  const fn = functionBodies(sql).get(`public.${spec.fn}`);
  if (!fn) { fail(`fonksiyon yok ${spec.fn}`); continue; }

  let body = fn.body;
  for (const { find, replace } of spec.mutations) {
    const count = body.split(find).length - 1;
    if (count !== 1) { fail(`mutasyon ${count} kez eşleşti: ${find.slice(0, 70)}`); continue; }
    body = body.replace(find, () => replace);
    if (h19bMutations.has(`${spec.fn}|${find}|${replace}`)) fail('H19b mutasyonu tekrar kullanılmış');
  }
  const afterSql = sql.slice(0, fn.start) + body + sql.slice(fn.end);
  const patch = gitDiff(sql, afterSql);
  if (!patch.startsWith('@@')) { fail('diff üretilmedi'); continue; }
  const bodyLine = lineOf(sql, fn.start);
  const changed = changedLineNumbers(patch);
  let facts;
  try {
    facts = extractFacts(fn.body, body, {
      removed: changed.removed.map((n) => n - bodyLine),
      added: changed.added.map((n) => n - bodyLine),
    });
  } catch (error) { fail(error.message); continue; }
  const files = [{ path: rel, patch }];
  const inputText = JSON.stringify(files);

  // ---- protokol §2–§3 doğrulamaları ----
  const d5 = 'AB'.includes(spec.cell);
  if (d5 && !['weakens', 'strengthens'].includes(spec.label)) fail(`gerçek D5 etiketi ${spec.label}`);
  if (!d5 && spec.label !== 'no_effect') fail(`D5 değil ama etiket ${spec.label}`);
  if (!d5 && !['D0', 'D2', 'D3', 'D4'].includes(spec.axis)) fail(`eksen ${spec.axis}`);
  if (facts.guard_delta !== 'unchanged') fail(`guard_delta ${facts.guard_delta}`);
  if ('AC'.includes(spec.cell) && !facts.lock_context) fail('A′/C′ kilit bağlamı yok');
  if ('BD'.includes(spec.cell)) {
    if (facts.lock_context) fail('B′/D′ kilit bağlamı içeriyor');
    if (CUE.test(inputText)) fail(`B′/D′ girdisinde ipucu: ${inputText.match(CUE)[0]}`);
    if (SHARE.test(fn.body) || SHARE.test(body)) fail('B′/D′ gövdesinde FOR SHARE');
  }
  const leak = LEAK.find((pattern) => pattern.test(inputText));
  if (leak) fail(`sızıntı ${leak}`);

  built.push({
    case_id: spec.id,
    cell: spec.cell,
    origin: 'synthetic',
    source: { file: rel, function: `public.${spec.fn}` },
    pair: spec.pair ?? null,
    label: spec.label,
    axis: spec.axis ?? 'D5',
    families: spec.families,
    rationale: spec.rationale,
    facts,
    files,
    input_digest: sha(inputText),
  });
}

// ---- matris ve eşleştirme (protokol §2) ----
const byCell = (cell) => built.filter((c) => c.cell === cell);
for (const cell of 'ABCD') if (byCell(cell).length !== 16) errors.push(`hücre ${cell}: ${byCell(cell).length} vaka (16 olmalı)`);
for (const cell of 'AB') {
  for (const label of ['weakens', 'strengthens']) {
    const n = byCell(cell).filter((c) => c.label === label).length;
    if (n !== 8) errors.push(`hücre ${cell}: ${label} ${n} (8 olmalı)`);
  }
}
for (const cell of 'CD') {
  for (const axis of ['D0', 'D2', 'D3', 'D4']) {
    const n = byCell(cell).filter((c) => c.axis === axis).length;
    if (n !== 4) errors.push(`hücre ${cell}: ${axis} ${n} (4 olmalı)`);
  }
}
const byId = Object.fromEntries(built.map((c) => [c.case_id, c]));
const unpaired = { A: 0, B: 0, C: 0, D: 0 };
for (const c of built) {
  const p = byId[c.pair];
  const ok = p && p.pair === c.case_id && p.source.file === c.source.file && p.source.function === c.source.function
    && ({ A: 'C', C: 'A', B: 'D', D: 'B' })[c.cell] === p.cell;
  if (!ok) unpaired[c.cell] += 1;
}
for (const [cell, n] of Object.entries(unpaired)) if (n > 4) errors.push(`hücre ${cell}: eşsiz ${n} (en fazla 4)`);

// ---- naif özellik kapısı: B′–C′ ayrımında hiçbir tek özellik AUC > 0.70 vermemeli ----
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const features = naiveFeatures(built);
const naiveFail = features.filter((f) => f.bc > 0.7);
const size = (c) => c.files[0].patch.split('\n').filter((l) => /^[+-]/.test(l)).length;
if (naiveFail.length) {
  for (const f of naiveFail) console.error(`naif özellik "${f.name}" B′–C′ AUC ${f.bc.toFixed(2)} > 0.70`);
  console.error(`\nboyutlar B′: ${byCell('B').map((c) => `${c.case_id}=${size(c)}`).join(' ')}`);
  console.error(`boyutlar C′: ${byCell('C').map((c) => `${c.case_id}=${size(c)}`).join(' ')}`);
  console.error('set dondurulmadı (protokol §2).');
  process.exit(1);
}

const protocol = readFileSync(path.join(here, '../H19B-PRIME-PROTOKOL.md'), 'utf8');
const out = {
  version: 'H19B-PRIME-CASES-0.1',
  protocol: 'H19B-PRIME-PROTOKOL v0.1',
  protocol_sha256: sha(protocol),
  fact_schema: 'H19b v0.2 extractor (../h19b/extractor.mjs)',
  label_policy: 'function-level: caller-held locks are ignored; protection provided by helpers the function itself calls counts',
  cue_check_scope: 'files[].path and files[].patch for cells B and D',
  unpaired,
  cases: built,
};
const json = `${JSON.stringify(out, null, 2)}\n`;
writeFileSync(path.join(here, 'vakalar.v0.1.json'), json);

console.log('hücre  weakens/strengthens/no_effect  eksenler');
for (const cell of 'ABCD') {
  const list = byCell(cell);
  const n = (k) => list.filter((c) => c.label === k).length;
  const axes = ['D0', 'D2', 'D3', 'D4'].map((a) => `${a}:${list.filter((c) => c.axis === a).length}`).join(' ');
  console.log(`${cell}′     ${n('weakens')}/${n('strengthens')}/${n('no_effect')}                  ${'CD'.includes(cell) ? axes : ''}`);
}
console.log(`eşsiz: ${JSON.stringify(unpaired)}`);
console.log('\n| Naif özellik | genel | A′–C′ | B′–D′ | **B′–C′** |\n|---|---|---|---|---|');
for (const f of features) console.log(`| ${f.name} | ${f.all.toFixed(2)} | ${f.ac.toFixed(2)} | ${f.bd.toFixed(2)} | ${f.bc.toFixed(2)} |`);
console.log('\nvaka  lock ver inside retry  +/-');
for (const c of built) {
  const f = c.facts; const lines = c.files[0].patch.split('\n');
  console.log(`${c.case_id}  ${+f.lock_context}    ${+f.version_guard}   ${+f.changed_inside_locked_region}      ${+f.retry_path}      +${lines.filter((l) => l.startsWith('+')).length}/-${lines.filter((l) => l.startsWith('-')).length}  ${c.label}${c.axis !== 'D5' ? ` ${c.axis}` : ''}`);
}
console.log(`\nvakalar.v0.1.json sha256 ${sha(json)}`);
