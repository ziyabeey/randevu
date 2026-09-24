#!/usr/bin/env node
// İkinci okuyucu örneklemi (sabit tohum, hücre başına 3 vaka, kör) ve tüm vakaların okunur listesi.
//
//   node h19/h19b/okuyucu.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8'));
let seed = 19;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const copy = [...list]; const out = []; while (out.length < n) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]); return out; };
const sample = ['A', 'B', 'C', 'D'].flatMap((cell) => pick(cases.filter((c) => c.cell === cell), 3));
// Okuyucu hücreyi görmesin diye sırayı da karıştır
const blind = pick(sample, sample.length).map((c, i) => ({ no: i + 1, c }));

const block = (c) => [
  `Fonksiyon: \`${c.source.function}\` (\`${c.source.file}\`)`, '',
  `Olgular: \`${JSON.stringify(c.facts)}\``, '',
  '```diff', c.files[0].patch, '```',
];
const R = ['# H19b ikinci okuyucu kontrolü (kör)', '',
  'Her vaka için yalnız şu soruyu cevapla: **Eklenen/silinen satırlar, bu fonksiyonda eşzamanlı isteklerin birbirine karışmasına karşı korumayı nasıl değiştiriyor?**',
  '`weakens` (zayıflatıyor) · `strengthens` (güçlendiriyor) · `no_effect` (yalnız iş mantığı/çıktı/doğrulama) · `undetermined` (belirlenemez).',
  'Etiket fonksiyon düzeyindedir: çağıranların tuttuğu kilitler hesaba katılmaz, fonksiyonun kendi çağırdığı yardımcıların koruması sayılır.',
  'Cevapları yazdıktan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Anlaşmazlıkta vaka düşer; etiket değiştirilmez.', ''];
for (const { no, c } of blind) R.push(`## Vaka ${no}`, '', ...block(c), '', 'Senin etiketin: `________`', '');
writeFileSync(path.join(here, 'ikinci-okuyucu.md'), `${R.join('\n')}\n`);

const K = ['# İkinci okuyucu anahtarı', '', '| No | Vaka | Hücre | Etiket | Gerekçe |', '|---|---|---|---|---|'];
for (const { no, c } of blind) K.push(`| ${no} | ${c.case_id} | ${c.cell} | ${c.label} | ${c.rationale} |`);
writeFileSync(path.join(here, 'ikinci-okuyucu-anahtar.md'), `${K.join('\n')}\n`);

const A = ['# H19b vakaları (vakalar.v0.1.json, okunur liste)', ''];
for (const c of cases) A.push(`## ${c.case_id} · hücre ${c.cell} · ${c.label}${c.pair ? ` · eş: ${c.pair}` : ''}`, '', c.rationale, '', ...block(c), '');
writeFileSync(path.join(here, 'vakalar.md'), `${A.join('\n')}\n`);
console.log(`örneklem: ${blind.map(({ no, c }) => `${no}=${c.case_id}`).join(' ')}`);
