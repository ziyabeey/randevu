#!/usr/bin/env node
// H19u analizi (H19U-PROTOKOL v0.1 §6–§12). V1 çalışmadan ÖNCE yazıldı; Jev çağrısı yapmaz.
// Donmuş iki aşamalı router (§1):
//   high_D5 := P(D5) >= 0.64 · high_D1 := P(D1) >= 0.64
//   P(D5) < .64 → no-route · P(D1) < .64 → route · ikisi de yüksek → route iff R1 ∈ {D5_ONLY, BOTH}
// Baseline: H19t router P(D5) >= 0.64. Başka eşik, skor veya soru hesaplanmaz (§11).
// Kör okuyucu uyuşmazlıkları dusen.json'da (["A03", ...]) verilirse o vakalar düşer.
//
//   node h19/h19u/analiz.mjs h19/h19u/sonuc/<ts>

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
const rowsV1 = load('V1'); const rowsR1 = load('R1'); const rowsR2 = load('R2');
const V1 = Object.fromEntries(rowsV1.map((r) => [r.case_id, r.axis_probabilities]));
const R1 = Object.fromEntries(rowsR1.map((r) => [r.case_id, r.resolver]));
const R2 = Object.fromEntries(rowsR2.map((r) => [r.case_id, r.resolver]));
for (const c of cases) if (!V1[c.case_id] || !R1[c.case_id] || !R2[c.case_id]) throw new Error(`eksik sonuç: ${c.case_id}`);

// ---- donmuş router (§1) ----
const TAU = 0.64;
const LABELS = ['D1_ONLY', 'D5_ONLY', 'BOTH', 'NEITHER_OR_OTHER'];
const highD5 = (id) => V1[id].D5 >= TAU;
const highD1 = (id) => V1[id].D1 >= TAU;
const ambiguous = (id) => highD5(id) && highD1(id);
const resolverRoutes = (R, id) => R[id].choice === 'D5_ONLY' || R[id].choice === 'BOTH';
const baseline = (id) => highD5(id);
const candidate = (id) => (!highD5(id) ? false : !highD1(id) ? true : resolverRoutes(R1, id));

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
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
const rate = (list, f) => { const k = list.filter((c) => f(c.case_id)).length; return { k, n: list.length, r: list.length ? k / list.length : NaN }; };
const rateText = ({ k, n, r }) => { const [lo, hi] = wilson(k, n); return `${k}/${n} = ${pct(r)} (Wilson %95: ${pct(lo)}–${pct(hi)})`; };

const L = (name) => cases.filter((c) => c.layer === name);
const A = L('A'); const B = L('B'); const C = L('C'); const D = L('D');
const D5set = [...B, ...C]; const nonD5 = [...A, ...D];

const H = [`# H19u sonuçları (${path.basename(dir)})`, '',
  'Protokol: H19U-PROTOKOL v0.1 (d39e388). Analiz kodu V1 çalışmadan önce yazıldı.',
  `Router: P(D5) ≥ ${TAU} ön filtresi · P(D1) ≥ ${TAU} ise R1 ayrıştırıcı. Baseline: P(D5) ≥ ${TAU}. Başka eşik, skor veya soru hesaplanmaz.`,
  `Düşen vakalar (kör okuyucu uyuşmazlığı): ${dropped.size ? [...dropped].join(', ') : 'yok'}. Analizdeki vaka: ${cases.length} (A ${A.length}, B ${B.length}, C ${C.length}, D ${D.length}).`, ''];

