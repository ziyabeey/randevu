import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { H19_AXES } from './h19-axis-shadow-score.mjs';

const DEFAULT_API_BASE = 'https://api.typesafe.ai';
const CACHE_VERSION = 'DE-JEV-H19-R0-CACHE-0.1';
const FACT_VERSION = 'DE-JEV-H19-R0-FACTS-0.1';

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort((a, b) => a.localeCompare(b, 'en'))
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function assertPinnedModel(model) {
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('JEV_MODEL is required and must be a pinned model version');
  }
  if (/(^|[-_.])latest$/i.test(model.trim())) {
    throw new Error('JEV_MODEL must be pinned; moving aliases such as jev-latest are not allowed for benchmark facts');
  }
  return model.trim();
}

export function assertLeakageFree(state) {
  const text = canonicalJson(state);
  const patterns = [
    /\bH19\b/i,
    /EXP-H19/i,
    /exp\/h19/i,
    /\bD[0-5]\s*[x×]\s*D[0-5]\b/i,
  ];
  const hit = patterns.find((pattern) => pattern.test(text));
  if (hit) throw new Error('benchmark input leakage guard rejected state: ' + hit);
  return state;
}

export function buildJevRequest(inputCase, questionBank, model) {
  if (!inputCase || typeof inputCase !== 'object' || typeof inputCase.case_key !== 'string') {
    throw new Error('input case requires case_key');
  }
  if (!Array.isArray(inputCase.files) || inputCase.files.length === 0) {
    throw new Error('input case ' + inputCase.case_key + ' requires production diff files');
  }
  if (!Array.isArray(questionBank?.axes) || questionBank.axes.length !== H19_AXES.length) {
    throw new Error('question bank must define exactly six H19 axes');
  }
  const state = assertLeakageFree({
    files: inputCase.files.map((file) => ({ path: file.path, patch: file.patch })),
  });
  const seen = new Set();
  const questions = {};
  for (const axis of questionBank.axes) {
    if (!H19_AXES.includes(axis?.id) || seen.has(axis.id)) {
      throw new Error('question bank contains invalid or duplicate axis: ' + axis?.id);
    }
    seen.add(axis.id);
    questions[axis.id] = {
      type: 'noul',
      instructions: axis.question,
      criteria: {
        true: 'The supplied production-code change materially affects this semantic axis.',
        false: 'The supplied production-code change does not materially affect this semantic axis.',
      },
    };
  }
  if (H19_AXES.some((axis) => !seen.has(axis))) throw new Error('question bank is missing an H19 axis');
  return { model: assertPinnedModel(model), state, questions };
}

export function validateJevResponse(response, requestedModel) {
  if (!response || typeof response !== 'object') throw new Error('Jev response must be an object');
  if (response.model !== requestedModel) {
    throw new Error('Jev served model differs from pinned request: requested=' + requestedModel + ' served=' + response.model);
  }
  if (!response.answers || typeof response.answers !== 'object') throw new Error('Jev response answers are missing');
  const axisProbabilities = {};
  for (const axis of H19_AXES) {
    const answer = response.answers[axis];
    if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number'
      || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new Error('invalid Jev Noul answer for ' + axis);
    }
    axisProbabilities[axis] = answer.noul;
  }
  return {
    axis_probabilities: axisProbabilities,
    usage: response.usage ?? null,
  };
}

export function buildFactIdentity({ inputDigest, questionBank, questionBankDigest, model }) {
  const identity = {
    input_digest: inputDigest,
    question_bank_id: questionBank.question_bank_id,
    question_bank_version: questionBank.version,
    question_bank_digest: questionBankDigest,
    model,
  };
  return { ...identity, fact_key: sha256(identity) };
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadCache(cachePath) {
  try {
    const cache = await loadJson(cachePath);
    if (cache?.version !== CACHE_VERSION || !cache.entries || typeof cache.entries !== 'object') {
      throw new Error('unsupported Jev fact cache format');
    }
    return cache;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: CACHE_VERSION, entries: {} };
    throw error;
  }
}

