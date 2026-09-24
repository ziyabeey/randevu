#!/usr/bin/env node
// H19a sonuçlarının API'siz ikinci analizi: tekrar üretim kontrolü, eksen bazında AUC,
// D5 2×2 (etiket × kilit kelimesi), en üst çift dağılımı. Yeni çağrı yapmaz.
//
//   node h19/h19a-analiz.mjs h19/sonuc/h19a-<ts>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '');
const here = path.dirname(new URL(import.meta.url).pathname);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const labels = json(path.join(here, 'kaynak/benchmark-etiketler.v0.1.json'));
const AXES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];
const IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const facts = Object.fromEntries(IDS.map((id) => [id, json(path.join(dir, `facts-${id}.json`))]));
const probs = (f) => Object.fromEntries(f.cases.map((c) => [c.case_key, c.axis_probabilities]));
const P = Object.fromEntries(IDS.map((id) => [id, probs(facts[id])]));
const keys = labels.cases.map((c) => c.case_key);
const pairOf = Object.fromEntries(labels.cases.map((c) => [c.case_key, c.expected_pair]));
const has = (k, a) => pairOf[k].includes(a);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Mann–Whitney AUC: rastgele bir etiketli vakanın P'si rastgele bir etiketsizden büyük olma olasılığı
function auc(pos, neg) {
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

const L = [`# H19a — ikinci analiz (${path.basename(dir)})`, ''];

L.push('## Tekrar üretim: C1 (v0.1, tam diff) ile önceki iki tur', '',
  'C1, DE-JEV-H19-R0 çalıştırıcısının isteğini yeniden kuruyor; önceki turlar o çalıştırıcıyla yapıldı.', '',
  '| Karşılaştırma | ort. |Δ| | en büyük |Δ| |', '|---|---|---|');
const prev = [1, 2].map((n) => probs(json(path.join(here, `sonuc/facts-${n}.json`))));
const diffs = (A, B) => keys.flatMap((k) => AXES.map((a) => Math.abs(A[k][a] - B[k][a])));
for (const [name, A, B] of [['tur 1 − tur 2', prev[0], prev[1]], ['C1 − tur 1', P.C1, prev[0]], ['C1 − tur 2', P.C1, prev[1]]]) {
  const d = diffs(A, B);
  L.push(`| ${name} | ${mean(d).toFixed(3)} | ${Math.max(...d).toFixed(2)} |`);
}

L.push('', '## Eksen bazında ayrışma (AUC; 0.5 = ayrışma yok, 1.0 = tam)', '',
  `| Eksen | etiketli n | ${IDS.join(' | ')} |`, `|---|---|${IDS.map(() => '---').join('|')}|`);
for (const a of AXES) {
  const pos = keys.filter((k) => has(k, a));
  const neg = keys.filter((k) => !has(k, a));
  L.push(`| ${a} | ${pos.length} | ${IDS.map((id) => auc(pos.map((k) => P[id][k][a]), neg.map((k) => P[id][k][a])).toFixed(2)).join(' | ')} |`);
}

L.push('', '## D5 2×2: etiket × kilit kelimesi (yalnız +/- girdisi; kilit = tek yapay bağlam satırı)', '',
  'Değişen satırların hiçbirinde kilit kelimesi yok; C2/C4 girdisinde kilit kelimesi hiç yok, C6/C7 girdisinde tek satır var.', '',
  '| Soru | Etiket | kilit yok | kilit var | kilit etkisi |', '|---|---|---|---|---|');
for (const [scope, off, on] of [['v0.1', 'C2', 'C6'], ['v0.2', 'C4', 'C7']]) {
  for (const [name, ks] of [['D5 etiketli (n=6)', keys.filter((k) => has(k, 'D5'))], ['D5 etiketsiz (n=10)', keys.filter((k) => !has(k, 'D5'))]]) {
    const a = mean(ks.map((k) => P[off][k].D5)); const b = mean(ks.map((k) => P[on][k].D5));
    L.push(`| ${scope} | ${name} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${b - a >= 0 ? '+' : ''}${(b - a).toFixed(2)} |`);
  }
}

L.push('', '## En üst çift', '', `| Koşul | D1xD5 en üstte | en sık en üst çiftler |`, '|---|---|---|');
const top = (p) => {
  let best = null;
  for (let i = 0; i < AXES.length; i += 1) for (let j = i + 1; j < AXES.length; j += 1) {
    const s = p[AXES[i]] * p[AXES[j]];
    if (!best || s > best.s) best = { pair: `${AXES[i]}x${AXES[j]}`, s };
  }
  return best.pair;
};
for (const id of IDS) {
  const tops = keys.map((k) => top(P[id][k]));
  const count = {};
  for (const t of tops) count[t] = (count[t] ?? 0) + 1;
  const common = Object.entries(count).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${t} ${n}`).join(', ');
  L.push(`| ${id} | ${tops.filter((t) => t === 'D1xD5').length}/16 | ${common} |`);
}

// Tam binom işaret testi (iki yönlü); |Δ| < 0.05 olanlar eşit sayılıp dışarıda bırakılır
function signTest(up, down) {
  const n = up + down;
  const choose = (k) => { let c = 1; for (let i = 1; i <= k; i += 1) c = (c * (n - k + i)) / i; return c; };
  let tail = 0;
  for (let k = 0; k <= Math.min(up, down); k += 1) tail += choose(k);
  return Math.min(1, (2 * tail) / 2 ** n);
}
const lockCtx = ['C01', 'C04', 'C05', 'C07', 'C08', 'C10', 'C13'];
L.push('', '## Eşleştirilmiş işaret testi (P(evet) farkı, aynı vaka)', '',
  '| Karşılaştırma | Eksen | artan / azalan / eşit | p (iki yönlü) |', '|---|---|---|---|');
for (const [a, b, ks] of [['C2', 'C1', keys], ['C4', 'C3', keys], ['C3', 'C1', keys], ['C4', 'C2', keys], ['C6', 'C2', keys], ['C7', 'C4', keys], ['C1', 'C5', lockCtx]]) {
  for (const axis of ['D5', 'D1']) {
    const d = ks.map((k) => P[a][k][axis] - P[b][k][axis]);
    const up = d.filter((x) => x >= 0.05).length; const down = d.filter((x) => x <= -0.05).length;
    L.push(`| ${a} − ${b}${ks.length < keys.length ? ` (${ks.length} vaka)` : ''} | ${axis} | ${up} / ${down} / ${ks.length - up - down} | ${up + down ? signTest(up, down).toPrecision(2) : '—'} |`);
  }
}

writeFileSync(path.join(dir, 'analiz.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
