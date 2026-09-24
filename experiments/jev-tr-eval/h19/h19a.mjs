#!/usr/bin/env node
// H19a — bağlam ablation deneyi (DE-JEV-H19-R0 v0.1 girdileri üzerinde).
//
// İki bağımsız değişken:
//   girdi kapsamı : full (orijinal diff) | changed (yalnız +/- satırları)
//   soru kapsamı  : v0.1 (soru bankası aynen) | v0.2 (yalnız +/- satırları değerlendir)
// ve iki karşı-olgusal kilit sondası:
//   nolockctx     : orijinal diff, kilit kelimesi geçen DEĞİŞMEYEN bağlam satırları çıkarılmış
//   changed+lock  : yalnız +/- satırları + tek bir yapay bağlam satırı "   for update;"
//
// Bu deney bir şeyi AYARLAMAZ; aynı vakada tek değişkeni değiştirip Jev'in duyarlılığını ölçer.
// v0.2'nin doğruluğu bu 16 vakayla değil, yeni vakalarla ölçülmelidir.
//
//   NODE_USE_ENV_PROXY=1 node h19/h19a.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = new URL('.', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(`kaynak/${name}`, here), 'utf8'));
const inputs = read('h19-axis-inputs.v0.1.json');
const bank = read('soru-bankasi.v0.1.json');
const labels = read('benchmark-etiketler.v0.1.json');
const MODEL = 'jev-1.13.0';
const AXES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];
const LOCK = /for update|lock|version|advisory|serializ|skip locked|nowait/i;

// ---- girdi varyantları (yalnız patch metni değişir) ----

const isChanged = (line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---');
const isHeader = (line) => line.startsWith('@@');
const bareHeader = (line) => line.replace(/^(@@[^@]*@@).*$/, '$1');

const VARIANTS = {
  full: (patch) => patch,
  changed: (patch) => patch.split('\n').filter((l) => isHeader(l) || isChanged(l)).map((l) => (isHeader(l) ? bareHeader(l) : l)).join('\n'),
  nolockctx: (patch) => patch.split('\n')
    .filter((l) => isHeader(l) || isChanged(l) || !LOCK.test(l))
    .map((l) => (isHeader(l) && LOCK.test(l) ? bareHeader(l) : l)).join('\n'),
  'changed+lock': (patch) => {
    const lines = VARIANTS.changed(patch).split('\n');
    const at = lines.findIndex(isHeader);
    lines.splice(at + 1, 0, '   for update;');
    return lines.join('\n');
  },
};

// ---- soru kapsamları ----

const V01_CRITERIA = {
  true: 'The supplied production-code change materially affects this semantic axis.',
  false: 'The supplied production-code change does not materially affect this semantic axis.',
};
const V02_SCOPE = ' Judge only the added (+) and removed (-) lines in `files[].patch`; unchanged context lines and hunk headers are not part of the change.';
const V02_CRITERIA = {
  true: 'The added or removed lines materially affect this semantic axis.',
  false: 'The added or removed lines do not materially affect this semantic axis; mentions only in unchanged context do not count.',
};
const questionsFor = (scope) => Object.fromEntries(bank.axes.map((axis) => [axis.id, {
  type: 'noul',
  instructions: scope === 'v0.1' ? axis.question : axis.question + V02_SCOPE,
  criteria: scope === 'v0.1' ? V01_CRITERIA : V02_CRITERIA,
}]));

// DE-JEV-H19-R0 çalıştırıcısındaki sızıntı koruması (aynı desenler)
const LEAK = [/\bH19\b/i, /EXP-H19/i, /exp\/h19/i, /\bD[0-5]\s*[x×]\s*D[0-5]\b/i];

const CONDITIONS = [
  ['C1', 'v0.1', 'full'],
  ['C2', 'v0.1', 'changed'],
  ['C3', 'v0.2', 'full'],
  ['C4', 'v0.2', 'changed'],
  ['C5', 'v0.1', 'nolockctx'],
  ['C6', 'v0.1', 'changed+lock'],
  ['C7', 'v0.2', 'changed+lock'],
];

async function ask(state, questions) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected'}` },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if (!res.ok) throw new Error(`TypeSafe ${res.status}`);
  const json = await res.json();
  if (json.model !== MODEL) throw new Error(`served ${json.model}`);
  return { probs: Object.fromEntries(AXES.map((a) => [a, json.answers[a].noul])), tokens: json.usage?.input_tokens ?? 0 };
}

const results = {};
for (const [id, scope, variant] of CONDITIONS) {
  const questions = questionsFor(scope);
  const cases = await Promise.all(inputs.cases.map(async (c) => {
    const state = { files: c.files.map((f) => ({ path: f.path, patch: VARIANTS[variant](f.patch) })) };
    const text = JSON.stringify(state);
    const leak = LEAK.find((p) => p.test(text));
    if (leak) throw new Error(`leakage ${c.case_key} ${leak}`);
    const started = performance.now();
    const answer = await ask(state, questions);
    return {
      case_key: c.case_key,
      input_digest: createHash('sha256').update(text).digest('hex'),
      axis_probabilities: answer.probs,
      usage: { input_tokens: answer.tokens },
      latency_ms: Math.round(performance.now() - started),
    };
  }));
  results[id] = { scope, variant, cases };
  process.stderr.write(`${id} ${scope} ${variant} ok\n`);
}

// ---- çıktı ve skorlama (DE-JEV-H19-R0 skorlayıcısı, değiştirilmeden) ----

