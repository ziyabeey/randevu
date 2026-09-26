import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';
import { freezeCases } from './freeze.mjs';
import { freezeCoverageDiscoveryPacket } from '../discovery/validation-packet.mjs';
import { verifyCoveragePacket } from '../specification/test-spec.mjs';
import { normalizeRelationalFact, validateRelationalEvidenceCase } from '../relations/relational-evidence.mjs';
import {
  composeRelationalCaseBatch, freezeComposerRelationship,
  freezeScopedRelationalFact, validateRelationalCaseBatch,
} from '../relations/relational-case-composer.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const REASONS = new Set(['surviving-mutant', 'explicit-runtime-coverage-gap',
  'unknown-runtime-coverage-on-impacted-reference', 'historical-companion-not-changed']);
const FORBIDDEN = new Set(['relationLabel', 'independentOutcome', 'judgment', 'judgments',
  'judgmentSha256', 'probabilities', 'providerConfidence', 'label', 'labels', 'outcome', 'outcomes']);
const ARTIFACT_KINDS = new Set(['m5-packet', 'fact-source', 'change', 'relationship-source']);
const PENDING_FIELDS = ['changeArtifactSha256', 'packetSha256', 'relationalCaseSha256',
  'relationLabel', 'independentOutcome'];

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => stableJson(a) === stableJson(b);
const sorted = (items) => [...items].sort();
const unique = (items) => Array.isArray(items) && new Set(items).size === items.length;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function m11Digest(value) {
  return createHash('sha256').update(`${stableJson(value)}\n`).digest('hex');
}

export function m11SourceBlobSha(bytes) {
  assert(typeof bytes === 'string' || Buffer.isBuffer(bytes), 'source bytes required');
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

export function validateM11SourcePath(path) {
  assert(nonEmpty(path) && !path.startsWith('/') && !path.includes('\\')
    && !path.includes('\0') && path.split('/').every((part) => part && !part.startsWith('.')),
  'invalid source path');
  return path;
}

function rejectLabels(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN.has(key), 'label or provider output is not an observation input');
    rejectLabels(child);
  }
}

export function validateM11Inventory(inventory, expectedInventorySha256) {
  assert(SHA256.test(expectedInventorySha256 ?? ''), 'trusted inventory digest required');
  assert(inventory?.schema_version === 1, 'unsupported inventory schema');
  const rebuilt = freezeCases(inventory.cases, {
    experimentId: inventory.experiment_id, protocolVersion: inventory.protocol_version,
    metadata: inventory.metadata,
  });
  assert(same(rebuilt, inventory) && rebuilt.manifest_sha256 === expectedInventorySha256,
    'inventory identity mismatch');
  const meta = inventory.metadata;
  assert(meta.manifestRole === 'scenario-anchor-inventory'
    && meta.referenceSuitesAreGroundTruth === false, 'unsupported inventory role');
  assert(SHA1.test(meta.sourceRevision) && SHA1.test(meta.toolRevision), 'pinned revisions required');
  assert(object(meta.sources), 'source inventory required');
  for (const [path, binding] of Object.entries(meta.sources)) {
    validateM11SourcePath(path);
    assert(SHA1.test(binding?.gitBlobSha), 'invalid source blob identity');
  }
  const clusterSplits = new Map();
  const primarySplits = new Map();
  for (const row of inventory.cases) {
    assert(['development', 'evaluation'].includes(row.split) && nonEmpty(row.cluster), 'invalid split');
    assert(nonEmpty(row.referenceTest) && unique(row.targets) && row.targets.length, 'invalid anchor');
    assert(row.inputStatus === 'pending-materialization'
      && PENDING_FIELDS.every((key) => row[key] === null), 'inventory must remain unmaterialized');
    assert(!clusterSplits.has(row.cluster) || clusterSplits.get(row.cluster) === row.split,
      'cluster crosses inventory splits');
    clusterSplits.set(row.cluster, row.split);
    for (const path of [row.referenceSuite, ...row.targets]) {
      assert(Object.hasOwn(meta.sources, path), 'anchor source is not pinned');
      assert(!primarySplits.has(path) || primarySplits.get(path) === row.split,
        'primary source crosses inventory splits');
      primarySplits.set(path, row.split);
    }
  }
  assert(inventory.cases.some((r) => r.split === 'development'), 'development anchors required');
  return inventory;
}

