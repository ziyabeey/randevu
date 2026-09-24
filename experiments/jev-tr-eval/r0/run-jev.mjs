#!/usr/bin/env node
// R0 inceleme yorumlarında Jev'i üretimdeki regex ile karşılaştırır.
//
//   A) karar  — tüm adaylar: temiz / degisiklik_gerekli / insan_bakmali
//        tam        : yorum olduğu gibi (HTML temizlenmiş)
//        basliksiz  : Copilot başlığı ve "VERDICT:" satırı çıkarılmış (biçim değişirse ne olur?)
//   B) somut  — yalnız 🔵 Needs a closer look: somut bir kusur mu, genel insan incelemesi önerisi mi?
//
// Çelişki dedektörü simülasyonu: Jev, regex'le çelişip güveni ≥ --flag-threshold ise işaret koyar.
// Jev hiçbir zaman karar vermez; işaret yalnız mevcut escalation yoluna düşer.
//
//   NODE_USE_ENV_PROXY=1 node r0/run-jev.mjs [--mock] [--limit=N]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TypeSafeClient } from '@typesafe-ai/sdk';

const { values: args } = parseArgs({ options: {
  mock: { type: 'boolean', default: false },
  limit: { type: 'string' },
  concurrency: { type: 'string', default: '8' },
  'flag-threshold': { type: 'string', default: '0.9' },
  price: { type: 'string', default: '0.042' },
} });
const here = new URL('.', import.meta.url);
const flagThreshold = Number(args['flag-threshold']);
const rows = readFileSync(new URL('labeled.jsonl', here), 'utf8').trim().split('\n').map(JSON.parse)
  .slice(0, args.limit ? Number(args.limit) : Infinity);
const blueLabels = JSON.parse(readFileSync(new URL('blue-labels.json', here), 'utf8'));

const client = args.mock
  ? new TypeSafeClient({ apiKey: 'mock', fetch: mockFetch, retry: { maxRetries: 0 } })
  : new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY?.trim() || 'proxy-injected', timeout: 30_000 });

