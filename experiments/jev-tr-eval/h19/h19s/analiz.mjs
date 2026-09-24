#!/usr/bin/env node
// H19s analizi (H19S-PROTOKOL-v0.2 §5–§13). İlk kohort biriminden ÖNCE yazıldı; Jev çağrısı yapmaz.
// Girdiler:
//   --kohort   kohort.json (golge.mjs)                 --golge   golge.jsonl (golge.mjs)
//   --a, --b   okuyucu etiketleri {reader, product, visible_model, date, labels:[{unit_id,d1,d5,actionable_d5,reason}]}
//   --tiebreak (isteğe bağlı) [{unit_id, field: 'd5'|'actionable_d5', value: 'yes'|'no', evidence}]
//   --gozlenen [{unit_id|pr, observed: 'yes'|'no'|'unknown', evidence}] (birim kaydı PR kaydını ezer)
//   --out      rapor dizini
//
// Önceden sabitlenen okuma kuralları (veri görülmeden):
// - Birincil etiket: A ve B aynıysa o değer (ikisi de undetermined ise undetermined). Aynı değilse d5 ve
//   actionable_d5 için yalnız --tiebreak'teki SHA-bound kanıt kaydı; yoksa undetermined (v0.2 §5).
//   d1 için tie-break yoktur; uyuşmazlık undetermined kalır.
// - D5_INVOLVED := d5=yes · D1_ONLY := d1=yes ve d5=no. undetermined birimler ilgili payda dışıdır; route ve
//   S3 sayımında kalır.
// - Kapılar sayıma dayanır: oran eşiği k/n ile; n = 0 ise kapı boş geçer ve raporda "n=0" diye işaretlenir.
// - S5 yarıları: kohort birim sırasının ilk ⌊n/2⌋ birimi ve kalanı.
// - Bootstrap: PR düzeyinde, 2000 yeniden örnekleme, sabit tohum 19; yalnız rapor.
//
//   node h19/h19s/analiz.mjs --kohort k.json --golge g.jsonl --a A.json --b B.json --gozlenen o.json --out <dizin>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const need = (name) => { const v = arg(name); if (!v) throw new Error(`${name} gerekli`); return v; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const cohort = readJson(need('--kohort'));
const shadowRows = readFileSync(need('--golge'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const labelFile = (p) => { const j = readJson(p); return Array.isArray(j) ? { labels: j } : j; };
const A = labelFile(need('--a'));
const B = labelFile(need('--b'));
const tiebreak = arg('--tiebreak') ? readJson(arg('--tiebreak')) : [];
const observedRows = readJson(need('--gozlenen'));
const out = need('--out');

// ---- doğrulama (eksik ya da fazla kayıt analizi durdurur) ----
const units = cohort.prs.flatMap((pr) => pr.units.map((u) => ({ ...u, pr: pr.pr })));
const ids = new Set(units.map((u) => u.unit_id));
if (!cohort.stop_rule_met) throw new Error('kohort stop rule sağlamıyor');
const order = cohort.unit_order;
if (order.length !== units.length || order.some((id) => !ids.has(id))) throw new Error('unit_order kohortla uyuşmuyor');
const S = new Map(shadowRows.map((r) => [r.unit_id, r]));
for (const u of units) {
  const r = S.get(u.unit_id);
  if (!r) throw new Error(`gölge kaydı yok: ${u.unit_id}`);
  if (r.input_digest !== u.input_digest) throw new Error(`gölge girdisi uyuşmuyor: ${u.unit_id}`);
  // Donmuş router (§1) kayıttaki olasılık ve Choice'tan yeniden hesaplanır; kayıtlı kararla aynı olmalı.
  const p = r.v.axis_probabilities;
  const amb = p.D5 >= 0.64 && p.D1 >= 0.64;
  if (amb !== r.ambiguous || amb !== Boolean(r.resolver)) throw new Error(`belirsiz mahalle kaydı tutarsız: ${u.unit_id}`);
  const expected = p.D5 < 0.64 ? false : p.D1 < 0.64 ? true : ['D5_ONLY', 'BOTH'].includes(r.resolver.choice);
  if (expected !== r.candidate_route) throw new Error(`route kaydı donmuş kurala uymuyor: ${u.unit_id}`);
}
const ENUM = ['yes', 'no', 'undetermined'];
function labelMap(file, who) {
  const m = new Map();
  for (const l of file.labels) {
    if (!ids.has(l.unit_id)) throw new Error(`${who}: kohortta olmayan birim ${l.unit_id}`);
    if (m.has(l.unit_id)) throw new Error(`${who}: tekrar eden birim ${l.unit_id}`);
    for (const f of ['d1', 'd5', 'actionable_d5']) if (!ENUM.includes(l[f])) throw new Error(`${who}: ${l.unit_id} ${f}=${l[f]}`);
    m.set(l.unit_id, l);
  }
  for (const id of ids) if (!m.has(id)) throw new Error(`${who}: etiketsiz birim ${id}`);
  return m;
}
const LA = labelMap(A, 'Reader A');
const LB = labelMap(B, 'Reader B');
const TB = new Map();
for (const t of tiebreak) {
  if (!ids.has(t.unit_id) || !['d5', 'actionable_d5'].includes(t.field) || !['yes', 'no'].includes(t.value) || !t.evidence) {
    throw new Error(`geçersiz tie-break: ${JSON.stringify(t)}`);
  }
  if (LA.get(t.unit_id)[t.field] === LB.get(t.unit_id)[t.field]) throw new Error(`uyuşan etikete tie-break: ${t.unit_id} ${t.field}`);
  TB.set(`${t.unit_id}|${t.field}`, t);
}
const OBS = new Map();
const prObs = new Map();
for (const o of observedRows) {
  if (!['yes', 'no', 'unknown'].includes(o.observed)) throw new Error(`geçersiz gözlenen: ${JSON.stringify(o)}`);
  if (o.observed === 'yes' && !o.unit_id) throw new Error('gözlenen yes birime bağlanmalı (v0.2 §6)');
  if (o.unit_id) { if (!ids.has(o.unit_id)) throw new Error(`gözlenen: bilinmeyen birim ${o.unit_id}`); OBS.set(o.unit_id, o.observed); } else prObs.set(o.pr, o.observed);
}
for (const u of units) {
  if (!OBS.has(u.unit_id)) {
    if (!prObs.has(u.pr)) throw new Error(`gözlenen actionable D5 kaydı yok: ${u.unit_id}`);
    OBS.set(u.unit_id, prObs.get(u.pr));
  }
}

// ---- birincil etiketler ----
const primary = (id, field) => {
  const a = LA.get(id)[field];
  const b = LB.get(id)[field];
  if (a === b) return a;
  if (field !== 'd1' && TB.has(`${id}|${field}`)) return TB.get(`${id}|${field}`).value;
  return 'undetermined';
};
const rows = order.map((id) => {
  const u = units.find((x) => x.unit_id === id);
  const s = S.get(id);
  const d1 = primary(id, 'd1');
  const d5 = primary(id, 'd5');
  const act = primary(id, 'actionable_d5');
  const refClass = d5 === 'undetermined' || d1 === 'undetermined' ? 'UNDETERMINED'
    : d1 === 'yes' && d5 === 'yes' ? 'BOTH' : d1 === 'yes' ? 'D1_ONLY' : d5 === 'yes' ? 'D5_ONLY' : 'NEITHER_OR_OTHER';
  return {
    id, pr: u.pr, change: u.change, u, s, d1, d5, act, refClass,
    route: s.candidate_route, ambiguous: s.ambiguous, observed: OBS.get(id),
  };
});

// ---- istatistik ----
const pct = (x) => `%${(x * 100).toFixed(1)}`;
function wilson(k, n) {
  if (!n) return [NaN, NaN];
  const z = 1.959963984540054; const p = k / n; const d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const frac = (k, n) => (n ? `${k}/${n} = ${pct(k / n)} (Wilson %95: ${pct(wilson(k, n)[0])}–${pct(wilson(k, n)[1])})` : `0/0 (n=0)`);
const count = (xs, f) => xs.filter(f).length;
const EPS = 1e-12;
const atLeast = (k, n, t) => (n === 0 ? true : k / n >= t - EPS);
const atMost = (k, n, t) => (n === 0 ? true : k / n <= t + EPS);
const mark = (ok, n) => (ok ? (n === 0 ? '**geçti (n=0, boş)**' : '**geçti**') : '**kaldı**');
const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const R = [];
const gate = (name, items) => {
  R.push(`## ${name}`, '', '| Ölçüt | Değer | Eşik | |', '|---|---|---|---|');
  for (const it of items) R.push(`| ${it.label} | ${it.value} | ${it.rule} | ${it.status} |`);
  const pass = items.filter((it) => it.gate !== false).every((it) => it.ok);
  R.push('', `${name.split(' ')[0]}: ${pass ? '**geçti**' : '**kaldı**'}`, '');
  return pass;
};
const recallItem = (label, xs, t) => {
  const n = xs.length; const k = count(xs, (r) => r.route);
  return { label, value: frac(k, n), rule: `≥ ${pct(t)}`, ok: atLeast(k, n, t), status: mark(atLeast(k, n, t), n) };
};
const fprItem = (label, xs, t) => {
  const n = xs.length; const k = count(xs, (r) => r.route);
  return { label, value: frac(k, n), rule: `≤ ${pct(t)}`, ok: atMost(k, n, t), status: mark(atMost(k, n, t), n) };
};

// ---- S1 ----
const d5yes = rows.filter((r) => r.d5 === 'yes');
const d5no = rows.filter((r) => r.d5 === 'no');
const actYes = rows.filter((r) => r.act === 'yes');
const obsYes = rows.filter((r) => r.observed === 'yes');
const actMiss = count(actYes, (r) => !r.route);
const obsMiss = count(obsYes, (r) => !r.route);
const S1 = gate('S1 — güvenlik (§7)', [
  recallItem('D5_INVOLVED recall', d5yes, 0.95),
  { label: 'actionable_D5 recall', value: `${frac(actYes.length - actMiss, actYes.length)} · kaçan ${actMiss}`, rule: '= %100', ok: actMiss === 0, status: mark(actMiss === 0, actYes.length) },
  { label: 'Gözlenen actionable D5 kaçırma', value: `${obsMiss} (gözlenen yes: ${obsYes.length}; unknown: ${count(rows, (r) => r.observed === 'unknown')})`, rule: '= 0', ok: obsMiss === 0, status: mark(obsMiss === 0, obsYes.length) },
  fprItem('D5=no FPR', d5no, 0.35),
]);

// ---- S2 ----
const d1only = rows.filter((r) => r.refClass === 'D1_ONLY');
const ambD1 = d1only.filter((r) => r.ambiguous);
const ambNoRoute = count(ambD1, (r) => !r.route);
const s2second = ambD1.length >= 5
  ? { label: 'Belirsiz mahallede D1_ONLY no-route', value: frac(ambNoRoute, ambD1.length), rule: '≥ %80 (n ≥ 5 iken)', ok: atLeast(ambNoRoute, ambD1.length, 0.8), status: mark(atLeast(ambNoRoute, ambD1.length, 0.8), ambD1.length) }
  : { label: 'Belirsiz mahallede D1_ONLY no-route', value: `${ambNoRoute}/${ambD1.length}`, rule: 'n < 5: insufficient-n', ok: true, gate: false, status: 'insufficient-n (tek başına kaldırmaz)' };
const S2 = gate('S2 — D1/D5 gerçek trafikte (§8)', [fprItem('D1_ONLY FPR', d1only, 0.3), s2second]);

// ---- S3 ----
const routed = count(rows, (r) => r.route);
const prs = [...new Set(rows.map((r) => r.pr))];
const prSaved = count(prs, (pr) => rows.some((r) => r.pr === pr && !r.route));
const S3 = gate('S3 — System Two yükü (§9)', [
  { label: 'Aday System Two route oranı (baseline %100)', value: `${frac(routed, rows.length)} · azalma ${((1 - routed / rows.length) * 100).toFixed(1)} puan`, rule: '≤ %85', ok: atMost(routed, rows.length, 0.85), status: mark(atMost(routed, rows.length, 0.85), rows.length) },
  { label: 'En az bir birimi route edilmeyen PR', value: frac(prSaved, prs.length), rule: '≥ %50', ok: atLeast(prSaved, prs.length, 0.5), status: mark(atLeast(prSaved, prs.length, 0.5), prs.length) },
]);

// ---- S4 ----
const agree = (f) => count(rows, (r) => LA.get(r.id)[f] === LB.get(r.id)[f]);
const d5und = count(rows, (r) => r.d5 === 'undetermined');
const S4 = gate('S4 — referans etiket güvenilirliği (§10)', [
  { label: 'Reader A/B D5 tam uyum', value: frac(agree('d5'), rows.length), rule: '≥ %90', ok: atLeast(agree('d5'), rows.length, 0.9), status: mark(atLeast(agree('d5'), rows.length, 0.9), rows.length) },
  { label: 'Reader A/B actionable_d5 tam uyum', value: frac(agree('actionable_d5'), rows.length), rule: '≥ %85', ok: atLeast(agree('actionable_d5'), rows.length, 0.85), status: mark(atLeast(agree('actionable_d5'), rows.length, 0.85), rows.length) },
  { label: 'Birincil D5 undetermined oranı', value: frac(d5und, rows.length), rule: '≤ %10', ok: atMost(d5und, rows.length, 0.1), status: mark(atMost(d5und, rows.length, 0.1), rows.length) },
  { label: '(rapor) Reader A/B D1 tam uyum', value: frac(agree('d1'), rows.length), rule: 'gate değil', ok: true, gate: false, status: '' },
]);

// ---- S5 ----
const half = Math.floor(rows.length / 2);
const halves = [['ilk yarı', rows.slice(0, half)], ['ikinci yarı', rows.slice(half)]];
const S5items = halves.flatMap(([name, xs]) => {
  const k = count(xs, (r) => r.route);
  return [
    recallItem(`${name} (${xs.length} birim): D5 recall`, xs.filter((r) => r.d5 === 'yes'), 0.9),
    { label: `${name}: route azalması`, value: `${((1 - k / xs.length) * 100).toFixed(1)} puan (route ${k}/${xs.length})`, rule: '≥ 10 puan', ok: atMost(k, xs.length, 0.9), status: mark(atMost(k, xs.length, 0.9), xs.length) },
  ];
});
const S5 = gate('S5 — dağılım / drift (§11)', S5items);

// PR düzeyinde bootstrap (yalnız rapor)
let seed = 19;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const byPr = new Map(prs.map((pr) => [pr, rows.filter((r) => r.pr === pr)]));
const boots = { recall: [], reduction: [] };
for (let b = 0; b < 2000; b += 1) {
  const sample = prs.map(() => byPr.get(prs[Math.floor(rand() * prs.length)])).flat();
  const pos = sample.filter((r) => r.d5 === 'yes');
  if (pos.length) boots.recall.push(count(pos, (r) => r.route) / pos.length);
  boots.reduction.push(1 - count(sample, (r) => r.route) / sample.length);
}
const ci = (xs) => `${pct(quantile(xs, 0.025))}–${pct(quantile(xs, 0.975))}`;
R.push('PR düzeyinde bootstrap (%95, 2000 örnekleme; gate değil):', '',
  `- D5 recall: ${boots.recall.length ? ci(boots.recall) : '—'}`,
  `- System Two route azalması: ${ci(boots.reduction)}`, '');

// ---- sonuç ----
const all = [S1, S2, S3, S4, S5];
const head = [
  `# H19s sonuçları`, '',
  `Protokol: H19S-PROTOKOL-v0.2. Analiz kodu ilk kohort biriminden önce yazıldı.`,
  `Kohort: ${prs.length} birimli PR / ${rows.length} birim (${cohort.merged_prs} merge'lü PR). Reader A: ${A.product ?? '?'} (${A.visible_model ?? '?'}, ${A.date ?? '?'}) · Reader B: ${B.product ?? '?'} (${B.visible_model ?? '?'}, ${B.date ?? '?'}). Tie-break kaydı: ${TB.size}.`,
  '',
  `**Sonuç kuralı (§13):** ${['S1', 'S2', 'S3', 'S4', 'S5'].map((n, i) => `${n} ${all[i] ? 'geçti' : 'kaldı'}`).join(' · ')} → ${all.every(Boolean) ? 'H19s **başarılı**' : 'H19s **başarısız**: router production gate olmaz, aynı trafikte tuning yok'}.`,
  '',
];

// ---- ikincil raporlar (§12; gate değil, eşik/prompt türetilmez) ----
R.push('## İkincil raporlar (§12)', '');
R.push('### Birim türüne göre (new / modified; zorunlu kırılım)', '', '| Tür | n | route | D5 recall | D5=no FPR | D1_ONLY FPR |', '|---|---|---|---|---|---|');
for (const kind of ['new', 'modified']) {
  const xs = rows.filter((r) => r.change === kind);
  const rc = (ys) => frac(count(ys, (r) => r.route), ys.length);
  R.push(`| ${kind} | ${xs.length} | ${rc(xs)} | ${rc(xs.filter((r) => r.d5 === 'yes'))} | ${rc(xs.filter((r) => r.d5 === 'no'))} | ${rc(xs.filter((r) => r.refClass === 'D1_ONLY'))} |`);
}
R.push('');
R.push('### Referans sınıf prevalansı ve aday kararı', '', '| Referans sınıf | n | belirsiz mahalle | aday route |', '|---|---|---|---|');
for (const c of ['D1_ONLY', 'D5_ONLY', 'BOTH', 'NEITHER_OR_OTHER', 'UNDETERMINED']) {
  const xs = rows.filter((r) => r.refClass === c);
  R.push(`| ${c} | ${xs.length} | ${count(xs, (r) => r.ambiguous)} | ${count(xs, (r) => r.route)} |`);
}
R.push('');
const LABELS = ['D1_ONLY', 'D5_ONLY', 'BOTH', 'NEITHER_OR_OTHER'];
const amb = rows.filter((r) => r.ambiguous);
R.push(`### Ayrıştırıcı karışıklık matrisi (yalnız belirsiz mahalle, n=${amb.length})`, '', `| Referans \\ resolver | ${LABELS.join(' | ')} |`, `|---|${LABELS.map(() => '---').join('|')}|`);
for (const c of [...LABELS, 'UNDETERMINED']) R.push(`| ${c} | ${LABELS.map((l) => count(amb, (r) => r.refClass === c && r.s.resolver?.choice === l)).join(' | ')} |`);
R.push('');
const CUE = /for update|lock|version|advisory|serializ|idempoten|request_hash|receipt|replay/i;
const LOCK = /\bfor\s+update\b|\bfor\s+no\s+key\s+update\b|\bpg_advisory_xact_lock\b|\bpg_advisory_lock\b|\bskip\s+locked\b/i;
R.push('### İpucu / lock_context kırılımı', '', '| Grup | n | route | D5 recall |', '|---|---|---|---|');
for (const [name, f] of [['ipucu var', (r) => CUE.test(JSON.stringify(r.u.files))], ['ipucu yok', (r) => !CUE.test(JSON.stringify(r.u.files))], ['lock_context', (r) => LOCK.test(r.u.after_definition)], ['lock_context yok', (r) => !LOCK.test(r.u.after_definition)]]) {
  const xs = rows.filter(f);
  R.push(`| ${name} | ${xs.length} | ${frac(count(xs, (r) => r.route), xs.length)} | ${frac(count(xs.filter((r) => r.d5 === 'yes'), (r) => r.route), count(xs, (r) => r.d5 === 'yes'))} |`);
}
R.push('');
R.push('### V dağılımı referans sınıfa göre', '', '| Sınıf | n | P(D1) ort. | P(D5) ort. | P(D5) medyan |', '|---|---|---|---|---|');
for (const c of [...LABELS, 'UNDETERMINED']) {
  const xs = rows.filter((r) => r.refClass === c);
  const p = (a) => xs.map((r) => r.s.v.axis_probabilities[a]);
  R.push(`| ${c} | ${xs.length} | ${mean(p('D1')).toFixed(3)} | ${mean(p('D5')).toFixed(3)} | ${median(p('D5')).toFixed(3)} |`);
}
R.push('');
const d5conf = ENUM.map((a) => ENUM.map((b) => count(rows, (r) => LA.get(r.id).d5 === a && LB.get(r.id).d5 === b)));
R.push('### Reader A × Reader B (D5)', '', `| A \\ B | ${ENUM.join(' | ')} |`, '|---|---|---|---|', ...ENUM.map((a, i) => `| ${a} | ${d5conf[i].join(' | ')} |`), '');
const sizes = prs.map((pr) => byPr.get(pr).length);
R.push('### Çağrı sayıları, token ve gecikme (maliyet ikincil, §12)', '',
  `- Jev V çağrısı: ${rows.length} · resolver çağrısı: ${amb.length} · aday System Two route: ${routed} · baseline System Two birimi: ${rows.length}`,
  `- V input token ort./medyan: ${mean(rows.map((r) => r.s.v.usage?.input_tokens ?? NaN)).toFixed(1)} / ${median(rows.map((r) => r.s.v.usage?.input_tokens ?? NaN))}`,
  `- Resolver input token ort.: ${mean(amb.map((r) => r.s.resolver.usage?.input_tokens ?? NaN)).toFixed(1)}`,
  `- V gecikme medyan: ${median(rows.map((r) => r.s.v.latency_ms))} ms · resolver medyan/p95: ${median(amb.map((r) => r.s.resolver.latency_ms))} / ${quantile(amb.map((r) => r.s.resolver.latency_ms), 0.95)} ms`,
  `- Aday yolun ek System One gecikmesi (V + gerekiyorsa resolver) medyan: ${median(rows.map((r) => r.s.v.latency_ms + (r.s.resolver?.latency_ms ?? 0)))} ms`,
  `- PR başına birim: medyan ${median(sizes)}, en çok ${Math.max(...sizes)}`, '');
R.push('## Birim bazında', '', '| Birim | PR | tür | P(D1) | P(D5) | belirsiz | resolver | route | A d1/d5/act | B d1/d5/act | birincil d1/d5/act | gözlenen |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const p = r.s.v.axis_probabilities; const la = LA.get(r.id); const lb = LB.get(r.id);
  R.push(`| ${r.id} | ${r.pr} | ${r.change} | ${p.D1.toFixed(2)} | ${p.D5.toFixed(2)} | ${r.ambiguous ? 'evet' : '·'} | ${r.s.resolver?.choice ?? '·'} | ${r.route ? 'R' : '·'} | ${la.d1}/${la.d5}/${la.actionable_d5} | ${lb.d1}/${lb.d5}/${lb.actionable_d5} | ${r.d1}/${r.d5}/${r.act} | ${r.observed} |`);
}

if (!existsSync(out)) mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'rapor.md'), `${[...head, ...R].join('\n')}\n`);
console.log(head[head.length - 2]);