// This verifies a producer declaration, not that the declared observation happened.
export function freezeM11Observation(body) {
  rejectLabels(body);
  assert(body?.schemaVersion === 1 && ARTIFACT_KINDS.has(body.kind), 'invalid observation kind');
  assert(nonEmpty(body.producer) && nonEmpty(body.producerVersion), 'observation producer required');
  assert(SHA1.test(body.sourceRevision), 'observation source revision required');
  assert(unique(body.sourcePaths) && body.sourcePaths.length, 'observation source paths required');
  body.sourcePaths.forEach(validateM11SourcePath);
  assert(unique(body.rootDigests) && body.rootDigests.length
    && body.rootDigests.every((s) => SHA256.test(s)), 'root observation digests required');
  assert(object(body.payload), 'observation payload required');
  const { artifactSha256, ...content } = structuredClone(body);
  const digest = m11Digest(content);
  assert(artifactSha256 == null || artifactSha256 === digest, 'observation digest mismatch');
  return deepFreeze({ ...content, artifactSha256: digest });
}

export function m11FactFromObservation(artifact, factId) {
  const source = freezeM11Observation(artifact);
  assert(source.kind === 'fact-source' && Array.isArray(source.payload.facts), 'fact observation required');
  const records = source.payload.facts.filter((f) => f.factId === factId);
  assert(records.length === 1, 'fact must have one source record');
  const { evidenceIds = [], ...record } = records[0];
  assert(record.provenance == null && record.lineageIds == null, 'fact source owns provenance');
  return normalizeRelationalFact({
    ...record,
    lineageIds: sorted(source.rootDigests),
    provenance: {
      producer: source.producer, producerVersion: source.producerVersion,
      inputDigest: source.artifactSha256, sourceRevision: source.sourceRevision, evidenceIds,
    },
  });
}

function validateBundle(bundle, inventory) {
  rejectLabels(bundle);
  const { bundleSha256, ...body } = structuredClone(bundle);
  assert(bundleSha256 === m11Digest(body), 'input bundle digest mismatch');
  assert(body.schemaVersion === 1 && body.kind === 'm11-offline-observations'
    && body.inventorySha256 === inventory.manifest_sha256
    && body.sourceRevision === inventory.metadata.sourceRevision, 'input bundle identity mismatch');
  assert(Array.isArray(body.receipts) && Array.isArray(body.clusters), 'receipts and closure required');
  const anchors = new Map(inventory.cases.map((r) => [r.case_id, r]));
  const receiptIndex = new Map();
  for (const receipt of body.receipts) {
    assert(anchors.get(receipt.anchorId)?.split === 'development', 'receipt must target development anchor');
    assert(!receiptIndex.has(receipt.anchorId), 'duplicate anchor receipt');
    receiptIndex.set(receipt.anchorId, receipt);
  }
  const expectedClusters = new Set(inventory.cases.map((r) => r.cluster));
  const clusters = new Map();
  const paths = new Map();
  for (const cluster of body.clusters) {
    assert(expectedClusters.has(cluster.cluster) && !clusters.has(cluster.cluster), 'invalid closure cluster');
    assert(cluster.complete === true && object(cluster.sourceBindings), 'complete producer closure required');
    const rows = inventory.cases.filter((r) => r.cluster === cluster.cluster);
    const split = rows[0].split;
    for (const row of rows) {
      for (const path of [row.referenceSuite, ...row.targets]) {
        assert(cluster.sourceBindings[path] === inventory.metadata.sources[path].gitBlobSha,
          'closure omits or changes pinned source');
      }
    }
    for (const [path, sha] of Object.entries(cluster.sourceBindings)) {
      validateM11SourcePath(path);
      assert(SHA1.test(sha), 'invalid closure source identity');
      const pinned = inventory.metadata.sources[path]?.gitBlobSha;
      assert(!pinned || pinned === sha, 'closure changes inventory source');
      const previous = paths.get(path);
      assert(!previous || previous.split === split, 'source closure crosses evaluation boundary');
      assert(!previous || previous.sha === sha, 'conflicting closure source identity');
      paths.set(path, { sha, split });
    }
    clusters.set(cluster.cluster, cluster.sourceBindings);
  }
  assert(clusters.size === expectedClusters.size, 'full split closure required before materialization');
  return { receiptIndex, clusters, paths };
}

