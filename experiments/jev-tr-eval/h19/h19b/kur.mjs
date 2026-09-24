#!/usr/bin/env node
// H19b vaka setini kurar ve dondurur: vakalar.mjs → vakalar.v0.1.json
// Her mutasyon gerçek migration fonksiyonuna uygulanır, diff git ile üretilir, olgular extractor'dan gelir.
// Jev çağrısı YAPMAZ.
//
//   node h19/h19b/kur.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUE, changedLineNumbers, extractFacts, functionBodies, lineOf } from './extractor.mjs';
import { CASES, LABEL_POLICY } from './vakalar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const LEAK = [/\bH19\b/i, /EXP-H19/i, /exp\/h19/i, /\bD[0-5]\s*[x×]\s*D[0-5]\b/i];
const SHARE = /\bfor\s+(?:key\s+)?share\b/i;
const FLIP = { A: 'unspecified', B: 'weakens_down', C: 'invariant', D: 'invariant', E: null };
const EXPECTED_LABEL = { A: 'weakens', B: 'weakens', C: 'no_effect', D: 'no_effect' };
const tmp = mkdtempSync(path.join(tmpdir(), 'h19b-'));

function gitDiff(before, after) {
  const a = path.join(tmp, 'a.sql');
  const b = path.join(tmp, 'b.sql');
  writeFileSync(a, before);
  writeFileSync(b, after);
  let out = '';
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { encoding: 'utf8' });
  } catch (error) {
    out = error.stdout; // değişiklik varsa git diff 1 ile çıkar
  }
  const lines = out.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('@@'))).join('\n').replace(/\n+$/, '');
}

const errors = [];
const built = [];
for (const spec of CASES) {
  const fail = (message) => errors.push(`${spec.id}: ${message}`);
  const rel = `supabase/migrations/${spec.file}`;
  const sql = readFileSync(path.join(repo, rel), 'utf8');
  const fn = functionBodies(sql).get(`public.${spec.fn}`);
  if (!fn) { fail(`fonksiyon yok ${spec.fn}`); continue; }

  let body = fn.body;
  for (const { find, replace } of spec.mutations) {
    const count = body.split(find).length - 1;
    if (count !== 1) { fail(`mutasyon ${count} kez eşleşti: ${find.slice(0, 60)}`); continue; }
    body = body.replace(find, () => replace);
  }
  const afterSql = sql.slice(0, fn.start) + body + sql.slice(fn.end);
  const patch = gitDiff(sql, afterSql);
  const bodyLine = lineOf(sql, fn.start);
  const changed = changedLineNumbers(patch);
  const facts = extractFacts(fn.body, body, {
    removed: changed.removed.map((n) => n - bodyLine),
    added: changed.added.map((n) => n - bodyLine),
  });
  const files = [{ path: rel, patch }];
  const inputText = JSON.stringify(files);

  // ---- hücre doğrulamaları (H19B-PROTOKOL v0.2 §1–§2) ----
  if (spec.cell !== 'E' && spec.label !== EXPECTED_LABEL[spec.cell]) fail(`etiket ${spec.label} hücreyle uyuşmuyor`);
  if (spec.cell === 'E' && facts.guard_delta === 'unchanged') fail('E vakasında guard_delta unchanged');
  if (spec.cell !== 'E' && facts.guard_delta !== 'unchanged') fail(`guard_delta ${facts.guard_delta}`);
  // A yalnız lock_context ister (değişiklik kilidin önünde de olabilir); C tanımı gereği kilitli bölgededir
  if (spec.cell === 'A' && !facts.lock_context) fail(`A olguları: ${JSON.stringify(facts)}`);
  if (spec.cell === 'C' && !(facts.lock_context && facts.changed_inside_locked_region)) fail(`C olguları: ${JSON.stringify(facts)}`);
  if ('BD'.includes(spec.cell)) {
    if (facts.lock_context || facts.version_guard) fail(`B/D yapı içeriyor: ${JSON.stringify(facts)}`);
    if (CUE.test(inputText)) fail(`B/D girdisinde ipucu kelimesi: ${inputText.match(CUE)[0]}`);
    if (SHARE.test(fn.body) || SHARE.test(body)) fail('B/D gövdesinde FOR SHARE');
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
    rationale: spec.rationale,
    flip_expectation: FLIP[spec.cell],
    facts,
    files,
    input_digest: sha(inputText),
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const protocol = readFileSync(path.join(here, '../H19B-PROTOKOL.md'), 'utf8');
const out = {
  version: 'H19B-CASES-0.1',
  protocol: 'H19B-PROTOKOL v0.2',
  protocol_sha256: sha(protocol),
  label_policy: LABEL_POLICY,
  cue_check_scope: 'files[].path and files[].patch; fixed fact field names are identical in every cell and are not checked',
  cases: built,
};
const json = `${JSON.stringify(out, null, 2)}\n`;
writeFileSync(path.join(here, 'vakalar.v0.1.json'), json);

const count = (cell) => built.filter((c) => c.cell === cell).length;
console.log(`hücreler: A ${count('A')} · B ${count('B')} · C ${count('C')} · D ${count('D')} · E ${count('E')}`);
for (const c of built) {
  const f = c.facts;
  console.log(`${c.case_id} ${c.label.padEnd(11)} lock=${+f.lock_context} ver=${+f.version_guard} inside=${+f.changed_inside_locked_region} delta=${f.guard_delta.padEnd(9)} retry=${+f.retry_path} +${c.files[0].patch.split('\n').filter((l) => l.startsWith('+')).length}/-${c.files[0].patch.split('\n').filter((l) => l.startsWith('-')).length}`);
}
console.log(`\nvakalar.v0.1.json sha256 ${sha(json)}`);
