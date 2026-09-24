#!/usr/bin/env node
// H19t analizi (H19T-PROTOKOL v0.1 §6–§10). V1 çalışmadan ÖNCE yazıldı; Jev çağrısı yapmaz.
// Yalnız iki sabit çalışma noktası hesaplanır: route_T := P(D5) >= 0.64 (birincil) ve
// route_B := P(D5) >= 0.50 (karşılaştırma). Başka eşik veya skor hesaplanmaz (§1, §11); AUC yalnız tanısal.
// Kör okuyucu uyuşmazlıkları dusen.json'da (["PS03", ...]) verilirse o vakalar düşer.
//
//   node h19/h19t/analiz.mjs h19/h19t/sonuc/<ts>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? '');
const all = JSON.parse(readFileSync(path.join(here, 'vakalar.v0.1.json'), 'utf8')).cases;
const droppedFile = path.join(here, 'dusen.json');
const dropped = new Set(existsSync(droppedFile) ? JSON.parse(readFileSync(droppedFile, 'utf8')) : []);
const cases = all.filter((c) => !dropped.has(c.case_id));
const load = (name) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')).rows;
const rows1 = load('V1'); const rows2 = load('V2');
const V1 = Object.fromEntries(rows1.map((r) => [r.case_id, r.axis_probabilities]));
const V2 = Object.fromEntries(rows2.map((r) => [r.case_id, r.axis_probabilities]));
for (const c of cases) if (!V1[c.case_id] || !V2[c.case_id]) throw new Error(`eksik sonuç: ${c.case_id}`);

// ---- donmuş çalışma noktaları (§1) ----
const TAU = 0.64;
const BASE = 0.50;
const D5 = (p) => p.D5;
const routeT = (p) => p.D5 >= TAU;
const routeB = (p) => p.D5 >= BASE;

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const auc = (pos, neg) => { let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (pos.length * neg.length); };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—'); const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const pct = (x) => (Number.isFinite(x) ? `%${(x * 100).toFixed(1)}` : '—');
const pp = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)} puan` : '—');
const pass = (ok) => (ok ? '**geçti**' : '**kaldı**');
function wilson(k, n) {
  if (!n) return [NaN, NaN];
  const z = 1.96; const p = k / n; const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d; const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function hanleyMcNeil(a, nPos, nNeg) {
  const q1 = a / (2 - a); const q2 = (2 * a * a) / (1 + a);
  const se = Math.sqrt((a * (1 - a) + (nPos - 1) * (q1 - a * a) + (nNeg - 1) * (q2 - a * a)) / (nPos * nNeg));
  return [Math.max(0, a - 1.96 * se), Math.min(1, a + 1.96 * se)];
}
const rate = (list, route, R) => { const k = list.filter((c) => route(R[c.case_id])).length; return { k, n: list.length, r: list.length ? k / list.length : NaN }; };
const rateText = ({ k, n, r }) => { const [lo, hi] = wilson(k, n); return `${k}/${n} = ${pct(r)} (Wilson %95: ${pct(lo)}–${pct(hi)})`; };

const P = cases.filter((c) => c.d5); const N = cases.filter((c) => !c.d5);
const L = (name) => cases.filter((c) => c.layer === name);
const PS = L('PS'); const PP = L('PP'); const NS = L('NS'); const NP = L('NP');
const AXES = ['D0', 'D1', 'D2', 'D3', 'D4'];
const ppGroup = (a) => PP.filter((c) => c.axes[0] === a);
const negAxis = (a) => N.filter((c) => c.axes.includes(a));

const H = [`# H19t sonuçları (${path.basename(dir)})`, '',
  'Protokol: H19T-PROTOKOL v0.1 (58cf9ea). Analiz kodu V1 çalışmadan önce yazıldı.',
  `Çalışma noktaları: route_T := P(D5) ≥ ${TAU} (birincil) · route_B := P(D5) ≥ ${BASE.toFixed(2)} (karşılaştırma). Başka eşik hesaplanmaz.`,
  `Düşen vakalar (kör okuyucu uyuşmazlığı): ${dropped.size ? [...dropped].join(', ') : 'yok'}. Analizdeki vaka: ${cases.length} (pozitif ${P.length}, negatif ${N.length}).`, ''];