function prepareReceipt(receipt, anchor, inventory, sourceBindings) {
  assert(Array.isArray(receipt.artifacts) && Array.isArray(receipt.factPool)
    && Array.isArray(receipt.relationships), 'receipt artifacts and inputs required');
  const artifacts = new Map();
  for (const raw of receipt.artifacts) {
    const artifact = freezeM11Observation(raw);
    assert(raw.artifactSha256 === artifact.artifactSha256, 'sealed observation required');
    assert(artifact.sourceRevision === inventory.metadata.sourceRevision, 'stale observation revision');
    assert(artifact.sourcePaths.every((p) => Object.hasOwn(sourceBindings, p)), 'observation outside closure');
    assert(!artifacts.has(artifact.artifactSha256), 'duplicate observation artifact');
    artifacts.set(artifact.artifactSha256, artifact);
  }
  const packetSource = artifacts.get(receipt.packetArtifactSha256);
  const changeSource = artifacts.get(receipt.changeArtifactSha256);
  assert(packetSource?.kind === 'm5-packet' && changeSource?.kind === 'change', 'packet and change receipts required');
  const packet = packetSource.payload.packet;
  verifyCoveragePacket(packet);
  assert(packet.sourceRevision === inventory.metadata.sourceRevision, 'stale packet revision');
  const rebuilt = freezeCoverageDiscoveryPacket({
    changeId: packet.changeId, sourceRevision: packet.sourceRevision,
    impact: packet, discovery: { hypotheses: packet.hypotheses },
  });
  assert(same(rebuilt, packet), 'noncanonical M5 packet');
  const change = changeSource.payload;
  assert(['change', 'baseline'].includes(change.mode) && unique(change.changedFiles)
    && change.changeId === packet.changeId && same(sorted(change.changedFiles), packet.changedFiles),
  'change receipt does not bind packet');
  assert(change.mode !== 'baseline' || change.changedFiles.length === 0, 'baseline cannot claim changed files');
  assert(change.mode !== 'change' || change.changedFiles.length > 0, 'change receipt requires changed files');
  assert(change.changedFiles.every((p) => changeSource.sourcePaths.includes(p)), 'change path missing provenance');
  assert(unique(packet.hypotheses.map((h) => h.id)), 'duplicate packet hypothesis');
  for (const h of packet.hypotheses) {
    assert(nonEmpty(h.id) && REASONS.has(h.reason) && ['high', 'medium', 'low'].includes(h.priority),
      'invalid packet hypothesis');
    assert(['path', 'semantic-unit'].includes(h.target?.kind) && anchor.targets.includes(h.target.path),
      'hypothesis outside anchor targets');
    assert(h.target.kind !== 'semantic-unit' || nonEmpty(h.target.unitId), 'semantic unit identity required');
    assert(packetSource.sourcePaths.includes(h.target.path), 'hypothesis source missing provenance');
  }
  const factPool = receipt.factPool.map((input) => {
    const entry = freezeScopedRelationalFact(input);
    const artifact = artifacts.get(entry.fact.provenance.inputDigest);
    assert(artifact?.kind === 'fact-source', 'fact has no bound observation');
    const expected = m11FactFromObservation(artifact, entry.fact.factId);
    assert(expected.family !== 'validation', 'validation outcomes are not pre-judgment inputs');
    assert(same(expected, entry.fact), 'fact value or lineage differs from observation');
    const scopedPath = entry.scope.kind === 'hypothesis'
      ? packet.hypotheses.find((h) => h.id === entry.scope.hypothesisId)?.target.path : entry.scope.path;
    assert(scopedPath && artifact.sourcePaths.includes(scopedPath), 'fact scope missing source provenance');
    return entry;
  });
  const relationships = receipt.relationships.map((input) => {
    const relation = freezeComposerRelationship(input);
    const artifact = artifacts.get(relation.sourceId);
    assert(artifact?.kind === 'relationship-source', 'relationship has no bound observation');
    assert(artifact.sourcePaths.includes(relation.fromPath) && artifact.sourcePaths.includes(relation.toPath),
      'relationship path missing source provenance');
    const expected = freezeComposerRelationship({ ...artifact.payload, sourceId: artifact.artifactSha256 });
    assert(same(expected, relation), 'relationship differs from observation');
    return relation;
  });
  const result = composeRelationalCaseBatch({ packet, factPool, relationships });
  validateRelationalCaseBatch(result.batch, { packet, factPool, relationships, relationalCases: result.relationalCases });
  result.relationalCases.forEach((c) => validateRelationalEvidenceCase(c, { packet }));
  return { packet, ...result, artifactDigests: sorted([...artifacts.keys()]) };
}

