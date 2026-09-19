import { readFileSync } from 'node:fs';
import path from 'node:path';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readBody(target) {
  if (!target || target === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

const bodyTarget = argValue('--body') ?? process.argv[2] ?? '-';
const url = process.env.CLAUDE_ROUTINE_URL;
const token = process.env.CLAUDE_ROUTINE_TOKEN;
const dryRun = process.argv.includes('--dry-run');
const body = readBody(bodyTarget);

if (!body || typeof body.text !== 'string' || !body.text.trim()) {
  throw new Error('Routine request body must contain non-empty text.');
}

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, configured: Boolean(url && token), body }, null, 2));
  process.exit(0);
}

if (!url) throw new Error('CAPABILITY_BLOCKED: CLAUDE_ROUTINE_URL is not configured.');
if (!token) throw new Error('CAPABILITY_BLOCKED: CLAUDE_ROUTINE_TOKEN is not configured.');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'experimental-cc-routine-2026-04-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`Claude routine fire failed (${response.status}): ${responseText.slice(0, 500)}`);
}

let parsed = null;
try {
  parsed = responseText ? JSON.parse(responseText) : null;
} catch {
  parsed = { raw: responseText };
}

console.log(JSON.stringify({ ok: true, status: response.status, result: parsed }, null, 2));
