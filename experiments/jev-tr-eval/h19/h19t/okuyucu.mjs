#!/usr/bin/env node
// H19t kör ikinci okuyucu örneklemi (protokol §4): sabit tohum, 4 PS + 4 PP (farklı eş eksenler) +
// 4 NS + 4 NP. Katman ve etiket yalnız anahtar dosyasındadır. Ayrıca tüm vakaların okunur listesi yazılır.
//
//   node h19/h19t/okuyucu.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8'));
let seed = 1924;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const copy = [...list]; const out = []; while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]); return out; };

const sample = [];
sample.push(...pick(cases.filter((c) => c.layer === 'PS' && c.direction === 'weakens'), 2));
sample.push(...pick(cases.filter((c) => c.layer === 'PS' && c.direction === 'strengthens'), 2));
for (const axis of pick(['D0', 'D1', 'D2', 'D3', 'D4'], 4)) sample.push(...pick(cases.filter((c) => c.layer === 'PP' && c.axes[0] === axis), 1));
for (const axis of pick(['D0', 'D1', 'D2', 'D3', 'D4'], 4)) sample.push(...pick(cases.filter((c) => c.layer === 'NS' && c.axes[0] === axis), 1));
const pairs = [...new Set(cases.filter((c) => c.layer === 'NP').map((c) => c.axes.join('×')))];
for (const pair of pick(pairs, 4)) sample.push(...pick(cases.filter((c) => c.layer === 'NP' && c.axes.join('×') === pair), 1));
const blind = pick(sample, sample.length).map((c, i) => ({ no: i + 1, c }));

const block = (c) => ['Fonksiyon: `' + c.source.function + '` (`' + c.source.file + '`)', '', '```diff', c.files[0].patch, '```'];
const R = ['# H19t kör ikinci okuyucu kontrolü (16 vaka)', '',
  'Her vaka için üç cevap yaz:',
  '1. **D5 maddi olarak etkileniyor mu?** (eşzamanlılık, kilit, yarış sırası, bayat yazma, iyimser sürüm, iç içe geçmeye duyarlı davranış) `yes` · `no` · `undetermined`',
  '2. **`yes` ise** D5 dışında maddi olarak değişen eksen(ler): `D0` kiracı/yetki · `D1` atomiklik/tekrar · `D2` anlık görüntü/politika · `D3` personel/kapasite · `D4` zaman/sınır · ya da `yok`',
  '3. **`no` ise** maddi olarak değişen eksen(ler)',
  '',
  'Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Yön (zayıflatma/güçlendirme) sorulmuyor.',
  'Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka düşer (`dusen.json`); etiket değiştirilmez.', ''];
for (const { no, c } of blind) R.push(`## Vaka ${no}`, '', ...block(c), '', 'D5: `____` · eksen(ler): `________`', '');
writeFileSync(path.join(here, 'ikinci-okuyucu.md'), `${R.join('\n')}\n`);

const label = (c) => (c.d5 ? `yes${c.axes.length ? ` + ${c.axes.join(', ')}` : ' (yalnız D5)'}` : `no; ${c.axes.join(', ')}`);
const K = ['# H19t ikinci okuyucu anahtarı', '', '| No | Vaka | Katman | Etiket | Yön (kayıt) | Gerekçe |', '|---|---|---|---|---|---|'];
for (const { no, c } of blind) K.push(`| ${no} | ${c.case_id} | ${c.layer} | ${label(c)} | ${c.direction ?? '—'} | ${c.rationale} |`);
writeFileSync(path.join(here, 'ikinci-okuyucu-anahtar.md'), `${K.join('\n')}\n`);

const A = ['# H19t vakaları (vakalar.v0.1.json, okunur liste)', ''];
for (const c of cases) {
  A.push(`## ${c.case_id} · ${c.layer} · ${label(c)}${c.direction ? ` · ${c.direction}` : ''} · aile: ${c.family}${c.function_reused ? ' · fonksiyon yeniden kullanıldı' : ''}`, '',
    c.rationale, '', `Betimleyici (Jev'e verilmez): \`${JSON.stringify(c.descriptive)}\``, '', ...block(c), '');
}
writeFileSync(path.join(here, 'vakalar.md'), `${A.join('\n')}\n`);
console.log(`örneklem: ${blind.map(({ no, c }) => `${no}=${c.case_id}`).join(' ')}`);
