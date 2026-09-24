#!/usr/bin/env node
// H19b′ Jev'siz naif özellikler (protokol §2 ve §10). Skor yüksekse "gerçek D5" tahmini; AUC pozitif
// sınıf = D5 etkisi olan hücre. Ölçümden önce hesaplanır.
//
//   node h19/h19b-prime/taban.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const auc = (pos, neg) => {
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
};
const lines = (c) => c.files.flatMap((f) => f.patch.split('\n'));
const added = (c) => lines(c).filter((l) => l.startsWith('+'));
const removed = (c) => lines(c).filter((l) => l.startsWith('-'));

export const FEATURES = {
  'diff boyutu (değişen satır)': (c) => added(c).length + removed(c).length,
  'eklenen satır': (c) => added(c).length,
  'silinen satır': (c) => removed(c).length,
  'silinen and/where oranı': (c) => removed(c).filter((l) => /^-\s*(and|where)\b/i.test(l)).length / Math.max(1, removed(c).length),
  'eklenen exists/select': (c) => added(c).filter((l) => /\b(exists|select)\b/i.test(l)).length,
  'eklenen raise': (c) => added(c).filter((l) => /raise exception/i.test(l)).length,
  'yalnız olgular (lock_context + inside)': (c) => (+c.facts.lock_context) + (+c.facts.changed_inside_locked_region),
};

export function naiveFeatures(cases) {
  const of = (cells, f) => cases.filter((c) => cells.includes(c.cell)).map(f);
  return Object.entries(FEATURES).map(([name, f]) => ({
    name,
    all: auc(of('AB', f), of('CD', f)),
    ac: auc(of('A', f), of('C', f)),
    bd: auc(of('B', f), of('D', f)),
    bc: auc(of('B', f), of('C', f)),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { cases } = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vakalar.v0.1.json'), 'utf8'));
  console.log('| Naif özellik | genel | A′–C′ | B′–D′ | B′–C′ |\n|---|---|---|---|---|');
  for (const f of naiveFeatures(cases)) console.log(`| ${f.name} | ${f.all.toFixed(2)} | ${f.ac.toFixed(2)} | ${f.bd.toFixed(2)} | ${f.bc.toFixed(2)} |`);
}
