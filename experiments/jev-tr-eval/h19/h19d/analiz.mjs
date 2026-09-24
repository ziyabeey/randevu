#!/usr/bin/env node
// H19d analizi (H19D-PROTOKOL v0.1 §10–§16). V1 çalışmadan ÖNCE yazıldı; Jev çağrısı yapmaz.
// Kör okuyucu uyuşmazlıkları dusen.json'da (["PS03", ...]) verilirse o vakalar düşer (H19d'de önceden
// tanımlı eşlenmiş çift yok).
//
//   node h19/h19d/analiz.mjs h19/h19d/sonuc/<ts>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? '');
const all = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8')).cases;
const droppedFile = path.join(here, 'dusen.json');
const dropped = new Set(existsSync(droppedFile) ? JSON.parse(readFileSync(droppedFile, 'utf8')) : []);
const cases = all.filter((c) => !dropped.has(c.case_id));
const run = (name) => Object.fromEntries(JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')).rows.map((r) => [r.case_id, r.axis_probabilities]));
const V1 = run('V1'); const V2 = run('V2');

// ---- donmuş skorlar (§2) ----
const B = (p) => p.D5;
const S0 = (p) => p.D5 - Math.max(p.D0, p.D1, p.D2, p.D3, p.D4);
const S1 = (p) => p.D5 - Math.max(p.D0, p.D2, p.D3, p.D4);
const routeB = (p) => p.D5 >= 0.5;
const routeS0 = (p) => S0(p) > 0;
const routeS1 = (p) => S1(p) > 0;

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const auc = (pos, neg) => { let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (pos.length * neg.length); };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—'); const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const pct = (x) => (Number.isFinite(x) ? `%${(x * 100).toFixed(1)}` : '—');
const pass = (ok) => (ok ? '**geçti**' : '**kaldı**');
function wilson(k, n) {
  if (!n) return [NaN, NaN];
  const z = 1.96; const p = k / n; const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d; const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const rate = (list, route, R) => { const k = list.filter((c) => route(R[c.case_id])).length; return { k, n: list.length, r: list.length ? k / list.length : NaN }; };
const rateText = ({ k, n, r }) => { const [lo, hi] = wilson(k, n); return `${k}/${n} = ${pct(r)} (Wilson %95: ${pct(lo)}–${pct(hi)})`; };

const P = cases.filter((c) => c.d5); const N = cases.filter((c) => !c.d5);
const L = (name) => cases.filter((c) => c.layer === name);
const PS = L('PS'); const PP = L('PP'); const NS = L('NS'); const NP = L('NP');
const aucOf = (score, R, pos, neg) => auc(pos.map((c) => score(R[c.case_id])), neg.map((c) => score(R[c.case_id])));

// Vaka kimliği üzerinden eşleştirilmiş bootstrap: pozitif ve negatif vakalar ayrı yeniden örneklenir.
function bootstrap(scoreA, scoreB, R, pos, neg, reps = 10000) {
  let seed = 20260924;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const draw = (list) => list.map(() => list[Math.floor(rnd() * list.length)]);
  const d = [];
  for (let i = 0; i < reps; i += 1) { const p = draw(pos); const n = draw(neg); d.push(aucOf(scoreA, R, p, n) - aucOf(scoreB, R, p, n)); }
  d.sort((x, y) => x - y);
  return [d[Math.floor(0.025 * reps)], d[Math.floor(0.975 * reps) - 1]];
}

function evaluate(score, route, name) {
  const aucS = aucOf(score, V1, P, N); const aucB = aucOf(B, V1, P, N);
  const [lo, hi] = bootstrap(score, B, V1, P, N);
  const d1 = aucS >= 0.80 && aucS - aucB >= 0.05 && lo > 0;
  const tpr = rate(P, route, V1); const tprPS = rate(PS, route, V1); const tprPP = rate(PP, route, V1);
  const fpr = rate(N, route, V1); const fprNP = rate(NP, route, V1);
  const bT = rate(P, routeB, V1); const bF = rate(N, routeB, V1);
  const dominated = bT.r >= tpr.r && bF.r <= fpr.r && (bT.r > tpr.r || bF.r < fpr.r);
  const d2 = tpr.r >= 0.90 && tprPS.r >= 0.90 && tprPP.r >= 0.85 && fpr.r <= 0.25 && fprNP.r <= 0.30 && !dominated;
  const sub = (f) => rate(P.filter(f), route, V1);
  const cueY = sub((c) => c.descriptive.cue); const cueN = sub((c) => !c.descriptive.cue);
  const lockY = sub((c) => c.descriptive.lock_context); const lockN = sub((c) => !c.descriptive.lock_context);
  const negAxis = ['D0', 'D1', 'D2', 'D3', 'D4'].map((a) => ({ a, ...rate(N.filter((c) => c.axes.includes(a)), route, V1) }));
  const d3 = cueY.r >= 0.80 && cueN.r >= 0.80 && lockY.r >= 0.80 && lockN.r >= 0.80 && negAxis.every((g) => !(g.r > 0.50));
  const diff = cases.map((c) => Math.abs(score(V1[c.case_id]) - score(V2[c.case_id])));
  const agree = mean(cases.map((c) => (route(V1[c.case_id]) === route(V2[c.case_id]) ? 1 : 0)));
  const auc2 = aucOf(score, V2, P, N); const tpr2 = rate(P, route, V2); const fpr2 = rate(N, route, V2);
  const d4 = mean(diff) <= 0.05 && agree >= 0.90 && aucS - auc2 <= 0.10 && tpr.r - tpr2.r <= 0.10 && fpr2.r - fpr.r <= 0.10;
  const out = [`## ${name}`, '',
    '### D1: göreli skorun ham P(D5)\'e katkısı', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
    `| AUC (${name}) | ${f3(aucS)} | ≥ 0.80 | ${pass(aucS >= 0.80)} |`,
    `| AUC ham P(D5) | ${f3(aucB)} | | |`,
    `| Fark | ${f3(aucS - aucB)} (bootstrap %95: ${f3(lo)} … ${f3(hi)}) | ≥ +0.05, alt sınır > 0 | ${pass(aucS - aucB >= 0.05 && lo > 0)} |`,
    '', `Ek (rapor): P-single ile tüm negatifler ${f3(aucOf(score, V1, PS, N))} · P-pair ile tüm negatifler ${f3(aucOf(score, V1, PP, N))} · **P-pair ile N-pair ${f3(aucOf(score, V1, PP, NP))}**${aucOf(score, V1, PP, NP) < 0.70 ? ' (< 0.70: "çift eksenli D5\'e genelleniyor" iddiası yapılamaz)' : ''}.`,
    `Aynı alt kümelerde ham P(D5): ${f3(aucOf(B, V1, PS, N))} · ${f3(aucOf(B, V1, PP, N))} · ${f3(aucOf(B, V1, PP, NP))}.`,
    '', `### D2: operasyonel router (${name} > 0)`, '', '| Ölçüt | Değer | Eşik |', '|---|---|---|',
    `| Genel TPR | ${rateText(tpr)} | ≥ %90 |`, `| P-single TPR | ${rateText(tprPS)} | ≥ %90 |`, `| P-pair TPR | ${rateText(tprPP)} | ≥ %85 |`,
    `| Genel FPR | ${rateText(fpr)} | ≤ %25 |`, `| N-pair FPR | ${rateText(fprNP)} | ≤ %30 |`,
    `| Baseline P(D5) ≥ 0.50 | TPR ${rateText(bT)} · FPR ${rateText(bF)} | ${dominated ? '**baseline katı üstün: D2 kalır**' : 'katı üstün değil'} |`,
    '', `D2: ${pass(d2)}`,
    '', '### D3: bağlam dayanıklılığı', '', '| Grup | Değer | Eşik |', '|---|---|---|',
    `| İpucu olan pozitifler TPR | ${rateText(cueY)} | ≥ %80 |`, `| İpucusuz pozitifler TPR | ${rateText(cueN)} | ≥ %80 |`,
    `| lock_context=true pozitifler TPR | ${rateText(lockY)} | ≥ %80 |`, `| lock_context=false pozitifler TPR | ${rateText(lockN)} | ≥ %80 |`,
    ...negAxis.map((g) => `| Negatif, ${g.a} içeren FPR | ${rateText(g)} | ≤ %50 |`),
    '', `D3: ${pass(d3)}`,
    '', '### D4: kararlılık (V1 ile V2)', '', '| Ölçüt | Değer | Eşik |', '|---|---|---|',
    `| ort. \\|skor V1 − V2\\| | ${f3(mean(diff))} | ≤ 0.05 |`, `| Route karar uyumu | ${pct(agree)} | ≥ %90 |`,
    `| AUC V1 → V2 | ${f3(aucS)} → ${f3(auc2)} | düşüş ≤ 0.10 |`, `| TPR V1 → V2 | ${pct(tpr.r)} → ${pct(tpr2.r)} | düşüş ≤ 10 puan |`,
    `| FPR V1 → V2 | ${pct(fpr.r)} → ${pct(fpr2.r)} | artış ≤ 10 puan |`,
    '', `D4: ${pass(d4)}`, ''];
  return { d1, d2, d3, d4, out };
}

const H = [`# H19d sonuçları (${path.basename(dir)})`, '',
  'Protokol: H19D-PROTOKOL v0.1 (6992921). Analiz kodu V1 çalışmadan önce yazıldı.',
  `Düşen vakalar (kör okuyucu uyuşmazlığı): ${dropped.size ? [...dropped].join(', ') : 'yok'}. Analizdeki vaka: ${cases.length} (pozitif ${P.length}, negatif ${N.length}).`, ''];
const s0 = evaluate(S0, routeS0, 'S0 = P(D5) − max(D0..D4) — birincil');
const s1 = evaluate(S1, routeS1, 'S1 = P(D5) − max(D0,D2,D3,D4) — ikincil, seçilemez');

let verdict;
if (s0.d1 && s0.d2 && s0.d3 && s0.d4) verdict = 'D1+D2+D3+D4 geçti → H19d başarılı; H19e (gölge router) açılabilir. Desteklenen iddia yalnız protokol §16\'daki dar cümledir.';
else if (s0.d1 && !s0.d2) verdict = 'D1 geçti, D2 kaldı → göreli matematik ranker olarak destekli, router olarak değil; eşik aynı veride yeniden ayarlanmaz.';
else if (!s0.d1 && s0.d2) verdict = 'D2 geçti, D1 kaldı → router çalışmış olabilir ama göreli skorun ham D5\'e ek değeri gösterilmedi; baseline korunur.';
else verdict = 'Birincil kapılardan biri veya birkaçı kaldı → üretim/gölge promosyonu yok.';
H.push(`**Sonuç kuralı (§16), S0:** D1 ${s0.d1 ? 'geçti' : 'kaldı'} · D2 ${s0.d2 ? 'geçti' : 'kaldı'} · D3 ${s0.d3 ? 'geçti' : 'kaldı'} · D4 ${s0.d4 ? 'geçti' : 'kaldı'} → ${verdict}`);
const s1all = s1.d1 && s1.d2 && s1.d3 && s1.d4;
H.push('', `**S1 (§14):** ${s1all ? (s0.d1 && s0.d2 && s0.d3 && s0.d4 ? 'S1 de bütün eşikleri geçti; üretim adayı yine S0.' : '"D1-excluded score prospectively promising; bağımsız yeni doğrulama gerekir." (S1 birincil sonucu kurtarmaz.)') : 'S1 bütün eşikleri geçmedi.'}`, '');
H.push(...s0.out, ...s1.out);

// ---- §12 katman raporu (eşiksiz) ----
H.push('## Katman bazında (V1, eşiksiz rapor)', '', '| Grup | n | ham P(D5) ort. | S0 ort. | S1 ort. | route_B | route_S0 | route_S1 |', '|---|---|---|---|---|---|---|---|');
const groups = [
  ['PS', PS], ['PP', PP], ['NS', NS], ['NP', NP],
  ...['D0', 'D1', 'D2', 'D3', 'D4'].map((a) => [`PP D5×${a}`, PP.filter((c) => c.axes[0] === a)]),
  ...['D0', 'D1', 'D2', 'D3', 'D4'].map((a) => [`negatif ${a} içeren`, N.filter((c) => c.axes.includes(a))]),
  ['pozitif, lock_context', P.filter((c) => c.descriptive.lock_context)], ['pozitif, kilitsiz', P.filter((c) => !c.descriptive.lock_context)],
  ['negatif, lock_context', N.filter((c) => c.descriptive.lock_context)], ['negatif, kilitsiz', N.filter((c) => !c.descriptive.lock_context)],
  ['pozitif, ipucu', P.filter((c) => c.descriptive.cue)], ['pozitif, ipucusuz', P.filter((c) => !c.descriptive.cue)],
  ['negatif, ipucu', N.filter((c) => c.descriptive.cue)], ['negatif, ipucusuz', N.filter((c) => !c.descriptive.cue)],
];
for (const [name, list] of groups) {
  const v = (f) => mean(list.map((c) => f(V1[c.case_id])));
  const r = (route) => `${list.filter((c) => route(V1[c.case_id])).length}/${list.length}`;
  H.push(`| ${name} | ${list.length} | ${f2(v(B))} | ${f2(v(S0))} | ${f2(v(S1))} | ${r(routeB)} | ${r(routeS0)} | ${r(routeS1)} |`);
}
H.push('', '## Vaka bazında (V1)', '', '| Vaka | katman | etiket | D0 | D1 | D2 | D3 | D4 | D5 | S0 | route_B | route_S0 | V2 S0 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const p = V1[c.case_id];
  H.push(`| ${c.case_id} | ${c.layer} | ${c.d5 ? 'D5' : 'no'}${c.axes.length ? ` +${c.axes.join('')}` : ''} | ${['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].map((a) => f2(p[a])).join(' | ')} | ${f2(S0(p))} | ${routeB(p) ? 'R' : '·'} | ${routeS0(p) ? 'R' : '·'} | ${f2(S0(V2[c.case_id]))} |`);
}

writeFileSync(path.join(dir, 'rapor.md'), `${H.join('\n')}\n`);
console.log(H.join('\n'));
