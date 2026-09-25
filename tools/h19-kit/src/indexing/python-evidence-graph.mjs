import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sourceFiles } from '../repository/inventory.mjs';

const PYTHON_GRAPH = String.raw`
import ast, json, sys

payload = json.load(sys.stdin)
files = payload.get("files", [])
parsed = {}
modules = {}
module_paths = {}
definitions = {}
module_defs = {}

def norm_path(value):
    return str(value).replace("\\\\", "/").lstrip("./")

def module_name(file_path):
    p = norm_path(file_path)
    if p.endswith(".py"):
        p = p[:-3]
    if p.endswith("/__init__"):
        p = p[:-9]
    elif p == "__init__":
        p = ""
    return p.replace("/", ".").strip(".")

def symbol_for(module, qualname):
    return f"python {module or '<root>'}::{qualname}"

def module_symbol(module):
    return f"python {module or '<root>'}::<module>"

def rng(node):
    start_line = max(0, int(getattr(node, "lineno", 1)) - 1)
    start_col = max(0, int(getattr(node, "col_offset", 0)))
    end_line = max(start_line, int(getattr(node, "end_lineno", getattr(node, "lineno", 1))) - 1)
    end_col = max(0, int(getattr(node, "end_col_offset", start_col)))
    return {
        "startLine": start_line,
        "startCharacter": start_col,
        "endLine": end_line,
        "endCharacter": end_col,
    }

class DefinitionVisitor(ast.NodeVisitor):
    def __init__(self, module, file_path):
        self.module = module
        self.file_path = file_path
        self.stack = []

    def visit_ClassDef(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    def _function(self, node, kind):
        qualname = ".".join(self.stack + [node.name])
        symbol = symbol_for(self.module, qualname)
        record = {
            "symbol": symbol,
            "displayName": node.name,
            "kind": kind,
            "path": self.file_path,
            "range": rng(node),
            "qualname": qualname,
            "module": self.module,
        }
        definitions[symbol] = record
        module_defs.setdefault(self.module, {}).setdefault(node.name, []).append(symbol)
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    def visit_FunctionDef(self, node):
        self._function(node, "FunctionDef")

    def visit_AsyncFunctionDef(self, node):
        self._function(node, "AsyncFunctionDef")

for item in files:
    file_path = norm_path(item["path"])
    tree = ast.parse(item["text"], filename=file_path)
    module = module_name(file_path)
    parsed[file_path] = tree
    modules[file_path] = module
    module_paths[module] = file_path
    DefinitionVisitor(module, file_path).visit(tree)

nodes = {}

def is_test_path(file_path):
    p = "/" + norm_path(file_path).lower()
    base = p.rsplit("/", 1)[-1]
    return (
        "/test/" in p or "/tests/" in p or "/spec/" in p or "/specs/" in p
        or base.startswith("test_") or base.endswith("_test.py")
    )

def ensure(symbol, display_name="", kind=None):
    if symbol not in nodes:
        nodes[symbol] = {
            "symbol": symbol,
            "displayName": display_name,
            "kind": kind,
            "definitions": [],
            "references": [],
            "relationships": [],
        }
    else:
        if display_name and not nodes[symbol]["displayName"]:
            nodes[symbol]["displayName"] = display_name
        if kind is not None and nodes[symbol]["kind"] is None:
            nodes[symbol]["kind"] = kind
    return nodes[symbol]

def loc(file_path, node, definition=False, enclosing=None, imported=False):
    return {
        "path": file_path,
        "range": rng(node),
        "enclosingRange": rng(enclosing) if enclosing is not None else (rng(node) if definition else None),
        "roles": 1 if definition else (2 if imported else 8),
        "isTest": is_test_path(file_path),
        "isRead": not definition,
        "isWrite": False,
        "isImport": bool(imported),
    }

for module, file_path in module_paths.items():
    ms = module_symbol(module)
    mnode = ensure(ms, module or "<root>", "module")
    mnode["definitions"].append({
        "path": file_path,
        "range": {"startLine": 0, "startCharacter": 0, "endLine": 0, "endCharacter": 0},
        "enclosingRange": None,
        "roles": 1,
        "isTest": is_test_path(file_path),
        "isRead": False,
        "isWrite": False,
        "isImport": False,
    })

for record in definitions.values():
    node = ensure(record["symbol"], record["displayName"], record["kind"])
    node["definitions"].append({
        "path": record["path"],
        "range": record["range"],
        "enclosingRange": record["range"],
        "roles": 1,
        "isTest": is_test_path(record["path"]),
        "isRead": False,
        "isWrite": False,
        "isImport": False,
    })

def resolve_relative(current_module, level, target):
    parts = current_module.split(".") if current_module else []
    if level:
        parts = parts[:max(0, len(parts) - level)]
    if target:
        parts += target.split(".")
    return ".".join([p for p in parts if p])

class ReferenceVisitor(ast.NodeVisitor):
    def __init__(self, module, file_path):
        self.module = module
        self.file_path = file_path
        self.module_aliases = {}
        self.symbol_aliases = {}
        self.local_defs = module_defs.get(module, {})
        self.enclosing = []

    def current_enclosing(self):
        return self.enclosing[-1] if self.enclosing else None

    def add_ref(self, symbol, node, imported=False):
        if symbol not in nodes:
            return
        nodes[symbol]["references"].append(loc(
            self.file_path,
            node,
            definition=False,
            enclosing=self.current_enclosing(),
            imported=imported,
        ))

    def visit_Import(self, node):
        for alias in node.names:
            target = alias.name
            local = alias.asname or alias.name.split(".")[0]
            if target in module_paths:
                self.module_aliases[local] = target
                self.add_ref(module_symbol(target), node, imported=True)
            elif alias.name.split(".")[0] in module_paths:
                root = alias.name.split(".")[0]
                self.module_aliases[local] = root
                self.add_ref(module_symbol(root), node, imported=True)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        target_module = resolve_relative(self.module, int(node.level or 0), node.module or "")
        if target_module in module_paths:
            self.add_ref(module_symbol(target_module), node, imported=True)
        for alias in node.names:
            local = alias.asname or alias.name
            candidates = module_defs.get(target_module, {}).get(alias.name, [])
            if len(candidates) == 1:
                self.symbol_aliases[local] = candidates[0]
                self.add_ref(candidates[0], node, imported=True)
            submodule = f"{target_module}.{alias.name}" if target_module else alias.name
            if submodule in module_paths:
                self.module_aliases[local] = submodule
                self.add_ref(module_symbol(submodule), node, imported=True)
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        self.enclosing.append(node)
        self.generic_visit(node)
        self.enclosing.pop()

    def visit_AsyncFunctionDef(self, node):
        self.enclosing.append(node)
        self.generic_visit(node)
        self.enclosing.pop()

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            if node.id in self.symbol_aliases:
                self.add_ref(self.symbol_aliases[node.id], node)
            else:
                candidates = self.local_defs.get(node.id, [])
                if len(candidates) == 1:
                    self.add_ref(candidates[0], node)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name):
            target_module = self.module_aliases.get(node.value.id)
            if target_module:
                candidates = module_defs.get(target_module, {}).get(node.attr, [])
                if len(candidates) == 1:
                    self.add_ref(candidates[0], node)
        self.generic_visit(node)

for file_path, tree in parsed.items():
    ReferenceVisitor(modules[file_path], file_path).visit(tree)

for node in nodes.values():
    node["definitions"].sort(key=lambda x: (x["path"], x["range"]["startLine"], x["range"]["startCharacter"]))
    node["references"].sort(key=lambda x: (x["path"], x["range"]["startLine"], x["range"]["startCharacter"]))

print(json.dumps({
    "metadata": {
        "tool": "python-ast",
        "version": 1,
        "fileCount": len(files),
        "moduleCount": len(module_paths),
        "definitionCount": len(definitions),
    },
    "nodeCount": len(nodes),
    "nodes": sorted(nodes.values(), key=lambda x: x["symbol"]),
}, sort_keys=True))
`;

