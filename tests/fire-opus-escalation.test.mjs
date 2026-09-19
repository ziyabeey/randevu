import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/fire-opus-escalation.mjs');

function writePackage(dir, value) {
  const file = path.join(dir, 'package.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}

test('Opus handoff dry-run accepts only a reasoning package and never requires credentials', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opus-handoff-'));
  try {
    const file = writePackage(dir, {
      DISPOSITION: 'REASONING_REQUIRED',
      CASE_FINGERPRINT: 'a'.repeat(64),
      SOURCE_ENVELOPE_BYTES: 1000,
      OPUS_ESCALATION_PACKAGE: {
        TASK: 'F12-04C',
        PR: 176,
        QUESTION: 'Resolve bounded ambiguity.',
      },
    });
    const run = spawnSync(process.execPath, [script, '--package', file, '--expected-fingerprint', 'a'.repeat(64), '--expected-source-bytes', '1000', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.caseFingerprint, 'a'.repeat(64));
    assert.equal(parsed.sourceEnvelopeBytes, 1000);
    assert.ok(parsed.compressedPackageBytes > 0);
    assert.equal(parsed.compressionRatio, Number((parsed.compressedPackageBytes / 1000).toFixed(4)));
    assert.ok(parsed.textBytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Opus handoff fails closed when Haiku sends a non-reasoning disposition', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opus-handoff-'));
  try {
    const file = writePackage(dir, {
      DISPOSITION: 'NO_ACTION',
      CASE_FINGERPRINT: 'b'.repeat(64),
      SOURCE_ENVELOPE_BYTES: 1000,
      OPUS_ESCALATION_PACKAGE: { QUESTION: 'none' },
    });
    const run = spawnSync(process.execPath, [script, '--package', file, '--expected-fingerprint', 'b'.repeat(64), '--expected-source-bytes', '1000', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /OPUS_HANDOFF_BLOCKED: DISPOSITION_NO_ACTION/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Opus handoff rejects malformed case fingerprints before any network call', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opus-handoff-'));
  try {
    const file = writePackage(dir, {
      DISPOSITION: 'REASONING_REQUIRED',
      CASE_FINGERPRINT: 'not-a-fingerprint',
      SOURCE_ENVELOPE_BYTES: 1000,
      OPUS_ESCALATION_PACKAGE: { QUESTION: 'bounded' },
    });
    const run = spawnSync(process.execPath, [script, '--package', file, '--expected-fingerprint', 'c'.repeat(64), '--expected-source-bytes', '1000', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_INVALID/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('GitHub escalation router can fire Haiku but has no Opus credential path', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/development-escalation-router.yml'), 'utf8');
  assert.match(workflow, /CLAUDE_HAIKU_ROUTINE_URL/);
  assert.match(workflow, /CLAUDE_HAIKU_ROUTINE_TOKEN/);
  assert.doesNotMatch(workflow, /CLAUDE_OPUS_ROUTINE_URL/);
  assert.doesNotMatch(workflow, /CLAUDE_OPUS_ROUTINE_TOKEN/);
});


test('Claude repository instructions make Haiku the exclusive Opus caller only for marked compressor runs', () => {
  const guidance = readFileSync(path.resolve('CLAUDE.md'), 'utf8');
  assert.match(guidance, /EVIDENCE_COMPRESSION_REQUEST/);
  assert.match(guidance, /trigger Opus exactly once/);
  assert.match(guidance, /node scripts\/fire-opus-escalation\.mjs --package .* --expected-fingerprint .* --expected-source-bytes/);
  assert.match(guidance, /GitHub Actions, the Dispatcher, and the caller are not Opus callers/);
  assert.match(guidance, /OPUS_HANDOFF_BLOCKED/);
  assert.match(guidance, /Outside an `EVIDENCE_COMPRESSION_REQUEST` session, this section grants no new\s+authority/);
});


test('Opus handoff rejects a compressed package whose fingerprint differs from the Dispatcher fingerprint', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opus-handoff-'));
  try {
    const file = writePackage(dir, {
      DISPOSITION: 'REASONING_REQUIRED',
      CASE_FINGERPRINT: 'd'.repeat(64),
      SOURCE_ENVELOPE_BYTES: 1000,
      OPUS_ESCALATION_PACKAGE: { QUESTION: 'bounded' },
    });
    const run = spawnSync(process.execPath, [
      script,
      '--package', file,
      '--expected-fingerprint', 'e'.repeat(64),
      '--expected-source-bytes', '1000',
      '--dry-run',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /OPUS_HANDOFF_BLOCKED: CASE_FINGERPRINT_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('Opus handoff rejects Haiku source-byte drift before network access', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opus-handoff-'));
  try {
    const file = writePackage(dir, {
      DISPOSITION: 'REASONING_REQUIRED',
      CASE_FINGERPRINT: 'f'.repeat(64),
      SOURCE_ENVELOPE_BYTES: 999,
      OPUS_ESCALATION_PACKAGE: { QUESTION: 'bounded' },
    });
    const run = spawnSync(process.execPath, [
      script,
      '--package', file,
      '--expected-fingerprint', 'f'.repeat(64),
      '--expected-source-bytes', '1000',
      '--dry-run',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /OPUS_HANDOFF_BLOCKED: SOURCE_ENVELOPE_BYTES_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
