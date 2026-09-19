import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeRelativePath, discoverFiles } from './ci-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = 'docs/development-engine';
export const skillNames = ['kepenk-implementer', 'r1-db-security-review',
  'r2-browser-integration-review', 'effective-state-audit', 'development-telemetry-review'];
export const promptNames = ['r0-review', 'effective-state-audit', 'stale-review-detector', 'development-telemetry-review'];
export const decisionFirstLabels = ['VERDICT:', 'BLOCKERS:', 'EVIDENCE GAPS:', 'REVIEWED SHA:', 'NEXT ACTION:'];
const reviewLineageKernelHeading = '### Review lineage kernel';
export const reviewLineageKernelRef = 'docs/plan/agent-workflow.md#review-lineage-kernel';
const reviewLineageRefs = new Map([
  ['docs/development-engine/automations/r0-review.md', '../../plan/agent-workflow.md#review-lineage-kernel'],
  ['docs/development-engine/automations/stale-review-detector.md', '../../plan/agent-workflow.md#review-lineage-kernel'],
  ['.github/skills/r1-db-security-review/SKILL.md', '../../../docs/plan/agent-workflow.md#review-lineage-kernel'],
  ['.github/skills/r2-browser-integration-review/SKILL.md', '../../../docs/plan/agent-workflow.md#review-lineage-kernel'],
]);
const decisionFirstFiles = new Set([
  'docs/development-engine/automations/r0-review.md',
  '.github/skills/r1-db-security-review/SKILL.md',
  '.github/skills/r2-browser-integration-review/SKILL.md',
]);
const sections = ['Role', 'Required inputs', 'Allowed actions', 'Forbidden actions', 'Evidence', 'Exact SHA', 'Output', 'Stop'];
const keywords = new Set(['$schema', 'title', 'description', 'type', 'const', 'enum', 'properties',
  'required', 'additionalProperties', 'items', 'minItems', 'minLength', 'minimum', 'pattern']);