// ---- T1: yakalama (§6) ----
const tpr = rate(P, routeT, V1); const tprPS = rate(PS, routeT, V1); const tprPP = rate(PP, routeT, V1);
const ppAxis = AXES.map((a) => ({ a, ...rate(ppGroup(a), routeT, V1) }));
const t1 = tpr.r >= 0.90 && tprPS.r >= 0.90 && tprPP.r >= 0.85 && ppAxis.every((g) => !(g.r < 0.75));
H.push('## T1: yakalama (V1, τ = 0.64)', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| Genel D5 TPR | ${rateText(tpr)} | ≥ %90 | ${pass(tpr.r >= 0.90)} |`,
  `| PS TPR | ${rateText(tprPS)} | ≥ %90 | ${pass(tprPS.r >= 0.90)} |`,
  `| PP TPR | ${rateText(tprPP)} | ≥ %85 | ${pass(tprPP.r >= 0.85)} |`,
  ...ppAxis.map((g) => `| PP ${g.a}×D5 TPR | ${rateText(g)} | ≥ %75 | ${pass(!(g.r < 0.75))} |`),
  '', `T1: ${pass(t1)}`, '');

// ---- T2: yanlış alarm ve System Two yükü (§6) ----
const fpr = rate(N, routeT, V1); const fprNP = rate(NP, routeT, V1);
const negAxisT = AXES.map((a) => ({ a, ...rate(negAxis(a), routeT, V1) }));
const loadT = rate(cases, routeT, V1); const loadB = rate(cases, routeB, V1);
const loadCut = loadB.r - loadT.r;
const t2 = fpr.r <= 0.35 && fprNP.r <= 0.35 && negAxisT.every((g) => !(g.r > 0.60)) && loadCut >= 0.10;
H.push('## T2: yanlış alarm ve System Two yükü (V1, τ = 0.64)', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| Genel FPR | ${rateText(fpr)} | ≤ %35 | ${pass(fpr.r <= 0.35)} |`,
  `| NP FPR | ${rateText(fprNP)} | ≤ %35 | ${pass(fprNP.r <= 0.35)} |`,
  ...negAxisT.map((g) => `| Negatif, ${g.a} içeren FPR | ${rateText(g)} | ≤ %60 | ${pass(!(g.r > 0.60))} |`),
  `| Toplam route oranı route_T | ${rateText(loadT)} | | |`,
  `| Toplam route oranı route_B | ${rateText(loadB)} | | |`,
  `| Yük azalması (route_B − route_T) | ${pp(loadCut)} | ≥ 10 puan | ${pass(loadCut >= 0.10)} |`,
  '', `T2: ${pass(t2)}`, '');

// ---- T3: baseline'a göre ödünleşim (§6) ----
const bT = rate(P, routeB, V1); const bPP = rate(PP, routeB, V1); const bF = rate(N, routeB, V1);
const tprLoss = bT.r - tpr.r; const ppLoss = bPP.r - tprPP.r; const fprCut = bF.r - fpr.r;
const t3 = tprLoss <= 0.10 && ppLoss <= 0.15 && fprCut >= 0.10;
H.push('## T3: baseline (τ = 0.50) ile ödünleşim (V1)', '', '| Ölçüt | τ = 0.50 | τ = 0.64 | Fark | Eşik | |', '|---|---|---|---|---|---|',
  `| Genel TPR | ${rateText(bT)} | ${rateText(tpr)} | kayıp ${pp(tprLoss)} | kayıp ≤ 10 puan | ${pass(tprLoss <= 0.10)} |`,
  `| PP TPR | ${rateText(bPP)} | ${rateText(tprPP)} | kayıp ${pp(ppLoss)} | kayıp ≤ 15 puan | ${pass(ppLoss <= 0.15)} |`,
  `| Genel FPR | ${rateText(bF)} | ${rateText(fpr)} | düşüş ${pp(fprCut)} | düşüş ≥ 10 puan | ${pass(fprCut >= 0.10)} |`,
  '', `T3: ${pass(t3)}`, '');

// ---- T4: bağlam dayanıklılığı (§7) ----
const sub = (list, f, R = V1) => rate(list.filter(f), routeT, R);
const cueP = sub(P, (c) => c.descriptive.cue); const noCueP = sub(P, (c) => !c.descriptive.cue);
const lockP = sub(P, (c) => c.descriptive.lock_context); const noLockP = sub(P, (c) => !c.descriptive.lock_context);
const cueN = sub(N, (c) => c.descriptive.cue); const noCueN = sub(N, (c) => !c.descriptive.cue);
const t4 = cueP.r >= 0.85 && noCueP.r >= 0.85 && lockP.r >= 0.85 && noLockP.r >= 0.85 && cueN.r <= 0.45 && noCueN.r <= 0.45;
H.push('## T4: bağlam dayanıklılığı (V1, τ = 0.64)', '', '| Grup | Değer | Eşik | |', '|---|---|---|---|',
  `| İpucu olan pozitifler TPR | ${rateText(cueP)} | ≥ %85 | ${pass(cueP.r >= 0.85)} |`,
  `| İpucusuz pozitifler TPR | ${rateText(noCueP)} | ≥ %85 | ${pass(noCueP.r >= 0.85)} |`,
  `| lock_context=true pozitifler TPR | ${rateText(lockP)} | ≥ %85 | ${pass(lockP.r >= 0.85)} |`,
  `| lock_context=false pozitifler TPR | ${rateText(noLockP)} | ≥ %85 | ${pass(noLockP.r >= 0.85)} |`,
  `| İpucu olan negatifler FPR | ${rateText(cueN)} | ≤ %45 | ${pass(cueN.r <= 0.45)} |`,
  `| İpucusuz negatifler FPR | ${rateText(noCueN)} | ≤ %45 | ${pass(noCueN.r <= 0.45)} |`,
  '', `T4: ${pass(t4)}`, '');

