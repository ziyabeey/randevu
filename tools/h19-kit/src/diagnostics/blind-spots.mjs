import { createHash } from 'node:crypto';

import { stableJson } from '../core/cache.mjs';

const CATEGORIES = new Set([
  'extraction-error',
  'semantic-unit-absence',
  'semantic-unit-symbol-unmatched',
  'impact-unknown',
]);

const sha256 = (value) =>
  createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');

const normalizePath = (value) => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');

const uniqueSorted = (values) => [...new Set(values.filter(Boolean).map(String))].sort();

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function blindSpotRecord({
  category,
  subject,
  evidence,
  sourceRevision = null,
  reason,
}) {
  if (!CATEGORIES.has(category)) throw new Error(`unsupported blind-spot category: ${category}`);
  const keyBody = {
    schemaVersion: 1,
    category,
    subject,
  };
  const blindSpotId = sha256(keyBody);
  const body = {
    schemaVersion: 1,
    kind: 'h19-blind-spot-candidate',
    blindSpotId,
    category,
    subject,
    state: 'candidate',
    reason,
    sourceRevision,
    evidence,
    authority: 'diagnostic-only',
  };
  return freeze({
    ...body,
    observationSha256: sha256(body),
  });
}

function validateInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.units) || !Array.isArray(inventory.errors)) {
    throw new TypeError('repository inventory with units/errors required');
  }
}

function validateImpactEntry(entry) {
  if (!entry || typeof entry.scopeId !== 'string' || !entry.scopeId.trim() || !entry.impact) {
    throw new TypeError('impact entry requires scopeId and impact');
  }
  const { impact } = entry;
  if (!Array.isArray(impact.changedFiles)
    || !Array.isArray(impact.unknowns)
    || !Array.isArray(impact.symbolImpact?.mapping?.matches)
    || !Array.isArray(impact.symbolImpact?.mapping?.unmatched)) {
    throw new TypeError('unsupported change-impact result');
  }
}

function countByCategory(spots) {
  return Object.fromEntries(
    [...CATEGORIES].sort().map((category) => [
      category,
      spots.filter((spot) => spot.category === category).length,
    ]),
  );
}

function sealLedger({
  sourceRevision = null,
  focusFiles,
  impactScopes,
  spots,
}) {
  const body = {
    schemaVersion: 1,
    kind: 'h19-blind-spot-ledger',
    sourceRevision,
    focusFiles,
    impactScopes,
    spots,
    counts: {
      total: spots.length,
      byCategory: countByCategory(spots),
    },
    semantics: {
      state: 'candidate',
      claimBoundary: 'A blind-spot candidate is an observed H19 evidence/coverage limitation, not proof of a product defect.',
      absenceBoundary: 'No candidate is not proof that H19 has complete knowledge.',
    },
  };
  return freeze({
    ...body,
    ledgerSha256: sha256(body),
  });
}

export function detectH19BlindSpots({
  inventory,
  focusFiles = [],
  impacts = [],
  sourceRevision = null,
} = {}) {
  validateInventory(inventory);
  if (!Array.isArray(focusFiles) || !Array.isArray(impacts)) {
    throw new TypeError('focusFiles and impacts must be arrays');
  }

  const normalizedFocus = uniqueSorted(focusFiles.map(normalizePath));
  const errors = new Map(
    inventory.errors.map((row) => [normalizePath(row.path), String(row.error ?? 'unknown extraction error')]),
  );
  const unitsByPath = new Map();
  for (const unit of inventory.units) {
    const p = normalizePath(unit.path);
    if (!unitsByPath.has(p)) unitsByPath.set(p, []);
    unitsByPath.get(p).push(unit);
  }

  const spots = [];

  for (const path of normalizedFocus) {
    if (errors.has(path)) {
      spots.push(blindSpotRecord({
        category: 'extraction-error',
        sourceRevision,
        subject: { path },
        reason: 'focused source could not be converted into semantic evidence',
        evidence: {
          path,
          error: errors.get(path),
        },
      }));
      continue;
    }

    const units = unitsByPath.get(path) ?? [];
    if (units.length === 0) {
      spots.push(blindSpotRecord({
        category: 'semantic-unit-absence',
        sourceRevision,
        subject: { path },
        reason: 'focused source produced zero semantic units',
        evidence: {
          path,
          semanticUnitCount: 0,
        },
      }));
    }
  }

  const impactScopes = [];
  for (const entry of impacts) {
    validateImpactEntry(entry);
    const scopeId = entry.scopeId.trim();
    const impact = entry.impact;
    impactScopes.push(scopeId);

    for (const match of impact.symbolImpact.mapping.matches) {
      if (match?.symbol != null && match?.mode !== 'unmatched') continue;
      const path = normalizePath(match?.path);
      const unitId = match?.unitId == null ? null : String(match.unitId);
      spots.push(blindSpotRecord({
        category: 'semantic-unit-symbol-unmatched',
        sourceRevision,
        subject: {
          scopeId,
          path,
          unitId,
        },
        reason: 'semantic unit exists but no symbol-graph mapping was available',
        evidence: {
          scopeId,
          path,
          unitId,
          mappingMode: match?.mode ?? 'unmatched',
        },
      }));
    }

    for (const unknown of uniqueSorted(impact.unknowns)) {
      spots.push(blindSpotRecord({
        category: 'impact-unknown',
        sourceRevision,
        subject: {
          scopeId,
          unknown,
        },
        reason: 'change-impact analysis retained an explicit unknown',
        evidence: {
          scopeId,
          unknown,
          changedFiles: [...impact.changedFiles],
          safeToNarrow: impact.safeToNarrow === true,
        },
      }));
    }
  }

  const deduped = new Map();
  for (const spot of spots) {
    const previous = deduped.get(spot.blindSpotId);
    if (previous && previous.observationSha256 !== spot.observationSha256) {
      throw new Error(`conflicting blind-spot observations: ${spot.blindSpotId}`);
    }
    deduped.set(spot.blindSpotId, spot);
  }

  const ordered = [...deduped.values()].sort((a, b) =>
    a.category.localeCompare(b.category)
    || stableJson(a.subject).localeCompare(stableJson(b.subject)));

  return sealLedger({
    sourceRevision,
    focusFiles: normalizedFocus,
    impactScopes: uniqueSorted(impactScopes),
    spots: ordered,
  });
}

