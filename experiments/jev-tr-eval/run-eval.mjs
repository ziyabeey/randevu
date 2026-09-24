#!/usr/bin/env node
// Jev'in Türkçe randevu mesajlarındaki seçim doğruluğunu ölçer.
//
//   npm run eval                      # gerçek API (TYPESAFE_API_KEY + api.typesafe.ai erişimi gerekir)
//   npm run eval -- --mock            # ağsız kuru çalışma; betiğin uçtan uca çalıştığını doğrular
//   npm run eval -- --task=niyet --variant=hazirlanmis --limit=20
//
// Çıktı: results/<zaman>/report.md ve raw.jsonl

import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { ruleIntent } from './baseline-rules.mjs';
import { TASKS, VARIANTS } from './tasks.mjs';

const { values: args } = parseArgs({
  options: {
    task: { type: 'string', default: 'all' },
    variant: { type: 'string', default: 'all' },
    mock: { type: 'boolean', default: false },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '8' },
    // USD / 1M input token; TypeSafe'in duyurduğu fiyat. Çıktı token'ı ücretsiz.
    price: { type: 'string', default: '0.042' },
    // Bu güvenin altındaki kararlar otomatik uygulanmaz, insana/netleştirici soruya gider.
    threshold: { type: 'string', default: '0.8' },
    out: { type: 'string', default: 'results' },
  },
});

const taskNames = args.task === 'all' ? Object.keys(TASKS) : args.task.split(',');
const variants = args.variant === 'all' ? VARIANTS : args.variant.split(',');
for (const t of taskNames) if (!TASKS[t]) fail(`Bilinmeyen görev: ${t} (niyet, hizmet, saat)`);
for (const v of variants) if (!VARIANTS.includes(v)) fail(`Bilinmeyen varyant: ${v} (${VARIANTS.join(', ')})`);
const limit = args.limit ? Number(args.limit) : Infinity;
const concurrency = Number(args.concurrency);
const pricePerMillion = Number(args.price);
const threshold = Number(args.threshold);

// Anahtar ortamın "API credentials" bölümüne eklendiyse oturum onu hiç görmez; ajan proxy'si
// api.typesafe.ai isteklerine Authorization başlığını kendisi ekler. SDK boş anahtarı kabul
// etmediği için o durumda yer tutucu gönderilir.
const apiKey = process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected';
if (!args.mock && apiKey === 'proxy-injected') {
  console.error('Not: TYPESAFE_API_KEY ortam değişkeni yok; anahtarın proxy tarafından eklendiği varsayılıyor.');
}

const client = args.mock
  ? new TypeSafeClient({ apiKey: 'mock', fetch: mockFetch, retry: { maxRetries: 0 } })
  : new TypeSafeClient({ apiKey, timeout: 15_000 });

// ---------------------------------------------------------------- çalıştırma

const jobs = [];
for (const task of taskNames) {
  const items = TASKS[task].items().slice(0, limit);
  for (const variant of variants) for (const item of items) jobs.push({ task, variant, item });
}

let done = 0;
const records = await pool(jobs, concurrency, async (job) => {
  const record = await ask(job);
  done += 1;
  if (process.stderr.isTTY) process.stderr.write(`\r${done}/${jobs.length}`);
  return record;
});
if (process.stderr.isTTY) process.stderr.write('\n');

// Kural tabanlı alt sınır (yalnız niyet görevi, API çağrısı yok).
if (taskNames.includes('niyet')) {
  for (const item of TASKS.niyet.items().slice(0, limit)) {
    const choice = ruleIntent(item.message, item.context);
    records.push(base({ task: 'niyet', variant: 'kural', item }, { choice, confidence: null, latencyMs: 0, inputTokens: 0 }));
  }
}

async function ask(job) {
  const { state, question } = TASKS[job.task].request(job.item, job.variant);
  const started = performance.now();
  try {
    const response = await client.systemOne({ state, questions: { karar: question } });
    const answer = response.answers.karar;
    return base(job, {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      latencyMs: performance.now() - started,
      inputTokens: response.usage?.input_tokens ?? 0,
      model: response.model,
    });
  } catch (error) {
    return base(job, { error: `${error?.name ?? 'Error'}: ${error?.message ?? error}`, latencyMs: performance.now() - started, inputTokens: 0 });
  }
}