export async function materializeM11Development({
  inventory, expectedInventorySha256, readSource, observations = null,
} = {}) {
  // Snapshot before an asynchronous reader can change caller-owned objects.
  inventory = structuredClone(inventory);
  observations = observations == null ? null : structuredClone(observations);
  validateM11Inventory(inventory, expectedInventorySha256);
  assert(typeof readSource === 'function', 'source byte reader required');
  const anchors = inventory.cases.filter((r) => r.split === 'development')
    .sort((a, b) => a.case_id.localeCompare(b.case_id));
  const bundle = observations == null ? null : validateBundle(observations, inventory);
  const bindings = new Map();
  for (const row of anchors) {
    for (const path of [row.referenceSuite, ...row.targets]) {
      bindings.set(path, inventory.metadata.sources[path].gitBlobSha);
    }
  }
  for (const [path, ref] of bundle?.paths ?? []) {
    if (ref.split === 'development') bindings.set(path, ref.sha);
  }
  const sources = new Map();
  for (const [path, sha] of [...bindings].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = await readSource(path);
    assert(m11SourceBlobSha(bytes) === sha, 'source bytes do not match pinned blob');
    sources.set(path, Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
  }
  for (const row of anchors) {
    assert(sources.get(row.referenceSuite).includes(row.referenceTest), 'reference control is missing');
  }
  const packets = new Map(), batches = new Map(), cases = new Map();
  const rows = [];
  for (const anchor of anchors) {
    const receipt = bundle?.receiptIndex.get(anchor.case_id);
    if (!receipt) {
      rows.push({ anchorId: anchor.case_id, cluster: anchor.cluster, status: 'skipped',
        reason: 'missing-observations', packetSha256: null, batchSha256: null,
        caseSha256s: [], hypothesisSkips: [], artifactDigests: [] });
      continue;
    }
    const result = prepareReceipt(receipt, anchor, inventory, bundle.clusters.get(anchor.cluster));
    packets.set(result.packet.packetSha256, result.packet);
    batches.set(result.batch.batchSha256, result.batch);
    result.relationalCases.forEach((c) => cases.set(c.caseSha256, c));
    const ready = result.relationalCases.length > 0;
    rows.push({ anchorId: anchor.case_id, cluster: anchor.cluster,
      status: ready ? 'materialized' : 'skipped',
      reason: ready ? null : (result.packet.hypotheses.length ? 'no-eligible-cases' : 'no-hypotheses'),
      packetSha256: result.packet.packetSha256, batchSha256: result.batch.batchSha256,
      caseSha256s: sorted(result.relationalCases.map((c) => c.caseSha256)),
      hypothesisSkips: result.batch.skipped, artifactDigests: result.artifactDigests });
  }
  const values = (map) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const body = {
    schemaVersion: 1, kind: 'm11-development-materialization', materializerVersion: '0.1',
    authority: 'advisory', split: 'development', inventorySha256: inventory.manifest_sha256,
    sourceRevision: inventory.metadata.sourceRevision, evidenceEngineRevision: inventory.metadata.toolRevision,
    observationsSha256: observations?.bundleSha256 ?? null,
    lineageClosure: bundle ? 'producer-declared-complete' : 'not-supplied',
    sourceBindings: Object.fromEntries([...bindings].sort(([a], [b]) => a.localeCompare(b))),
    rows, packets: values(packets), batches: values(batches), relationalCases: values(cases),
    counts: { anchors: anchors.length, materializedAnchors: rows.filter((r) => r.status === 'materialized').length,
      skippedAnchors: rows.filter((r) => r.status === 'skipped').length,
      uniquePackets: packets.size, uniqueBatches: batches.size, uniqueCases: cases.size },
  };
  return deepFreeze({ ...body, manifestSha256: m11Digest(body) });
}

export async function validateM11Materialization(result, options) {
  const expected = await materializeM11Development(options);
  assert(same(expected, result), 'materialization differs from bound input replay');
  return result;
}