// ---- T5: tur kararlılığı (§8) ----
const diff = cases.map((c) => Math.abs(D5(V1[c.case_id]) - D5(V2[c.case_id])));
const agree = mean(cases.map((c) => (routeT(V1[c.case_id]) === routeT(V2[c.case_id]) ? 1 : 0)));
const tpr2 = rate(P, routeT, V2); const fpr2 = rate(N, routeT, V2); const tprPP2 = rate(PP, routeT, V2);
const t5 = mean(diff) <= 0.05 && agree >= 0.90 && tpr.r - tpr2.r <= 0.10 && fpr2.r - fpr.r <= 0.10 && tprPP.r - tprPP2.r <= 0.15;
H.push('## T5: tur kararlılığı (V1 ile V2)', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| ort. \\|P(D5) V1 − V2\\| | ${f3(mean(diff))} (en büyük ${f3(Math.max(...diff))}) | ≤ 0.05 | ${pass(mean(diff) <= 0.05)} |`,
  `| route_T karar uyumu | ${pct(agree)} | ≥ %90 | ${pass(agree >= 0.90)} |`,
  `| Genel TPR V1 → V2 | ${pct(tpr.r)} → ${pct(tpr2.r)} | düşüş ≤ 10 puan | ${pass(tpr.r - tpr2.r <= 0.10)} |`,
  `| Genel FPR V1 → V2 | ${pct(fpr.r)} → ${pct(fpr2.r)} | artış ≤ 10 puan | ${pass(fpr2.r - fpr.r <= 0.10)} |`,
  `| PP TPR V1 → V2 | ${pct(tprPP.r)} → ${pct(tprPP2.r)} | düşüş ≤ 15 puan | ${pass(tprPP.r - tprPP2.r <= 0.15)} |`,
  '', `T5: ${pass(t5)}`, '');

// ---- §10 sonuç kuralı ----
const passed = t1 && t2 && t3 && t4 && t5;
const verdict = passed
  ? 'T1–T5 geçti → H19t geçti. Desteklenen iddia yalnız §10\'daki dar cümledir. Sonraki adım H19s: gerçek akışta yalnız gölge, otomatik karar yok.'
  : 'En az bir kapı kaldı → τ = 0.64 terfi etmez; aynı sette yeni eşik aranmaz; ham P(D5) yalnız sıralayıcı olarak kalır; H19s açılmaz.';
H.splice(5, 0, '', `**Sonuç kuralı (§10):** T1 ${t1 ? 'geçti' : 'kaldı'} · T2 ${t2 ? 'geçti' : 'kaldı'} · T3 ${t3 ? 'geçti' : 'kaldı'} · T4 ${t4 ? 'geçti' : 'kaldı'} · T5 ${t5 ? 'geçti' : 'kaldı'} → ${verdict}`);

// ---- §9 ikincil raporlar (eşiksiz; yeni kapı veya eşik üretmez) ----
H.push('## İkincil raporlar (§9; eşik üretmez)', '');
const aucV1 = auc(P.map((c) => D5(V1[c.case_id])), N.map((c) => D5(V1[c.case_id])));
const aucV2 = auc(P.map((c) => D5(V2[c.case_id])), N.map((c) => D5(V2[c.case_id])));
const [alo, ahi] = hanleyMcNeil(aucV1, P.length, N.length);
const aucPPNP = auc(PP.map((c) => D5(V1[c.case_id])), NP.map((c) => D5(V1[c.case_id])));
H.push(`Ham P(D5) AUC (tanısal): V1 ${f3(aucV1)} (Hanley–McNeil %95: ${f3(alo)}–${f3(ahi)}) · V2 ${f3(aucV2)} · PP–NP (V1) ${f3(aucPPNP)}.`, '');

H.push('### P(D5) dağılımı (V1)', '', '| Katman | n | ort. | medyan | en küçük | en büyük |', '|---|---|---|---|---|---|');
for (const [name, list] of [['PS', PS], ['PP', PP], ['NS', NS], ['NP', NP]]) {
  const xs = list.map((c) => D5(V1[c.case_id]));
  H.push(`| ${name} | ${list.length} | ${f3(mean(xs))} | ${f3(median(xs))} | ${f3(Math.min(...xs))} | ${f3(Math.max(...xs))} |`);
}

H.push('', '### Katmanlar ve aileler (V1)', '', '| Grup | n | P(D5) ort. | route_T | route_B |', '|---|---|---|---|---|');
const families = [...new Set(cases.map((c) => c.family))].sort();
const groups = [
  ['PS', PS], ['PS weakens', PS.filter((c) => c.direction === 'weakens')], ['PS strengthens', PS.filter((c) => c.direction === 'strengthens')],
  ['PP', PP], ['NS', NS], ['NP', NP],
  ...AXES.map((a) => [`PP ${a}×D5`, ppGroup(a)]),
  ...AXES.map((a) => [`NS ${a}`, NS.filter((c) => c.axes[0] === a)]),
  ...AXES.map((a) => [`negatif, ${a} içeren`, negAxis(a)]),
  ['pozitif, ipucu', P.filter((c) => c.descriptive.cue)], ['pozitif, ipucusuz', P.filter((c) => !c.descriptive.cue)],
  ['negatif, ipucu', N.filter((c) => c.descriptive.cue)], ['negatif, ipucusuz', N.filter((c) => !c.descriptive.cue)],
  ['pozitif, lock_context', P.filter((c) => c.descriptive.lock_context)], ['pozitif, kilitsiz', P.filter((c) => !c.descriptive.lock_context)],
  ['negatif, lock_context', N.filter((c) => c.descriptive.lock_context)], ['negatif, kilitsiz', N.filter((c) => !c.descriptive.lock_context)],
  ['pozitif, removed-predicate', P.filter((c) => c.descriptive.removed_predicate)], ['negatif, removed-predicate', N.filter((c) => c.descriptive.removed_predicate)],
  ...families.map((f) => [`aile: ${f}`, cases.filter((c) => c.family === f)]),
];
for (const [name, list] of groups) {
  if (!list.length) continue;
  const r = (route) => { const k = list.filter((c) => route(V1[c.case_id])).length; const [lo, hi] = wilson(k, list.length); return `${k}/${list.length} (${pct(lo)}–${pct(hi)})`; };
  H.push(`| ${name} | ${list.length} | ${f2(mean(list.map((c) => D5(V1[c.case_id]))))} | ${r(routeT)} | ${r(routeB)} |`);
}

const precision = (route) => { const tp = P.filter((c) => route(V1[c.case_id])).length; const fp = N.filter((c) => route(V1[c.case_id])).length; return { tp, fp, r: tp + fp ? tp / (tp + fp) : NaN }; };
const precT = precision(routeT); const precB = precision(routeB);
H.push('', '### Precision (yalnız bu dengeli test setinin %50 prevalansında; üretim prevalansı olarak yorumlanmaz)', '',
  `- τ = 0.64: ${precT.tp}/${precT.tp + precT.fp} = ${pct(precT.r)}`,
  `- τ = 0.50: ${precB.tp}/${precB.tp + precB.fp} = ${pct(precB.r)}`, '');

const tokens = (rows) => rows.map((r) => r.input_tokens); const lat = (rows) => rows.map((r) => r.latency_ms);
H.push('### Token ve gecikme', '', '| Tur | input token ort. | medyan | gecikme ort. (ms) | medyan (ms) |', '|---|---|---|---|---|',
  `| V1 | ${f2(mean(tokens(rows1)))} | ${median(tokens(rows1))} | ${f2(mean(lat(rows1)))} | ${median(lat(rows1))} |`,
  `| V2 | ${f2(mean(tokens(rows2)))} | ${median(tokens(rows2))} | ${f2(mean(lat(rows2)))} | ${median(lat(rows2))} |`, '');

H.push('## Vaka bazında (V1)', '', '| Vaka | katman | etiket | D0 | D1 | D2 | D3 | D4 | D5 | route_T | route_B | V2 D5 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const p = V1[c.case_id];
  H.push(`| ${c.case_id} | ${c.layer} | ${c.d5 ? 'D5' : 'no'}${c.axes.length ? ` +${c.axes.join('')}` : ''} | ${['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].map((a) => f2(p[a])).join(' | ')} | ${routeT(p) ? 'R' : '·'} | ${routeB(p) ? 'R' : '·'} | ${f2(D5(V2[c.case_id]))} |`);
}

writeFileSync(path.join(dir, 'rapor.md'), `${H.join('\n')}\n`);
console.log(H.join('\n'));
