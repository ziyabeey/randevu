import { stableJson } from '../core/cache.mjs';
import { bridgeM11Observations } from './m11-observation-bridge.mjs';
import { auditM11CollectionSources, summarizeM11Tap } from './m11-collection.mjs';
import { m11Digest, m11SourceBlobSha } from './m11-materializer.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const sameM11Supplement = (a, b) => stableJson(a) === stableJson(b);
export const uniqueM11Supplement = (xs) => [...new Set(xs)].sort();
export function sealM11Supplement(body, key) { return { ...body, [key]: m11Digest(body) }; }
export function checkM11SupplementSeal(value, key, expected) {
  const { [key]: digest, ...body } = value;
  assert(/^[a-f0-9]{64}$/.test(expected ?? '') && digest === expected && m11Digest(body) === digest,
    `${key} identity mismatch`);
}

// Node TAP v13 profile: top-level reference controls and nested checks have
// separate denominators. Names alone or a passing child cannot imply a pass.
export function summarizeM11SupplementTap(stdout, suite, exitCode, transportError = null) {
  try {
    stdout = stdout.replaceAll('\r\n', '\n');
    const summary = summarizeM11Tap(stdout);
    const points = [...stdout.matchAll(/^( *)(not ok|ok) (\d+) - (.+)\r?$/gm)]
      .map((m) => ({ depth: m[1].length, passed: m[2] === 'ok', number: Number(m[3]), name: m[4] }));
    const top = points.filter((p) => p.depth === 0);
    const nested = points.filter((p) => p.depth > 0);
    const names = [...stdout.matchAll(/^# Subtest: (.+)\r?$/gm)].map((m) => m[1]);
    const plans = [...stdout.matchAll(/^1\.\.(\d+)\r?$/gm)];
    const controlsComplete = sameM11Supplement(names, suite.controls)
      && sameM11Supplement(top.map((p) => p.name), suite.controls)
      && top.every((p, i) => p.number === i + 1)
      && sameM11Supplement(nested.map((p) => p.name), suite.nestedChecks)
      && plans.length === 1 && Number(plans[0][1]) === suite.controls.length
      && summary.tests === top.length + nested.length;
    const completedPassing = !transportError && exitCode === 0 && controlsComplete
      && points.every((p) => p.passed) && summary.pass === summary.tests
      && ['fail', 'cancelled', 'skipped', 'todo'].every((k) => summary[k] === 0);
    return { state: completedPassing ? 'completed-passing' : 'ineligible',
      summary, topLevelControls: top.length, nestedChecks: nested.length, controlsComplete };
  } catch {
    return { state: 'ineligible', summary: null, topLevelControls: null,
      nestedChecks: null, controlsComplete: false };
  }
}

export function supplementStaticRecipe(inventory, sourceBindings) {
  return sealM11Supplement({ schemaVersion: 1, kind: 'm11-collection-recipe',
    inventorySha256: inventory.manifest_sha256, sourceRevision: inventory.metadata.sourceRevision,
    referenceSuites: uniqueM11Supplement(inventory.cases.filter((r) => r.split === 'development')
      .map((r) => r.referenceSuite)), sourceBindings }, 'recipeSha256');
}

export async function verifyM11SupplementInputs(input) {
  const { plan, expectedPlanSha256, previousBridge, staticAudit, inventory, closure,
    readSource, readProducer } = input;
  checkM11SupplementSeal(plan, 'planSha256', expectedPlanSha256);
  assert(plan.schemaVersion === 1 && plan.kind === 'm11-development-supplement-plan', 'unsupported plan');
  assert(Number.isFinite(Date.parse(plan.frozenAt)) && plan.runtime === 'v24.19.0', 'invalid plan environment');
  assert(plan.inventorySha256 === inventory.manifest_sha256
    && plan.sourceRevision === inventory.metadata.sourceRevision, 'plan inventory mismatch');
  const replay = await bridgeM11Observations({ ...input,
    expectedInventorySha256: plan.inventorySha256,
    expectedCollectionSha256: plan.previousCollectionSha256 });
  checkM11SupplementSeal(previousBridge, 'bridgeSha256', plan.previousBridgeSha256);
  assert(sameM11Supplement(replay, previousBridge), 'previous bridge replay mismatch');
  const missing = previousBridge.materialization.rows.filter((r) => r.reason === 'missing-observations')
    .map((r) => r.anchorId).sort();
  assert(sameM11Supplement(plan.anchorIds, missing), 'plan must select exactly missing development anchors');
  const rows = inventory.cases.filter((r) => missing.includes(r.case_id));
  assert(rows.every((r) => r.split === 'development'), 'evaluation anchor selected');
  assert(sameM11Supplement(plan.suites.map((s) => s.path), uniqueM11Supplement(rows.map((r) => r.referenceSuite))),
    'supplement suite set mismatch');
  for (const suite of plan.suites) {
    assert(sameM11Supplement(suite.controls, rows.filter((r) => r.referenceSuite === suite.path).map((r) => r.referenceTest))
      && Array.isArray(suite.nestedChecks) && new Set(suite.nestedChecks).size === suite.nestedChecks.length,
    'reference control set mismatch');
  }
  const bindings = Object.assign({}, ...closure.components.filter((c) => c.split === 'development').map((c) => c.sourceBindings));
  assert(sameM11Supplement(plan.sourceBindings, bindings)
    && sameM11Supplement(plan.commonContextBindings, closure.commonContextBindings), 'development source boundary mismatch');
  const texts = {};
  for (const [p, sha] of Object.entries({ ...bindings, ...plan.commonContextBindings })) {
    const bytes = await readSource(p);
    assert(m11SourceBlobSha(bytes) === sha, `source identity mismatch: ${p}`);
    texts[p] = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  }
  const lock = JSON.parse(texts['package-lock.json']).packages['node_modules/hono'];
  assert(sameM11Supplement(plan.runtimeDependency,
    { name: 'hono', version: lock.version, integrity: lock.integrity, resolved: lock.resolved }), 'locked runtime dependency mismatch');
  assert(Object.keys(plan.producerBindings).length >= 2 && typeof readProducer === 'function', 'producer bindings required');
  for (const [p, sha] of Object.entries(plan.producerBindings)) {
    assert(m11SourceBlobSha(await readProducer(p)) === sha, `producer identity mismatch: ${p}`);
  }
  const { audit } = await auditM11CollectionSources({ inventory, expectedInventorySha256: plan.inventorySha256,
    recipe: supplementStaticRecipe(inventory, bindings), readSource: async (p) => texts[p] });
  checkM11SupplementSeal(staticAudit, 'auditSha256', plan.staticAuditSha256);
  assert(sameM11Supplement(audit, staticAudit) && audit.conflicts.length === 0, 'development static audit mismatch');
  return { texts, rows, previousBridge: replay };
}
