import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function nonEmptyStrings(values = []) {
  if (!Array.isArray(values)) throw new TypeError('section hints must be arrays');
  return values.map((x) => String(x).trim()).filter(Boolean);
}

function sectionFromHints(name, hints) {
  const items = nonEmptyStrings(hints?.[name] ?? []);
  if (items.length > 0) {
    return Object.freeze({
      state: 'known',
      items: Object.freeze(items),
      reason: null,
    });
  }
  return Object.freeze({
    state: 'unknown',
    items: Object.freeze([]),
    reason: 'no-deterministic-' + name + '-evidence',
  });
}

function validateSection(name, section) {
  if (!section || !['known', 'unknown'].includes(section.state)) {
    throw new TypeError(name + ' must have state known|unknown');
  }
  if (!Array.isArray(section.items)) throw new TypeError(name + '.items must be an array');
  if (section.state === 'known' && nonEmptyStrings(section.items).length === 0) {
    throw new Error(name + ' known state requires at least one item');
  }
  if (section.state === 'unknown' && !String(section.reason ?? '').trim()) {
    throw new Error(name + ' unknown state requires reason');
  }
  return section;
}

function validationStatus(validation) {
  if (!validation) return 'unvalidated';
  if (!['confirmed', 'rejected', 'inconclusive'].includes(validation.status)) {
    throw new TypeError('validation status must be confirmed, rejected or inconclusive');
  }
  return validation.status;
}

function mutationIdentity(hypothesis) {
  if (hypothesis.reason !== 'surviving-mutant') return null;
  const mutationId = String(hypothesis.validation?.mutationId ?? '').trim();
  const mutatorId = String(hypothesis.validation?.mutatorId ?? '').trim();
  if (!mutationId || !mutatorId) {
    throw new Error('surviving-mutant hypothesis requires mutationId and mutatorId');
  }
  return Object.freeze({
    mutationId,
    mutatorId,
    preferredValidation: hypothesis.validation?.preferred ?? 'test-that-kills-mutant',
  });
}

export function createMinimalTestSpec({
  packet,
  hypothesisId,
  validation = null,
  hints = {},
  schemaVersion = 1,
} = {}) {
  if (schemaVersion !== 1) throw new Error('unsupported minimal test spec schemaVersion');
  if (!packet?.packetSha256) throw new TypeError('frozen M5 packet is required');
  if (!hypothesisId) throw new TypeError('hypothesisId is required');

  const hypothesis = (packet.hypotheses ?? []).find((x) => x.id === hypothesisId);
  if (!hypothesis) throw new Error('unknown hypothesis: ' + hypothesisId);

  if (validation) {
    if (validation.packetSha256 !== packet.packetSha256) {
      throw new Error('validation packet mismatch');
    }
    if (validation.hypothesisId !== hypothesisId) {
      throw new Error('validation hypothesis mismatch');
    }
  }

  const status = validationStatus(validation);
  if (status === 'rejected') throw new Error('rejected hypothesis is not eligible for M6');

  const eligible = hypothesis.priority === 'high' || status === 'confirmed';
  if (!eligible) throw new Error('hypothesis is not eligible for M6');

  const setup = validateSection('setup', sectionFromHints('setup', hints));
  const action = validateSection('action', sectionFromHints('action', hints));
  const expectedInvariant = validateSection(
    'expectedInvariant',
    sectionFromHints('expectedInvariant', hints),
  );
  const requiredObservations = validateSection(
    'requiredObservations',
    sectionFromHints('requiredObservations', hints),
  );

  const mutation = mutationIdentity(hypothesis);
  const missingSections = [
    ['setup', setup],
    ['action', action],
    ['expectedInvariant', expectedInvariant],
    ['requiredObservations', requiredObservations],
  ].filter(([, section]) => section.state !== 'known').map(([name]) => name);

  const body = {
    schemaVersion,
    packetSha256: packet.packetSha256,
    hypothesisId,
    target: structuredClone(hypothesis.target ?? null),
    hypothesis: {
      reason: hypothesis.reason ?? null,
      priority: hypothesis.priority ?? null,
      evidenceIds: [...(hypothesis.evidenceIds ?? [])].sort(),
    },
    validationStatus: status,
    mutation,
    setup,
    action,
    expectedInvariant,
    requiredObservations,
    readiness: {
      eligible,
      readyForExecutableGeneration: eligible && missingSections.length === 0,
      missingSections,
    },
  };

  return Object.freeze({
    ...body,
    specSha256: sha256(stableJson(body) + '\n'),
  });
}

export function validateMinimalTestSpec(spec) {
  if (spec?.schemaVersion !== 1) {
    throw new Error('unsupported minimal test spec schemaVersion');
  }
  if (!spec?.specSha256 || !spec?.packetSha256 || !spec?.hypothesisId) {
    throw new TypeError('minimal test spec is missing provenance');
  }
  if (!['unvalidated', 'confirmed', 'inconclusive'].includes(spec.validationStatus)) {
    throw new Error('minimal test spec validationStatus is invalid');
  }
  validateSection('setup', spec.setup);
  validateSection('action', spec.action);
  validateSection('expectedInvariant', spec.expectedInvariant);
  validateSection('requiredObservations', spec.requiredObservations);

  const body = {
    schemaVersion: spec.schemaVersion,
    packetSha256: spec.packetSha256,
    hypothesisId: spec.hypothesisId,
    target: structuredClone(spec.target ?? null),
    hypothesis: structuredClone(spec.hypothesis ?? {}),
    validationStatus: spec.validationStatus,
    mutation: structuredClone(spec.mutation ?? null),
    setup: structuredClone(spec.setup),
    action: structuredClone(spec.action),
    expectedInvariant: structuredClone(spec.expectedInvariant),
    requiredObservations: structuredClone(spec.requiredObservations),
    readiness: structuredClone(spec.readiness),
  };
  const expected = sha256(stableJson(body) + '\n');
  if (expected !== spec.specSha256) throw new Error('minimal test spec hash mismatch');

  if (spec.readiness?.eligible !== true) {
    throw new Error('minimal test spec must remain eligible');
  }

  const missingSections = [
    ['setup', spec.setup],
    ['action', spec.action],
    ['expectedInvariant', spec.expectedInvariant],
    ['requiredObservations', spec.requiredObservations],
  ].filter(([, section]) => section.state !== 'known').map(([name]) => name);

  const shouldBeReady = missingSections.length === 0;
  if (Boolean(spec.readiness?.readyForExecutableGeneration) !== shouldBeReady) {
    throw new Error('minimal test spec readiness mismatch');
  }
  if (stableJson(spec.readiness?.missingSections ?? []) !== stableJson(missingSections)) {
    throw new Error('minimal test spec missingSections mismatch');
  }

  if (spec.hypothesis?.reason === 'surviving-mutant') {
    if (!spec.mutation?.mutationId || !spec.mutation?.mutatorId) {
      throw new Error('surviving-mutant spec lost mutation identity');
    }
  }

  return spec;
}
