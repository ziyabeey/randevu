import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (x) => createHash('sha256').update(String(x)).digest('hex');

export function freezeCases(cases, {
  experimentId,
  protocolVersion,
  metadata = {},
} = {}) {
  if (!experimentId || !protocolVersion) throw new TypeError('experimentId and protocolVersion are required');
  if (!Array.isArray(cases) || !cases.length) throw new TypeError('cases must be a non-empty array');

  const seen = new Set();
  const frozenCases = cases.map((item, index) => {
    const caseId = item.case_id ?? item.id;
    if (!caseId) throw new Error(`case at index ${index} has no id`);
    if (seen.has(caseId)) throw new Error(`duplicate case id: ${caseId}`);
    seen.add(caseId);
    return structuredClone({ ...item, case_id: caseId });
  });

  const body = {
    schema_version: 1,
    experiment_id: experimentId,
    protocol_version: protocolVersion,
    metadata: structuredClone(metadata),
    cases: frozenCases,
  };

  const casesSha256 = sha(`${stableJson(frozenCases)}\n`);
  const manifestSha256 = sha(`${stableJson(body)}\n`);

  return Object.freeze({
    ...body,
    cases_sha256: casesSha256,
    manifest_sha256: manifestSha256,
  });
}