const types = new Set(['object', 'array', 'string', 'boolean', 'integer', 'number', 'null']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const primitive = (value) => value === null || ['string', 'boolean'].includes(typeof value)
  || (typeof value === 'number' && Number.isFinite(value));
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

// Deliberately bounded to the authored schemas; unsupported JSON Schema is an error.
export function assertSchema(schema, location = '$') {
  const need = (condition, message) => { if (!condition) throw new Error(`${location}: ${message}`); };
  need(object(schema), 'schema must be an object');
  for (const key of Object.keys(schema)) need(keywords.has(key), `unsupported schema keyword ${key}`);
  for (const key of ['$schema', 'title', 'description']) {
    if (Object.hasOwn(schema, key)) need(nonempty(schema[key]), `${key} must be a non-empty string`);
  }
  if (schema.$schema) need(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'unsupported schema dialect');
  if (Object.hasOwn(schema, 'type')) {
    const values = Array.isArray(schema.type) ? schema.type : [schema.type];
    need(values.length > 0 && values.every((value) => types.has(value))
      && new Set(values).size === values.length, 'invalid type');
  }
  if (Object.hasOwn(schema, 'const')) need(primitive(schema.const), 'only primitive const is supported');
  if (Object.hasOwn(schema, 'enum')) {
    need(Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(primitive)
      && new Set(schema.enum).size === schema.enum.length, 'enum must contain unique primitives');
  }
  if (Object.hasOwn(schema, 'properties')) {
    need(object(schema.properties), 'properties must be an object');
    for (const [key, child] of Object.entries(schema.properties)) assertSchema(child, `${location}.${key}`);
  }
  if (Object.hasOwn(schema, 'required')) {
    need(Array.isArray(schema.required) && schema.required.every(nonempty)
      && new Set(schema.required).size === schema.required.length, 'required must contain unique names');
    need(schema.required.every((key) => Object.hasOwn(schema.properties ?? {}, key)), 'required field has no property schema');
  }
  if (Object.hasOwn(schema, 'additionalProperties')) {
    need(schema.additionalProperties === false, 'only additionalProperties:false is supported');
  }
  if (Object.hasOwn(schema, 'items')) assertSchema(schema.items, `${location}[]`);
  for (const key of ['minItems', 'minLength']) {
    if (Object.hasOwn(schema, key)) need(Number.isInteger(schema[key]) && schema[key] >= 0, `${key} must be a nonnegative integer`);
  }
  if (Object.hasOwn(schema, 'minimum')) need(Number.isFinite(schema.minimum), 'minimum must be finite');
  if (Object.hasOwn(schema, 'pattern')) {
    need(typeof schema.pattern === 'string', 'pattern must be a string');
    try { new RegExp(schema.pattern, 'u'); } catch { throw new Error(`${location}: invalid pattern`); }
  }
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'object') return object(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

export function validateManifest(schema, value) {
  assertSchema(schema);
  const errors = [];
  function walk(rule, current, location) {
    const fail = (message) => errors.push(`${location}: ${message}`);
    if (rule.type && ![].concat(rule.type).some((type) => matchesType(current, type))) {
      fail(`expected ${[].concat(rule.type).join('|')}`);
      return;
    }
    if (Object.hasOwn(rule, 'const') && current !== rule.const) fail(`expected constant ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.includes(current)) fail('value is outside enum');
    if (typeof current === 'string') {
      if (Object.hasOwn(rule, 'minLength') && [...current].length < rule.minLength) fail('string is too short');
      if (rule.pattern && !new RegExp(rule.pattern, 'u').test(current)) fail('string does not match pattern');
    }
    if (typeof current === 'number' && Object.hasOwn(rule, 'minimum') && current < rule.minimum) fail('number is below minimum');
    if (Array.isArray(current)) {
      if (Object.hasOwn(rule, 'minItems') && current.length < rule.minItems) fail('array has too few items');
      if (rule.items) current.forEach((item, index) => walk(rule.items, item, `${location}[${index}]`));
    }
    if (object(current)) {
      for (const key of rule.required ?? []) if (!Object.hasOwn(current, key)) fail(`missing ${key}`);
      for (const key of Object.keys(current)) {
        if (Object.hasOwn(rule.properties ?? {}, key)) walk(rule.properties[key], current[key], `${location}.${key}`);
        else if (rule.additionalProperties === false) fail(`unknown field ${key}`);
      }
    }
  }
  walk(schema, value, '$');
  return errors;
}

export function parseFrontmatter(markdown, allowed) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('missing or unterminated YAML frontmatter');
  const fields = Object.create(null);
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = line.match(/^([A-Za-z][A-Za-z-]*): (".*")$/);
    if (!field) throw new Error('frontmatter subset requires one JSON-quoted YAML string per line');
    const [, key, raw] = field;
    if (!allowed.includes(key)) throw new Error(`unsupported frontmatter key ${key}`);
    if (Object.hasOwn(fields, key)) throw new Error(`duplicate frontmatter key ${key}`);
    fields[key] = JSON.parse(raw);
    if (!nonempty(fields[key])) throw new Error(`empty frontmatter value ${key}`);
  }
  return { fields, body: match[2] };
}

function sectionBody(markdown, heading) {
  return markdown.match(new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1] ?? null;
}

function codeFence(markdown) {
  return markdown.match(/```text\r?\n([\s\S]*?)```/)?.[1] ?? null;
}

function orderedLabels(text, labels) {
  let cursor = 0;
  for (const label of labels) {
    const next = text.indexOf(label, cursor);
    if (next === -1) return false;
    cursor = next + label.length;
  }
  return true;
}

const driftRules = [
  ['.github/copilot-instructions.md', /Never self-ready or self-merge/, 'coordinator-only readiness/merge'],
  ['.github/copilot-instructions.md', /Semantic runtime changes invalidate/, 'semantic review reset'],
  ['.github/copilot-instructions.md', /post-main CI/, 'post-main evidence'],
  ['.github/copilot-instructions.md', /Accepted migrations are immutable/, 'forward-only migration'],
  [`${home}/README.md`, /control_maturity[\s\S]*executor_mode/, 'distinct maturity/executor names'],
  ...promptNames.map((name) => [`${home}/automations/${name}.md`, /maturity `SHADOW`/, 'observation-only rollout maturity']),
  [`${home}/automations/development-telemetry-review.md`, /null with a reason, not zero/, 'unknown-versus-zero telemetry'],
  [`${home}/automations/development-telemetry-review.md`, /tiny cohort/, 'small-sample limitation'],
];

export function validateGuidance(file, markdown) {
  const errors = [];
  const warnings = [];
  try {
    if (file.endsWith('/SKILL.md')) {
      const { fields, body } = parseFrontmatter(markdown, ['name', 'description']);
      if (fields.name !== file.split('/').at(-2) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name)) {
        errors.push('Skill name must match its lowercase-hyphen directory');
      }
      if (!fields.description) errors.push('Skill description is required');
      for (const section of sections) {
        const content = body.match(new RegExp(`^## ${section}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1];
        if (!content?.trim()) errors.push(`missing or empty Skill section ${section}`);
      }
    } else if (file.endsWith('.instructions.md')) {
      const { fields } = parseFrontmatter(markdown, ['applyTo', 'excludeAgent']);
      if (!fields.applyTo) errors.push('applyTo is required');
      else for (const glob of fields.applyTo.split(',')) assertSafeRelativePath(glob.trim(), 'applyTo glob');
      if (fields.excludeAgent && !['code-review', 'cloud-agent'].includes(fields.excludeAgent)) errors.push('unsupported excludeAgent');
    }
  } catch (error) { errors.push(error.message); }
  if (file === 'docs/plan/agent-workflow.md') {
    if (!markdown.includes(reviewLineageKernelHeading)) errors.push('missing canonical review lineage kernel heading');
    const kernel = markdown.match(/^### Review lineage kernel\r?\n([\s\S]*?)(?=^## |^### |$(?![\s\S]))/m)?.[1];
    if (!kernel?.trim()) errors.push('missing canonical review lineage kernel body');
    else {
      for (const label of ['Previous receipt:', 'Previous reviewed SHA:', 'Candidate SHA:', 'Approved delta:', 'Frozen blockers:', 'Closure evidence:', 'Evidence gaps:', 'Next coordinator action:']) {
        if (!kernel.includes(label)) errors.push(`review lineage kernel missing ${label}`);
      }
      if (!orderedLabels(kernel, decisionFirstLabels)) errors.push('review lineage kernel must keep decision-first receipt labels in canonical order');
    }
  }
  if (reviewLineageRefs.has(file)) {
    const expectedRef = reviewLineageRefs.get(file);
    if (!markdown.includes(expectedRef)) errors.push(`must reference canonical review lineage kernel ${expectedRef}`);
  }
  if (decisionFirstFiles.has(file)) {
    const output = codeFence(sectionBody(markdown, 'Output') ?? '');
    if (!output) errors.push('missing text output code fence for decision-first receipt');
    else {
      const normalizedOutput = output.trimStart();
      if (!normalizedOutput.startsWith('VERDICT:')) errors.push('decision-first receipt must start with VERDICT');
      if (!orderedLabels(output, decisionFirstLabels)) errors.push('decision-first receipt labels must appear in canonical order');
    }
  }
  const normalized = markdown.replace(/\s+/g, ' ');
  for (const [target, pattern, invariant] of driftRules) {
    if (target === file && !pattern.test(normalized)) warnings.push(`${file}: inspect possible drift of ${invariant}`);
  }
  return { errors: errors.map((error) => `${file}: ${error}`), warnings };
}

// Call only for structurally validated projections. This never returns merge authority.
export function inspectProjections(task, evidence) {
  const warnings = [];
  const head = evidence.candidate.exact_head_sha;
  if (!head || !task.identity.current_head_sha) warnings.push('Candidate identity is unknown; no live acceptance can be inferred.');
  else if (head !== task.identity.current_head_sha) warnings.push('Task and Evidence heads differ; refresh the projection.');
  if (head && evidence.ci.exact_sha !== head) warnings.push('CI evidence is missing or stale for the candidate.');
  if (evidence.ci.status !== 'success') warnings.push(`CI result is not successful: ${evidence.ci.status}; required evidence remains incomplete.`);
  if (evidence.ci.status === 'success') {
    if (!evidence.candidate.base_main_sha || !evidence.ci.base_main_sha) {
      warnings.push('CI base identity is unknown; current integration freshness cannot be inferred.');
    } else if (evidence.candidate.base_main_sha !== evidence.ci.base_main_sha) {
      warnings.push('CI base differs from the observed candidate base; refresh integration evidence.');
    }
  }
  if (evidence.ci.status === 'success'
    && (!evidence.ci.run || !evidence.ci.job || !evidence.ci.attempt || !evidence.ci.tested_checkout_sha || !evidence.ci.exact_sha)) {
    warnings.push('Successful CI claim lacks exact run/job/attempt/checkout provenance.');
  }
  for (const role of ['r1', 'r2']) {
    const review = evidence.reviews[role];
    if (review.required !== (task.review[role] === 'required')) warnings.push(`${role}: requirement differs from Task projection; consult the coordinator.`);
    if (review.sha && head && review.sha !== head) warnings.push(`${role}: SHA-bound receipt is stale; coordinator delta/final confirmation needed.`);
    if (review.verdict === 'acceptable' && (!review.sha || !review.receipt || !head)) warnings.push(`${role}: acceptance provenance is incomplete.`);
    if (review.required && review.verdict === 'not_required') warnings.push(`${role}: required review is recorded as not_required.`);
    if (task.review[role] === 'required' && review.verdict !== 'acceptable') warnings.push(`${role}: required review has no acceptable receipt (${review.verdict}).`);
  }
  for (const proof of evidence.proofs) {
    if (proof.status !== 'pass') {
      if (!proof.exact_sha) {
        warnings.push(`${proof.obligation}: non-pass proof is not bound to a candidate SHA.`);
      } else if (head && proof.exact_sha === head) {
        warnings.push(`${proof.obligation}: ${proof.kind} current proof result is ${proof.status}; inspect obligation coverage (${proof.ref ?? 'no reference'}).`);
      } else if (head && proof.exact_sha !== head) {
        warnings.push(`${proof.obligation}: non-pass proof is historical, not current candidate evidence.`);
      }
    }
    if (['pass', 'fail'].includes(proof.status) && !proof.ref) warnings.push(`${proof.obligation}: proof result has no evidence reference.`);
    if (['pass', 'fail'].includes(proof.status)) {
      if (!proof.exact_sha || !proof.tested_checkout_sha) warnings.push(`${proof.obligation}: proof identity is incomplete.`);
      if (proof.exact_sha && head && proof.exact_sha !== head) warnings.push(`${proof.obligation}: proof is historical, not current candidate evidence.`);
    }
  }
  if (evidence.merge.ready === true) {
    warnings.push(evidence.merge.coordinator_receipt
      ? 'Readiness is only a recorded claim; verify the coordinator receipt on the live candidate.'
      : 'Readiness claim has no coordinator receipt; this projection grants no merge authority.');
  }
  if (evidence.post_main.status === 'success' && (!evidence.post_main.merge_sha || !evidence.post_main.ci_run)) {
    warnings.push('Post-main success claim lacks separate merge-SHA/run evidence.');
  }
  return warnings;
}

export async function validateArtifacts(repo = root) {
  const errors = [];
  const warnings = [];
  const requiredMarkdown = ['.github/copilot-instructions.md',
    'docs/plan/agent-workflow.md',
    ...['implementation', 'db-security', 'browser-integration'].map((name) => `.github/instructions/${name}.instructions.md`),
    ...skillNames.map((name) => `.github/skills/${name}/SKILL.md`),
    ...promptNames.map((name) => `${home}/automations/${name}.md`), `${home}/README.md`];
  const discovered = new Set([
    ...await discoverFiles(repo, '.github', '.md'),
    ...await discoverFiles(repo, home, '.md'),
    ...await discoverFiles(repo, 'docs/plan', '.md'),
    ...await discoverFiles(repo, home, '.json'),
  ]);
  const read = (file) => {
    if (!discovered.has(file)) throw new Error(`missing artifact ${file}`);
    return readFileSync(path.join(repo, file), 'utf8');
  };
  for (const file of requiredMarkdown) {
    try {
      const result = validateGuidance(file, read(file));
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    } catch (error) { errors.push(error.message); }
  }
  const examples = {};
  for (const kind of ['task', 'evidence']) {
    try {
      const schema = JSON.parse(read(`${home}/schemas/${kind}-manifest.v0.1.schema.json`));
      const example = JSON.parse(read(`${home}/examples/${kind}-manifest.v0.1.json`));
      const failures = validateManifest(schema, example);
      if (example.example !== true) failures.push('committed example must be explicitly illustrative');
      errors.push(...failures.map((error) => `${kind}: ${error}`));
      if (!failures.length) examples[kind] = example;
    } catch (error) { errors.push(`${kind}: ${error.message}`); }
  }
  if (examples.task && examples.evidence) warnings.push(...inspectProjections(examples.task, examples.evidence));
  return { errors, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { errors, warnings } = await validateArtifacts();
    for (const warning of warnings) console.warn(`ADVISORY: ${warning}`);
    if (errors.length) {
      console.error(errors.map((error) => `ERROR: ${error}`).join('\n'));
      process.exitCode = 1;
    } else console.log('Development Engine static artifacts valid; governance observations are advisory only.');
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
