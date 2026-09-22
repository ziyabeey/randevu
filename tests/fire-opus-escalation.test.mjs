import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertPackageBinding,
  prepareOpusHandoff,
  verifyGithubOidcAttestation,
} from '../scripts/fire-opus-escalation.mjs';

const nowMs = Date.parse('2026-09-19T10:00:00Z');
const workflowSha = 'c'.repeat(40);
const fingerprint = 'a'.repeat(64);
const sourceEnvelopeBytes = 1000;

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: 'jwk' });
publicJwk.kid = 'test-key';
publicJwk.use = 'sig';
publicJwk.alg = 'RS256';
const jwks = { keys: [publicJwk] };

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeToken(overrides = {}) {
  const now = Math.floor(nowMs / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const payload = encodeJson({
    iss: 'https://token.actions.githubusercontent.com',
    aud: `kepenk-escalation:v1:${fingerprint}:${sourceEnvelopeBytes}:${workflowSha}`,
    repository: 'ziyabeey/randevu',
    repository_id: '1363775739',
    runner_environment: 'github-hosted',
    workflow_ref: 'ziyabeey/randevu/.github/workflows/development-escalation-router.yml@refs/heads/main',
    sha: workflowSha,
    run_id: '12345',
    nbf: now - 30,
    iat: now - 10,
    exp: now + 300,
    ...overrides,
  });
  const input = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

function packageFor(token, overrides = {}) {
  return {
    DISPOSITION: 'REASONING_REQUIRED',
    CASE_FINGERPRINT: fingerprint,
    SOURCE_ENVELOPE_BYTES: sourceEnvelopeBytes,
    TRUSTED_ATTESTATION: token,
    OPUS_ESCALATION_PACKAGE: {
      TASK: 'F12-04C',
      PR: 176,
      QUESTION: 'Resolve bounded ambiguity.',
    },
    ...overrides,
  };
}

test('GitHub OIDC attestation binds fingerprint, source bytes, repository and workflow', async () => {
  const binding = await verifyGithubOidcAttestation(makeToken(), { jwks, nowMs });
  assert.equal(binding.caseFingerprint, fingerprint);
  assert.equal(binding.sourceEnvelopeBytes, sourceEnvelopeBytes);
  assert.equal(binding.workflowSha, workflowSha);
  assert.equal(binding.runId, '12345');
});

test('Opus preparation accepts a valid attested reasoning package', async () => {
  const prepared = await prepareOpusHandoff(packageFor(makeToken()), { jwks, nowMs });
  assert.equal(prepared.pkg.caseFingerprint, fingerprint);
  assert.equal(prepared.binding.runId, '12345');
  assert.ok(prepared.compressedPackageBytes > 0);
  assert.equal(
    prepared.compressionRatio,
    Number((prepared.compressedPackageBytes / sourceEnvelopeBytes).toFixed(4)),
  );
  assert.ok(prepared.textBytes > 0);
});

test('altering both package binding fields cannot bypass the signed audience', async () => {
  const pkg = packageFor(makeToken(), {
    CASE_FINGERPRINT: 'b'.repeat(64),
    SOURCE_ENVELOPE_BYTES: 999,
  });
  await assert.rejects(
    prepareOpusHandoff(pkg, { jwks, nowMs }),
    /OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_MISMATCH/,
  );
});

test('tampered OIDC payload is rejected before Opus network access', async () => {
  const token = makeToken();
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.aud = `kepenk-escalation:v1:${'f'.repeat(64)}:${sourceEnvelopeBytes}:${workflowSha}`;
  const tampered = `${header}.${encodeJson(claims)}.${signature}`;
  await assert.rejects(
    verifyGithubOidcAttestation(tampered, { jwks, nowMs }),
    /OPUS_HANDOFF_BLOCKED: ATTESTATION_SIGNATURE_INVALID/,
  );
});

test('wrong repository or workflow claims are rejected', async () => {
  await assert.rejects(
    verifyGithubOidcAttestation(makeToken({ repository: 'attacker/repo' }), { jwks, nowMs }),
    /OPUS_HANDOFF_BLOCKED: ATTESTATION_REPOSITORY_INVALID/,
  );
  await assert.rejects(
    verifyGithubOidcAttestation(makeToken({ workflow_ref: 'ziyabeey/randevu/.github/workflows/other.yml@refs/heads/main' }), { jwks, nowMs }),
    /OPUS_HANDOFF_BLOCKED: ATTESTATION_WORKFLOW_INVALID/,
  );
});

test('package binding helper rejects source-byte drift', () => {
  assert.throws(
    () => assertPackageBinding(
      { caseFingerprint: fingerprint, sourceEnvelopeBytes: 999 },
      { caseFingerprint: fingerprint, sourceEnvelopeBytes },
    ),
    /OPUS_HANDOFF_BLOCKED: SOURCE_ENVELOPE_BYTES_MISMATCH/,
  );
});

test('GitHub router can fire Haiku but has no Opus credential path', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/development-escalation-router.yml'), 'utf8');
  assert.match(workflow, /CLAUDE_HAIKU_ROUTINE_URL/);
  assert.match(workflow, /CLAUDE_HAIKU_ROUTINE_TOKEN/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /CLAUDE_OPUS_ROUTINE_URL/);
  assert.doesNotMatch(workflow, /CLAUDE_OPUS_ROUTINE_TOKEN/);
});

test('Claude instructions use a fixed command with no payload interpolation', () => {
  const guidance = readFileSync(path.resolve('CLAUDE.md'), 'utf8');
  assert.match(guidance, /EVIDENCE_COMPRESSION_REQUEST/);
  assert.match(guidance, /node scripts\/fire-opus-escalation\.mjs --package \/tmp\/kepenk-opus-handoff\.json/);
  assert.doesNotMatch(guidance, /--expected-fingerprint|--expected-source-bytes/);
  assert.match(guidance, /GitHub-signed OIDC attestation/);
  assert.match(guidance, /OPUS_HANDOFF_BLOCKED/);
});

test('generic Routine adapter never echoes request or response bodies on failure paths', () => {
  const adapter = readFileSync(path.resolve('scripts/fire-claude-routine.mjs'), 'utf8');
  assert.doesNotMatch(adapter, /responseText\.slice|raw\.slice/);
  assert.doesNotMatch(adapter, /dryRun[^\n]+body/);
  assert.match(adapter, /CLAUDE_ROUTINE_FIRE_BLOCKED: TRANSPORT_UNAVAILABLE/);
});
