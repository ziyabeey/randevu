#!/usr/bin/env node
// Jev'siz naif tabanlar: yalnız diff yüzeyinden skor. Ölçümden önce hesaplanır; Jev'in geçmesi gereken
// referans noktalarıdır (protokol kapısı değil).
//
//   node h19/h19b/taban.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const auc = (pos, neg) => {
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
};
const lines = (c) => c.files.flatMap((f) => f.patch.split('\n'));
export const BASELINES = {
  'diff boyutu (değişen satır)': (c) => lines(c).filter((l) => /^[+-]/.test(l)).length,
  'silinen and/where satırı': (c) => lines(c).filter((l) => /^-\s*(and|where)\b/i.test(l)).length,
  'eklenen exists/select': (c) => lines(c).filter((l) => /^\+.*\b(exists|select)\b/i.test(l)).length,
  'eklenen raise yok (az raise → weakens)': (c) => -lines(c).filter((l) => /^\+.*raise exception/i.test(l)).length,
};

export function naiveBaselines(cases) {
  const of = (cells, f) => cases.filter((c) => cells.includes(c.cell)).map(f);
  return Object.entries(BASELINES).map(([name, f]) => ({
    name,
    all: auc(of('AB', f), of('CD', f)),
    ac: auc(of('A', f), of('C', f)),
    bd: auc(of('B', f), of('D', f)),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { cases } = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vakalar.v0.1.json'), 'utf8'));
  console.log('| Taban | AUC | A–C | B–D |\n|---|---|---|---|');
  for (const b of naiveBaselines(cases)) console.log(`| ${b.name} | ${b.all.toFixed(2)} | ${b.ac.toFixed(2)} | ${b.bd.toFixed(2)} |`);
}
