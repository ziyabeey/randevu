#!/usr/bin/env node
// H19u kör ikinci okuyucu örneklemi (protokol §4): A/B/C/D katmanlarından dörder, 16 vaka.
// Tohum, donmuş vakalar.v0.1.json dosyasının SHA-256 özetinin ilk 8 onaltılık hanesidir: dondurulmadan önce
// bilinemez, dondurulduktan sonra sabittir. Katman ve etiket yalnız anahtar dosyasındadır. Ayrıca tüm
// vakaların okunur listesi yazılır.
//   A: 2 receipt/request-hash/replay + 2 diğer D1 ailesi · B: 2 weakens + 2 strengthens
//   C: 4 farklı mekanizma ailesi (mümkünse) · D: D0, D2, D3, D4 birer
//
//   node h19/h19u/okuyucu.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8');
const frozenSha = createHash('sha256').update(text).digest('hex');
const { cases } = JSON.parse(text);
let seed = Number.parseInt(frozenSha.slice(0, 8), 16) % 2147483648;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (list, n) => { const copy = [...list]; const out = []; while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]); return out; };
const layer = (name) => cases.filter((c) => c.layer === name);

const sample = [];
sample.push(...pick(layer('A').filter((c) => c.family_group === 'receipt_hash_replay'), 2));
sample.push(...pick(layer('A').filter((c) => c.family_group !== 'receipt_hash_replay'), 2));
sample.push(...pick(layer('B').filter((c) => c.direction === 'weakens'), 2));
sample.push(...pick(layer('B').filter((c) => c.direction === 'strengthens'), 2));
const cFamilies = pick([...new Set(layer('C').map((c) => c.family))], 4);
const cChosen = cFamilies.flatMap((f) => pick(layer('C').filter((c) => c.family === f), 1));
sample.push(...cChosen, ...pick(layer('C').filter((c) => !cChosen.includes(c)), 4 - cChosen.length));
for (const axis of ['D0', 'D2', 'D3', 'D4']) sample.push(...pick(layer('D').filter((c) => c.axes[0] === axis), 1));
const blind = pick(sample, sample.length).map((c, i) => ({ no: i + 1, c }));

const block = (c) => ['Fonksiyon: `' + c.source.function + '` (`' + c.source.file + '`)', '', '```diff', c.files[0].patch, '```'];
const R = ['# H19u kör ikinci okuyucu kontrolü (16 vaka)', '',
  `Donmuş set SHA-256: \`${frozenSha}\` · örneklem tohumu: ilk 8 hane (\`${frozenSha.slice(0, 8)}\`).`, '',
  'Her vaka için tek etiket yaz (protokol §4):',
  '- `D1_ONLY`: idempotency, komut kimliği, tekrar/makbuz semantiği, istek kimliği veya tekrarlanan komutun işlenişi maddi olarak değişir; eşzamanlılık/kilit/sürüm/serileştirme değişmez.',
  '- `D5_ONLY`: eşzamanlılık, iyimser sürüm, kilit, serileştirme, bayat yazma koruması veya yarışa duyarlı davranış maddi olarak değişir; idempotency/komut kimliği değişmez.',
  '- `BOTH`: iki aile birlikte maddi olarak değişir.',
  '- `NEITHER_OR_OTHER`: iki aile de maddi olarak değişmez (yalnız D0/D2/D3/D4) ya da diff karar vermeye yetmez.',
  '',
  'Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Yön sorulmuyor.',
  'Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka düşer (`dusen.json`); etiket değiştirilmez, yerine yenisi konmaz.', ''];
for (const { no, c } of blind) R.push(`## Vaka ${no}`, '', ...block(c), '', 'Etiket: `________`', '');
writeFileSync(path.join(here, 'ikinci-okuyucu.md'), `${R.join('\n')}\n`);

const K = ['# H19u ikinci okuyucu anahtarı', '', '| No | Vaka | Katman | Etiket | Aile | Yön (kayıt) | Gerekçe |', '|---|---|---|---|---|---|---|'];
for (const { no, c } of blind) K.push(`| ${no} | ${c.case_id} | ${c.layer}${c.axes.length ? ` (${c.axes.join(', ')})` : ''} | ${c.label} | ${c.family} | ${c.direction ?? '—'} | ${c.rationale} |`);
writeFileSync(path.join(here, 'ikinci-okuyucu-anahtar.md'), `${K.join('\n')}\n`);

const A = ['# H19u vakaları (vakalar.v0.1.json, okunur liste)', ''];
for (const c of cases) {
  A.push(`## ${c.case_id} · ${c.layer} · ${c.label}${c.axes.length ? ` (${c.axes.join(', ')})` : ''}${c.direction ? ` · ${c.direction}` : ''} · aile: ${c.family}${c.family_group ? ` [${c.family_group}]` : ''}${c.function_reused ? ' · fonksiyon yeniden kullanıldı' : ''}`, '',
    c.rationale, '', `Betimleyici (Jev'e verilmez): \`${JSON.stringify(c.descriptive)}\``, '', ...block(c), '');
}
writeFileSync(path.join(here, 'vakalar.md'), `${A.join('\n')}\n`);
console.log(`tohum ${frozenSha.slice(0, 8)} · örneklem: ${blind.map(({ no, c }) => `${no}=${c.case_id}`).join(' ')}`);
