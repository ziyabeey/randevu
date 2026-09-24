#!/usr/bin/env node
// H19s referans okuyucu paketleri (H19S-PROTOKOL-v0.2 §5, H19S-BLIND-LABEL-0.2).
// Yalnız kohort.json okunur; golge.jsonl'e (H19 çıktısı) dokunulmaz. Reader A ve Reader B aynı paketleri,
// aynı donmuş istemle, birbirinden ayrı ürün oturumlarında alır. Stop rule sağlanmadan paket üretilmez.
//
//   node h19/h19s/paket.mjs --kohort <dizin>/kohort.json --out <paket-dizini> [--parti 10]

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const contractText = readFileSync(path.join(here, 'referans-etiket.v0.2.json'), 'utf8');
const contract = JSON.parse(contractText);

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const kohortPath = arg('--kohort');
const out = arg('--out');
if (!kohortPath || !out) throw new Error('--kohort ve --out gerekli');
const batchSize = Number(arg('--parti') ?? 10);
const cohort = JSON.parse(readFileSync(kohortPath, 'utf8'));
if (!cohort.stop_rule_met) throw new Error('stop rule henüz sağlanmadı; paket üretilmez (v0.2 §5)');

const units = cohort.prs.flatMap((pr) => pr.units.map((u) => ({
  unit_id: u.unit_id,
  pr_number: pr.pr,
  pr_title: pr.title,
  routine_id: u.symbol,
  path: u.path,
  change_kind: u.change,
  patch: u.files[0].patch,
  before_definition: u.before_definition,
  after_definition: u.after_definition,
})));
for (const u of units) for (const key of contract.input) if (!(key in u)) throw new Error(`paket alanı eksik: ${key}`);

// İstem yalnız donmuş sözleşmeden kurulur; sözleşmede olmayan tanım eklenmez.
const enumText = (key) => contract.output[key].join(' | ');
const PROMPT = [
  `Task: ${contract.task}`,
  '',
  'You will receive a batch of routine changes from merged pull requests (PostgreSQL / PL/pgSQL migrations).',
  'Label each routine change independently. Do not use tools, web access, or any other source.',
  '',
  'Definitions:',
  `- D1: ${contract.definitions.D1}`,
  `- D5: ${contract.definitions.D5}`,
  `- actionable_D5: ${contract.definitions.actionable_D5}`,
  '',
  'For each unit answer whether the change materially involves D1, whether it materially involves D5, and whether it',
  'contains an actionable D5 problem. For a new routine (before_definition is null), judge the behavior the new',
  'routine introduces. Use "undetermined" only when the supplied material is insufficient.',
  '',
  'Return only a JSON array, one object per unit, in the order given:',
  `[{"unit_id": "<as given>", "d1": "${enumText('d1')}", "d5": "${enumText('d5')}", "actionable_d5": "${enumText('actionable_d5')}", "reason": "<${contract.output.reason}>"}]`,
].join('\n');

mkdirSync(out, { recursive: true });
const block = (u) => [
  `### ${u.unit_id}`, '',
  `- pr_number: ${u.pr_number}`,
  `- pr_title: ${u.pr_title}`,
  `- routine_id: ${u.routine_id}`,
  `- path: ${u.path}`,
  `- change_kind: ${u.change_kind}`, '',
  'patch:', '```diff', u.patch, '```', '',
  'before_definition:', ...(u.before_definition === null ? ['null'] : ['```sql', u.before_definition, '```']), '',
  'after_definition:', '```sql', u.after_definition, '```', '',
];
const batches = [];
for (let i = 0; i < units.length; i += batchSize) batches.push(units.slice(i, i + batchSize));
const index = [];
batches.forEach((batch, b) => {
  const name = `parti-${String(b + 1).padStart(2, '0')}.md`;
  const text = [`# H19s okuyucu partisi ${b + 1}/${batches.length}`, '', PROMPT, '', '---', '', ...batch.flatMap(block)].join('\n');
  writeFileSync(path.join(out, name), `${text}\n`);
  index.push({ file: name, sha256: sha(`${text}\n`), units: batch.map((u) => u.unit_id) });
});
const manifest = {
  contract: contract.version,
  contract_sha256: sha(contractText),
  prompt_sha256: sha(PROMPT),
  cohort_units: units.length,
  batch_size: batchSize,
  batches: index,
  label_file_format: {
    reader: 'A | B',
    product: 'ürün adı (ör. ChatGPT, Claude)',
    visible_model: 'oturumda görünen model kimliği',
    date: 'YYYY-MM-DD',
    labels: '[{unit_id, d1, d5, actionable_d5, reason}] — her kohort birimi tam bir kez',
  },
};
writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${units.length} birim · ${batches.length} parti · istem ${manifest.prompt_sha256.slice(0, 12)}`);