// ---- U1: ayrıştırıcının kendi yeteneği (R1, bütün vakalar) ----
const rr = (R) => (id) => resolverRoutes(R, id);
const exact = (R, list) => rate(list, (id) => R[id].choice === cases.find((c) => c.case_id === id).label);
const u1m = (R) => ({ bc: rate(D5set, rr(R)), a: rate(A, rr(R)), d: rate(D, rr(R)), c: rate(C, rr(R)), acc: exact(R, cases) });
const m1 = u1m(R1);
const u1 = m1.bc.r >= 0.90 && m1.a.r <= 0.30 && m1.d.r <= 0.25 && m1.c.r >= 0.85 && m1.acc.r >= 0.70;
H.push('## U1: ayrıştırıcı D1-only ile D5-involved\'ı ayırıyor mu (R1, bütün vakalar)', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| B+C (D5 involved) recall | ${rateText(m1.bc)} | ≥ %90 | ${pass(m1.bc.r >= 0.90)} |`,
  `| A (D1 only) FPR | ${rateText(m1.a)} | ≤ %30 | ${pass(m1.a.r <= 0.30)} |`,
  `| D (neither) FPR | ${rateText(m1.d)} | ≤ %25 | ${pass(m1.d.r <= 0.25)} |`,
  `| C (both) recall | ${rateText(m1.c)} | ≥ %85 | ${pass(m1.c.r >= 0.85)} |`,
  `| Dört sınıflı tam doğruluk | ${rateText(m1.acc)} | ≥ %70 | ${pass(m1.acc.r >= 0.70)} |`,
  '', `U1: ${pass(u1)}`, '');

// ---- U2: bileşik router (§7) ----
const cT = rate(D5set, candidate); const cB = rate(B, candidate); const cC = rate(C, candidate);
const cF = rate(nonD5, candidate); const cA = rate(A, candidate);
const bT = rate(D5set, baseline); const bC = rate(C, baseline); const bF = rate(nonD5, baseline);
const cLoad = rate(cases, candidate); const bLoad = rate(cases, baseline);
const recallLoss = bT.r - cT.r; const cLoss = bC.r - cC.r; const fprCut = bF.r - cF.r; const loadCut = bLoad.r - cLoad.r;
const u2own = cT.r >= 0.90 && cB.r >= 0.90 && cC.r >= 0.85 && cF.r <= 0.30 && cA.r <= 0.30;
const u2cmp = recallLoss <= 0.05 && cLoss <= 0.10 && fprCut >= 0.10 && loadCut >= 0.10;
const u2 = u2own && u2cmp;
H.push('## U2: bileşik router (V1 + R1)', '', '| Ölçüt | Aday | Eşik | |', '|---|---|---|---|',
  `| D5 recall (B+C) | ${rateText(cT)} | ≥ %90 | ${pass(cT.r >= 0.90)} |`,
  `| B recall | ${rateText(cB)} | ≥ %90 | ${pass(cB.r >= 0.90)} |`,
  `| C recall | ${rateText(cC)} | ≥ %85 | ${pass(cC.r >= 0.85)} |`,
  `| Non-D5 FPR (A+D) | ${rateText(cF)} | ≤ %30 | ${pass(cF.r <= 0.30)} |`,
  `| A (D1-only) FPR | ${rateText(cA)} | ≤ %30 | ${pass(cA.r <= 0.30)} |`,
  '', '| Baseline P(D5) ≥ 0.64 ile karşılaştırma | Baseline | Aday | Fark | Eşik | |', '|---|---|---|---|---|---|',
  `| D5 recall | ${rateText(bT)} | ${rateText(cT)} | kayıp ${pp(recallLoss)} | kayıp ≤ 5 puan | ${pass(recallLoss <= 0.05)} |`,
  `| C recall | ${rateText(bC)} | ${rateText(cC)} | kayıp ${pp(cLoss)} | kayıp ≤ 10 puan | ${pass(cLoss <= 0.10)} |`,
  `| Genel FPR (A+D) | ${rateText(bF)} | ${rateText(cF)} | düşüş ${pp(fprCut)} | düşüş ≥ 10 puan | ${pass(fprCut >= 0.10)} |`,
  `| Toplam System Two route oranı | ${rateText(bLoad)} | ${rateText(cLoad)} | düşüş ${pp(loadCut)} | düşüş ≥ 10 puan | ${pass(loadCut >= 0.10)} |`,
  '', `U2: ${pass(u2)}`, '');

// ---- U3: ayrıştırıcı çağrı bütçesi (§8) ----
const amb = rate(cases, ambiguous);
const tok = (rows, ids) => rows.filter((r) => ids.has(r.case_id));
const ambIds = new Set(cases.filter((c) => ambiguous(c.case_id)).map((c) => c.case_id));
const u3 = amb.r <= 0.60 && cLoad.k < bLoad.k;
H.push('## U3: ayrıştırıcı çağrı bütçesi', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| Ayrıştırıcı çağrılan vaka oranı (belirsiz mahalle) | ${rateText(amb)} | ≤ %60 | ${pass(amb.r <= 0.60)} |`,
  `| System Two route sayısı: aday / baseline | ${cLoad.k} / ${bLoad.k} | aday < baseline | ${pass(cLoad.k < bLoad.k)} |`,
  `| Aday: System Two route + ayrıştırıcı çağrısı (rapor) | ${cLoad.k} + ${amb.k} | | |`,
  `| Ayrıştırıcı input token ort. (belirsiz mahalle, R1) | ${f2(mean(tok(rowsR1, ambIds).map((r) => r.input_tokens)))} | | |`,
  `| Ayrıştırıcı gecikme medyanı ms (belirsiz mahalle, R1) | ${median(tok(rowsR1, ambIds).map((r) => r.latency_ms))} | | |`,
  '', 'Ayrıştırıcı çağrısı System Two ile aynı maliyet sayılmaz; bu satırlar parasal maliyet iddiası değildir.', '', `U3: ${pass(u3)}`, '');

