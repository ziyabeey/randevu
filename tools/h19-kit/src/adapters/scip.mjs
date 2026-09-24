import { spawn } from 'node:child_process';
import { CodeGraph } from '../graph/code-graph.mjs';

const roles = Object.freeze({
  definition: 0x1,
  import: 0x2,
  write: 0x4,
  read: 0x8,
  generated: 0x10,
  forwardDefinition: 0x40,
});

const field = (obj, snake, camel) => obj?.[snake] ?? obj?.[camel];

function exec(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (x) => { stdout += x; });
    child.stderr.on('data', (x) => { stderr += x; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout)
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 2000)}`)));
  });
}

function rangeOf(occurrence) {
  const single = field(occurrence, 'single_line_range', 'singleLineRange');
  if (single) {
    const line = Number(single.line ?? 0);
    const start = Number(field(single, 'start_character', 'startCharacter') ?? 0);
    const end = Number(field(single, 'end_character', 'endCharacter') ?? start);
    return [line, start, end];
  }

  const multi = field(occurrence, 'multi_line_range', 'multiLineRange');
  if (multi) {
    return [
      Number(field(multi, 'start_line', 'startLine') ?? 0),
      Number(field(multi, 'start_character', 'startCharacter') ?? 0),
      Number(field(multi, 'end_line', 'endLine') ?? 0),
      Number(field(multi, 'end_character', 'endCharacter') ?? 0),
    ];
  }

  const range = occurrence?.range;
  return Array.isArray(range) ? [...range] : null;
}

function enclosingRangeOf(occurrence) {
  const single = field(occurrence, 'single_line_enclosing_range', 'singleLineEnclosingRange');
  if (single) {
    const line = Number(single.line ?? 0);
    const start = Number(field(single, 'start_character', 'startCharacter') ?? 0);
    const end = Number(field(single, 'end_character', 'endCharacter') ?? start);
    return [line, start, end];
  }

  const multi = field(occurrence, 'multi_line_enclosing_range', 'multiLineEnclosingRange');
  if (multi) {
    return [
      Number(field(multi, 'start_line', 'startLine') ?? 0),
      Number(field(multi, 'start_character', 'startCharacter') ?? 0),
      Number(field(multi, 'end_line', 'endLine') ?? 0),
      Number(field(multi, 'end_character', 'endCharacter') ?? 0),
    ];
  }

  const range = field(occurrence, 'enclosing_range', 'enclosingRange');
  return Array.isArray(range) ? [...range] : null;
}

function points(range) {
  if (!Array.isArray(range)) return null;
  if (range.length === 3) {
    return { start: [range[0], range[1]], end: [range[0], range[2]] };
  }
  if (range.length === 4) {
    return { start: [range[0], range[1]], end: [range[2], range[3]] };
  }
  return null;
}

function cmp(a, b) {
  return a[0] - b[0] || a[1] - b[1];
}

function containsRange(outer, inner) {
  const o = points(outer), i = points(inner);
  if (!o || !i) return false;
  return cmp(o.start, i.start) <= 0 && cmp(o.end, i.end) >= 0;
}

export function normalizeScipIndex(index, { source = 'scip' } = {}) {
  const graph = new CodeGraph();
  const documents = index?.documents ?? index?.Documents ?? [];

  for (const doc of documents) {
    const path = field(doc, 'relative_path', 'relativePath');
    if (!path) continue;
    const docId = `doc:${path}`;
    graph.addNode(docId, 'document', {
      path,
      language: doc.language ?? null,
      source,
    });

    for (const info of doc.symbols ?? []) {
      const symbol = info.symbol;
      if (!symbol) continue;
      const symbolId = `symbol:${symbol}`;
      graph.addNode(symbolId, 'symbol', {
        symbol,
        displayName: field(info, 'display_name', 'displayName') ?? null,
        source,
      });
      for (const rel of info.relationships ?? []) {
        const target = rel.symbol;
        if (!target) continue;
        const targetId = `symbol:${target}`;
        graph.addNode(targetId, 'symbol', { symbol: target, source });
        const kinds = [
          ['definition', field(rel, 'is_definition', 'isDefinition')],
          ['reference', field(rel, 'is_reference', 'isReference')],
          ['implementation', field(rel, 'is_implementation', 'isImplementation')],
          ['type-definition', field(rel, 'is_type_definition', 'isTypeDefinition')],
        ].filter(([, on]) => Boolean(on));
        for (const [kind] of kinds) graph.addEdge(symbolId, targetId, `scip:${kind}`);
      }
    }

    const occurrences = doc.occurrences ?? [];
    const definitions = [];

    for (const occurrence of occurrences) {
      const symbol = occurrence.symbol;
      if (!symbol) continue;
      const symbolId = `symbol:${symbol}`;
      const roleValue = Number(field(occurrence, 'symbol_roles', 'symbolRoles') ?? 0);
      const definition = (roleValue & roles.definition) !== 0;
      const range = rangeOf(occurrence);
      graph.addNode(symbolId, 'symbol', { symbol, source });
      graph.addEdge(docId, symbolId, definition ? 'scip:defines' : 'scip:references', {
        range,
        roles: {
          definition,
          import: (roleValue & roles.import) !== 0,
          write: (roleValue & roles.write) !== 0,
          read: (roleValue & roles.read) !== 0,
          generated: (roleValue & roles.generated) !== 0,
          forwardDefinition: (roleValue & roles.forwardDefinition) !== 0,
        },
      });
      if (definition) {
        definitions.push({
          symbolId,
          range: enclosingRangeOf(occurrence) ?? range,
        });
      }
    }

    for (const occurrence of occurrences) {
      const symbol = occurrence.symbol;
      if (!symbol) continue;
      const roleValue = Number(field(occurrence, 'symbol_roles', 'symbolRoles') ?? 0);
      if ((roleValue & roles.definition) !== 0) continue;
      const range = rangeOf(occurrence);
      if (!range) continue;

      const owners = definitions.filter((def) => def.range && containsRange(def.range, range));
      if (!owners.length) continue;
      owners.sort((a, b) => {
        const pa = points(a.range), pb = points(b.range);
        const sa = pa ? (pa.end[0] - pa.start[0]) * 1e6 + (pa.end[1] - pa.start[1]) : Number.MAX_SAFE_INTEGER;
        const sb = pb ? (pb.end[0] - pb.start[0]) * 1e6 + (pb.end[1] - pb.start[1]) : Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });
      const owner = owners[0].symbolId;
      const target = `symbol:${symbol}`;
      if (owner !== target) graph.addEdge(owner, target, 'scip:uses', { range, document: path });
    }
  }

  return graph;
}

export async function loadScipIndex({
  indexPath = 'index.scip',
  cwd = process.cwd(),
  executable = 'scip',
} = {}) {
  const raw = await exec(executable, ['print', '--json', indexPath], cwd);
  return JSON.parse(raw);
}

export async function scipGraph(options = {}) {
  const index = await loadScipIndex(options);
  return normalizeScipIndex(index, { source: `scip:${options.indexPath ?? 'index.scip'}` });
}

export function scipImpact(graph, changedPaths = []) {
  const changedDocs = changedPaths.map((path) => `doc:${path}`);
  const definedSymbols = new Set();

  for (const docId of changedDocs) {
    for (const edge of graph.outgoing(docId, 'scip:defines')) definedSymbols.add(edge.to);
  }

  const affectedDocs = new Set(changedDocs);
  for (const symbolId of definedSymbols) {
    for (const edge of graph.incoming(symbolId, 'scip:references')) affectedDocs.add(edge.from);
  }

  return {
    changedDocuments: changedDocs,
    changedSymbols: [...definedSymbols].sort(),
    affectedDocuments: [...affectedDocs].sort(),
  };
}
