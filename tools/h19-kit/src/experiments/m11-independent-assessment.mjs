import { stableJson } from '../core/cache.mjs';
import {
  RELATION_DIRECTION_QUESTION,
  relationalInputDigest,
  validateRelationalEvidenceCase,
} from '../relations/relational-evidence.mjs';
import { m11Digest } from './m11-materializer.mjs';

const LABELS = new Set(['strengthens', 'weakens', 'unrelated', 'insufficient']);
const EXPOSURE_KEYS = [
  'jevOutputSeen',
  'laterFunctionalOutcomeSeen',
  'peerAssessmentSeen',
  'evaluationObservationSeen',
];

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => stableJson(a) === stableJson(b);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function cleanExposure(exposure) {
  assert(exposure && typeof exposure === 'object' && !Array.isArray(exposure),
    'assessment exposure declaration required');
  assert(Object.keys(exposure).sort().join(',') === [...EXPOSURE_KEYS].sort().join(','),
    'assessment exposure keys differ from frozen contract');
  for (const key of EXPOSURE_KEYS) {
    assert(exposure[key] === false, `assessment exposure must remain false: ${key}`);
  }
  return Object.fromEntries(EXPOSURE_KEYS.map((key) => [key, false]));
}

export function validateM11IndependentAssessmentFreeze(freeze, { bridge = null } = {}) {
  assert(freeze?.schemaVersion === 1
    && freeze.kind === 'm11-independent-relation-assessment-freeze'
    && freeze.version === '0.1'
    && freeze.status === 'frozen-inputs-labels-pending',
  'unsupported independent-assessment freeze');
  assert(freeze.labelsCollected === 0, 'freeze must not contain collected labels');
  assert(sha256(freeze.bridgeSha256) && sha256(freeze.sourceRevision),
    'freeze digest/source bindings invalid');
  assert(same(freeze.question, RELATION_DIRECTION_QUESTION),
    'freeze relation question differs from implementation');
  assert(freeze.assessorContract?.requiredIndependentAssessmentsPerCase === 2,
    'freeze must require two assessments per case');
  assert(same(freeze.assessorContract.labels, [...LABELS]),
    'freeze label domain mismatch');
  assert(freeze.assessorContract.assessOnePacketAtATime === true,
    'freeze must require one-packet-at-a-time assessment');
  cleanExposure(freeze.receiptContract?.exposure);

  assert(Array.isArray(freeze.packets) && freeze.packets.length === 3,
    'freeze must contain exactly three blind packets');
  const packetIds = new Set();
  const caseIds = new Set();
  for (const packet of freeze.packets) {
    assert(nonEmpty(packet.packetId) && !packetIds.has(packet.packetId),
      'duplicate or invalid blind packet id');
    packetIds.add(packet.packetId);
    validateRelationalEvidenceCase(packet.relationalCase);
    assert(packet.relationalCase.sourceRevision === freeze.sourceRevision,
      'blind packet source revision mismatch');
    assert(!caseIds.has(packet.relationalCase.caseSha256), 'duplicate blind case');
    caseIds.add(packet.relationalCase.caseSha256);
  }

  if (bridge) {
    assert(bridge.bridgeSha256 === freeze.bridgeSha256,
      'freeze bridge identity mismatch');
    const cases = bridge.materialization?.relationalCases;
    assert(Array.isArray(cases) && cases.length === freeze.packets.length,
      'freeze/bridge case count mismatch');
    const bySha = new Map(cases.map((relationalCase) => [
      relationalCase.caseSha256,
      relationalCase,
    ]));
    for (const packet of freeze.packets) {
      assert(same(packet.relationalCase, bySha.get(packet.relationalCase.caseSha256)),
        `blind packet differs from bridge case: ${packet.packetId}`);
    }
  }

  return freeze;
}

export function freezeM11IndependentAssessmentReceipt({
  freeze,
  packetId,
  assessorId,
  assessorKind,
  label,
  rationale,
  exposure,
  sealedAt,
} = {}) {
  validateM11IndependentAssessmentFreeze(freeze);
  const packet = freeze.packets.find((item) => item.packetId === packetId);
  assert(packet, 'unknown independent-assessment packet');
  assert(nonEmpty(assessorId), 'assessment assessorId required');
  assert(nonEmpty(assessorKind), 'assessment assessorKind required');
  assert(LABELS.has(label), 'invalid independent-assessment label');
  assert(nonEmpty(rationale) && rationale.trim().length <= 2000,
    'assessment rationale must be 1..2000 characters');
  assert(nonEmpty(sealedAt) && Number.isFinite(Date.parse(sealedAt)),
    'assessment sealedAt must be an ISO-compatible timestamp');

  const body = {
    schemaVersion: 1,
    kind: 'm11-independent-relation-assessment-receipt',
    packetId,
    caseSha256: packet.relationalCase.caseSha256,
    inputSha256: relationalInputDigest(packet.relationalCase),
    sourceRevision: freeze.sourceRevision,
    bridgeSha256: freeze.bridgeSha256,
    assessorId: assessorId.trim(),
    assessorKind: assessorKind.trim(),
    rubricId: freeze.question.id,
    rubricVersion: freeze.question.version,
    label,
    rationale: rationale.trim(),
    exposure: cleanExposure(exposure),
    sealedAt: new Date(sealedAt).toISOString(),
  };

  return deepFreeze({ ...body, receiptSha256: m11Digest(body) });
}