export function validateH19BlindSpotLedger(ledger) {
  if (!ledger?.ledgerSha256) throw new TypeError('blind-spot ledger required');
  const { ledgerSha256, ...body } = structuredClone(ledger);
  if (sha256(body) !== ledgerSha256) throw new Error('blind-spot ledger digest mismatch');
  if (ledger.schemaVersion !== 1 || ledger.kind !== 'h19-blind-spot-ledger') {
    throw new Error('unsupported blind-spot ledger');
  }
  if (!Array.isArray(ledger.spots)
    || !Array.isArray(ledger.focusFiles)
    || !Array.isArray(ledger.impactScopes)) {
    throw new Error('invalid blind-spot ledger shape');
  }
  for (const spot of ledger.spots) {
    if (!CATEGORIES.has(spot.category)
      || spot.kind !== 'h19-blind-spot-candidate'
      || spot.state !== 'candidate'
      || spot.authority !== 'diagnostic-only') {
      throw new Error('invalid blind-spot record');
    }
    const { observationSha256, ...spotBody } = structuredClone(spot);
    if (sha256(spotBody) !== observationSha256) throw new Error('blind-spot observation digest mismatch');
    const expectedId = sha256({
      schemaVersion: 1,
      category: spot.category,
      subject: spot.subject,
    });
    if (spot.blindSpotId !== expectedId) throw new Error('blind-spot identity mismatch');
  }
  if (ledger.counts?.total !== ledger.spots.length
    || stableJson(ledger.counts?.byCategory) !== stableJson(countByCategory(ledger.spots))) {
    throw new Error('blind-spot ledger count mismatch');
  }
  return ledger;
}

export function compareH19BlindSpotLedgers(before, after) {
  validateH19BlindSpotLedger(before);
  validateH19BlindSpotLedger(after);

  const beforeById = new Map(before.spots.map((spot) => [spot.blindSpotId, spot]));
  const afterById = new Map(after.spots.map((spot) => [spot.blindSpotId, spot]));

  const resolved = [...beforeById.values()]
    .filter((spot) => !afterById.has(spot.blindSpotId))
    .map((spot) => spot.blindSpotId)
    .sort();
  const persistent = [...beforeById.values()]
    .filter((spot) => afterById.has(spot.blindSpotId))
    .map((spot) => spot.blindSpotId)
    .sort();
  const introduced = [...afterById.values()]
    .filter((spot) => !beforeById.has(spot.blindSpotId))
    .map((spot) => spot.blindSpotId)
    .sort();

  const comparable = before.sourceRevision === after.sourceRevision
    && stableJson(before.focusFiles) === stableJson(after.focusFiles)
    && stableJson(before.impactScopes) === stableJson(after.impactScopes);

  const body = {
    schemaVersion: 1,
    kind: 'h19-blind-spot-comparison',
    beforeLedgerSha256: before.ledgerSha256,
    afterLedgerSha256: after.ledgerSha256,
    comparable,
    resolved,
    persistent,
    introduced,
    counts: {
      before: before.spots.length,
      after: after.spots.length,
      resolved: resolved.length,
      persistent: persistent.length,
      introduced: introduced.length,
    },
    blindSpotReductionRate: comparable && before.spots.length > 0
      ? resolved.length / before.spots.length
      : null,
    claimBoundary: 'Reduction measures disappearance of the same deterministic diagnostic candidates, not population-level model correctness.',
  };

  return freeze({
    ...body,
    comparisonSha256: sha256(body),
  });
}
