import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import {
  buildTestSpecification,
  freezeTestRecipe,
} from '../src/specification/test-spec.mjs';
import {
  freezeBaseFile,
  materializeTestCandidate,
  normalizeCandidatePath,
  validateTestCandidate,
} from '../src/materialization/test-candidate.mjs';

const hypothesis = {
  id: 'coverage:surviving-mutant:mut-17:worker_bookings.ts',
  target: {
    kind: 'semantic-unit',
    path: 'worker/bookings.ts',
    unitId: 'worker/bookings.ts::createBooking@40',
  },
  reason: 'surviving-mutant',
  priority: 'high',
  evidenceIds: ['mutation.survivor.present'],
  validation: {
    preferred: 'test-that-kills-mutant',
    mutatorId: 'boundary.flip',
    mutationId: 'mut-17',
    requiresRuntimeEvidence: true,
  },
};

const packet = freezeCoverageDiscoveryPacket({
  changeId: 'pr-123',
  sourceRevision: 'abc123',
  impact: { changedFiles: ['worker/bookings.ts'], unknowns: [], safeToNarrow: true },
  discovery: { hypotheses: [hypothesis] },
});

const partial = buildTestSpecification({ packet, hypothesisId: hypothesis.id });
assert.equal(partial.readyForExecution, false);

const recipe = freezeTestRecipe({
  recipeId: 'booking.capacity-boundary',
  version: '1',
  matches: { reason: 'surviving-mutant', mutatorId: 'boundary.flip' },
  setup: ['Create a boundary fixture.'],
  action: 'Run the booking operation.',
  expectedInvariant: 'The boundary invariant remains satisfied.',
  observations: ['Return result', 'Persisted booking state'],
});
const spec = buildTestSpecification({ packet, hypothesisId: hypothesis.id, recipe });
assert.equal(spec.readyForExecution, true);

const specBefore = JSON.stringify(spec);
const renderer = {
  rendererId: 'node-test-basic',
  version: '1',
  framework: 'node:test',
  language: 'javascript',
  artifactSha256: 'a'.repeat(64),
  render(input) {
    return {
      path: 'tests/generated/booking-boundary.test.mjs',
      operation: 'create',
      content: [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "",
        `test('generated boundary contract', async () => {`,
        `  // setup: ${input.setup.items.join(' | ')}`,
        `  // action: ${input.action.value}`,
        `  // invariant: ${input.expectedInvariant.value}`,
        "  assert.ok(true);",
        "});",
        "",
      ].join('\n'),
    };
  },
};

// TC1: partial specs fail closed.
assert.throws(() => materializeTestCandidate({
  spec: partial,
  renderer,
}), /not ready for execution/);

// TC2/TC4/TC7: renderer identity, deterministic replay, immutable spec.
const a = materializeTestCandidate({ spec, renderer });
const b = materializeTestCandidate({ spec, renderer });
assert.equal(a.candidateSha256, b.candidateSha256);
assert.equal(a.contentSha256, b.contentSha256);
assert.equal(JSON.stringify(spec), specBefore);
assert.equal(validateTestCandidate(a), a);

// TC5/TC6: renderer identity/content bindings affect candidate identity.
const rendererV2 = {
  ...renderer,
  version: '2',
  artifactSha256: 'b'.repeat(64),
};
const c = materializeTestCandidate({ spec, renderer: rendererV2 });
assert.notEqual(a.candidateSha256, c.candidateSha256);

const rendererDifferentContent = {
  ...renderer,
  artifactSha256: 'c'.repeat(64),
  render() {
    return {
      path: 'tests/generated/booking-boundary.test.mjs',
      operation: 'create',
      content: "import test from 'node:test';\ntest('different', () => {});\n",
    };
  },
};
const d = materializeTestCandidate({ spec, renderer: rendererDifferentContent });
assert.notEqual(a.contentSha256, d.contentSha256);
assert.notEqual(a.candidateSha256, d.candidateSha256);

// TC3: path and operation safety.
for (const unsafe of ['../evil.test.mjs', '/tmp/evil.test.mjs', 'C:\\tmp\\evil.test.mjs', 'x\0y']) {
  assert.throws(() => normalizeCandidatePath(unsafe));
}

assert.throws(() => materializeTestCandidate({
  spec,
  renderer: { ...renderer, artifactSha256: 'not-a-sha' },
}), /artifactSha256/);

let nondeterministicCounter = 0;
const nondeterministic = {
  ...renderer,
  artifactSha256: 'd'.repeat(64),
  render() {
    nondeterministicCounter += 1;
    return {
      path: 'tests/generated/nondeterministic.test.mjs',
      operation: 'create',
      content: `test-${nondeterministicCounter}`,
    };
  },
};
assert.throws(() => materializeTestCandidate({
  spec,
  renderer: nondeterministic,
}), /nondeterministic/);

const base = freezeBaseFile({
  path: 'tests/existing.test.mjs',
  content: "test('old', () => {});\n",
});
const replaceRenderer = {
  ...renderer,
  artifactSha256: 'e'.repeat(64),
  render(_spec, baseFile) {
    return {
      path: baseFile.path,
      operation: 'replace',
      content: "test('replacement', () => {});\n",
    };
  },
};
const replacement = materializeTestCandidate({ spec, renderer: replaceRenderer, baseFile: base });
assert.equal(replacement.target.baseFileSha256, base.sha256);
assert.equal(validateTestCandidate(replacement, { baseFile: base }), replacement);

assert.throws(() => materializeTestCandidate({
  spec,
  renderer: {
    ...replaceRenderer,
    artifactSha256: 'f'.repeat(64),
    render() {
      return {
        path: 'tests/other.test.mjs',
        operation: 'replace',
        content: "test('x', () => {});\n",
      };
    },
  },
  baseFile: base,
}), /must match base file path/);

assert.throws(() => materializeTestCandidate({
  spec,
  renderer: replaceRenderer,
  baseFile: { ...base, sha256: '0'.repeat(64) },
}), /base-file hash mismatch/);

// TC8: materialization does not create the proposed file.
const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-m7-'));
try {
  const candidate = materializeTestCandidate({
    spec,
    renderer: {
      ...renderer,
      artifactSha256: '1'.repeat(64),
      render() {
        return {
          path: 'generated.test.mjs',
          operation: 'create',
          content: "test('data-only', () => {});\n",
        };
      },
    },
  });
  assert.equal(candidate.target.path, 'generated.test.mjs');
  await assert.rejects(access(path.join(temp, 'generated.test.mjs')));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M7 executable test-candidate smoke: ok');