function base({ task, variant, item }, result) {
  return {
    task, variant, id: item.id, message: item.message, context: item.context,
    gold: item.gold, accept: item.accept, tags: item.tags, ambiguous: item.ambiguous,
    ...result,
    correct: result.error ? null : item.accept.includes(result.choice),
  };
}

async function pool(list, size, worker) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      out[index] = await worker(list[index]);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- metrikler

const pct = (x) => (x === null || Number.isNaN(x) ? '—' : `%${(x * 100).toFixed(1)}`);
const rate = (rows, pred) => (rows.length ? rows.filter(pred).length / rows.length : null);
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function summarize(rows) {
  const ok = rows.filter((r) => !r.error);
  const clear = ok.filter((r) => !r.ambiguous);
  const ambiguous = ok.filter((r) => r.ambiguous);
  const hasConfidence = ok.some((r) => r.confidence !== null);
  const covered = clear.filter((r) => r.confidence >= threshold);
  const tokens = ok.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
  return {
    n: rows.length,
    errors: rows.length - ok.length,
    accuracy: rate(clear, (r) => r.correct),
    hasConfidence,
    coverage: hasConfidence ? rate(clear, (r) => r.confidence >= threshold) : null,
    coveredAccuracy: hasConfidence ? rate(covered, (r) => r.correct) : null,
    confidentWrong: hasConfidence ? covered.filter((r) => !r.correct).length : null,
    ambiguousEscalated: hasConfidence ? rate(ambiguous, (r) => r.confidence < threshold) : null,
    confCorrect: mean(clear.filter((r) => r.correct && r.confidence !== null).map((r) => r.confidence)),
    confWrong: mean(clear.filter((r) => !r.correct && r.confidence !== null).map((r) => r.confidence)),
    p50: quantile(ok.map((r) => r.latencyMs), 0.5),
    p95: quantile(ok.map((r) => r.latencyMs), 0.95),
    tokens,
    cost: (tokens / 1e6) * pricePerMillion,
    clear,
    ambiguous,
  };
}

function groupAccuracy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) for (const key of [keyOf(row)].flat()) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, n: list.length, accuracy: rate(list, (r) => r.correct) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.n - a.n);
}

// ---------------------------------------------------------------- rapor

