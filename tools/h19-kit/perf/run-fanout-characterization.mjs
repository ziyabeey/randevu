#!/usr/bin/env node
// FANOUT-001 — M10 fan-out performance and equivalence characterization (plan: perf/FANOUT-001.md).
// The arms, sizes, repeats and case set below were committed before the first live request.
//
//   node perf/run-fanout-characterization.mjs --out perf/baselines/FANOUT-001.<env>.json [--fake]
//
// Live mode needs a TypeSafe credential: TYPESAFE_API_KEY, or --proxy-injected-key when an egress
// proxy injects it. The credential is never written to the report.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { composeRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';
import { RELATION_DIRECTION_QUESTION, relationalJevState } from '../src/relations/relational-evidence.mjs';
import {
  JEV_RELATIONAL_MODEL,
  RELATION_CHOICE_DOMAIN,
  TYPESAFE_SYSTEMONE_URL,
  normalizeRelationProbabilities,
} from '../src/adapters/jev-relational.mjs';
import { runRelationalJudgmentBatch } from '../src/relations/relational-judgment-batch.mjs';

export const PLAN = Object.freeze({
  id: 'FANOUT-001',
  sizes: [1, 5, 10, 20],
  repeats: 3,
  singleRepeats: 2,
  failureTimeoutMs: 1,
  failureSize: 5,
  timeoutMs: 60_000,
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };

// ---- frozen synthetic case set: 20 surviving-mutant hypotheses with varied fact relations ----
const OTHER_FAMILIES = ['coverage', 'history', 'test', 'dependency', 'performance'];
function fact({ factId, family, path: filePath, value, baseline, sampleSize = 20, lineage = null }) {
  return {
    fact: {
      factId,
      family,
      state: 'present',
      metricId: `metric:${family}`,
      value,
      unit: 'count',
      denominator: null,
      sampleSize,
      baseline: { value: baseline, sampleSize: 200, sourceId: `baseline:${family}` },
      lineageIds: [lineage ?? `lineage:${factId}`],
      provenance: {
        producer: `producer:${family}`,
        producerVersion: '1',
        inputDigest: `input:${factId}`,
        sourceRevision: 'fanout-001',
        evidenceIds: [`evidence:${factId}`],
      },
    },
    scope: { kind: 'path', path: filePath },
  };
}

export function buildCaseSet() {
  const hypotheses = [];
  const factPool = [];
  for (let i = 0; i < 20; i += 1) {
    const filePath = `src/module-${String(i).padStart(2, '0')}.ts`;
    hypotheses.push({
      id: `coverage:surviving-mutant:m${i}:${filePath}`,
      target: { kind: 'path', path: filePath },
      reason: 'surviving-mutant',
      priority: i % 3 === 0 ? 'high' : 'medium',
      evidenceIds: [`evidence:h${i}`],
      validation: { preferred: 'targeted-test-or-mutation', requiresRuntimeEvidence: true },
    });
    // Pattern i % 4: 0 reinforcing, 1 contradicting, 2 near-baseline, 3 shared lineage.
    const pattern = i % 4;
    const other = OTHER_FAMILIES[i % OTHER_FAMILIES.length];
    const sharedLineage = pattern === 3 ? `lineage:shared:${i}` : null;
    factPool.push(fact({
      factId: `mutation:${i}`, family: 'mutation', path: filePath,
      value: 8 + (i % 5), baseline: 3, sampleSize: i % 7 === 0 ? 3 : 25, lineage: sharedLineage,
    }));
    factPool.push(fact({
      factId: `${other}:${i}`, family: other, path: filePath,
      value: pattern === 0 ? 9 : pattern === 1 ? 1 : 3.1, baseline: 3, lineage: sharedLineage,
    }));
    // Shared-lineage pairs need a third independent family to remain a valid M9 case.
    if (i % 5 === 2 || pattern === 3) {
      const third = OTHER_FAMILIES[(i + 2) % OTHER_FAMILIES.length];
      factPool.push(fact({ factId: `${third}:${i}`, family: third, path: filePath, value: 6, baseline: 3 }));
    }
  }
  const packet = freezeCoverageDiscoveryPacket({
    changeId: 'fanout-001',
    sourceRevision: 'fanout-001',
    impact: { changedFiles: hypotheses.map((h) => h.target.path), unknowns: [], safeToNarrow: true },
    discovery: { hypotheses },
  });
  return composeRelationalCaseBatch({ packet, factPool });
}

class MemoryCache {
  constructor() { this.map = new Map(); this.writes = 0; }
  async get(_namespace, key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : null; }
  async set(_namespace, key, value) { this.writes += 1; this.map.set(key, structuredClone(value)); }
}

// ---- transport: records bytes, latency and usage for every provider request ----
function makeTransport({ fake }) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const requestBytes = Buffer.byteLength(options.body);
    const body = JSON.parse(options.body);
    const started = performance.now();
    let status = 0;
    let text = '';
    let error = null;
    try {
      if (fake) {
        const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, {
          type: 'choice', choice: 'unrelated', confidence: 0.5,
          probabilities: { strengthens: 0.2, weakens: 0.1, unrelated: 0.6, insufficient: 0.1 },
        }]));
        status = 200;
        text = JSON.stringify({ model: body.model, answers, usage: { input_tokens: requestBytes >> 2 } });
      } else {
        const response = await fetch(url, options);
        status = response.status;
        text = await response.text();
      }
    } catch (caught) {
      error = caught;
    }
    const latencyMs = Math.round((performance.now() - started) * 10) / 10;
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    requests.push({
      questions: Object.keys(body.questions ?? {}).length || 1,
      shape: body.state?.schemaVersion === 1 && Array.isArray(body.state?.cases) ? 'fanout' : 'single',
      requestBytes,
      responseBytes: Buffer.byteLength(text),
      status,
      latencyMs,
      usage: json?.usage ?? null,
      error: error ? String(error.name || 'Error') : null,
      raw: json,
    });
    if (error) throw error;
    return { ok: status >= 200 && status < 300, status, async json() { return json; } };
  };
  return { requests, fetchImpl };
}

