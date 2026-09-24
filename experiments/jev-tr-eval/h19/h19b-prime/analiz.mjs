#!/usr/bin/env node
// H19b′ analizi (H19B-PRIME-PROTOKOL v0.1 §6–§11). Ölçümden ÖNCE yazıldı; Jev çağrısı yapmaz.
// Kör okuyucu uyuşmazlıkları dusen.json'da (["AP03", ...]) verilirse o vakalar ve eşleri analizden düşer.
//
//   node h19/h19b-prime/analiz.mjs h19/h19b-prime/sonuc/<ts>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auc, naiveFeatures } from './taban.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? '');
const all = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8')).cases;
const droppedFile = path.join(here, 'dusen.json');
const dropped = existsSync(droppedFile) ? JSON.parse(readFileSync(droppedFile, 'utf8')) : [];
const pairOf = Object.fromEntries(all.map((c) => [c.case_id, c.pair]));
const excluded = new Set(dropped.flatMap((id) => [id, pairOf[id]]));
const cases = all.filter((c) => !excluded.has(c.case_id));
const arm = (name) => Object.fromEntries(JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')).rows.map((r) => [r.case_id, r]));
const JF1 = arm('JF1'); const JF2 = arm('JF2'); const J0 = arm('J0'); const V = arm('V');

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const ids = (cells) => cases.filter((c) => cells.includes(c.cell)).map((c) => c.case_id);
const byId = Object.fromEntries(cases.map((c) => [c.case_id, c]));
const det = (A, id) => (A === V ? A[id].axis_probabilities.D5 : A[id].verdict.probabilities.weakens + A[id].verdict.probabilities.strengthens);
const choice = (A, id) => A[id].verdict.choice;
const aucOf = (A, pos, neg) => auc(pos.map((id) => det(A, id)), neg.map((id) => det(A, id)));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—'); const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const pct = (x) => `%${(x * 100).toFixed(1)}`;
const pass = (ok) => (ok ? '**geçti**' : '**kaldı**');

// Vaka kimliği üzerinden eşleştirilmiş bootstrap (pozitif ve negatif hücreler ayrı yeniden örneklenir;
// bir vakanın iki koldaki skoru birlikte taşınır). 10 000 tekrar, sabit tohum.
function bootstrapDiff(A, B, pos, neg, reps = 10000) {
  let seed = 20260924;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const draw = (list) => list.map(() => list[Math.floor(rand() * list.length)]);
  const diffs = [];
  for (let r = 0; r < reps; r += 1) {
    const p = draw(pos); const n = draw(neg);
    diffs.push(aucOf(A, p, n) - aucOf(B, p, n));
  }
  diffs.sort((x, y) => x - y);
  return [diffs[Math.floor(0.025 * reps)], diffs[Math.floor(0.975 * reps) - 1]];
}

const B = ids('B'); const C = ids('C');
const L = [`# H19b′ sonuçları (${path.basename(dir)})`, '',
  'Protokol: H19B-PRIME-PROTOKOL v0.1 (5bc1aed). Analiz kodu ölçümden önce yazıldı.',
  `Düşen vakalar (kör okuyucu uyuşmazlığı ve eşleri): ${excluded.size ? [...excluded].join(', ') : 'yok'}. Analizdeki vaka: ${cases.length}.`, ''];

// ---- P1 ----
const aJF = aucOf(JF1, B, C); const aV = aucOf(V, B, C); const aJ0 = aucOf(J0, B, C);
const [p1lo, p1hi] = bootstrapDiff(JF1, V, B, C);
const P1 = aJF - aV >= 0.10 && p1lo > 0 && aJF >= 0.80;
// ---- P2 ----
const [p2lo, p2hi] = bootstrapDiff(JF1, J0, B, C);
const cInflation = mean(C.map((id) => det(JF1, id))) - mean(C.map((id) => det(J0, id)));
const P2 = aJF - aJ0 >= 0.05 && p2lo >= 0 && cInflation <= 0.05;
// ---- P3 ----
const p3 = { all: aucOf(JF1, ids('AB'), ids('CD')), ac: aucOf(JF1, ids('A'), ids('C')), bd: aucOf(JF1, ids('B'), ids('D')) };
const P3 = p3.all >= 0.80 && p3.ac >= 0.75 && p3.bd >= 0.75;
// ---- P4 ----
const noEffectAcc = (cells) => mean(ids(cells).map((id) => (choice(JF1, id) === 'no_effect' ? 1 : 0)));
const cdGap = Math.abs(mean(ids('C').map((id) => det(JF1, id))) - mean(ids('D').map((id) => det(JF1, id))));
const P4 = noEffectAcc('C') >= 0.75 && noEffectAcc('D') >= 0.75 && cdGap <= 0.10;
// ---- P5 ----
const AB = ids('AB');
const dirOk = (id) => (choice(JF1, id) === byId[id].label ? 1 : 0);
const dirAll = mean(AB.map(dirOk));
const dirW = mean(AB.filter((id) => byId[id].label === 'weakens').map(dirOk));
const dirS = mean(AB.filter((id) => byId[id].label === 'strengthens').map(dirOk));
const undet = mean(AB.map((id) => (choice(JF1, id) === 'undetermined' ? 1 : 0)));
const P5 = dirAll >= 0.80 && dirW >= 0.75 && dirS >= 0.75 && undet <= 0.15;
// ---- P6 ----
const dDet = cases.map((c) => Math.abs(det(JF1, c.case_id) - det(JF2, c.case_id)));
const agreeAB = mean(AB.map((id) => (choice(JF1, id) === choice(JF2, id) ? 1 : 0)));
const agreeAll = mean(cases.map((c) => (choice(JF1, c.case_id) === choice(JF2, c.case_id) ? 1 : 0)));
const aJF2 = aucOf(JF2, B, C);
const P6 = mean(dDet) <= 0.05 && agreeAB >= 0.90 && aJF - aJF2 <= 0.10;

L.push('## Birincil çapraz: B′ (gerçek D5, ipucu yok) ile C′ (D5 değil, kilit bağlamı var)', '',
  '| Kol | AUC(B′, C′) |', '|---|---|',
  `| JF (facts + Choice) | ${f2(aJF)} |`, `| J0 (Choice, facts yok) | ${f2(aJ0)} |`, `| V (eski D5) | ${f2(aV)} |`, '');
L.push('## Kapılar', '', '| Kapı | Ölçüt | Değer | Eşik | Sonuç |', '|---|---|---|---|---|');
L.push(`| P1 | AUC_JF − AUC_V (B′,C′) | ${f3(aJF - aV)} (bootstrap %95: ${f3(p1lo)} … ${f3(p1hi)}) | ≥ 0.10, alt sınır > 0 | ${pass(aJF - aV >= 0.10 && p1lo > 0)} |`);
L.push(`| P1 | AUC_JF (B′,C′) | ${f2(aJF)} | ≥ 0.80 | ${pass(aJF >= 0.80)} |`);
L.push(`| P2 | AUC_JF − AUC_J0 (B′,C′) | ${f3(aJF - aJ0)} (bootstrap %95: ${f3(p2lo)} … ${f3(p2hi)}) | ≥ 0.05, alt sınır ≥ 0 | ${pass(aJF - aJ0 >= 0.05 && p2lo >= 0)} |`);
L.push(`| P2 | C′ ort. detection JF − J0 | ${f3(cInflation)} | ≤ +0.05 | ${pass(cInflation <= 0.05)} |`);
L.push(`| P3 | JF1 AUC genel / A′–C′ / B′–D′ | ${f2(p3.all)} / ${f2(p3.ac)} / ${f2(p3.bd)} | ≥ 0.80 / 0.75 / 0.75 | ${pass(P3)} |`);
L.push(`| P4 | no_effect doğruluğu C′ / D′ | ${pct(noEffectAcc('C'))} / ${pct(noEffectAcc('D'))} | ≥ %75 / %75 | ${pass(noEffectAcc('C') >= 0.75 && noEffectAcc('D') >= 0.75)} |`);
L.push(`| P4 | \\|C′ − D′\\| ort. detection | ${f3(cdGap)} | ≤ 0.10 | ${pass(cdGap <= 0.10)} |`);
L.push(`| P5 | yön doğruluğu genel / weakens / strengthens | ${pct(dirAll)} / ${pct(dirW)} / ${pct(dirS)} | ≥ %80 / %75 / %75 | ${pass(dirAll >= 0.80 && dirW >= 0.75 && dirS >= 0.75)} |`);
L.push(`| P5 | undetermined (A′+B′) | ${pct(undet)} | ≤ %15 | ${pass(undet <= 0.15)} |`);
L.push(`| P6 | JF1–JF2 ort. \\|Δ detection\\| | ${f3(mean(dDet))} | ≤ 0.05 | ${pass(mean(dDet) <= 0.05)} |`);
L.push(`| P6 | yön argmax uyumu (A′+B′) / tüm vakalar | ${pct(agreeAB)} / ${pct(agreeAll)} | ≥ %90 | ${pass(agreeAB >= 0.90)} |`);
L.push(`| P6 | AUC_JF1 − AUC_JF2 (B′,C′) | ${f3(aJF - aJF2)} | ≤ 0.10 | ${pass(aJF - aJF2 <= 0.10)} |`);

let verdict;
if (P1 && P2 && P3 && P4 && P5 && P6) verdict = 'P1–P6 geçti → H19c açılır. İddia yalnız protokol §11\'deki cümledir.';
else if (!P1) verdict = 'P1 kaldı → JF mevcut V yöntemini geçmedi; H19c açılmaz.';
else if (!P2) verdict = 'P1 geçti, P2 kaldı → iyileşme Choice/framing\'e yazılır; K11\'e kredi yok; H19c açılmaz.';
else verdict = 'P1 ve P2 geçti ama P3–P6\'dan biri kaldı → performans yeterince genel, yönsel veya kararlı değil; H19c açılmaz.';
if (aJ0 > aJF) verdict += ' J0, JF\'den iyi: K11 bu kullanımda negatif katkı olarak raporlanır.';
L.push('', `**Sonuç kuralı (§11):** ${verdict}`, '');

// ---- ikincil ----
L.push('## İkincil (eşiksiz)', '', '### Hücre AUC ve ortalamalar', '', '| Kol | genel | A′–C′ | B′–D′ | B′–C′ | A′–D′ | ort. A′ | ort. B′ | ort. C′ | ort. D′ |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [name, A] of [['JF1', JF1], ['JF2', JF2], ['J0', J0], ['V', V]]) {
  L.push(`| ${name} | ${f2(aucOf(A, ids('AB'), ids('CD')))} | ${f2(aucOf(A, ids('A'), ids('C')))} | ${f2(aucOf(A, ids('B'), ids('D')))} | ${f2(aucOf(A, ids('B'), ids('C')))} | ${f2(aucOf(A, ids('A'), ids('D')))} | ${'ABCD'.split('').map((c) => f2(mean(ids(c).map((id) => det(A, id))))).join(' | ')} |`);
}
L.push('', '### Eşlenmiş fonksiyon çiftleri: pozitif skor > negatif skor oranı', '', '| Kol | A′ > C′ | B′ > D′ |', '|---|---|---|');
for (const [name, A] of [['JF1', JF1], ['J0', J0], ['V', V]]) {
  const rate = (cell) => { const list = ids(cell).filter((id) => byId[byId[id].pair]); return `${list.filter((id) => det(A, id) > det(A, byId[id].pair)).length}/${list.length}`; };
  L.push(`| ${name} | ${rate('A')} | ${rate('B')} |`);
}
L.push('', '### C′ ve D′ yanlış pozitif profili (eksene göre, JF1 argmax ≠ no_effect / ort. detection; V ort. P(D5))', '', '| Eksen | C′ JF1 | C′ V | D′ JF1 | D′ V |', '|---|---|---|---|---|');
for (const axis of ['D0', 'D2', 'D3', 'D4']) {
  const cell = (c) => cases.filter((x) => x.cell === c && x.axis === axis).map((x) => x.case_id);
  const fp = (c) => `${cell(c).filter((id) => choice(JF1, id) !== 'no_effect').length}/${cell(c).length} · ${f2(mean(cell(c).map((id) => det(JF1, id))))}`;
  L.push(`| ${axis} | ${fp('C')} | ${f2(mean(cell('C').map((id) => det(V, id))))} | ${fp('D')} | ${f2(mean(cell('D').map((id) => det(V, id))))} |`);
}
L.push('', '### A′/B′ yön hataları (JF1 / J0)', '', '| Vaka | hücre | etiket | JF1 | J0 | aileler |', '|---|---|---|---|---|---|');
for (const id of AB) if (choice(JF1, id) !== byId[id].label || choice(J0, id) !== byId[id].label) {
  L.push(`| ${id} | ${byId[id].cell}′ | ${byId[id].label} | ${choice(JF1, id)} | ${choice(J0, id)} | ${byId[id].families.join(', ')} |`);
}
L.push('', '### Önceden işaretlenmiş aileler: JF1 hata oranı (D5 için yön, D5 değil için no_effect dışı seçim)', '', '| Aile | vaka | JF1 hata | J0 hata |', '|---|---|---|---|');
const wrong = (A, id) => choice(A, id) !== byId[id].label;
for (const family of [...new Set(cases.flatMap((c) => c.families))].sort()) {
  const list = cases.filter((c) => c.families.includes(family)).map((c) => c.case_id);
  L.push(`| ${family} | ${list.length} | ${list.filter((id) => wrong(JF1, id)).length} | ${list.filter((id) => wrong(J0, id)).length} |`);
}
L.push('', '### Jev\'siz naif tabanlar (ölçümden önce hesaplandı)', '', '| Özellik | genel | A′–C′ | B′–D′ | B′–C′ |', '|---|---|---|---|---|');
for (const f of naiveFeatures(cases)) L.push(`| ${f.name} | ${f2(f.all)} | ${f2(f.ac)} | ${f2(f.bd)} | ${f2(f.bc)} |`);
const corr = (x, y) => { const mx = mean(x); const my = mean(y); let sxy = 0; let sx = 0; let sy = 0; for (let i = 0; i < x.length; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sx * sy); };
const every = cases.map((c) => c.case_id);
L.push('', '### V kolunda D1–D5 eş hareketi', '', `r(P(D1), P(D5)) tüm vakalar: ${f2(corr(every.map((id) => V[id].axis_probabilities.D1), every.map((id) => V[id].axis_probabilities.D5)))}; ort. P(D1) A′/B′/C′/D′: ${'ABCD'.split('').map((c) => f2(mean(ids(c).map((id) => V[id].axis_probabilities.D1)))).join(' / ')}.`);
L.push('', '### Token ve gecikme', '', '| Kol | ort. token | ort. gecikme (ms) |', '|---|---|---|');
for (const [name, A] of [['JF1', JF1], ['JF2', JF2], ['J0', J0], ['V', V]]) {
  const rows = cases.map((c) => A[c.case_id]);
  L.push(`| ${name} | ${Math.round(mean(rows.map((r) => r.input_tokens)))} | ${Math.round(mean(rows.map((r) => r.latency_ms)))} |`);
}
L.push('', '### Vaka bazında', '', '| Vaka | hücre | etiket | eksen | JF1 seçim | JF1 det | JF2 det | J0 seçim | J0 det | V P(D5) |', '|---|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const id = c.case_id;
  L.push(`| ${id} | ${c.cell}′ | ${c.label} | ${c.axis} | ${choice(JF1, id)} | ${f2(det(JF1, id))} | ${f2(det(JF2, id))} | ${choice(J0, id)} | ${f2(det(J0, id))} | ${f2(det(V, id))} |`);
}

writeFileSync(path.join(dir, 'rapor.md'), `${L.join('\n')}\n`);
console.log(L.join('\n'));