const out = new URL(`sonuc/h19a-${new Date().toISOString().replace(/[:.]/g, '-')}/`, here);
mkdirSync(out, { recursive: true });
const labelOf = Object.fromEntries(labels.cases.map((c) => [c.case_key, c]));
const scores = {};
for (const [id, r] of Object.entries(results)) {
  const factsPath = new URL(`facts-${id}.json`, out);
  writeFileSync(factsPath, JSON.stringify({ version: 'h19a', protocol: 'DE-JEV-H19-R0', model: MODEL, condition: { id, scope: r.scope, variant: r.variant }, cases: r.cases }, null, 2));
  const scored = JSON.parse(execFileSync('node', [new URL('kaynak/h19-axis-shadow-score.mjs', here).pathname, factsPath.pathname, new URL('kaynak/benchmark-etiketler.v0.1.json', here).pathname]).toString());
  scores[id] = scored.metrics.all;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p = (id, key, axis) => results[id].cases.find((c) => c.case_key === key).axis_probabilities[axis];
const keys = inputs.cases.map((c) => c.case_key);
const lockCtx = new Set(inputs.cases.filter((c) => c.files.some((f) => f.patch.split('\n').some((l) => !isChanged(l) && LOCK.test(l)))).map((c) => c.case_key));
const hasAxis = (key, axis) => labelOf[key].expected_pair.includes(axis);

const L = [`# H19a — bağlam ablation (${new Date().toISOString()})`, '', `Model ${MODEL}; 16 dondurulmuş vaka; koşul başına 16 canlı çağrı.`, ''];
L.push('## Koşullar ve sıralama metrikleri (aynı 16 vaka — yalnız karşılaştırma içindir, promosyon kanıtı değildir)', '');
L.push('| Koşul | Soru | Girdi | Top-1 | Top-3 | MRR | ort. token |', '|---|---|---|---|---|---|---|');
for (const [id, r] of Object.entries(results)) {
  const s = scores[id];
  L.push(`| ${id} | ${r.scope} | ${r.variant} | ${(s.top1Rate * 100).toFixed(1)}% | ${(s.top3Rate * 100).toFixed(1)}% | ${s.meanReciprocalRank.toFixed(3)} | ${Math.round(mean(r.cases.map((c) => c.usage.input_tokens)))} |`);
}
for (const axis of ['D5', 'D1']) {
  L.push('', `## ${axis}: etikete göre ortalama P(evet)`, '', '| Koşul | etiketli | etiketsiz | etiketsiz, bağlamda kilit | etiketsiz, bağlamda kilit yok |', '|---|---|---|---|---|');
  for (const id of Object.keys(results)) {
    const pos = keys.filter((k) => hasAxis(k, axis)); const neg = keys.filter((k) => !hasAxis(k, axis));
    L.push(`| ${id} | ${mean(pos.map((k) => p(id, k, axis))).toFixed(2)} (n=${pos.length}) | ${mean(neg.map((k) => p(id, k, axis))).toFixed(2)} (n=${neg.length}) | ${mean(neg.filter((k) => lockCtx.has(k)).map((k) => p(id, k, axis))).toFixed(2)} | ${mean(neg.filter((k) => !lockCtx.has(k)).map((k) => p(id, k, axis))).toFixed(2)} |`);
  }
}
L.push('', '## Eşleştirilmiş farklar (aynı vaka, tek değişken)', '', '| Karşılaştırma | Ne ölçer | Eksen | ort. Δ | artan / azalan / eşit (|Δ|<0.05) |', '|---|---|---|---|---|');
const pairs = [
  ['C2 − C1', 'girdi kapsamı (v0.1 soru)', 'C2', 'C1', keys],
  ['C4 − C3', 'girdi kapsamı (v0.2 soru)', 'C4', 'C3', keys],
  ['C3 − C1', 'soru kapsamı (tam diff)', 'C3', 'C1', keys],
  ['C4 − C2', 'soru kapsamı (yalnız +/-)', 'C4', 'C2', keys],
  ['C6 − C2', 'yapay kilit satırı ekle (v0.1)', 'C6', 'C2', keys],
  ['C7 − C4', 'yapay kilit satırı ekle (v0.2)', 'C7', 'C4', keys],
  ['C1 − C5', 'gerçek kilit bağlamını geri koy (yalnız kilit bağlamlı 7 vaka)', 'C1', 'C5', keys.filter((k) => lockCtx.has(k))],
];
for (const [name, what, a, b, ks] of pairs) for (const axis of ['D5', 'D1']) {
  const d = ks.map((k) => p(a, k, axis) - p(b, k, axis));
  L.push(`| ${name} | ${what} | ${axis} | ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(3)} | ${d.filter((x) => x >= 0.05).length} / ${d.filter((x) => x <= -0.05).length} / ${d.filter((x) => Math.abs(x) < 0.05).length} |`);
}
L.push('', '## Vaka bazında P(D5)', '', `| Vaka | D5 etiketli | bağlamda kilit | ${Object.keys(results).join(' | ')} |`, `|---|---|---|${Object.keys(results).map(() => '---').join('|')}|`);
for (const k of keys) L.push(`| ${k} | ${hasAxis(k, 'D5') ? 'evet' : 'hayır'} | ${lockCtx.has(k) ? 'var' : '—'} | ${Object.keys(results).map((id) => p(id, k, 'D5').toFixed(2)).join(' | ')} |`);
writeFileSync(new URL('report.md', out), L.join('\n') + '\n');
console.log(L.join('\n'));
console.log(`\nRapor: ${new URL('report.md', out).pathname}`);
