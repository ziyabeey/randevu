import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const PY = String.raw`
import ast, hashlib, json, sys

path = sys.argv[1]
text = sys.stdin.read()
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

# Conservative module-level fallback: only emit a pseudo-unit when the file has
# no function/async-function units at all, but does contain executable top-level
# statements. Imports and a leading module docstring alone do not create a unit.
if not out:
    executable = []
    for index, node in enumerate(tree.body):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if (
            index == 0
            and isinstance(node, ast.Expr)
            and isinstance(getattr(node, "value", None), ast.Constant)
            and isinstance(node.value.value, str)
        ):
            continue
        executable.append(node)

    if executable:
        segments = [ast.get_source_segment(text, node) or "" for node in executable]
        definition = "\n".join(segment for segment in segments if segment)
        start_line = min(node.lineno for node in executable)
        end_line = max(getattr(node, "end_lineno", node.lineno) for node in executable)
        out.append({
            "id": f"{path}::<module>@{start_line}",
            "language": "python",
            "kind": "Module",
            "path": path,
            "symbol": "<module>",
            "startLine": start_line,
            "endLine": end_line,
            "definition": definition,
            "body": definition,
            "digest": hashlib.sha256(definition.encode()).hexdigest(),
        })

print(json.dumps(out))
`;

const PY_BATCH = String.raw`
import ast, hashlib, json, sys

payload = json.load(sys.stdin)
results = []
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

    if not out:
        executable = []
        for index, node in enumerate(tree.body):
            if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if (
                index == 0
                and isinstance(node, ast.Expr)
                and isinstance(getattr(node, "value", None), ast.Constant)
                and isinstance(node.value.value, str)
            ):
                continue
            executable.append(node)

        if executable:
            segments = [ast.get_source_segment(text, node) or "" for node in executable]
            definition = "\n".join(segment for segment in segments if segment)
            start_line = min(node.lineno for node in executable)
            end_line = max(getattr(node, "end_lineno", node.lineno) for node in executable)
            out.append({
                "id": f"{path}::<module>@{start_line}",
                "language": "python",
                "kind": "Module",
                "path": path,
                "symbol": "<module>",
                "startLine": start_line,
                "endLine": end_line,
                "definition": definition,
                "body": definition,
                "digest": hashlib.sha256(definition.encode()).hexdigest(),
            })

    return out

for item in payload.get("files", []):
    path = str(item.get("path", "unknown.py"))
    text = str(item.get("text", ""))
    try:
        results.append({"path": path, "units": extract(path, text)})
    except Exception as error:
        errors.append({"path": path, "error": str(error)})

print(json.dumps({"results": results, "errors": errors}))
`;

function runPython(command, text, path) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-c', PY, path], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(out || '[]'));
      else reject(Object.assign(new Error(err.trim() || `${command} exited ${code}`), { code }));
    });
    child.stdin.end(text);
  });
}

export async function extractPythonUnits(text, {
  path = 'unknown.py',
  executables = ['python3', 'python'],
} = {}) {
  let last = null;
  for (const command of executables) {
    try {
      return await runPython(command, text, path);
    } catch (error) {
      last = error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw last ?? new Error('Python interpreter unavailable');
}


function runPythonBatch(command, files) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-c', PY_BATCH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(out || '{"results":[],"errors":[]}'));
      else reject(Object.assign(new Error(err.trim() || `${command} exited ${code}`), { code }));
    });
    child.stdin.end(JSON.stringify({ files }));
  });
}

export async function extractPythonUnitsBatch(files, {
  executables = ['python3', 'python'],
} = {}) {
  if (!Array.isArray(files)) throw new TypeError('Python batch files must be an array');
  const normalized = files.map((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') {
      throw new TypeError('Python batch entries require path and text strings');
    }
    return { path: file.path, text: file.text };
  });

  let last = null;
  for (const command of executables) {
    try {
      const result = await runPythonBatch(command, normalized);
      if (!Array.isArray(result?.results) || !Array.isArray(result?.errors)) {
        throw new Error('invalid Python batch response');
      }
      return result;
    } catch (error) {
      last = error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw last ?? new Error('Python interpreter unavailable');
}
