import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertSchema, validateManifest, parseFrontmatter, validateGuidance,
  inspectProjections, validateArtifacts, skillNames,
} from '../scripts/validate-development-engine.mjs';
import { discoverHttpTests } from '../scripts/run-http-tests.mjs';
import { classifyPaths } from '../scripts/ci-scope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = 'docs/development-engine';
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const load = (kind, location) => JSON.parse(read(`${home}/${location}/${kind}-manifest.v0.1${location === 'schemas' ? '.schema' : ''}.json`));
const taskSchema = load('task', 'schemas'), evidenceSchema = load('evidence', 'schemas');
const taskExample = load('task', 'examples'), evidenceExample = load('evidence', 'examples');
const a = 'a'.repeat(40), b = 'b'.repeat(40);

test('committed native artifacts are valid and the existing full CI discovers this test', async (t) => {
  const result = await validateArtifacts(root);
  for (const warning of result.warnings) t.diagnostic(`ADVISORY: ${warning}`);
  assert.deepEqual(result.errors, []);
  assert.ok((await discoverHttpTests(root)).includes('tests/development-engine.test.mjs'));
  assert.equal(classifyPaths(['.github/copilot-instructions.md', `${home}/examples/task-manifest.v0.1.json`]), 'code');
});

test('required artifact-test path reports extra advisories without failing, but rejects static errors', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'randevu-engine-advisory-'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { cwd: fixture, env, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  const artifactTest = ['--test', '--test-reporter=tap', '--test-name-pattern=^committed native artifacts',
    'tests/development-engine.test.mjs'];
  try {
    for (const directory of ['.github', home]) {
      cpSync(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    }
    for (const file of ['scripts/validate-development-engine.mjs', 'scripts/ci-files.mjs',
      'scripts/ci-scope.mjs', 'scripts/run-http-tests.mjs', 'tests/development-engine.test.mjs']) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      cpSync(path.join(root, file), path.join(fixture, file));
    }
    const instructions = '.github/copilot-instructions.md';
    writeFileSync(path.join(fixture, instructions), read(instructions)
      .replace('Never self-ready or self-merge', 'Never mark your own PR ready or merge it'));
    const telemetry = `${home}/automations/development-telemetry-review.md`;
    writeFileSync(path.join(fixture, telemetry), read(telemetry)
      .replace('a tiny cohort', 'a very small cohort'));
    const observation = await validateArtifacts(fixture);
    assert.deepEqual(observation.errors, []);
    assert.ok(observation.warnings.some((warning) => warning.includes('coordinator-only readiness/merge')));
    assert.ok(observation.warnings.some((warning) => warning.includes('small-sample limitation')));
    const cli = run(['scripts/validate-development-engine.mjs']);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /ADVISORY: .*coordinator-only readiness\/merge/);
    assert.match(cli.stderr, /ADVISORY: .*small-sample limitation/);
    const advisoryTest = run(artifactTest);
    assert.equal(advisoryTest.status, 0, advisoryTest.stdout + advisoryTest.stderr);
    assert.match(advisoryTest.stdout, /ADVISORY: .*coordinator-only readiness\/merge/);
    assert.match(advisoryTest.stdout, /ADVISORY: .*small-sample limitation/);

    const scoped = '.github/instructions/implementation.instructions.md';
    writeFileSync(path.join(fixture, scoped), read(scoped).replace(/^---\r?\n/, '---\nunsupported: "fixture"\n'));
    const invalidCli = run(['scripts/validate-development-engine.mjs']);
    assert.equal(invalidCli.status, 1, invalidCli.stdout + invalidCli.stderr);
    assert.match(invalidCli.stderr, /ERROR: .*unsupported frontmatter key/);
    const invalidTest = run(artifactTest);
    assert.equal(invalidTest.status, 1, invalidTest.stdout + invalidTest.stderr);
    assert.match(invalidTest.stdout, /unsupported frontmatter key/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('both manifest examples are explicitly non-authoritative and do not fabricate current evidence', () => {
  for (const [schema, example] of [[taskSchema, taskExample], [evidenceSchema, evidenceExample]]) {
    assert.deepEqual(validateManifest(schema, example), []);
    assert.equal(example.observation_only, true);
    assert.equal(example.example, true);
    assert.ok(validateManifest(schema, { ...example, observation_only: false }).some((error) => error.includes('constant')));
  }
  assert.equal(taskExample.identity.current_head_sha, null);
  assert.equal(evidenceExample.ci.status, 'pending');
  assert.equal(evidenceExample.merge.ready, false);
  assert.equal(evidenceExample.post_main.status, 'pending');
});

test('bounded schema validation checks required, extra, nested, array, enum, type and exact SHA constraints', () => {
  const cases = [
    (value) => { delete value.risk.auth; },
    (value) => { value.risk.auth = 'false'; },
    (value) => { value.risk.auth = null; },
    (value) => { value.identity.current_head_sha = 'abc123'; },
    (value) => { value.identity.pr = 0; },
    (value) => { value.task.size = 'XXL'; },
    (value) => { value.task.validation_budget = 'SKIP'; },
    (value) => { value.scope.writable = [42]; },
    (value) => { value.dependencies.tasks = ['K-01']; },
    (value) => { value.state.executor_mode = 'BLOCK'; },
    (value) => { value.review.coordinator_merge = 'optional'; },
    (value) => { value.source_refs = []; },
    (value) => { value.extra_authority = true; },
  ];
  for (const mutate of cases) {
    const value = structuredClone(taskExample);
    mutate(value);
    assert.ok(validateManifest(taskSchema, value).length > 0, mutate.toString());
  }
  const value = structuredClone(taskExample);
  value.identity.current_head_sha = a;
  value.identity.pr = 119;
  value.state.executor_mode = 'SHADOW';
  assert.deepEqual(validateManifest(taskSchema, value), []);
  const evidence = structuredClone(evidenceExample);
  evidence.reviews.r1.sha = 'main';
  evidence.proofs[0].status = 'green-ish';
  assert.equal(validateManifest(evidenceSchema, evidence).length, 2);
});

test('canonical KC dependencies can be projected without omitting the K04 contract', () => {
  for (const [id, dependencies] of [
    ['KC-00', ['K04']],
    ['KC-01', ['KC-00']],
    ['KC-03', ['KC-01', 'KC-02']],
  ]) {
    const value = structuredClone(taskExample);
    value.task.id = id;
    value.dependencies.tasks = dependencies;
    assert.deepEqual(validateManifest(taskSchema, value), [], `${id} -> ${dependencies.join(', ')}`);
  }
});

test('dependency reference syntax covers canonical families without authorizing graph edges', () => {
  const value = structuredClone(taskExample);
  value.task.id = 'ILLUSTRATIVE-SYNTAX-ONLY';
  value.dependencies.tasks = ['TEMEL', 'S08', 'F11-04', 'GS', 'G11', 'K01', 'K04', 'KC-00', 'MKT-01', 'DEV-ENGINE-01'];
  assert.deepEqual(validateManifest(taskSchema, value), []);
});

test('malformed or unsafe dependency references still fail static validation', () => {
  for (const dependency of [
    '', 'K4', 'K004', 'K-04', 'KC-0', 'KC-000', 'KC_00', 'kc-00',
    'MKT01', 'MKT-1', 'DEV-ENGINE-1', 'DEV-ENGINE-001', 'UNKNOWN-01',
    'S1', 'F11-4', 'G1', '../KC-00', 'K04/KC-00', 'KC-00 extra',
    ' KC-00', 'KC-00 ', 'KC-00\n', 'KC-00\r\n', 'KC-00\u2028', 'KC-00\u0000',
  ]) {
    const value = structuredClone(taskExample);
    value.dependencies.tasks = [dependency];
    assert.ok(validateManifest(taskSchema, value).some((error) => error.includes('$.dependencies.tasks[0]')),
      JSON.stringify(dependency));
  }
});

test('unsupported or malformed schema features are errors, never silently ignored', () => {
  for (const schema of [
    { $ref: '#/definitions/head' }, { format: 'uri' }, { oneOf: [] },
    { properties: { nested: { default: true } } }, { type: [] },
    { type: ['string', 'string'] }, { enum: [] }, { enum: [{ key: 1 }] },
    { const: [] }, { additionalProperties: true }, { required: ['missing'] },
    { pattern: '[' }, { minLength: -1 }, { minimum: '0' }, { items: true },
    { $schema: 'https://example.invalid/schema' },
  ]) assert.throws(() => assertSchema(schema), Error, JSON.stringify(schema));
  assert.deepEqual(validateManifest({ type: 'string', minLength: 1 }, '😀'), []);
  assert.equal(validateManifest({ type: 'string', minLength: 2 }, '😀').length, 1);
  assert.deepEqual(validateManifest({ type: ['integer', 'null'], minimum: 1 }, null), []);
  assert.equal(validateManifest({ type: 'number' }, Infinity).length, 1);
});

test('native frontmatter uses only supported quoted scalar fields; duplicate and invented keys fail', () => {
  assert.equal(parseFrontmatter('---\r\napplyTo: "**/*.ts,**/*.tsx"\r\n---\r\ntext', ['applyTo']).fields.applyTo, '**/*.ts,**/*.tsx');
  for (const text of [
    'name: "no fence"', '---\nname: "unfinished"\n',
    '---\nname: "one"\nname: "two"\n---\n',
    '---\nenvironments: "app"\n---\n',
    '---\nname: ["array"]\n---\n',
    '---\nname: ""\n---\n',
  ]) assert.throws(() => parseFrontmatter(text, ['name', 'description']));
  const file = '.github/instructions/implementation.instructions.md';
  const original = read(file);
  for (const text of [
    original.replace('excludeAgent: "code-review"', 'excludeAgent: "app"'),
    original.replace('applyTo: "**"', 'applyTo: "../worker/**"'),
    original.replace('applyTo: "**"\n', ''),
    original.replace('excludeAgent: "code-review"', 'allowed-tools: "all"'),
  ]) assert.ok(validateGuidance(file, text).errors.length > 0);
});

test('all five Skills have role/input/evidence/SHA/output/stop boundaries, not agent-profile fields', () => {
  for (const name of skillNames) {
    const file = `.github/skills/${name}/SKILL.md`;
    const text = read(file);
    assert.deepEqual(validateGuidance(file, text).errors, []);
    assert.ok(validateGuidance(file, text.replace('## Stop', '## Removed')).errors.some((error) => error.includes('section Stop')));
    assert.ok(validateGuidance(file, text.replace(/^description:.*\n/m, '')).errors.some((error) => error.includes('description')));
    assert.ok(validateGuidance(file, text.replace(`name: "${name}"`, 'name: "Different"')).errors.some((error) => error.includes('name')));
  }
});

test('governance wording drift is advisory rather than a new live BLOCK gate', () => {
  const file = '.github/copilot-instructions.md';
  const text = 'Self-merge is allowed';
  const result = validateGuidance(file, text);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes('coordinator-only')));
  const telemetry = `${home}/automations/development-telemetry-review.md`;
  const controlled = 'Control maturity `SHADOW`. Unknown values are null with a reason, not zero. Do not generalize from a tiny cohort.';
  assert.deepEqual(validateGuidance(telemetry, controlled), { errors: [], warnings: [] });
  const changed = controlled.replace('null with a reason, not zero', 'zero')
    .replace('maturity `SHADOW`', 'maturity `BLOCK`');
  const drift = validateGuidance(telemetry, changed);
  assert.deepEqual(drift.errors, []);
  assert.equal(drift.warnings.length, 2);
});

test('stale/unsupported evidence claims remain representable observations, not automatically repaired approvals', () => {
  const task = structuredClone(taskExample), evidence = structuredClone(evidenceExample);
  task.identity.current_head_sha = a;
  task.review.r1 = 'required';
  evidence.candidate.exact_head_sha = a;
  evidence.candidate.semantic_sha = a;
  evidence.ci = { run: 'fixture:run', status: 'success', exact_sha: b, tested_checkout_sha: b, job: 'fixture:job', attempt: 1 };
  evidence.reviews.r1 = { required: true, verdict: 'acceptable', sha: b, receipt: 'fixture:r1-old-head' };
  evidence.merge = { ready: true, coordinator_receipt: null };
  assert.deepEqual(validateManifest(evidenceSchema, evidence), []);
  const before = JSON.stringify(evidence);
  const warnings = inspectProjections(task, evidence);
  assert.ok(warnings.some((warning) => warning.includes('CI evidence')));
  assert.ok(warnings.some((warning) => warning.includes('r1: SHA-bound receipt is stale')));
  assert.ok(warnings.some((warning) => warning.includes('no coordinator receipt')));
  assert.equal(JSON.stringify(evidence), before);
  assert.equal(evidence.reviews.r1.sha, b);
});

test('a different tested merge-tree SHA is not itself stale CI; green CI is not post-main acceptance', () => {
  const task = structuredClone(taskExample), evidence = structuredClone(evidenceExample);
  task.identity.current_head_sha = a;
  evidence.candidate.exact_head_sha = a;
  evidence.ci = { run: 'fixture:run', status: 'success', exact_sha: a, tested_checkout_sha: b, job: 'fixture:job', attempt: 1 };
  const freshCiWarnings = inspectProjections(task, evidence)
    .filter((warning) => warning.startsWith('CI evidence') || warning.startsWith('Successful CI claim'));
  assert.deepEqual(freshCiWarnings, []);
  assert.equal(evidence.post_main.status, 'pending');
  assert.equal(evidence.merge.ready, false);
  evidence.post_main.status = 'success';
  evidence.proofs[0].status = 'pass';
  const warnings = inspectProjections(task, evidence);
  assert.ok(warnings.some((warning) => warning.includes('Post-main')));
  assert.ok(warnings.some((warning) => warning.includes('no evidence reference')));
});

test('missing artifacts and symlinked discovery fail visibly without following outside data', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'randevu-engine-'));
  try {
    mkdirSync(path.join(fixture, '.github'), { recursive: true });
    mkdirSync(path.join(fixture, home), { recursive: true });
    const result = await validateArtifacts(fixture);
    assert.ok(result.errors.some((error) => error.includes('missing artifact')));
    const target = path.join(fixture, 'outside.json');
    writeFileSync(target, '{}');
    symlinkSync(target, path.join(fixture, home, 'linked.json'));
    await assert.rejects(validateArtifacts(fixture), /symlinks are not allowed/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
