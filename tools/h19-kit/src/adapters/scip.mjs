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
  const range = occurrence?.range;
  return Array.isArray(range) ? [...range] : null;
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

    for (const occurrence of doc.occurrences ?? []) {
      const symbol = occurrence.symbol;
      if (!symbol) continue;
      const symbolId = `symbol:${symbol}`;
      const roleValue = Number(field(occurrence, 'symbol_roles', 'symbolRoles') ?? 0);
      graph.addNode(symbolId, 'symbol', { symbol, source });
      const kind = (roleValue & roles.definition) !== 0 ? 'defines' : 'references';
      graph.addEdge(docId, symbolId, `scip:${kind}`, {
        range: rangeOf(occurrence),
        roles: {
          definition: (roleValue & roles.definition) !== 0,
          import: (roleValue & roles.import) !== 0,
          write: (roleValue & roles.write) !== 0,
          read: (roleValue & roles.read) !== 0,
          generated: (roleValue & roles.generated) !== 0,
          forwardDefinition: (roleValue & roles.forwardDefinition) !== 0,
        },
      });
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
