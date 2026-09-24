import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const hashBody = (value) => sha(`${stableJson(value)}\n`);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function packetBody(packet) {
  const { packetSha256, ...body } = structuredClone(packet ?? {});
  return body;
}

export function verifyCoveragePacket(packet) {
  if (!packet?.packetSha256) throw new TypeError('frozen M5 packet required');
  const expected = hashBody(packetBody(packet));
  if (expected !== packet.packetSha256) {
    throw new Error('M5 packet hash mismatch');
  }
  return packet;
}

export function validationDigest(validationResult) {
  if (!validationResult || typeof validationResult !== 'object') {
    throw new TypeError('validation result required');
  }
  return hashBody(structuredClone(validationResult));
}

export function recipeDigest(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new TypeError('recipe required');
  const { digest, ...body } = structuredClone(recipe);
  return hashBody(body);
}

export function freezeTestRecipe(recipe = {}) {
  if (!nonEmptyString(recipe.recipeId) || !nonEmptyString(recipe.version)) {
    throw new TypeError('recipe requires recipeId and version');
  }
  const body = {
    recipeId: String(recipe.recipeId),
    version: String(recipe.version),
    matches: structuredClone(recipe.matches ?? {}),
    setup: [...(recipe.setup ?? [])].map(String),
    action: recipe.action == null ? null : String(recipe.action),
    expectedInvariant: recipe.expectedInvariant == null ? null : String(recipe.expectedInvariant),
    observations: [...(recipe.observations ?? [])].map(String),
  };
  return deepFreeze({
    ...body,
    digest: hashBody(body),
  });
}

export function verifyTestRecipe(recipe, hypothesis) {
  if (!recipe) return null;
  if (!nonEmptyString(recipe.recipeId) || !nonEmptyString(recipe.version)) {
    throw new Error('test recipe requires recipeId and version');
  }
  if (recipeDigest(recipe) !== recipe.digest) throw new Error('test recipe digest mismatch');

  const matches = recipe.matches ?? {};
  if (!nonEmptyString(matches.reason)) {
    throw new Error('test recipe requires a reason match');
  }
  if (matches.reason != null && matches.reason !== hypothesis.reason) {
    throw new Error('test recipe reason does not match hypothesis');
  }

  const hypothesisMutator = hypothesis.validation?.mutatorId ?? null;
  if (matches.mutatorId != null && matches.mutatorId !== hypothesisMutator) {
    throw new Error('test recipe mutator does not match hypothesis');
  }

  return recipe;
}

function recipeRef(recipe) {
  return recipe ? `recipe:${recipe.recipeId}@${recipe.version}#${recipe.digest}` : null;
}

function knownText(value, provenance) {
  if (!nonEmptyString(value)) return deepFreeze({ state: 'unknown', value: null, provenance: [] });
  return deepFreeze({ state: 'known', value: String(value), provenance: [provenance] });
}

function knownList(items, provenance) {
  const values = [...(items ?? [])].map(String).filter((x) => x.trim().length > 0);
  if (!values.length) return deepFreeze({ state: 'unknown', items: [], provenance: [] });
  return deepFreeze({ state: 'known', items: values, provenance: [provenance] });
}

function unknownMutation() {
  return deepFreeze({
    state: 'unknown',
    mutationId: null,
    mutatorId: null,
    provenance: [],
  });
}

function hypothesisMutation(hypothesis) {
  const mutationId = hypothesis.validation?.mutationId;
  const mutatorId = hypothesis.validation?.mutatorId;
  if (!nonEmptyString(mutationId) || !nonEmptyString(mutatorId)) {
    throw new Error('surviving-mutant hypothesis requires mutationId and mutatorId');
  }
  return deepFreeze({
    state: 'known',
    mutationId,
    mutatorId,
    provenance: [
      `m5:hypothesis:${hypothesis.id}`,
      `mutation:${mutationId}`,
    ],
  });
}

function resolveValidation(packet, hypothesis, validationResult) {
  if (!validationResult) return null;

  if (validationResult.packetSha256 !== packet.packetSha256) {
    throw new Error('validation result packet hash mismatch');
  }
  if (validationResult.hypothesisId !== hypothesis.id) {
    throw new Error('validation result hypothesis mismatch');
  }
  if (validationResult.status === 'rejected') {
    throw new Error('rejected hypothesis is ineligible for test specification');
  }
  if (validationResult.status === 'inconclusive') {
    throw new Error('inconclusive hypothesis is not promoted');
  }
  if (validationResult.status !== 'confirmed') {
    throw new Error('invalid validation result status');
  }

  return deepFreeze({
    status: 'confirmed',
    digest: validationDigest(validationResult),
  });
}

