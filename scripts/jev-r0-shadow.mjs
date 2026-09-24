#!/usr/bin/env node
// DE-JEV-R0 (maturity SHADOW): advisory second signal for R0 receipt parsing.
//
// Reads recent PR reviews/comments, applies the production R0 "clean" rule from
// scripts/prepare-development-review-observation.mjs (copied verbatim; pinned by
// tests/jev-r0-shadow.test.mjs) and asks TypeSafe Jev for the reviewer's verdict.
// A disagreement at or above the threshold is only reported. The script never
// writes to GitHub, never changes dispatcher input and never fails a gate: with no
// TYPESAFE_API_KEY it skips and exits 0.

import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JEV_MODEL = 'jev-1.13.0';
export const FLAG_THRESHOLD = 0.9;
const MAX_REVIEW_CHARS = 12_000;

// ---- production rule (copy of r0Receipt candidate filter and clean verdict) ----

export function isR0Candidate({ author = '', association = '', body = '' }) {
  return /copilot-pull-request-reviewer/i.test(author)
    || (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association)
      && /(?:^|[^a-z0-9])r0(?:[^a-z0-9]|$)/i.test(body)
      && /verdict\s*:/i.test(body));
}

export function productionClean(body) {
  const structuredCleanVerdict = /verdict\s*:\s*(?:no\s+findings|acceptable)/i.test(body);
  const nativeNoFindings = /\*\*findings:\**\s*none/i.test(body);
  const claimsUnresolved = /unresolved[^\n]*(?:issue|finding|remain)|(?:issue|finding)[^\n]*remain[^\n]*unresolved/i.test(body);
  return structuredCleanVerdict || (nativeNoFindings && !claimsUnresolved);
}

// ---- Jev question (as measured in experiments/jev-tr-eval/r0) ----

export const VERDICT_QUESTION = {
  type: 'choice',
  instructions: '`review` is an automated code review posted on a pull request. What is the reviewer\'s own verdict '
    + 'about the reviewed commit? Judge only open items; findings the review marks as resolved do not count.',
  criteria: {
    clean: 'The reviewer reports no open problem and accepts or recommends approving the change.',
    changes_needed: 'The reviewer reports at least one open problem, finding or blocker that should be fixed before merging.',
    needs_human: 'The reviewer does not assert a definite defect but recommends that a human take a closer look because of uncertainty, missing evidence or risk.',
  },
};

export function reviewText(body) {
  return String(body ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<picture>[\s\S]*?<\/picture>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_REVIEW_CHARS);
}

export function contradiction(regexClean, answer, threshold = FLAG_THRESHOLD) {
  if (!answer || answer.confidence < threshold) return null;
  const jevClean = answer.choice === 'clean';
  if (jevClean === regexClean) return null;
  return regexClean ? 'regex_clean_jev_not_clean' : 'regex_blocked_jev_clean';
}

// ---- I/O ----

async function github(fetchImpl, repository, token, route) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = route.includes('?') ? '&' : '?';
    const res = await fetchImpl(`https://api.github.com/repos/${repository}${route}${separator}per_page=100&page=${page}`, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'de-jev-r0-shadow' },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${route}`);
    const batch = await res.json();
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function askJev(fetchImpl, apiKey, review) {
  const res = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: JEV_MODEL, state: { review }, questions: { verdict: VERDICT_QUESTION } }),
  });
  if (!res.ok) throw new Error(`TypeSafe ${res.status}`);
  const json = await res.json();
  return { ...json.answers.verdict, model: json.model, inputTokens: json.usage?.input_tokens ?? 0 };
}

export function renderSummary({ repository, since, rows, skipped }) {
  const lines = ['## DE-JEV-R0 (SHADOW) — R0 receipt second signal', ''];
  if (skipped) return [...lines, `Skipped: ${skipped}. No gate or dispatcher input is affected.`, ''].join('\n');
  const flagged = rows.filter((row) => row.flag);
  const errors = rows.filter((row) => row.error);
  lines.push(`Repository \`${repository}\` · candidates since ${since}: **${rows.length}** · flags (≥ ${FLAG_THRESHOLD}): **${flagged.length}** · Jev errors: ${errors.length}`);
  lines.push('', 'Advisory only: flags are for measured coordinator review and never change R0 blockers.', '');
  if (flagged.length) {
    lines.push('| PR | Receipt | Production rule | Jev | Flag |', '|---|---|---|---|---|');
    for (const row of flagged) {
      lines.push(`| #${row.pr} | [${row.kind}](${row.url}) | ${row.regexClean ? 'clean' : 'not clean'} | ${row.jev.choice} (${row.jev.confidence.toFixed(2)}) | ${row.flag} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function run({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const days = Number(env.LOOKBACK_DAYS ?? 7);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  if (!env.TYPESAFE_API_KEY?.trim()) return { repository, since, rows: [], skipped: 'TYPESAFE_API_KEY is not configured' };

  const pulls = (await github(fetchImpl, repository, token, '/pulls?state=all&sort=updated&direction=desc'))
    .filter((pr) => pr.updated_at >= since);
  const rows = [];
  for (const pr of pulls) {
    const [reviews, comments] = await Promise.all([
      github(fetchImpl, repository, token, `/pulls/${pr.number}/reviews`),
      github(fetchImpl, repository, token, `/issues/${pr.number}/comments`),
    ]);
    for (const [kind, list] of [['review', reviews], ['comment', comments]]) {
      for (const item of list) {
        const at = item.submitted_at ?? item.created_at ?? '';
        const candidate = { author: item.user?.login ?? '', association: item.author_association ?? '', body: item.body ?? '' };
        if (at < since || !candidate.body.trim() || !isR0Candidate(candidate)) continue;
        const regexClean = productionClean(candidate.body);
        const row = { pr: pr.number, kind, id: item.id, url: item.html_url, at, regexClean };
        try {
          row.jev = await askJev(fetchImpl, env.TYPESAFE_API_KEY.trim(), reviewText(candidate.body));
          row.flag = contradiction(regexClean, row.jev);
        } catch (error) {
          row.error = String(error?.message ?? error);
        }
        rows.push(row);
      }
    }
  }
  return { repository, since, rows };
}

async function main() {
  const result = await run();
  const summary = renderSummary(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.JEV_R0_OUTPUT) writeFileSync(process.env.JEV_R0_OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