const probsOf = (answer) => normalizeRelationProbabilities(answer?.probabilities);
const l1 = (a, b) => RELATION_CHOICE_DOMAIN.reduce((sum, c) => sum + Math.abs(a[c] - b[c]), 0) / RELATION_CHOICE_DOMAIN.length;
const argmax = (p) => RELATION_CHOICE_DOMAIN.reduce((best, c) => (p[c] > p[best] ? c : best), RELATION_CHOICE_DOMAIN[0]);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function compare(mapA, mapB) {
  const ids = Object.keys(mapA).filter((id) => mapB[id]);
  const deltas = ids.map((id) => l1(mapA[id], mapB[id]));
  return {
    n: ids.length,
    meanAbsDelta: mean(deltas),
    maxAbsDelta: deltas.length ? Math.max(...deltas) : null,
    argmaxAgreement: ids.length ? ids.filter((id) => argmax(mapA[id]) === argmax(mapB[id])).length / ids.length : null,
  };
}

async function main() {
  const fake = process.argv.includes('--fake');
  const apiKey = fake ? 'fake' : (process.env.TYPESAFE_API_KEY?.trim() || (process.argv.includes('--proxy-injected-key') ? 'proxy-injected' : ''));
  if (!apiKey) throw new Error('TYPESAFE_API_KEY or --proxy-injected-key required for live mode');
  const out = arg('--out');
  const { batch, relationalCases } = buildCaseSet();
  if (batch.cases.length !== 20) throw new Error(`expected 20 composed cases, got ${batch.cases.length}`);
  const byOrder = batch.cases.map((s) => relationalCases.find((c) => c.caseSha256 === s.caseSha256));
  const transport = makeTransport({ fake });
  const runs = [];
  const run = async (label, options) => {
    const before = transport.requests.length;
    const started = performance.now();
    const result = await runRelationalJudgmentBatch({
      batch, relationalCases, apiKey, fetchImpl: transport.fetchImpl, timeoutMs: PLAN.timeoutMs, ...options,
    });
    const wallMs = Math.round((performance.now() - started) * 10) / 10;
    const record = {
      label,
      maxLiveQuestions: options.maxLiveQuestions,
      providerRequestCount: result.run.providerRequestCount,
      counts: result.run.counts,
      errorCodes: [...new Set(result.run.rows.filter((r) => r.kind === 'error').map((r) => r.errorCode))],
      wallMs,
      request: transport.requests.slice(before).map(({ raw: _raw, ...rest }) => rest)[0] ?? null,
      probabilities: Object.fromEntries(result.run.rows.filter((r) => r.kind === 'answered' && r.source === 'live')
        .map((r) => [r.hypothesisId, r.probabilities])),
    };
    runs.push(record);
    process.stderr.write(`${label}: requests=${record.providerRequestCount} live=${record.counts.live} errors=${record.counts.error} wall=${wallMs}ms\n`);
    return { result, record };
  };

  // Arm A — fan-out size lane (fresh cache each run).
  for (let repeat = 1; repeat <= PLAN.repeats; repeat += 1) {
    for (const size of PLAN.sizes) await run(`size-${size}-r${repeat}`, { maxLiveQuestions: size, cache: new MemoryCache() });
  }

  // Arm B — equivalence lane: each case in the M8 single-case request shape, repeated.
  const singles = [];
  for (let repeat = 1; repeat <= PLAN.singleRepeats; repeat += 1) {
    const map = {};
    for (const relationalCase of byOrder) {
      const request = {
        model: JEV_RELATIONAL_MODEL,
        state: relationalJevState(relationalCase),
        questions: { relation: { type: RELATION_DIRECTION_QUESTION.type, instructions: RELATION_DIRECTION_QUESTION.instructions, criteria: structuredClone(RELATION_DIRECTION_QUESTION.criteria) } },
      };
      const options = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(PLAN.timeoutMs),
      };
      try {
        const response = await transport.fetchImpl(TYPESAFE_SYSTEMONE_URL, options);
        const json = await response.json();
        const p = probsOf(json?.answers?.relation);
        if (response.ok && json?.model === JEV_RELATIONAL_MODEL && p) map[relationalCase.hypothesis.hypothesisId] = p;
      } catch {
        // recorded by the transport
      }
    }
    singles.push(map);
    process.stderr.write(`single-r${repeat}: ${Object.keys(map).length}/20 valid\n`);
  }

  // Arm C — cache lane: warm the cache with one full fan-out, then replay with zero requests.
  const cache = new MemoryCache();
  await run('cache-warm', { maxLiveQuestions: 20, cache });
  const replay = await run('cache-replay', { maxLiveQuestions: 20, cache });

  // Arm D — failure lane: one request with a timeout too short to complete.
  const failureCache = new MemoryCache();
  const failure = await run('failure-timeout', {
    maxLiveQuestions: PLAN.failureSize, cache: failureCache, timeoutMs: PLAN.failureTimeoutMs,
  });

  // ---- summary ----
  const sizeSummary = PLAN.sizes.map((size) => {
    const xs = runs.filter((r) => r.label.startsWith(`size-${size}-`));
    const ok = xs.filter((r) => r.counts.error === 0 && r.request);
    return {
      questions: size,
      runs: xs.length,
      successfulRuns: ok.length,
      medianLatencyMs: median(ok.map((r) => r.request.latencyMs)),
      latencyMsPerQuestion: ok.length ? median(ok.map((r) => r.request.latencyMs)) / size : null,
      requestBytes: median(ok.map((r) => r.request.requestBytes)),
      responseBytes: median(ok.map((r) => r.request.responseBytes)),
      inputTokens: median(ok.map((r) => r.request.usage?.input_tokens).filter((x) => typeof x === 'number')),
      errorCodes: [...new Set(xs.flatMap((r) => r.errorCodes))],
    };
  });
  const fanout20 = runs.filter((r) => r.label.startsWith('size-20-')).map((r) => r.probabilities);
  const pairs = (maps) => maps.flatMap((a, i) => maps.slice(i + 1).map((b) => compare(a, b)));
  const singleRequests = transport.requests.filter((r) => r.shape === 'single');
  const report = {
    id: PLAN.id,
    mode: fake ? 'fake' : 'live',
    environment: fake ? 'local-fake' : (arg('--env') ?? 'unspecified'),
    model: JEV_RELATIONAL_MODEL,
    plan: PLAN,
    caseSetSha256: batch.batchSha256,
    providerRequests: transport.requests.length,
    questionsAsked: transport.requests.reduce((s, r) => s + r.questions, 0),
    sizes: sizeSummary,
    singleShape: {
      requests: singleRequests.length,
      medianLatencyMs: median(singleRequests.filter((r) => r.status === 200).map((r) => r.latencyMs)),
      medianRequestBytes: median(singleRequests.map((r) => r.requestBytes)),
      medianInputTokens: median(singleRequests.map((r) => r.usage?.input_tokens).filter((x) => typeof x === 'number')),
    },
    // Per-case probabilities of each single-shape repeat (hypothesisId → four-option map).
    singleShapeProbabilities: singles,
    equivalence: {
      note: 'Mean |Δp| is the mean absolute difference over the four options; argmax agreement is the share of cases with the same top option.',
      singleVsSingle: pairs(singles),
      fanout20VsFanout20: pairs(fanout20),
      singleVsFanout20: singles.flatMap((s) => fanout20.map((f) => compare(s, f))),
    },
    cache: {
      warmRequests: runs.find((r) => r.label === 'cache-warm').providerRequestCount,
      replayRequests: replay.record.providerRequestCount,
      replayCached: replay.record.counts.cached,
      replayWallMs: replay.record.wallMs,
    },
    failure: {
      providerRequestCount: failure.record.providerRequestCount,
      errorCodes: failure.record.errorCodes,
      errors: failure.record.counts.error,
      cacheWrites: failureCache.writes,
    },
    runs,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(path.resolve(out), json);
  }
  if (json.includes(apiKey) && apiKey !== 'fake') throw new Error('credential leaked into report');
  process.stdout.write(`${JSON.stringify({ sizes: report.sizes, equivalence: report.equivalence, cache: report.cache, failure: report.failure }, null, 2)}\n`);
  process.stderr.write(`report sha256 ${sha256(json)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
