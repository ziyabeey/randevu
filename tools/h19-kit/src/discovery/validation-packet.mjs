import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function freezeCoverageDiscoveryPacket({
  changeId,
  impact,
  discovery,
  sourceRevision = null,
} = {}) {
  if (!changeId) throw new TypeError('changeId is required');
  if (!impact) throw new TypeError('impact is required');
  if (!discovery) throw new TypeError('discovery is required');

  const hypotheses = (discovery.hypotheses ?? []).map((hypothesis) => Object.freeze({
    id: hypothesis.id,
    target: structuredClone(hypothesis.target),
    reason: hypothesis.reason,
    priority: hypothesis.priority,
    evidenceIds: [...(hypothesis.evidenceIds ?? [])].sort(),
    validation: structuredClone(hypothesis.validation ?? {}),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const body = {
    schemaVersion: 1,
    changeId: String(changeId),
    sourceRevision: sourceRevision == null ? null : String(sourceRevision),
    changedFiles: [...(impact.changedFiles ?? [])].sort(),
    unknowns: [...(impact.unknowns ?? [])].sort(),
    safeToNarrow: Boolean(impact.safeToNarrow),
    hypotheses,
  };

  return Object.freeze({
    ...body,
    packetSha256: sha256(`${stableJson(body)}\n`),
  });
}

export function coverageValidationResult({
  packet,
  hypothesisId,
  status,
  observed = {},
} = {}) {
  if (!packet?.packetSha256) throw new TypeError('frozen packet is required');
  if (!hypothesisId) throw new TypeError('hypothesisId is required');
  if (!['confirmed', 'rejected', 'inconclusive'].includes(status)) {
    throw new TypeError('status must be confirmed, rejected, or inconclusive');
  }

  const hypothesis = packet.hypotheses.find((x) => x.id === hypothesisId);
  if (!hypothesis) throw new Error(`unknown hypothesis: ${hypothesisId}`);

  return Object.freeze({
    packetSha256: packet.packetSha256,
    hypothesisId,
    status,
    observed: structuredClone(observed),
  });
}