// ---- U4: bağlam dayanıklılığı (§9) ----
const sub = (list, f) => list.filter(f);
const cueD5 = rate(sub(D5set, (c) => c.descriptive.cue), candidate); const noCueD5 = rate(sub(D5set, (c) => !c.descriptive.cue), candidate);
const lockD5 = rate(sub(D5set, (c) => c.descriptive.lock_context), candidate); const noLockD5 = rate(sub(D5set, (c) => !c.descriptive.lock_context), candidate);
const cueA = rate(sub(A, (c) => c.descriptive.cue), candidate); const noCueA = rate(sub(A, (c) => !c.descriptive.cue), candidate);
const accCue = exact(R1, sub(cases, (c) => c.descriptive.cue)); const accNoCue = exact(R1, sub(cases, (c) => !c.descriptive.cue));
const u4 = cueD5.r >= 0.85 && noCueD5.r >= 0.85 && lockD5.r >= 0.85 && noLockD5.r >= 0.85 && cueA.r <= 0.40 && noCueA.r <= 0.40 && accCue.r >= 0.65 && accNoCue.r >= 0.65;
H.push('## U4: bağlam dayanıklılığı', '', '| Grup | Değer | Eşik | |', '|---|---|---|---|',
  `| Aday: ipucu olan D5 recall | ${rateText(cueD5)} | ≥ %85 | ${pass(cueD5.r >= 0.85)} |`,
  `| Aday: ipucusuz D5 recall | ${rateText(noCueD5)} | ≥ %85 | ${pass(noCueD5.r >= 0.85)} |`,
  `| Aday: lock_context=true D5 recall | ${rateText(lockD5)} | ≥ %85 | ${pass(lockD5.r >= 0.85)} |`,
  `| Aday: lock_context=false D5 recall | ${rateText(noLockD5)} | ≥ %85 | ${pass(noLockD5.r >= 0.85)} |`,
  `| Aday: A, ipucu olan FPR | ${rateText(cueA)} | ≤ %40 | ${pass(cueA.r <= 0.40)} |`,
  `| Aday: A, ipucusuz FPR | ${rateText(noCueA)} | ≤ %40 | ${pass(noCueA.r <= 0.40)} |`,
  `| Ayrıştırıcı (R1) tam doğruluk, ipucu olan | ${rateText(accCue)} | ≥ %65 | ${pass(accCue.r >= 0.65)} |`,
  `| Ayrıştırıcı (R1) tam doğruluk, ipucusuz | ${rateText(accNoCue)} | ≥ %65 | ${pass(accNoCue.r >= 0.65)} |`,
  '', `U4: ${pass(u4)}`, '');

