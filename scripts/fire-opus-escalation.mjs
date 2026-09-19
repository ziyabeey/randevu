import { readFileSync } from 'node:fs';
import path from 'node:path';

const BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const MAX_TEXT_BYTES = 64 * 1024;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(target) {
  if (!target || target === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`OPUS_HANDOFF_BLOCKED: ${label}_MISSING`);
  return value.trim();
}

function validateRoutineUrl(raw) {
  const value = requireString(raw, 'CLAUDE_OPUS_ROUTINE_URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OPUS_HANDOFF_BLOCKED: CLAUDE_OPUS_ROUTINE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.anthropic.com') {
    throw new Error('OPUS_HANDOFF_BLOCKED: CLAUDE_OPUS_ROUTINE_URL_UNTRUSTED');
  }
  if (!/^\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/.test(parsed.pathname)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: CLAUDE_OPUS_ROUTINE_URL_PATH_INVALID');
  }
  return parsed.toString();
}

function normalizePackage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: PACKAGE_INVALID');
  }

  const disposition = input.DISPOSITION ?? input.disposition;
  if (disposition !== 'REASONING_REQUIRED') {
    throw new Error(`OPUS_HANDOFF_BLOCKED: DISPOSITION_${disposition ?? 'MISSING'}`);
  }

  const caseFingerprint = requireString(
    input.CASE_FINGERPRINT ?? input.caseFingerprint,
    'CASE_FINGERPRINT',
  );
  if (!/^[a-f0-9]{64}$/i.test(caseFingerprint)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_INVALID');
  }

  const opusPackage = input.OPUS_ESCALATION_PACKAGE ?? input.opusEscalationPackage;
  if (!opusPackage || typeof opusPackage !== 'object' || Array.isArray(opusPackage)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: OPUS_ESCALATION_PACKAGE_MISSING');
  }

  return {
    disposition,
    caseFingerprint,
    opusEscalationPackage: opusPackage,
  };
}

function buildText(pkg) {
  return [
    'OPUS_ESCALATION_PACKAGE',
    `CASE_FINGERPRINT: ${pkg.caseFingerprint}`,
    'SOURCE: HAIKU_EVIDENCE_CONTEXT_COMPRESSOR',
    '',
    'Resolve only the bounded technical ambiguity in this package.',
    'Treat this package as a freshness-fenced navigation aid with provenance, not as permission to broaden scope.',
    'Do not reconstruct unrelated repository history unless a material contradiction or missing provenance requires it.',
    '',
    JSON.stringify(pkg.opusEscalationPackage),
  ].join('\n');
}

const target = argValue('--package') ?? process.argv[2] ?? '-';
const expectedFingerprint = argValue('--expected-fingerprint');
const dryRun = process.argv.includes('--dry-run');
const pkg = normalizePackage(readJson(target));

if (!expectedFingerprint || !/^[a-f0-9]{64}$/i.test(expectedFingerprint)) {
  throw new Error('OPUS_HANDOFF_BLOCKED: EXPECTED_FINGERPRINT_INVALID');
}
if (pkg.caseFingerprint.toLowerCase() !== expectedFingerprint.toLowerCase()) {
  throw new Error('OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_MISMATCH');
}

const text = buildText(pkg);

if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
  throw new Error('OPUS_HANDOFF_BLOCKED: PACKAGE_TOO_LARGE');
}

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    caseFingerprint: pkg.caseFingerprint,
    textBytes: Buffer.byteLength(text, 'utf8'),
  }, null, 2));
  process.exit(0);
}

const url = validateRoutineUrl(process.env.CLAUDE_OPUS_ROUTINE_URL);
const token = requireString(process.env.CLAUDE_OPUS_ROUTINE_TOKEN, 'CLAUDE_OPUS_ROUTINE_TOKEN');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA_HEADER,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ text }),
  signal: AbortSignal.timeout(30_000),
});

const raw = await response.text();
if (!response.ok) {
  let reason = `HTTP_${response.status}`;
  try {
    const parsed = JSON.parse(raw);
    const type = parsed?.error?.type;
    if (typeof type === 'string' && type) reason = `${reason}_${type.toUpperCase()}`;
  } catch {
    // Preserve only the status-derived reason; never echo unknown response bodies.
  }
  throw new Error(`OPUS_HANDOFF_BLOCKED: ${reason}`);
}

let receipt;
try {
  receipt = JSON.parse(raw);
} catch {
  throw new Error('OPUS_HANDOFF_BLOCKED: RESPONSE_NOT_JSON');
}

if (receipt?.type !== 'routine_fire'
  || typeof receipt?.claude_code_session_id !== 'string'
  || typeof receipt?.claude_code_session_url !== 'string') {
  throw new Error('OPUS_HANDOFF_BLOCKED: RESPONSE_SHAPE_INVALID');
}

console.log(JSON.stringify({
  status: 'OPUS_TRIGGERED',
  caseFingerprint: pkg.caseFingerprint,
  claudeCodeSessionId: receipt.claude_code_session_id,
  claudeCodeSessionUrl: receipt.claude_code_session_url,
}, null, 2));
