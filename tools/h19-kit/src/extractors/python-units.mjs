import { spawn } from 'node:child_process';

const PY_BATCH = String.raw`
import ast, hashlib, json, sys

payload = json.load(sys.stdin)
entries = payload.get("entries", [])
include_module_units = bool(payload.get("includeModuleUnits", False))
units = []
errors = []

def extract(path, text):
    tree = ast.parse(text, filename=path)
    lines = text.splitlines(True)
    out = []

    def source_segment(node):
        if not hasattr(node, "end_lineno") or node.end_lineno is None:
            return ""
        start = sum(len(x) for x in lines[:node.lineno-1])
        end = sum(len(x) for x in lines[:node.end_lineno-1]) + node.end_col_offset
        return text[start:end]

    class V(ast.NodeVisitor):
        def __init__(self):
            self.stack = []

        def visit_ClassDef(self, node):
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def _function(self, node, kind):
            symbol = ".".join(self.stack + [node.name])
            definition = source_segment(node)
            out.append({
                "id": f"{path}::{symbol}@{node.lineno}",
                "language": "python",
                "kind": kind,
                "path": path,
                "symbol": symbol,
                "startLine": node.lineno,
                "endLine": getattr(node, "end_lineno", node.lineno),
                "definition": definition,
                "body": definition,
                "digest": hashlib.sha256(definition.encode()).hexdigest(),
            })
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_FunctionDef(self, node):
            self._function(node, "FunctionDef")

        def visit_AsyncFunctionDef(self, node):
            self._function(node, "AsyncFunctionDef")

    V().visit(tree)
    if include_module_units and not out:
        end_line = max(1, len(text.splitlines()))
        out.append({
            "id": f"{path}::<module>@1",
            "language": "python",
            "kind": "Module",
            "path": path,
            "symbol": "<module>",
            "startLine": 1,
            "endLine": end_line,
            "definition": text,
            "body": text,
            "digest": hashlib.sha256(text.encode()).hexdigest(),
        })
    return out

for entry in entries:
    path = str(entry.get("path", "unknown.py"))
    text = str(entry.get("text", ""))
    try:
        units.extend(extract(path, text))
    except Exception as error:
        errors.append({
            "path": path,
            "error": f"{type(error).__name__}: {error}",
        })

print(json.dumps({
    "units": units,
    "errors": errors,
    "filesAttempted": len(entries),
    "filesParsed": len(entries) - len(errors),
}))
`;

function runPythonBatch(command, entries, includeModuleUnits) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-c', PY_BATCH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(out || '{}'));
      else reject(Object.assign(new Error(err.trim() || `${command} exited ${code}`), { code }));
    });
    child.stdin.end(JSON.stringify({ entries, includeModuleUnits }));
  });
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Python batch entries must be an array');
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`Python batch entry ${index} must be an object`);
    if (typeof entry.path !== 'string' || !entry.path) throw new TypeError(`Python batch entry ${index} path required`);
    if (typeof entry.text !== 'string') throw new TypeError(`Python batch entry ${index} text required`);
    return { path: entry.path, text: entry.text };
  });
}

export async function extractPythonUnitsBatch(entries, {
  executables = ['python3', 'python'],
  includeModuleUnits = false,
} = {}) {
  const normalized = normalizeEntries(entries);
  if (!normalized.length) {
    return Object.freeze({
      units: Object.freeze([]),
      errors: Object.freeze([]),
      filesAttempted: 0,
      filesParsed: 0,
      interpreter: null,
    });
  }

  let last = null;
  for (const command of executables) {
    try {
      const result = await runPythonBatch(command, normalized, Boolean(includeModuleUnits));
      return Object.freeze({
        units: Object.freeze(result.units ?? []),
        errors: Object.freeze(result.errors ?? []),
        filesAttempted: Number(result.filesAttempted ?? normalized.length),
        filesParsed: Number(result.filesParsed ?? 0),
        interpreter: command,
      });
    } catch (error) {
      last = error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw last ?? new Error('Python interpreter unavailable');
}

export async function extractPythonUnits(text, {
  path = 'unknown.py',
  executables = ['python3', 'python'],
} = {}) {
  const result = await extractPythonUnitsBatch([{ path, text }], {
    executables,
    includeModuleUnits: false,
  });
  if (result.errors.length) throw new Error(result.errors[0].error);
  return [...result.units];
}
