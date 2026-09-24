#!/usr/bin/env node
// H19d öncesi keşif (ön kayıt DEĞİL, post-hoc): mevcut V çıktılarında göreli eksen skorları.
// Yeni Jev çağrısı yapmaz. Varyantlar aynı veride denendiği için buradaki hiçbir sayı kanıt veya kapı değildir.
//
//   node h19/h19d-kesif.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const auc = (p, n) => { let s = 0; for (const a of p) for (const b of n) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (p.length * n.length); };
const lg = (q) => { const c = Math.min(0.999, Math.max(0.001, q)); return Math.log(c / (1 - c)); };
const OTHERS = ['D0', 'D1', 'D2', 'D3', 'D4'];
const NO_D1 = ['D0', 'D2', 'D3', 'D4'];
const SCORES = {
  'ham P(D5)': (p) => p.D5,
  'D5 − max(diğer)': (p) => p.D5 - Math.max(...OTHERS.map((a) => p[a])),
  'D5 − max(D1 hariç)': (p) => p.D5 - Math.max(...NO_D1.map((a) => p[a])),
  'logit marjı': (p) => lg(p.D5) - Math.max(...OTHERS.map((a) => lg(p[a]))),
  'sıra': (p) => -OTHERS.filter((a) => p[a] > p.D5).length,
};
const rows = [];
const add = (name, pos, neg) => rows.push(`| ${name} | ${pos.length}/${neg.length} | ${Object.values(SCORES).map((f) => auc(pos.map(f), neg.map(f)).toFixed(3)).join(' | ')} |`);

{
  const { cases } = json('h19b-prime/vakalar.v0.1.json');
  const V = Object.fromEntries(json('h19b-prime/sonuc/2026-09-24T08-41-42-192Z/V.json').rows.map((r) => [r.case_id, r.axis_probabilities]));
  const g = (cells) => cases.filter((c) => cells.includes(c.cell)).map((c) => V[c.case_id]);
  add('H19b′ B′ ile C′ (birincil çapraz)', g('B'), g('C'));
  add('H19b′ A′+B′ ile C′+D′', g('AB'), g('CD'));
  add('H19b′ B′ ile D′', g('B'), g('D'));
}
{
  const { cases } = json('h19b/vakalar.v0.1.json');
  const V = Object.fromEntries(json('h19b/sonuc/2026-09-24T07-54-00-236Z/V.json').rows.map((r) => [r.case_id, r.axis_probabilities]));
  const g = (cells) => cases.filter((c) => cells.includes(c.cell)).map((c) => V[c.case_id]);
  add('H19b A+B ile C+D', g('AB'), g('CD'));
}
const labels = json('kaynak/benchmark-etiketler.v0.1.json').cases;
for (const [name, file] of [['R0 tur 1', 'sonuc/facts-1.json'], ['R0 tur 2', 'sonuc/facts-2.json'], ['H19a C1', 'sonuc/h19a-2026-09-24T07-11-42-782Z/facts-C1.json']]) {
  const V = Object.fromEntries(json(file).cases.map((c) => [c.case_key, c.axis_probabilities]));
  add(`${name} (çift etiketi: D5 içeren ile içermeyen)`, labels.filter((c) => c.expected_pair.includes('D5')).map((c) => V[c.case_key]), labels.filter((c) => !c.expected_pair.includes('D5')).map((c) => V[c.case_key]));
}
const L = ['# H19d öncesi keşif: göreli eksen skorları (post-hoc, ön kayıt dışı)', '',
  'Mevcut V çıktıları yeniden okundu; yeni çağrı yok. Beş varyant aynı veride denendi. Buradaki sayılar hipotez',
  'kaynağıdır, kanıt ya da kapı değildir.', '',
  `| Set | poz/neg | ${Object.keys(SCORES).join(' | ')} |`, `|---|---|${Object.keys(SCORES).map(() => '---').join('|')}|`, ...rows];
writeFileSync(path.join(here, 'H19D-KESIF.md'), `${L.join('\n')}\n`);
console.log(L.join('\n'));
