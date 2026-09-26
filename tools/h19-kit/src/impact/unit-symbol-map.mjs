import { evidence } from '../core/contracts.mjs';

function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function unitRange(unit) {
  const start = Math.max(0, Number(unit.startLine ?? 1) - 1);
  const end = Math.max(start, Number(unit.endLine ?? unit.startLine ?? 1) - 1);
  return { startLine: start, endLine: end };
}

function contains(range, unit) {
  if (!range) return false;
  return range.startLine <= unit.startLine && range.endLine >= unit.endLine;
}

function definitionNearUnit(range, unit, tolerance = 2) {
  if (!range) return false;
  return range.startLine >= unit.startLine
    && range.startLine <= Math.min(unit.endLine, unit.startLine + tolerance);
}

function span(range) {
  if (!range) return Number.POSITIVE_INFINITY;
  return Math.max(0, range.endLine - range.startLine);
}

export function symbolsForSemanticUnits(graph, units = [], {
  definitionLineTolerance = 2,
} = {}) {
  const matches = [];
  const symbols = new Set();
  const unmatched = [];

  for (const unit of units) {
    const path = normalizePath(unit.path);
    const uRange = unitRange(unit);
    const candidates = [];

    for (const node of graph?.nodes ?? []) {
      if (
        unit.language === 'python'
        && unit.kind === 'Module'
        && unit.symbol === '<module>'
        && node.kind === 'module'
        && (node.definitions ?? []).some((definition) => normalizePath(definition.path) === path)
      ) {
        const definition = (node.definitions ?? []).find((item) => normalizePath(item.path) === path);
        candidates.push({
          symbol: node.symbol,
          mode: 'python-module',
          rank: -1,
          span: 0,
          definition,
        });
      }
      for (const definition of node.definitions ?? []) {
        if (normalizePath(definition.path) !== path) continue;

        const enclosing = definition.enclosingRange ?? null;
        const direct = definition.range ?? null;
        if (contains(enclosing, uRange)) {
          candidates.push({
            symbol: node.symbol,
            mode: 'enclosing-range',
            rank: 0,
            span: span(enclosing),
            definition,
          });
        } else if (definitionNearUnit(direct, uRange, definitionLineTolerance)) {
          candidates.push({
            symbol: node.symbol,
            mode: 'definition-near-start',
            rank: 1,
            span: span(direct),
            definition,
          });
        }
      }
    }

    candidates.sort((a, b) => a.rank - b.rank || a.span - b.span || a.symbol.localeCompare(b.symbol));
    const best = candidates[0] ?? null;
    if (!best) {
      unmatched.push(unit.id ?? `${path}:${unit.startLine ?? '?'}`);
      matches.push(Object.freeze({
        unitId: unit.id ?? null,
        path,
        symbol: null,
        mode: 'unmatched',
        candidates: [],
      }));
      continue;
    }

    symbols.add(best.symbol);
    matches.push(Object.freeze({
      unitId: unit.id ?? null,
      path,
      symbol: best.symbol,
      mode: best.mode,
      candidates: candidates.map((x) => ({
        symbol: x.symbol,
        mode: x.mode,
        rank: x.rank,
        span: x.span,
      })),
    }));
  }

  return Object.freeze({
    symbols: [...symbols].sort(),
    matches,
    unmatched,
  });
}

export function unitSymbolMappingEvidence(mapping) {
  return evidence(
    'impact.symbol_mapping_gap.present',
    mapping.unmatched.length > 0 ? 'present' : 'absent',
    {
      matchedCount: mapping.matches.length - mapping.unmatched.length,
      unmatchedCount: mapping.unmatched.length,
      unmatched: mapping.unmatched,
    },
  );
}
