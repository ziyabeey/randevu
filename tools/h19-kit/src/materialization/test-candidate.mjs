import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';
import { validateTestSpecification } from '../specification/test-spec.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const hashBody = (value) => sha(Buffer.from(`${stableJson(value)}\n`));

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function normalizeCandidatePath(value) {
  if (!nonEmpty(value)) throw new Error('candidate path required');
  if (value.includes('\0')) throw new Error('candidate path contains NUL');

  const raw = value.replaceAll('\\', '/');
  if (raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw)) {
    throw new Error('candidate path must be repository-relative');
  }

  const segments = raw.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error('candidate path traversal is not allowed');
  }

  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
  if (!normalized) throw new Error('candidate path required');
  return normalized;
}

export function freezeBaseFile({ path, content } = {}) {
  const normalizedPath = normalizeCandidatePath(path);
  if (typeof content !== 'string') throw new TypeError('base file content must be a string');
  return deepFreeze({
    path: normalizedPath,
    content,
    sha256: sha(Buffer.from(content)),
  });
}

export function verifyBaseFile(baseFile) {
  if (!baseFile) return null;
  const normalizedPath = normalizeCandidatePath(baseFile.path);
  if (typeof baseFile.content !== 'string' || !isSha256(baseFile.sha256)) {
    throw new Error('invalid base-file snapshot');
  }
  const actual = sha(Buffer.from(baseFile.content));
  if (actual !== baseFile.sha256) throw new Error('base-file hash mismatch');
  return deepFreeze({
    path: normalizedPath,
    content: baseFile.content,
    sha256: baseFile.sha256,
  });
}

function validateRendererMetadata(renderer) {
  for (const field of ['rendererId','version','framework','language']) {
    if (!nonEmpty(renderer?.[field])) throw new Error(`renderer ${field} required`);
  }
  if (!isSha256(renderer?.artifactSha256)) throw new Error('renderer artifactSha256 required');
  return renderer;
}

function rendererIdentity(renderer) {
  if (!renderer || typeof renderer.render !== 'function') {
    throw new TypeError('renderer with render(spec, baseFile) required');
  }
  validateRendererMetadata(renderer);
  return deepFreeze({
    rendererId: renderer.rendererId,
    version: renderer.version,
    framework: renderer.framework,
    language: renderer.language,
    artifactSha256: renderer.artifactSha256,
  });
}

function normalizeRenderResult(result) {
  if (!result || typeof result !== 'object') throw new Error('renderer returned invalid result');
  const path = normalizeCandidatePath(result.path);
  if (!['create','replace'].includes(result.operation)) throw new Error('renderer operation must be create or replace');
  if (!nonEmpty(result.content)) throw new Error('renderer content must be non-empty');
  return {
    path,
    operation: result.operation,
    content: String(result.content),
  };
}

function runRendererDeterministically(renderer, spec, baseFile) {
  const render = renderer.render;
  const once = normalizeRenderResult(render(
    deepFreeze(structuredClone(spec)),
    baseFile ? deepFreeze(structuredClone(baseFile)) : null,
  ));
  const twice = normalizeRenderResult(render(
    deepFreeze(structuredClone(spec)),
    baseFile ? deepFreeze(structuredClone(baseFile)) : null,
  ));

  if (stableJson(once) !== stableJson(twice)) {
    throw new Error('renderer is nondeterministic for frozen inputs');
  }
  return once;
}

export function materializeTestCandidate({
  spec,
  renderer,
  baseFile = null,
} = {}) {
  validateTestSpecification(spec);
  if (spec.readyForExecution !== true) {
    throw new Error('test specification is not ready for execution');
  }

  const identity = rendererIdentity(renderer);
  const verifiedBase = verifyBaseFile(baseFile);
  const rendered = runRendererDeterministically(renderer, spec, verifiedBase);

  if (rendered.operation === 'create' && verifiedBase) {
    throw new Error('create candidate must not bind a base file');
  }

  if (rendered.operation === 'replace') {
    if (!verifiedBase) throw new Error('replace candidate requires a base file');
    if (rendered.path !== verifiedBase.path) {
      throw new Error('replace candidate path must match base file path');
    }
  }

  const contentSha256 = sha(Buffer.from(rendered.content));
  const body = {
    schemaVersion: 1,
    specSha256: spec.specSha256,
    renderer: identity,
    target: {
      path: rendered.path,
      operation: rendered.operation,
      baseFileSha256: verifiedBase?.sha256 ?? null,
    },
    content: rendered.content,
    contentSha256,
  };

  return deepFreeze({
    ...body,
    candidateSha256: hashBody(body),
  });
}

export function validateTestCandidate(candidate, { baseFile = null } = {}) {
  if (!candidate?.candidateSha256) throw new TypeError('test candidate required');
  const { candidateSha256, ...body } = structuredClone(candidate);
  if (hashBody(body) !== candidateSha256) throw new Error('test candidate hash mismatch');

  if (!isSha256(candidate.specSha256)) throw new Error('candidate specSha256 is invalid');
  validateRendererMetadata(candidate.renderer);

  const normalizedPath = normalizeCandidatePath(candidate.target?.path);
  if (normalizedPath !== candidate.target.path) throw new Error('candidate target path is not normalized');
  if (!['create','replace'].includes(candidate.target?.operation)) throw new Error('invalid candidate operation');

  const contentSha256 = sha(Buffer.from(String(candidate.content ?? '')));
  if (!nonEmpty(candidate.content) || contentSha256 !== candidate.contentSha256) {
    throw new Error('candidate content hash mismatch');
  }

  if (candidate.target.operation === 'create') {
    if (candidate.target.baseFileSha256 !== null) {
      throw new Error('create candidate must not bind a base file');
    }
  } else {
    if (!isSha256(candidate.target.baseFileSha256)) throw new Error('replace candidate requires base-file hash');
    const verifiedBase = verifyBaseFile(baseFile);
    if (!verifiedBase || verifiedBase.path !== candidate.target.path
      || verifiedBase.sha256 !== candidate.target.baseFileSha256) {
      throw new Error('replace candidate base-file binding mismatch');
    }
  }

  return candidate;
}
