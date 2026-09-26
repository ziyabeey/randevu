import { createHash } from 'node:crypto';

import { normalizeScipIndex } from '../adapters/scip.mjs';
import { stableJson } from '../core/cache.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function rangeKey(range) {
  if (!range) return null;
  return {
    startLine: range.startLine,
    startCharacter: range.startCharacter,
    endLine: range.endLine,
    endCharacter: range.endCharacter,
  };
}

function canonicalOccurrence(occ) {
  return {
    symbol: occ.symbol,
    symbolRoles: occ.symbolRoles,
    range: rangeKey(occ.range),
    enclosingRange: rangeKey(occ.enclosingRange),
  };
}

function canonicalRelationship(rel) {
  return {
    symbol: rel.symbol,
    isReference: Boolean(rel.isReference),
    isImplementation: Boolean(rel.isImplementation),
    isTypeDefinition: Boolean(rel.isTypeDefinition),
    isDefinition: Boolean(rel.isDefinition),
  };
}

function canonicalSymbol(info) {
  return {
    symbol: info.symbol,
    displayName: info.displayName,
    kind: info.kind,
    enclosingSymbol: info.enclosingSymbol,
    relationships: [...info.relationships]
      .map(canonicalRelationship)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
  };
}

export function canonicalScipDocument(doc) {
  return {
    path: doc.path,
    language: doc.language,
    occurrences: [...doc.occurrences]
      .map(canonicalOccurrence)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    symbols: [...doc.symbols]
      .map(canonicalSymbol)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
  };
}

export function scipDocumentDigest(doc) {
  return sha256(stableJson(canonicalScipDocument(doc)));
}

export function mergeScipIndexes(inputs = []) {
  const docs = new Map();
  const duplicateDocuments = [];
  const conflicts = [];

  inputs.forEach((input, inputIndex) => {
    const normalized = normalizeScipIndex(input);
    for (const doc of normalized.documents) {
      const canonical = canonicalScipDocument(doc);
      const digest = sha256(stableJson(canonical));
      const previous = docs.get(doc.path);
      if (!previous) {
        docs.set(doc.path, {
          doc: canonical,
          digest,
          sources: [inputIndex],
        });
        continue;
      }

      if (previous.digest === digest) {
        previous.sources.push(inputIndex);
        duplicateDocuments.push({
          path: doc.path,
          digest,
          sources: [...previous.sources],
        });
        continue;
      }

      conflicts.push({
        path: doc.path,
        existingDigest: previous.digest,
        incomingDigest: digest,
        existingSources: [...previous.sources],
        incomingSource: inputIndex,
      });
    }
  });

  return Object.freeze({
    index: Object.freeze({
      metadata: { merged: true, sourceCount: inputs.length },
      documents: Object.freeze(
        [...docs.values()]
          .map((x) => Object.freeze(x.doc))
          .sort((a, b) => a.path.localeCompare(b.path)),
      ),
    }),
    duplicateDocuments: Object.freeze(duplicateDocuments),
    conflicts: Object.freeze(conflicts),
  });
}

function documentMap(input) {
  const normalized = normalizeScipIndex(input);
  return new Map(normalized.documents.map((doc) => {
    const canonical = canonicalScipDocument(doc);
    return [canonical.path, {
      digest: sha256(stableJson(canonical)),
      doc: canonical,
    }];
  }));
}

export function compareScipDocumentEvidence(expected, actual) {
  const a = documentMap(expected);
  const b = documentMap(actual);

  const missing = [...a.keys()].filter((path) => !b.has(path)).sort();
  const extra = [...b.keys()].filter((path) => !a.has(path)).sort();
  const mismatched = [...a.keys()]
    .filter((path) => b.has(path) && a.get(path).digest !== b.get(path).digest)
    .sort()
    .map((path) => ({
      path,
      expectedDigest: a.get(path).digest,
      actualDigest: b.get(path).digest,
    }));

  return Object.freeze({
    expectedDocuments: a.size,
    actualDocuments: b.size,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    mismatched: Object.freeze(mismatched),
    exact: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
  });
}