// ---- U5: R1 ↔ R2 kararlılığı (§10) ----
const agreeChoice = rate(cases, (id) => R1[id].choice === R2[id].choice);
const agreeBinary = rate(cases, (id) => resolverRoutes(R1, id) === resolverRoutes(R2, id));
const m2 = u1m(R2);
const worse = { bc: m1.bc.r - m2.bc.r, c: m1.c.r - m2.c.r, a: m2.a.r - m1.a.r, d: m2.d.r - m1.d.r };
const u5 = agreeChoice.r >= 0.90 && agreeBinary.r >= 0.95 && Object.values(worse).every((w) => w <= 0.10);
H.push('## U5: ayrıştırıcı kararlılığı (R1 ile R2)', '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|',
  `| Choice argmax uyumu | ${rateText(agreeChoice)} | ≥ %90 | ${pass(agreeChoice.r >= 0.90)} |`,
  `| resolver_routes_D5 uyumu | ${rateText(agreeBinary)} | ≥ %95 | ${pass(agreeBinary.r >= 0.95)} |`,
  `| B+C recall R1 → R2 | ${pct(m1.bc.r)} → ${pct(m2.bc.r)} | kötüleşme ≤ 10 puan | ${pass(worse.bc <= 0.10)} |`,
  `| C recall R1 → R2 | ${pct(m1.c.r)} → ${pct(m2.c.r)} | kötüleşme ≤ 10 puan | ${pass(worse.c <= 0.10)} |`,
  `| A FPR R1 → R2 | ${pct(m1.a.r)} → ${pct(m2.a.r)} | kötüleşme ≤ 10 puan | ${pass(worse.a <= 0.10)} |`,
  `| D FPR R1 → R2 | ${pct(m1.d.r)} → ${pct(m2.d.r)} | kötüleşme ≤ 10 puan | ${pass(worse.d <= 0.10)} |`,
  `| (rapor) R2 tam doğruluk | ${rateText(m2.acc)} | | |`,
  '', `U5: ${pass(u5)}`, '');

// ---- §12 sonuç kuralı ----
const passed = u1 && u2 && u3 && u4 && u5;
const verdict = passed
  ? 'U1–U5 geçti → H19u başarılı. Desteklenen iddia yalnız §12\'deki dar cümledir; sonraki adım ayrı bir H19s (yalnız gölge) ön kaydı olabilir.'
  : 'En az bir kapı kaldı → H19s açılmaz; aynı sette yeni prompt/eşik aranmaz; D1/D5 ayrımının Jev System One ile bu biçimde çözülemediği kaydedilir; ham V vektörü yalnız sıralayıcı/sinyal olarak kalır.';
H.splice(5, 0, '', `**Sonuç kuralı (§12):** U1 ${u1 ? 'geçti' : 'kaldı'} · U2 ${u2 ? 'geçti' : 'kaldı'} · U3 ${u3 ? 'geçti' : 'kaldı'} · U4 ${u4 ? 'geçti' : 'kaldı'} · U5 ${u5 ? 'geçti' : 'kaldı'} → ${verdict}`);

// ---- §11 ikincil raporlar (eşik üretmez) ----
H.push('## İkincil raporlar (§11; eşik, skor veya yeni soru üretmez)', '');
H.push('### V1 P(D1) ve P(D5) dağılımı', '', '| Katman | n | P(D1) ort. | P(D1) medyan | P(D5) ort. | P(D5) medyan | high_D5 | belirsiz mahalle |', '|---|---|---|---|---|---|---|---|');
for (const [name, list] of [['A (D1 only)', A], ['B (D5 only)', B], ['C (both)', C], ['D (neither)', D]]) {
  const d1 = list.map((c) => V1[c.case_id].D1); const d5 = list.map((c) => V1[c.case_id].D5);
  H.push(`| ${name} | ${list.length} | ${f3(mean(d1))} | ${f3(median(d1))} | ${f3(mean(d5))} | ${f3(median(d5))} | ${rate(list, highD5).k}/${list.length} | ${rate(list, ambiguous).k}/${list.length} |`);
}

H.push('', '### Belirsiz mahallede gerçek sınıf ve aday kararı', '', '| Gerçek sınıf | belirsiz mahallede | R1 route | route etmeyen |', '|---|---|---|---|');
for (const label of LABELS) {
  const list = cases.filter((c) => c.label === label && ambiguous(c.case_id));
  const k = list.filter((c) => resolverRoutes(R1, c.case_id)).length;
  H.push(`| ${label} | ${list.length} | ${k} | ${list.length - k} |`);
}

