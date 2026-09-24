#!/usr/bin/env node
// Son analiz sonucunu elle doğrulama etiketleriyle (dogrulama.json) karşılaştırır.
//   node rakip/verify.mjs [results/<zaman>/raw.json]
import { readdirSync, readFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const path = process.argv[2] ?? `results/${readdirSync(new URL('results/', here)).filter((d) => !d.endsWith('-mock')).sort().at(-1)}/raw.json`;
const rows = JSON.parse(readFileSync(new URL(path, here), 'utf8')).filter((r) => r.answers);
const labels = JSON.parse(readFileSync(new URL('dogrulama.json', here), 'utf8'));
const perQ = {};
const misses = [];
for (const r of rows) {
  for (const [q, expected] of Object.entries(labels[r.ad] ?? {})) {
    if (expected === null || !r.answers[q]) continue;
    const a = r.answers[q];
    const got = a.type === 'noul' ? a.noul >= 0.5 : a.choice;
    const ok = Array.isArray(expected) ? expected.includes(got) : got === expected;
    (perQ[q] ??= { n: 0, ok: 0 }).n += 1;
    if (ok) perQ[q].ok += 1; else misses.push(`${r.ad} · ${q}: Jev=${a.type === 'noul' ? a.noul.toFixed(2) : `${a.choice} (${a.confidence.toFixed(2)})`} beklenen=${JSON.stringify(expected)}`);
  }
}
let n = 0; let ok = 0;
console.log('| Soru | Uyum |\n|---|---|');
for (const [q, s] of Object.entries(perQ)) { n += s.n; ok += s.ok; console.log(`| ${q} | ${s.ok}/${s.n} |`); }
console.log(`| **toplam** | **${ok}/${n} (%${((ok / n) * 100).toFixed(1)})** |\n`);
console.log(misses.length ? `Uyuşmayanlar:\n${misses.map((m) => `- ${m}`).join('\n')}` : 'Uyuşmayan yok.');