export function buildTestSpecification({
  packet,
  hypothesisId,
  validationResult = null,
  recipe = null,
} = {}) {
  verifyCoveragePacket(packet);
  if (!nonEmptyString(hypothesisId)) throw new TypeError('hypothesisId required');

  const hypothesis = packet.hypotheses?.find((x) => x.id === hypothesisId);
  if (!hypothesis) throw new Error(`unknown hypothesis: ${hypothesisId}`);

  const survivingMutant = hypothesis.reason === 'surviving-mutant';
  const validation = resolveValidation(packet, hypothesis, validationResult);

  if (!survivingMutant && !validation) {
    throw new Error('hypothesis requires confirmed validation before test specification');
  }

  if (!Array.isArray(hypothesis.evidenceIds) || hypothesis.evidenceIds.length === 0) {
    throw new Error('hypothesis requires source evidence IDs');
  }

  const verifiedRecipe = verifyTestRecipe(recipe, hypothesis);
  const provenance = recipeRef(verifiedRecipe);

  const setup = verifiedRecipe
    ? knownList(verifiedRecipe.setup, provenance)
    : deepFreeze({ state: 'unknown', items: [], provenance: [] });
  const action = verifiedRecipe
    ? knownText(verifiedRecipe.action, provenance)
    : deepFreeze({ state: 'unknown', value: null, provenance: [] });
  const expectedInvariant = verifiedRecipe
    ? knownText(verifiedRecipe.expectedInvariant, provenance)
    : deepFreeze({ state: 'unknown', value: null, provenance: [] });
  const requiredObservations = verifiedRecipe
    ? knownList(verifiedRecipe.observations, provenance)
    : deepFreeze({ state: 'unknown', items: [], provenance: [] });

  const mutationToKill = survivingMutant
    ? hypothesisMutation(hypothesis)
    : unknownMutation();

  const unknowns = [];
  if (setup.state === 'unknown') unknowns.push('setup');
  if (action.state === 'unknown') unknowns.push('action');
  if (expectedInvariant.state === 'unknown') unknowns.push('expectedInvariant');
  if (mutationToKill.state === 'unknown') unknowns.push('mutationToKill');
  if (requiredObservations.state === 'unknown') unknowns.push('requiredObservations');

  const executionReady = setup.state === 'known'
    && action.state === 'known'
    && expectedInvariant.state === 'known'
    && requiredObservations.state === 'known'
    && (!survivingMutant || mutationToKill.state === 'known');

  const body = {
    schemaVersion: 1,
    packetSha256: packet.packetSha256,
    hypothesisId: hypothesis.id,
    sourceRevision: packet.sourceRevision ?? null,
    target: {
      kind: hypothesis.target.kind,
      path: hypothesis.target.path,
      ...(hypothesis.target.unitId != null ? { unitId: hypothesis.target.unitId } : {}),
    },
    origin: {
      reason: hypothesis.reason,
      priority: hypothesis.priority,
      evidenceIds: [...(hypothesis.evidenceIds ?? [])].sort(),
      recipe: verifiedRecipe ? {
        recipeId: verifiedRecipe.recipeId,
        version: verifiedRecipe.version,
        digest: verifiedRecipe.digest,
      } : null,
      validation,
    },
    setup,
    action,
    expectedInvariant,
    mutationToKill,
    requiredObservations,
    unknowns,
    readyForExecution: executionReady,
  };

  return deepFreeze({
    ...body,
    specSha256: hashBody(body),
  });
}

export function validateTestSpecification(spec) {
  if (!spec?.specSha256) throw new TypeError('test specification required');
  const { specSha256, ...body } = structuredClone(spec);
  if (hashBody(body) !== specSha256) throw new Error('test specification hash mismatch');

  const sections = [
    ['setup', spec.setup, 'items'],
    ['action', spec.action, 'value'],
    ['expectedInvariant', spec.expectedInvariant, 'value'],
    ['requiredObservations', spec.requiredObservations, 'items'],
  ];

  for (const [name, section, payload] of sections) {
    if (!section || !['known', 'unknown'].includes(section.state)) {
      throw new Error(`invalid ${name} state`);
    }
    if (section.state === 'known') {
      const value = section[payload];
      const hasPayload = Array.isArray(value) ? value.length > 0 : nonEmptyString(value);
      if (!hasPayload || !Array.isArray(section.provenance) || !section.provenance.length) {
        throw new Error(`known ${name} requires payload and provenance`);
      }
    }
  }

  if (!Array.isArray(spec.origin?.evidenceIds) || spec.origin.evidenceIds.length === 0) {
    throw new Error('test specification requires origin evidence IDs');
  }

  if (!spec.mutationToKill || !['known', 'unknown'].includes(spec.mutationToKill.state)) {
    throw new Error('invalid mutationToKill state');
  }
  if (spec.mutationToKill.state === 'known') {
    if (!nonEmptyString(spec.mutationToKill.mutationId)
      || !nonEmptyString(spec.mutationToKill.mutatorId)
      || !Array.isArray(spec.mutationToKill.provenance)
      || spec.mutationToKill.provenance.length === 0) {
      throw new Error('known mutationToKill requires IDs and provenance');
    }
  } else if (spec.mutationToKill.mutationId !== null || spec.mutationToKill.mutatorId !== null) {
    throw new Error('unknown mutationToKill must not carry mutation IDs');
  }

  const survivingMutant = spec.origin?.reason === 'surviving-mutant';
  const expectedUnknowns = [];
  if (spec.setup.state === 'unknown') expectedUnknowns.push('setup');
  if (spec.action.state === 'unknown') expectedUnknowns.push('action');
  if (spec.expectedInvariant.state === 'unknown') expectedUnknowns.push('expectedInvariant');
  if (spec.mutationToKill.state === 'unknown') expectedUnknowns.push('mutationToKill');
  if (spec.requiredObservations.state === 'unknown') expectedUnknowns.push('requiredObservations');

  if (stableJson(spec.unknowns) !== stableJson(expectedUnknowns)) {
    throw new Error('unknowns list is inconsistent with section states');
  }

  const expectedReady = spec.setup.state === 'known'
    && spec.action.state === 'known'
    && spec.expectedInvariant.state === 'known'
    && spec.requiredObservations.state === 'known'
    && (!survivingMutant || spec.mutationToKill?.state === 'known');

  if (Boolean(spec.readyForExecution) !== expectedReady) {
    throw new Error('readyForExecution is inconsistent with specification completeness');
  }

  return spec;
}