const clean = (body) => body
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<picture>[\s\S]*?<\/picture>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, 12_000);
const stripVerdict = (body) => body.replace(/^###\s*.+$/m, '').replace(/^.*verdict\s*:.*$/gim, '');

const VERDICT_QUESTION = {
  type: 'choice',
  instructions: '`review` is an automated code review posted on a pull request. What is the reviewer\'s own verdict '
    + 'about the reviewed commit? Judge only open items; findings the review marks as resolved do not count.',
  criteria: {
    temiz: 'The reviewer reports no open problem and accepts or recommends approving the change.',
    degisiklik_gerekli: 'The reviewer reports at least one open problem, finding or blocker that should be fixed before merging.',
    insan_bakmali: 'The reviewer does not assert a definite defect but recommends that a human take a closer look because of uncertainty, missing evidence or risk.',
  },
};
const CONCRETE_QUESTION = {
  type: 'noul',
  instructions: 'Does `review` describe a concrete, specific defect or gap in this pull request that should be fixed '
    + '(for example wrong behavior, a missing check, missing or unbound evidence, a security issue, an accessibility issue), '
    + 'rather than only recommending human review because the changed area is sensitive?',
  criteria: {
    true: 'Names at least one specific problem, gap or required fix in the change or its evidence.',
    false: 'Only says a human should review, because the area is sensitive or approvals are mixed, without naming a specific problem.',
  },
};

const jobs = [];
for (const row of rows) {
  const body = clean(row.body);
  jobs.push({ row, task: 'karar', variant: 'tam', state: { review: body }, question: VERDICT_QUESTION });
  jobs.push({ row, task: 'karar', variant: 'basliksiz', state: { review: clean(stripVerdict(row.body)) }, question: VERDICT_QUESTION });
  if (row.label === 'insan_bakmali' && row.id in blueLabels) {
    jobs.push({ row, task: 'somut', variant: 'tam', state: { review: body }, question: CONCRETE_QUESTION });
  }
}

const results = [];
const queue = [...jobs];
await Promise.all(Array.from({ length: Number(args.concurrency) }, async () => {
  while (queue.length) {
    const job = queue.shift();
    const started = performance.now();
    try {
      const response = await client.systemOne({ state: job.state, questions: { karar: job.question } });
      const answer = response.answers.karar;
      results.push({ job, answer, tokens: response.usage?.input_tokens ?? 0, ms: performance.now() - started, model: response.model });
    } catch (error) {
      results.push({ job, error: `${error?.name}: ${error?.message}`, ms: performance.now() - started, tokens: 0 });
    }
  }
}));

// ---------------------------------------------------------------- rapor

const pct = (a, b) => (b ? `%${((a / b) * 100).toFixed(1)}` : '—');
const lines = [];
const out = (s = '') => lines.push(s);
const errors = results.filter((r) => r.error);
const tokens = results.reduce((s, r) => s + r.tokens, 0);
out(`# R0 inceleme yorumları — regex ve Jev (${new Date().toISOString()})`);
out();
if (args.mock) out('> **MOCK — gerçek sonuç değildir.**\n');
out(`Aday: ${rows.length} · çağrı: ${results.length} · hata: ${errors.length} · model: ${[...new Set(results.map((r) => r.model).filter(Boolean))].join(', ')} · maliyet ≈ $${((tokens / 1e6) * Number(args.price)).toFixed(4)}`);
if (errors.length) out(`İlk hata: ${errors[0].error}`);
out();

const source = (row) => (/copilot/i.test(row.author) ? 'copilot' : 'ekip');
const verdicts = results.filter((r) => r.job.task === 'karar' && !r.error);
out('## A) Karar: temiz mi?');
out();
out('| Kaynak | Yöntem | n | İkili doğruluk (temiz / temiz değil) | 3 sınıf doğruluk |');
out('|---|---|---|---|---|');
for (const src of ['copilot', 'ekip', 'hepsi']) {
  const inSrc = (row) => src === 'hepsi' || source(row) === src;
  const base = rows.filter(inSrc);
  const regexOk = base.filter((row) => row.regexClean === (row.label === 'temiz')).length;
  out(`| ${src} | üretim regex'i | ${base.length} | ${pct(regexOk, base.length)} | — |`);
  for (const variant of ['tam', 'basliksiz']) {
    const list = verdicts.filter((r) => r.job.variant === variant && inSrc(r.job.row));
    const binary = list.filter((r) => (r.answer.choice === 'temiz') === (r.job.row.label === 'temiz')).length;
    const exact = list.filter((r) => r.answer.choice === r.job.row.label).length;
    out(`| ${src} | Jev · ${variant} | ${list.length} | ${pct(binary, list.length)} | ${pct(exact, list.length)} |`);
  }
}
out();

out(`## Çelişki dedektörü (Jev "tam", eşik ${flagThreshold})`);
out();
out('Jev kararı vermez; regex ile çelişip güveni eşiğin üstündeyse yalnız işaret koyar.');
out();
const tam = verdicts.filter((r) => r.job.variant === 'tam');
const regexWrong = tam.filter((r) => r.job.row.regexClean !== (r.job.row.label === 'temiz'));
const flagged = tam.filter((r) => (r.answer.choice === 'temiz') !== r.job.row.regexClean && r.answer.confidence >= flagThreshold);
const caught = flagged.filter((r) => r.job.row.regexClean !== (r.job.row.label === 'temiz'));
out(`- Regex'in yanıldığı yorum: **${regexWrong.length}**`);
out(`- Jev'in işaret koyduğu: **${flagged.length}** → doğru işaret (regex gerçekten yanlış): **${caught.length}**, yanlış alarm: **${flagged.length - caught.length}**`);
out(`- Yakalanamayan regex hatası: ${regexWrong.length - caught.length}`);
out();
const falseAlarms = flagged.filter((r) => !caught.includes(r));
if (falseAlarms.length) {
  out('Yanlış alarmlar:');
  out();
  for (const r of falseAlarms) out(`- #${r.job.row.pr} ${r.job.row.id} etiket=${r.job.row.label} regex=${r.job.row.regexClean ? 'temiz' : 'blok'} Jev=${r.answer.choice} (${r.answer.confidence.toFixed(2)})`);
  out();
}

out('## B) 🔵 incelemelerde somut sorun var mı?');
out();
const concrete = results.filter((r) => r.job.task === 'somut' && !r.error && blueLabels[r.job.row.id] !== null);
const decided = (r) => r.answer.noul >= 0.5;
const concreteOk = concrete.filter((r) => decided(r) === blueLabels[r.job.row.id]).length;
out(`Elle etiketli ${concrete.length} yorumda (belirsizler hariç) doğruluk: **${pct(concreteOk, concrete.length)}**`);
const regexCleanConcrete = concrete.filter((r) => r.job.row.regexClean && blueLabels[r.job.row.id] === true);
const regexCleanConcreteCaught = regexCleanConcrete.filter((r) => r.answer.noul >= flagThreshold);
out(`Regex'in "temiz" okuduğu ama somut sorun içeren ${regexCleanConcrete.length} yorumdan Jev'in ≥ ${flagThreshold} güvenle yakaladığı: **${regexCleanConcreteCaught.length}**`);
out();
out('| PR | Etiket | Jev P(somut) | Özet |');
out('|---|---|---|---|');
for (const r of concrete.sort((a, b) => a.job.row.pr - b.job.row.pr)) {
  const summary = r.job.row.body.split('\n').slice(r.job.row.body.split('\n').findIndex((l) => /^###/.test(l)) + 1).find((l) => l.trim()) ?? '';
  const mark = decided(r) === blueLabels[r.job.row.id] ? '' : ' ❌';
  out(`| #${r.job.row.pr} | ${blueLabels[r.job.row.id] ? 'somut' : 'genel'} | ${r.answer.noul.toFixed(2)}${mark} | ${summary.trim().slice(0, 110).replace(/\|/g, '\\|')} |`);
}

const dir = new URL(`results/${new Date().toISOString().replace(/[:.]/g, '-')}${args.mock ? '-mock' : ''}/`, here);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('report.md', dir), lines.join('\n') + '\n');
writeFileSync(new URL('raw.jsonl', dir), results.map((r) => JSON.stringify({ id: r.job.row.id, pr: r.job.row.pr, task: r.job.task, variant: r.job.variant, label: r.job.row.label, regexClean: r.job.row.regexClean, answer: r.answer, error: r.error, tokens: r.tokens, ms: r.ms })).join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nRapor: ${new URL('report.md', dir).pathname}`);

async function mockFetch(_url, init) {
  const body = JSON.parse(init.body);
  const q = body.questions.karar;
  const text = String(body.state.review ?? '');
  const answer = q.type === 'noul'
    ? { type: 'noul', noul: /remain|fix|missing|issue|gap/i.test(text) ? 0.9 : 0.2 }
    : (() => {
      const choice = /approval recommended|acceptable|no findings/i.test(text) ? 'temiz' : /closer look/i.test(text) ? 'insan_bakmali' : 'degisiklik_gerekli';
      return { type: 'choice', choice, confidence: 0.95, probabilities: { temiz: 0, degisiklik_gerekli: 0, insan_bakmali: 0, [choice]: 0.95 } };
    })();
  return new Response(JSON.stringify({ model: 'mock', answers: { karar: answer }, usage: { input_tokens: Math.ceil(init.body.length / 4), output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