export function validateM11IndependentAssessmentReceipt(receipt, { freeze } = {}) {
  validateM11IndependentAssessmentFreeze(freeze);
  assert(receipt?.schemaVersion === 1
    && receipt.kind === 'm11-independent-relation-assessment-receipt',
  'unsupported independent-assessment receipt');
  assert(sha256(receipt.receiptSha256), 'assessment receipt digest required');
  const { receiptSha256, ...body } = structuredClone(receipt);
  assert(m11Digest(body) === receiptSha256, 'assessment receipt digest mismatch');

  const packet = freeze.packets.find((item) => item.packetId === receipt.packetId);
  assert(packet, 'assessment receipt packet missing from freeze');
  assert(receipt.caseSha256 === packet.relationalCase.caseSha256,
    'assessment receipt case mismatch');
  assert(receipt.inputSha256 === relationalInputDigest(packet.relationalCase),
    'assessment receipt input mismatch');
  assert(receipt.sourceRevision === freeze.sourceRevision
    && receipt.bridgeSha256 === freeze.bridgeSha256,
  'assessment receipt lineage mismatch');
  assert(receipt.rubricId === freeze.question.id
    && receipt.rubricVersion === freeze.question.version,
  'assessment receipt rubric mismatch');
  assert(nonEmpty(receipt.assessorId) && nonEmpty(receipt.assessorKind),
    'assessment receipt assessor identity required');
  assert(LABELS.has(receipt.label), 'assessment receipt label invalid');
  assert(nonEmpty(receipt.rationale) && receipt.rationale.trim().length <= 2000,
    'assessment receipt rationale invalid');
  assert(nonEmpty(receipt.sealedAt) && Number.isFinite(Date.parse(receipt.sealedAt)),
    'assessment receipt sealedAt invalid');
  cleanExposure(receipt.exposure);
  return receipt;
}

export function summarizeM11IndependentAssessmentReceipts(receipts, { freeze } = {}) {
  validateM11IndependentAssessmentFreeze(freeze);
  assert(Array.isArray(receipts), 'assessment receipts array required');

  const seenReceipt = new Set();
  const seenAssessorPacket = new Set();
  const perPacket = new Map(freeze.packets.map((packet) => [packet.packetId, {
    packetId: packet.packetId,
    caseSha256: packet.relationalCase.caseSha256,
    receipts: [],
  }]));

  for (const receipt of receipts) {
    validateM11IndependentAssessmentReceipt(receipt, { freeze });
    assert(!seenReceipt.has(receipt.receiptSha256), 'duplicate assessment receipt digest');
    seenReceipt.add(receipt.receiptSha256);
    const assessorPacket = `${receipt.packetId}\0${receipt.assessorId}`;
    assert(!seenAssessorPacket.has(assessorPacket),
      'same assessor cannot submit two receipts for one packet');
    seenAssessorPacket.add(assessorPacket);
    perPacket.get(receipt.packetId).receipts.push(receipt);
  }

  const packets = [...perPacket.values()].map((entry) => {
    const assessorIds = [...new Set(entry.receipts.map((receipt) => receipt.assessorId))].sort();
    const labels = entry.receipts.map((receipt) => receipt.label);
    return {
      packetId: entry.packetId,
      caseSha256: entry.caseSha256,
      receiptCount: entry.receipts.length,
      distinctAssessorCount: assessorIds.length,
      twoDistinctReceiptsPresent: assessorIds.length >= 2,
      labels,
      independenceVerified: false,
      resolvedReferenceLabel: null,
    };
  });

  return deepFreeze({
    schemaVersion: 1,
    kind: 'm11-independent-relation-assessment-receipt-ledger',
    receiptCount: receipts.length,
    packets,
    twoDistinctReceiptPackets: packets.filter((packet) => packet.twoDistinctReceiptsPresent).length,
    independenceVerifiedPackets: 0,
    resolvedReferenceLabels: 0,
    note: 'Structural receipt validation cannot establish assessor independence or resolve reference truth.',
  });
}
