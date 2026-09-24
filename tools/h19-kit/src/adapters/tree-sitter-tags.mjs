import { spawn } from 'node:child_process';
import { CodeGraph } from '../graph/code-graph.mjs';

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

export function parseTreeSitterTags(output) {
  const rows = [];
  let currentPath = null;

  for (const raw of String(output ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (!raw.includes('|')) {
      currentPath = raw.trim();
      continue;
    }
    const match = raw.match(/^\s*(.*?)\s*\|\s*(\S+)\s+(def|ref)\s+\((\d+),\s*(\d+)\)\s+-\s+\((\d+),\s*(\d+)\)/);
    if (!match || !currentPath) continue;
    rows.push({
      path: currentPath,
      name: match[1].trim(),
      kind: match[2],
      role: match[3] === 'def' ? 'definition' : 'reference',
      range: {
        start: { row: Number(match[4]), column: Number(match[5]) },
        end: { row: Number(match[6]), column: Number(match[7]) },
      },
    });
  }
  return rows;
}

export function treeSitterTagsGraph(rows, { source = 'tree-sitter-tags' } = {}) {
  const graph = new CodeGraph();
  for (const row of rows) {
    const docId = `doc:${row.path}`;
    const symbolId = `syntax-symbol:${row.kind}:${row.name}`;
    graph.addNode(docId, 'document', { path: row.path, source });
    graph.addNode(symbolId, 'syntax-symbol', {
      name: row.name,
      kind: row.kind,
      precision: 'syntax-only',
      source,
    });
    graph.addEdge(docId, symbolId, row.role === 'definition' ? 'tree-sitter:defines' : 'tree-sitter:references', {
      range: row.range,
      precision: 'syntax-only',
    });
  }
  return graph;
}

export async function treeSitterTags({
  files,
  cwd = process.cwd(),
  executable = 'tree-sitter',
  scope = null,
} = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new TypeError('files are required');
  const args = ['tags'];
  if (scope) args.push('--scope', scope);
  args.push(...files);
  const output = await exec(executable, args, cwd);
  return treeSitterTagsGraph(parseTreeSitterTags(output));
}