const variantOrder = ['kural', ...VARIANTS];
const combos = [];
for (const task of taskNames) for (const variant of variantOrder) {
  const rows = records.filter((r) => r.task === task && r.variant === variant);
  if (rows.length) combos.push({ task, variant, rows, s: summarize(rows) });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const lines = [];
lines.push(`# Jev Türkçe randevu değerlendirmesi — ${new Date().toISOString()}`, '');
if (args.mock) lines.push('> **MOCK ÇALIŞMA — gerçek Jev sonucu değildir.** Yalnız betiğin uçtan uca çalıştığını doğrular.', '');
const models = [...new Set(records.map((r) => r.model).filter(Boolean))];
lines.push(`Model: ${models.join(', ') || '—'} · Güven eşiği: ${threshold} · Fiyat varsayımı: $${pricePerMillion}/1M girdi token`, '');
lines.push('**Doğruluk** yalnız net mesajlarda ölçülür. **Otomatik** = güveni eşiğin üstünde olup insana sorulmadan uygulanacak kararların oranı.');
lines.push('**Emin ama yanlış** = eşiğin üstünde olduğu hâlde yanlış olan karar sayısı; botun asıl riski budur.');
lines.push('**Belirsizde durma** = gerçekten belirsiz mesajlarda güvenin eşiğin altında kalıp soruya/insana düşme oranı (yüksek olması iyi).');
lines.push('**kural** = anahtar kelime kuralları. Test seti görülerek yazıldığı için iyimserdir; yeni gerçek mesajlarda bu kadar iyi olması beklenmez.', '');
lines.push('| Görev | Varyant | n | Hata | Doğruluk | Otomatik | Otomatikte doğruluk | Emin ama yanlış | Belirsizde durma | p50 ms | p95 ms | Maliyet |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { task, variant, s } of combos) {
  lines.push(`| ${task} | ${variant} | ${s.n} | ${s.errors} | ${pct(s.accuracy)} | ${pct(s.coverage)} | ${pct(s.coveredAccuracy)} | ${s.confidentWrong ?? '—'} | ${pct(s.ambiguousEscalated)} | ${s.p50?.toFixed(0) ?? '—'} | ${s.p95?.toFixed(0) ?? '—'} | $${s.cost.toFixed(5)} |`);
}
const summaryEnd = lines.length;
lines.push('');

for (const { task, variant, rows, s } of combos) {
  lines.push(`## ${task} · ${variant}`, '');
  if (s.hasConfidence) {
    lines.push(`Ortalama güven — doğru: ${s.confCorrect?.toFixed(2) ?? '—'}, yanlış: ${s.confWrong?.toFixed(2) ?? '—'}`, '');
    lines.push('| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |', '|---|---|---|---|');
    for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      const covered = s.clear.filter((r) => r.confidence >= t);
      lines.push(`| ${t} | ${pct(rate(s.clear, (r) => r.confidence >= t))} | ${pct(rate(covered, (r) => r.correct))} | ${covered.filter((r) => !r.correct).length} |`);
    }
    lines.push('');
  }
  lines.push('**Etikete göre (en zayıftan):** ' + groupAccuracy(s.clear, (r) => r.gold).map((g) => `${g.key} ${pct(g.accuracy)} (${g.n})`).join(' · '), '');
  lines.push('**Zorluk etiketine göre:** ' + groupAccuracy(s.clear, (r) => r.tags).map((g) => `${g.key} ${pct(g.accuracy)} (${g.n})`).join(' · '), '');
  const mistakes = s.clear.filter((r) => !r.correct).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 15);
  if (mistakes.length) {
    lines.push('**Yanlışlar (en emin olunandan):**', '', '| Mesaj | Bağlam | Beklenen | Seçilen | Güven |', '|---|---|---|---|---|');
    for (const r of mistakes) {
      lines.push(`| ${cell(r.message)} | ${cell(r.context ?? '')} | ${r.accept.join(' / ')} | ${r.choice} | ${r.confidence?.toFixed(2) ?? '—'} |`);
    }
    lines.push('');
  }
  const errors = rows.filter((r) => r.error).slice(0, 5);
  if (errors.length) lines.push('**API hataları (ilk 5):**', '', ...errors.map((r) => `- ${r.id}: ${cell(r.error)}`), '');
}

const dir = new URL(`${args.out}/${stamp}${args.mock ? '-mock' : ''}/`, new URL('.', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('report.md', dir), lines.join('\n'));
writeFileSync(new URL('raw.jsonl', dir), records.map((r) => JSON.stringify(r)).join('\n') + '\n');

console.log(lines.slice(0, summaryEnd).join('\n'));
console.log(`\nRapor: ${new URL('report.md', dir).pathname}`);

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------- mock

// SDK'nın gerçek istek/yanıt yolunu kullanır; yalnız ağ çağrısı sahte.
async function mockFetch(_url, init) {
  const body = JSON.parse(init.body);
  const question = body.questions.karar;
  const labels = Object.keys(question.criteria);
  const message = body.state.musteri_mesaji ?? '';
  const choice = 'randevu_al' in question.criteria
    ? ruleIntent(message, body.state.botun_onceki_mesaji)
    : labels[hash(message) % labels.length];
  const top = 0.4 + (hash(`${message}:c`) % 60) / 100;
  const rest = (1 - top) / (labels.length - 1);
  const probabilities = Object.fromEntries(labels.map((label) => [label, label === choice ? top : rest]));
  const payload = {
    model: 'mock',
    answers: { karar: { type: 'choice', choice, confidence: top, probabilities } },
    usage: { input_tokens: Math.ceil(init.body.length / 4), output_tokens: 0 },
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}