function run(command, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-c', PYTHON_GRAPH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout || '{}'));
        } catch (error) {
          reject(error);
        }
      } else {
        reject(Object.assign(
          new Error(stderr.trim() || `${command} exited ${code}`),
          { code },
        ));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function freezeLocation(value) {
  return Object.freeze({
    ...value,
    range: value.range ? Object.freeze({ ...value.range }) : null,
    enclosingRange: value.enclosingRange ? Object.freeze({ ...value.enclosingRange }) : null,
  });
}

function freezeGraph(graph) {
  const nodes = (graph.nodes ?? []).map((node) => Object.freeze({
    ...node,
    definitions: Object.freeze((node.definitions ?? []).map(freezeLocation)),
    references: Object.freeze((node.references ?? []).map(freezeLocation)),
    relationships: Object.freeze([...(node.relationships ?? [])].map((item) => Object.freeze({ ...item }))),
  }));
  return Object.freeze({
    metadata: Object.freeze({ ...(graph.metadata ?? {}) }),
    nodeCount: nodes.length,
    nodes: Object.freeze(nodes),
  });
}

export async function buildPythonEvidenceGraph({
  cwd = process.cwd(),
  executables = ['python3', 'python'],
} = {}) {
  const repoRoot = path.resolve(cwd);
  const files = (await sourceFiles(repoRoot)).filter((file) => file.endsWith('.py'));
  const payload = {
    files: await Promise.all(files.map(async (file) => ({
      path: file,
      text: await readFile(path.join(repoRoot, file), 'utf8'),
    }))),
  };

  let last = null;
  for (const command of executables) {
    try {
      const graph = freezeGraph(await run(command, payload));
      return Object.freeze({
        mode: 'python-ast',
        graph,
        provenance: Object.freeze({
          indexer: Object.freeze({ id: 'python-ast', version: '0.1' }),
          executable: command,
          graphSchemaVersion: 1,
        }),
        project: Object.freeze({
          sourceFiles: files.length,
          documentCount: files.length,
          nodeCount: graph.nodeCount,
        }),
      });
    } catch (error) {
      last = error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw last ?? new Error('Python interpreter unavailable');
}
