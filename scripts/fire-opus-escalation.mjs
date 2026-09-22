import {
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const MAX_TEXT_BYTES = 64 * 1024;
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const OIDC_JWKS_URL = `${OIDC_ISSUER}/.well-known/jwks`;
const EXPECTED_REPOSITORY = 'ziyabeey/randevu';
const EXPECTED_REPOSITORY_ID = '1363775739';
const EXPECTED_WORKFLOW_PATH = '.github/workflows/development-escalation-router.yml@';
const AUDIENCE_RE = /^kepenk-escalation:v1:([a-f0-9]{64}):([1-9][0-9]*):([a-f0-9]{40})$/;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(target) {
  if (!target || target === '-') return JSON.parse(readFileSync(0, 'utf8'));
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OPUS_HANDOFF_BLOCKED: ${label}_MISSING`);
  }
  return value.trim();
}

function decodeJsonSegment(value, label) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`OPUS_HANDOFF_BLOCKED: ATTESTATION_${label}_INVALID`);
  }
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

  const sourceEnvelopeBytes = input.SOURCE_ENVELOPE_BYTES ?? input.sourceEnvelopeBytes;
  if (!Number.isInteger(sourceEnvelopeBytes) || sourceEnvelopeBytes <= 0) {
    throw new Error('OPUS_HANDOFF_BLOCKED: SOURCE_ENVELOPE_BYTES_INVALID');
  }

  const trustedAttestation = requireString(
    input.TRUSTED_ATTESTATION ?? input.trustedAttestation,
    'TRUSTED_ATTESTATION',
  );

  const opusPackage = input.OPUS_ESCALATION_PACKAGE ?? input.opusEscalationPackage;
  if (!opusPackage || typeof opusPackage !== 'object' || Array.isArray(opusPackage)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: OPUS_ESCALATION_PACKAGE_MISSING');
  }

  return {
    disposition,
    caseFingerprint: caseFingerprint.toLowerCase(),
    sourceEnvelopeBytes,
    trustedAttestation,
    opusEscalationPackage: opusPackage,
  };
}

function parseAudience(audience) {
  if (typeof audience !== 'string') {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_AUDIENCE_INVALID');
  }
  const match = audience.match(AUDIENCE_RE);
  if (!match) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_AUDIENCE_INVALID');
  }
  return {
    caseFingerprint: match[1],
    sourceEnvelopeBytes: Number(match[2]),
    workflowSha: match[3],
  };
}

async function fetchJwks(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(OIDC_JWKS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_JWKS_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new Error(`OPUS_HANDOFF_BLOCKED: ATTESTATION_JWKS_HTTP_${response.status}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_JWKS_INVALID');
  }
  if (!Array.isArray(payload?.keys)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_JWKS_INVALID');
  }
  return payload;
}

export async function verifyGithubOidcAttestation(token, {
  fetchImpl = fetch,
  jwks = null,
  nowMs = Date.now(),
} = {}) {
  const value = requireString(token, 'TRUSTED_ATTESTATION');
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_FORMAT_INVALID');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader, 'HEADER');
  const claims = decodeJsonSegment(encodedPayload, 'PAYLOAD');

  if (header?.alg !== 'RS256' || typeof header?.kid !== 'string' || !header.kid) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_HEADER_INVALID');
  }

  const keySet = jwks ?? await fetchJwks(fetchImpl);
  const jwk = keySet.keys.find((item) => item?.kid === header.kid && item?.kty === 'RSA');
  if (!jwk) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_KEY_NOT_FOUND');
  }

  let verified = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    verified = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_SIGNATURE_INVALID');
  }
  if (!verified) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_SIGNATURE_INVALID');
  }

  const now = Math.floor(nowMs / 1000);
  if (claims?.iss !== OIDC_ISSUER) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_ISSUER_INVALID');
  }
  if (!Number.isInteger(claims?.exp) || claims.exp < now - 30) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_EXPIRED');
  }
  if (Number.isInteger(claims?.nbf) && claims.nbf > now + 30) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_NOT_YET_VALID');
  }
  if (claims?.repository !== EXPECTED_REPOSITORY
    || String(claims?.repository_id ?? '') !== EXPECTED_REPOSITORY_ID) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_REPOSITORY_INVALID');
  }
  if (claims?.runner_environment !== 'github-hosted') {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_RUNNER_INVALID');
  }

  const workflowRefs = [claims?.workflow_ref, claims?.job_workflow_ref]
    .filter((item) => typeof item === 'string');
  if (!workflowRefs.some((item) => item.includes(`/${EXPECTED_WORKFLOW_PATH}`))) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_WORKFLOW_INVALID');
  }

  const binding = parseAudience(claims?.aud);
  if (claims?.sha !== binding.workflowSha) {
    throw new Error('OPUS_HANDOFF_BLOCKED: ATTESTATION_SHA_MISMATCH');
  }

  return {
    ...binding,
    runId: String(claims?.run_id ?? ''),
    workflowRef: workflowRefs.find((item) => item.includes(`/${EXPECTED_WORKFLOW_PATH}`)),
  };
}