const confusion = (R) => {
  const out = ['| Gerçek \\ R | ' + LABELS.join(' | ') + ' |', '|---|' + LABELS.map(() => '---').join('|') + '|'];
  for (const truth of LABELS) {
    const list = cases.filter((c) => c.label === truth);
    out.push(`| ${truth} | ${LABELS.map((l) => list.filter((c) => R[c.case_id].choice === l).length).join(' | ')} |`);
  }
  return out;
};
H.push('', '### Ayrıştırıcı karışıklık matrisi (R1, bütün vakalar)', '', ...confusion(R1));
H.push('', '### Ayrıştırıcı karışıklık matrisi (R2, bütün vakalar)', '', ...confusion(R2));

H.push('', '### Mekanizma ailesine göre (bileşik aday ve R1)', '', '| Katman | Aile | n | aday route | R1 tam doğru | baseline route |', '|---|---|---|---|---|---|');
for (const layerName of ['A', 'B', 'C', 'D']) {
  const fams = [...new Set(L(layerName).map((c) => c.family))].sort();
  for (const fam of fams) {
    const list = L(layerName).filter((c) => c.family === fam);
    H.push(`| ${layerName} | ${fam} | ${list.length} | ${rate(list, candidate).k} | ${exact(R1, list).k} | ${rate(list, baseline).k} |`);
  }
}
H.push('', '### Önceden işaretli aileler', '', '| Grup | n | aday route | baseline route | R1 tam doğru |', '|---|---|---|---|---|');
const flagged = [
  ['A: receipt/request-hash/replay', A.filter((c) => c.family_group === 'receipt_hash_replay')],
  ['A: diğer D1 aileleri', A.filter((c) => c.family_group !== 'receipt_hash_replay')],
  ['request_hash alanı (A)', A.filter((c) => c.family === 'request_hash_field')],
  ['makbuz kapatılmıyor / tekrar atlanıyor (A)', A.filter((c) => ['receipt_not_finished', 'replay_skipped', 'stale_receipt_result'].includes(c.family))],
  ['stale token / sürüm (B+C)', D5set.filter((c) => /stale|version/.test(c.family) || /version/i.test(c.files[0].patch))],
  ['removed-predicate (B+C)', D5set.filter((c) => c.descriptive.removed_predicate)],
  ['removed-predicate (A+D)', nonD5.filter((c) => c.descriptive.removed_predicate)],
];
for (const [name, list] of flagged) H.push(`| ${name} | ${list.length} | ${rate(list, candidate).k} | ${rate(list, baseline).k} | ${exact(R1, list).k} |`);

const precision = (f) => { const tp = D5set.filter((c) => f(c.case_id)).length; const fp = nonD5.filter((c) => f(c.case_id)).length; return { tp, fp, r: tp + fp ? tp / (tp + fp) : NaN }; };
const pC = precision(candidate); const pB = precision(baseline);
H.push('', '### Precision (yalnız bu dengeli setin %50 D5 prevalansında; üretim prevalansı olarak yorumlanmaz)', '',
  `- Aday: ${pC.tp}/${pC.tp + pC.fp} = ${pct(pC.r)}`, `- Baseline: ${pB.tp}/${pB.tp + pB.fp} = ${pct(pB.r)}`, '');

const tl = (rows) => [f2(mean(rows.map((r) => r.input_tokens))), median(rows.map((r) => r.input_tokens)), f2(mean(rows.map((r) => r.latency_ms))), median(rows.map((r) => r.latency_ms))];
H.push('### Token ve gecikme', '', '| Tur | input token ort. | medyan | gecikme ort. (ms) | medyan (ms) |', '|---|---|---|---|---|',
  ...[['V1', rowsV1], ['R1', rowsR1], ['R2', rowsR2]].map(([n, rows]) => `| ${n} | ${tl(rows).join(' | ')} |`), '');

H.push('## Vaka bazında', '', '| Vaka | katman | etiket | P(D1) | P(D5) | belirsiz | R1 | R2 | baseline | aday |', '|---|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const id = c.case_id;
  H.push(`| ${id} | ${c.layer} | ${c.label} | ${f2(V1[id].D1)} | ${f2(V1[id].D5)} | ${ambiguous(id) ? 'evet' : '·'} | ${R1[id].choice} | ${R2[id].choice} | ${baseline(id) ? 'R' : '·'} | ${candidate(id) ? 'R' : '·'} |`);
}

writeFileSync(path.join(dir, 'rapor.md'), `${H.join('\n')}\n`);
console.log(H.join('\n'));
