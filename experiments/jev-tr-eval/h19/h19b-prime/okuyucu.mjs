#!/usr/bin/env node
// H19b′ kör ikinci okuyucu örneklemi (protokol §4): sabit tohum, hücre başına 4 vaka.
// A′/B′ örnekleri 2 weakens + 2 strengthens; C′/D′ örnekleri D0/D2/D3/D4'ten birer vaka.
// Hücre, etiket ve eksen yalnız anahtar dosyasındadır. Ayrıca tüm vakaların okunur listesi yazılır.
//
//   node h19/h19b-prime/okuyucu.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8'));
let seed = 1919;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const copy = [...list]; const out = []; while (out.length < n) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]); return out; };

const sample = [];
for (const cell of 'AB') {
  for (const label of ['weakens', 'strengthens']) sample.push(...pick(cases.filter((c) => c.cell === cell && c.label === label), 2));
}
for (const cell of 'CD') {
  for (const axis of ['D0', 'D2', 'D3', 'D4']) sample.push(...pick(cases.filter((c) => c.cell === cell && c.axis === axis), 1));
}
const blind = pick(sample, sample.length).map((c, i) => ({ no: i + 1, c }));

// Okuyucu diff'i ve fonksiyonun gerekli bağlamını görür (protokol §4); olgular gösterilmez.
const block = (c) => ['Fonksiyon: `' + c.source.function + '` (`' + c.source.file + '`)', '', '```diff', c.files[0].patch, '```'];
const R = ['# H19b′ kör ikinci okuyucu kontrolü (16 vaka)', '',
  'Her vaka için iki cevap yaz:',
  '1. **D5 etkisi:** Eklenen/silinen satırlar bu fonksiyonda eşzamanlı isteklerin birbirine karışmasına karşı korumayı nasıl değiştiriyor? `weakens` · `strengthens` · `no_effect` · `undetermined`',
  '2. **`no_effect` ise hangi eksen değişiyor?** `D0` kiracı/yetki · `D2` anlık görüntü/politika · `D3` personel/kapasite · `D4` zaman/sınır',
  '',
  'Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır (ör. `f10_resolve_or_create_customer` işletme anahtarlı advisory kilit altında çalışır).',
  'Tam fonksiyon gerekiyorsa verilen dosyada fonksiyon adına bak. Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka ve eşi ana eşleştirilmiş analizden düşer; etiket değiştirilmez.', ''];
for (const { no, c } of blind) R.push(`## Vaka ${no}`, '', ...block(c), '', 'D5: `________` · eksen (no_effect ise): `____`', '');
writeFileSync(path.join(here, 'ikinci-okuyucu.md'), `${R.join('\n')}\n`);

const K = ['# H19b′ ikinci okuyucu anahtarı', '', '| No | Vaka | Hücre | D5 etiketi | Eksen | Eş | Gerekçe |', '|---|---|---|---|---|---|---|'];
for (const { no, c } of blind) K.push(`| ${no} | ${c.case_id} | ${c.cell}′ | ${c.label} | ${c.axis} | ${c.pair} | ${c.rationale} |`);
writeFileSync(path.join(here, 'ikinci-okuyucu-anahtar.md'), `${K.join('\n')}\n`);

const A = ['# H19b′ vakaları (vakalar.v0.1.json, okunur liste)', ''];
for (const c of cases) {
  A.push(`## ${c.case_id} · ${c.cell}′ · ${c.label}${c.axis !== 'D5' ? ` · ${c.axis}` : ''} · eş ${c.pair}${c.families.length ? ` · aile: ${c.families.join(', ')}` : ''}`, '',
    c.rationale, '', `Olgular: \`${JSON.stringify(c.facts)}\``, '', ...block(c), '');
}
writeFileSync(path.join(here, 'vakalar.md'), `${A.join('\n')}\n`);
console.log(`örneklem: ${blind.map(({ no, c }) => `${no}=${c.case_id}`).join(' ')}`);