async function saveJson(file, value) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

async function callJev(request, { apiKey, apiBase = DEFAULT_API_BASE, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('TYPESAFE_API_KEY is required for uncached benchmark facts');
  }
  const response = await fetchImpl(apiBase.replace(/\/$/, '') + '/v1/systemone', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error('TypeSafe System One request failed HTTP ' + response.status + ': ' + body);
  }
  return response.json();
}

export async function runH19AxisShadow({
  inputs,
  questionBank,
  model,
  cache,
  apiKey,
  apiBase,
  fetchImpl,
}) {
  const pinnedModel = assertPinnedModel(model);
  if (!Array.isArray(inputs?.cases) || inputs.cases.length === 0) throw new Error('benchmark inputs require cases');
  if (questionBank?.question_bank_id !== 'DE-JEV-H19-AXIS') throw new Error('unexpected question bank id');
  const questionBankDigest = sha256(questionBank);
  const outputCases = [];
  let liveCalls = 0;
  let cacheHits = 0;

  for (const inputCase of inputs.cases) {
    const request = buildJevRequest(inputCase, questionBank, pinnedModel);
    const inputDigest = sha256(request.state);
    const identity = buildFactIdentity({
      inputDigest,
      questionBank,
      questionBankDigest,
      model: pinnedModel,
    });
    const cached = cache.entries[identity.fact_key];
    if (cached) {
      const expected = canonicalJson(identity);
      if (canonicalJson(cached.identity) !== expected) throw new Error('cache identity mismatch for ' + inputCase.case_key);
      outputCases.push({ case_key: inputCase.case_key, ...identity, ...cached.fact, cache_hit: true });
      cacheHits += 1;
      continue;
    }

    const raw = await callJev(request, { apiKey, apiBase, fetchImpl });
    const fact = validateJevResponse(raw, pinnedModel);
    cache.entries[identity.fact_key] = {
      identity: {
        input_digest: identity.input_digest,
        question_bank_id: identity.question_bank_id,
        question_bank_version: identity.question_bank_version,
        question_bank_digest: identity.question_bank_digest,
        model: identity.model,
        fact_key: identity.fact_key,
      },
      fact,
    };
    outputCases.push({ case_key: inputCase.case_key, ...identity, ...fact, cache_hit: false });
    liveCalls += 1;
  }

  return {
    facts: {
      version: FACT_VERSION,
      protocol: 'DE-JEV-H19-R0',
      question_bank: {
        id: questionBank.question_bank_id,
        version: questionBank.version,
        digest: questionBankDigest,
      },
      model: pinnedModel,
      cases: outputCases,
    },
    cache,
    receipt: { case_count: outputCases.length, live_calls: liveCalls, cache_hits: cacheHits },
  };
}

async function main() {
  const [inputsPath, questionsPath, factsPath, cachePath = '.cache/de-jev-h19-r0.json'] = process.argv.slice(2);
  if (!inputsPath || !questionsPath || !factsPath) {
    console.error('usage: node scripts/run-h19-axis-jev-shadow.mjs <inputs.json> <questions.json> <facts.json> [cache.json]');
    process.exitCode = 2;
    return;
  }
  const [inputs, questionBank, cache] = await Promise.all([
    loadJson(inputsPath),
    loadJson(questionsPath),
    loadCache(cachePath),
  ]);
  const result = await runH19AxisShadow({
    inputs,
    questionBank,
    model: process.env.JEV_MODEL,
    cache,
    apiKey: process.env.TYPESAFE_API_KEY,
    apiBase: process.env.TYPESAFE_API_BASE,
  });
  await saveJson(cachePath, result.cache);
  await saveJson(factsPath, result.facts);
  process.stdout.write(JSON.stringify(result.receipt) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