export function assertPackageBinding(pkg, binding) {
  if (pkg.caseFingerprint !== binding.caseFingerprint) {
    throw new Error('OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_MISMATCH');
  }
  if (pkg.sourceEnvelopeBytes !== binding.sourceEnvelopeBytes) {
    throw new Error('OPUS_HANDOFF_BLOCKED: SOURCE_ENVELOPE_BYTES_MISMATCH');
  }
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

async function fireOpus(pkg) {
  const url = validateRoutineUrl(process.env.CLAUDE_OPUS_ROUTINE_URL);
  const token = requireString(process.env.CLAUDE_OPUS_ROUTINE_TOKEN, 'CLAUDE_OPUS_ROUTINE_TOKEN');
  const text = buildText(pkg);

  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw new Error('OPUS_HANDOFF_BLOCKED: PACKAGE_TOO_LARGE');
  }

  let response;
  try {
    response = await fetch(url, {
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
  } catch {
    throw new Error('OPUS_HANDOFF_BLOCKED: TRANSPORT_UNAVAILABLE');
  }

  const raw = await response.text();
  if (!response.ok) {
    let reason = `HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw);
      const type = parsed?.error?.type;
      if (typeof type === 'string' && /^[a-z0-9_]+$/i.test(type)) {
        reason = `${reason}_${type.toUpperCase()}`;
      }
    } catch {
      // Keep only the status-derived reason; never echo response content.
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
  return receipt;
}

export async function prepareOpusHandoff(input, options = {}) {
  const pkg = normalizePackage(input);
  const binding = await verifyGithubOidcAttestation(pkg.trustedAttestation, options);
  assertPackageBinding(pkg, binding);

  const compressedPackageBytes = Buffer.byteLength(
    JSON.stringify(pkg.opusEscalationPackage),
    'utf8',
  );
  const compressionRatio = Number((compressedPackageBytes / pkg.sourceEnvelopeBytes).toFixed(4));

  return {
    pkg,
    binding,
    compressedPackageBytes,
    compressionRatio,
    textBytes: Buffer.byteLength(buildText(pkg), 'utf8'),
  };
}

async function main() {
  const target = argValue('--package') ?? process.argv[2] ?? '-';
  const dryRun = process.argv.includes('--dry-run');
  const prepared = await prepareOpusHandoff(readJson(target));

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      caseFingerprint: prepared.pkg.caseFingerprint,
      sourceEnvelopeBytes: prepared.pkg.sourceEnvelopeBytes,
      compressedPackageBytes: prepared.compressedPackageBytes,
      compressionRatio: prepared.compressionRatio,
      textBytes: prepared.textBytes,
      attestedRunId: prepared.binding.runId,
    }, null, 2));
    return;
  }

  const receipt = await fireOpus(prepared.pkg);
  console.log(JSON.stringify({
    status: 'OPUS_TRIGGERED',
    caseFingerprint: prepared.pkg.caseFingerprint,
    sourceEnvelopeBytes: prepared.pkg.sourceEnvelopeBytes,
    compressedPackageBytes: prepared.compressedPackageBytes,
    compressionRatio: prepared.compressionRatio,
    attestedRunId: prepared.binding.runId,
    claudeCodeSessionId: receipt.claude_code_session_id,
    claudeCodeSessionUrl: receipt.claude_code_session_url,
  }, null, 2));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'OPUS_HANDOFF_BLOCKED: UNKNOWN';
    console.error(message.startsWith('OPUS_HANDOFF_BLOCKED:')
      ? message
      : 'OPUS_HANDOFF_BLOCKED: UNKNOWN');
    process.exit(1);
  });
}
