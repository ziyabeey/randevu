import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import ts from '@typescript/typescript6';
import { freezeCases } from './freeze.mjs';
import { m11Digest, m11SourceBlobSha, validateM11Inventory, validateM11SourcePath } from './m11-materializer.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (items) => [...new Set(items)].sort(compare);
const SHA1 = /^[a-f0-9]{40}$/;
const PROGRAM = /\.(?:[cm]?[jt]sx?)$/;
export const M11_CLOSURE_PROFILE = 'repository-file-inputs-v1';
export const M11_COMMON_CONTEXT = Object.freeze(['package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.worker.json', 'tsconfig.node.json',
  'vite.config.ts', 'wrangler.jsonc'].sort(compare));

// A complete Git file index is needed for negative lookups, not merely the
// subset of source bytes that happens to have been downloaded.
export function m11GitTreeSha(entries) {
  const root = new Map();
  for (const { path: p, mode, gitBlobSha } of entries) {
    assert(typeof p === 'string' && !p.includes('\\') && !p.includes('\0')
      && p.split('/').every((s) => s && s !== '.' && s !== '..'), 'invalid Git path');
    assert(['100644', '100755', '120000', '160000'].includes(mode) && SHA1.test(gitBlobSha), 'invalid Git entry');
    const parts = p.split('/'); let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (!parent.has(part)) parent.set(part, new Map());
      assert(parent.get(part) instanceof Map, 'Git file/directory collision');
      parent = parent.get(part);
    }
    assert(!parent.has(parts.at(-1)), 'duplicate Git path');
    parent.set(parts.at(-1), { mode, sha: gitBlobSha });
  }
  const hashTree = (tree) => {
    const children = [...tree].map(([name, value]) => value instanceof Map
      ? { name, mode: '40000', sha: hashTree(value), sortKey: name + '/' }
      : { name, ...value, sortKey: name });
    children.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
    const bytes = Buffer.concat(children.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]));
    return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
  };
  return hashTree(root);
}

export function freezeM11Snapshot(entries, sourceRevision, gitTreeSha) {
  const ordered = structuredClone(entries).sort((a, b) => compare(a.path, b.path));
  assert(SHA1.test(sourceRevision) && m11GitTreeSha(ordered) === gitTreeSha, 'Git tree identity mismatch');
  const body = { schemaVersion: 1, kind: 'm11-repository-snapshot', sourceRevision, gitTreeSha, entries: ordered };
  return { ...body, snapshotSha256: m11Digest(body) };
}

const stringValue = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const importMeta = (node) => node && ts.isPropertyAccessExpression(node) && node.name.text === 'url'
  && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

function extractReferences(filePath, text) {
  const refs = [], unknowns = [];
  const add = (specifier, kind, line, cwd = false) => refs.push({ specifier, kind, line, cwd });
  if (filePath.endsWith('.css')) {
    // This version deliberately refuses CSS loads/escapes instead of silently
    // certifying an incomplete CSS parser. The pinned reachable styles have none.
    const plain = text.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@import\b|url\s*\(|\\/i.test(plain)) unknowns.push({ kind: 'unsupported-css-reference' });
    return { refs, unknowns };
  }
  if (!PROGRAM.test(filePath)) return { refs, unknowns }; // Byte-bound data/text leaf, never executed.
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  assert(!source.parseDiagnostics.length, `source parse failed: ${filePath}`);
  const fsFunctions = new Set(), fsNamespaces = new Set();
  for (const s of source.statements) {
    if (ts.isImportDeclaration(s) && ['node:module', 'module'].includes(stringValue(s.moduleSpecifier))) unknowns.push({ kind: 'unsupported-module-loader-api' });
    if (!ts.isImportDeclaration(s) || !['node:fs', 'fs', 'node:fs/promises', 'fs/promises'].includes(stringValue(s.moduleSpecifier))) continue;
    if (s.importClause?.name) fsNamespaces.add(s.importClause.name.text);
    const bindings = s.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) fsNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const e of bindings.elements) if (['readFile', 'readFileSync'].includes(e.propertyName?.text ?? e.name.text)) fsFunctions.add(e.name.text);
      for (const e of bindings.elements) if (!['readFile', 'readFileSync'].includes(e.propertyName?.text ?? e.name.text)) unknowns.push({ kind: 'unsupported-filesystem-api', name: e.name.text });
    }
  }
  const urlFile = (node) => node && ts.isNewExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'URL' && node.arguments?.length === 2 && importMeta(node.arguments[1]);
  const visit = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (ts.isIdentifier(node) && (fsFunctions.has(node.text) || fsNamespaces.has(node.text))) {
      const parent = node.parent;
      const binding = ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent);
      const directCall = ts.isCallExpression(parent) && parent.expression === node && fsFunctions.has(node.text);
      const namespaceCall = ts.isPropertyAccessExpression(parent) && parent.expression === node
        && ts.isCallExpression(parent.parent) && parent.parent.expression === parent && fsNamespaces.has(node.text);
      if (!binding && !directCall && !namespaceCall) unknowns.push({ kind: 'unsupported-filesystem-alias', line });
    }
    if (ts.isIdentifier(node) && ['eval', 'Function', 'createRequire'].includes(node.text)) unknowns.push({ kind: 'unsupported-code-loader-reference', line });
    if (ts.isIdentifier(node) && node.text === 'require'
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) unknowns.push({ kind: 'unsupported-require-alias', line });
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = stringValue(node.moduleSpecifier);
      if (specifier === null) unknowns.push({ kind: 'nonliteral-import', line });
      else add(specifier, 'static-import', line);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = stringValue(node.argument.literal);
      if (specifier !== null) add(specifier, 'type-import', line);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringValue(node.moduleReference.expression);
      if (specifier === null) unknowns.push({ kind: 'nonliteral-require', line });
      else add(specifier, 'require', line);
    }
    if (urlFile(node)) {
      const specifier = stringValue(node.arguments[0]);
      if (specifier === null) unknowns.push({ kind: 'nonliteral-file-url', line });
      else add(specifier, 'file-url', line);
    }
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const requireCall = ts.isIdentifier(e) && e.text === 'require';
      if (e.kind === ts.SyntaxKind.ImportKeyword || requireCall) {
        const specifier = stringValue(node.arguments[0]);
        if (specifier === null) unknowns.push({ kind: 'nonliteral-module-load', line });
        else {
          add(specifier, requireCall ? 'require' : 'dynamic-import', line);
          if (['node:fs', 'fs', 'node:fs/promises', 'fs/promises', 'node:module', 'module'].includes(specifier)) unknowns.push({ kind: 'unsupported-filesystem-loader-binding', line });
        }
      }
      const fsCall = (ts.isIdentifier(e) && fsFunctions.has(e.text))
        || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && fsNamespaces.has(e.expression.text));
      if (fsCall) {
        const method = ts.isPropertyAccessExpression(e) ? e.name.text : null;
        if (method && !['readFile', 'readFileSync'].includes(method)) unknowns.push({ kind: 'unsupported-filesystem-api', line });
        else if (!urlFile(node.arguments[0])) {
          const specifier = stringValue(node.arguments[0]);
          if (specifier === null) unknowns.push({ kind: 'nonliteral-file-read', line });
          else add(specifier, 'file-read', line, true);
        }
      }
      if (ts.isIdentifier(e) && ['eval', 'Function', 'createRequire'].includes(e.text)) unknowns.push({ kind: 'unsupported-code-loader', line });
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') unknowns.push({ kind: 'unsupported-code-loader', line });
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const reference of source.referencedFiles) add(reference.fileName, 'reference-path', 1);
  return { refs, unknowns };
}

function resolveReference(from, ref, entries) {
  const resource = ['file-url', 'file-read', 'reference-path'].includes(ref.kind);
  if (!resource && !ref.specifier.startsWith('.')) return { external: true };
  if (path.posix.isAbsolute(ref.specifier) || /^[a-z]+:/i.test(ref.specifier) || /[?#\\]/.test(ref.specifier)) return { problem: 'unsupported-reference-path' };
  const base = path.posix.normalize(ref.cwd ? ref.specifier : path.posix.join(path.posix.dirname(from), ref.specifier));
  try { validateM11SourcePath(base); } catch { return { problem: 'source-outside-repository' }; }
  let candidates;
  if (resource || /\.(?:ts|tsx|css|json|svg)$/.test(base)) candidates = entries.has(base) ? [base] : [];
  else {
    const stem = /\.[cm]?jsx?$/.test(base) ? base.replace(/\.[cm]?jsx?$/, '') : base;
    candidates = sorted([base, ...['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((x) => stem + x),
      ...['.ts', '.tsx', '.js', '.mjs'].map((x) => base + '/index' + x)].filter((p) => entries.has(p)));
    if (entries.has(base + '/package.json')) return { problem: 'unsupported-directory-package' };
  }
  if (candidates.length !== 1) return { problem: candidates.length ? 'ambiguous-local-resolution' : 'missing-local-reference' };
  if (!['100644', '100755'].includes(entries.get(candidates[0]).mode)) return { problem: 'nonregular-source-file' };
  return { toPath: candidates[0] };
}

export function m11ClosureComponents(inventory, clusters) {
  const parents = new Map(clusters.map((c) => [c.cluster, c.cluster]));
  const find = (x) => parents.get(x) === x ? x : find(parents.get(x));
  const owner = new Map();
  for (const c of clusters) for (const p of Object.keys(c.sourceBindings)) {
    if (owner.has(p)) parents.set(find(c.cluster), find(owner.get(p)));
    else owner.set(p, c.cluster);
  }
  const groups = new Map();
  for (const c of clusters) { const id = find(c.cluster); groups.set(id, [...(groups.get(id) ?? []), c.cluster]); }
  return [...groups.values()].map((group) => {
    const originalClusters = sorted(group);
    const rows = inventory.cases.filter((r) => group.includes(r.cluster));
    return { component: `M11-COMP-${m11Digest(originalClusters).slice(0, 12)}`, originalClusters,
      split: rows.some((r) => r.split === 'development') ? 'development' : 'evaluation',
      anchorIds: sorted(rows.map((r) => r.case_id)), sourceBindings: Object.fromEntries(
        clusters.filter((c) => group.includes(c.cluster)).flatMap((c) => Object.entries(c.sourceBindings)).sort(([a], [b]) => compare(a, b))) };
  }).sort((a, b) => compare(a.component, b.component));
}

export function m11ClusterClosures(inventory, sourceBindings, edges) {
  for (const [p, sha] of Object.entries(sourceBindings)) { validateM11SourcePath(p); assert(SHA1.test(sha), 'invalid closure source identity'); }
  for (const e of edges) assert(Object.hasOwn(sourceBindings, e.fromPath) && Object.hasOwn(sourceBindings, e.toPath), 'edge outside source closure');
  return sorted(inventory.cases.map((r) => r.cluster)).map((cluster) => {
    const rows = inventory.cases.filter((r) => r.cluster === cluster);
    const roots = sorted(rows.flatMap((r) => [r.referenceSuite, ...r.targets]));
    for (const p of roots) assert(sourceBindings[p] === inventory.metadata.sources[p].gitBlobSha, 'closure omits or changes primary source');
    const reached = new Set(roots), pending = [...roots];
    for (let i = 0; i < pending.length; i++) for (const e of edges.filter((e) => e.fromPath === pending[i])) {
      if (!reached.has(e.toPath)) { reached.add(e.toPath); pending.push(e.toPath); }
    }
    return { cluster, originalSplit: rows[0].split, roots,
      sourceBindings: Object.fromEntries(sorted(reached).map((p) => [p, sourceBindings[p]])) };
  });
}

function verifyViteProfile(text) {
  const source = ts.createSourceFile('vite.config.ts', text, ts.ScriptTarget.Latest, true);
  assert(!source.parseDiagnostics.length, 'invalid Vite configuration');
  for (const s of source.statements) {
    if (ts.isImportDeclaration(s)) assert(['vite', '@vitejs/plugin-react', '@cloudflare/vite-plugin'].includes(stringValue(s.moduleSpecifier)), 'unsupported Vite plugin');
    else assert(ts.isExportAssignment(s) && ts.isCallExpression(s.expression)
      && s.expression.expression.getText(source) === 'defineConfig' && ts.isObjectLiteralExpression(s.expression.arguments[0]), 'unsupported Vite configuration');
  }
  const visit = (node) => {
    assert(!ts.isSpreadAssignment(node) && !ts.isComputedPropertyName(node), 'unsupported Vite configuration indirection');
    if (ts.isPropertyAssignment(node)) assert(!['resolve', 'alias', 'resolveId'].includes(node.name.getText(source).replace(/['"]/g, '')), 'unsupported Vite resolution override');
    if (ts.isCallExpression(node)) assert(['defineConfig', 'react', 'cloudflare'].includes(node.expression.getText(source)), 'unsupported Vite plugin invocation');
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export async function buildM11DependencyClosure({ inventory, expectedInventorySha256, snapshot, expectedSnapshotSha256, readSource }) {
  inventory = structuredClone(inventory); snapshot = structuredClone(snapshot);
  validateM11Inventory(inventory, expectedInventorySha256);
  const rebuilt = freezeM11Snapshot(snapshot.entries, snapshot.sourceRevision, snapshot.gitTreeSha);
  assert(m11Digest(rebuilt) === m11Digest(snapshot) && rebuilt.snapshotSha256 === expectedSnapshotSha256
    && snapshot.sourceRevision === inventory.metadata.sourceRevision, 'snapshot identity mismatch');
  const entries = new Map(snapshot.entries.map((e) => [e.path, e]));
  const texts = new Map(), sourceBindings = {}, commonContextBindings = {};
  const read = async (p, bindings) => {
    validateM11SourcePath(p);
    assert(entries.has(p) && ['100644', '100755'].includes(entries.get(p).mode), `regular pinned source required: ${p}`);
    if (!texts.has(p)) {
      const bytes = await readSource(p);
      assert(m11SourceBlobSha(bytes) === entries.get(p).gitBlobSha, `source identity mismatch: ${p}`);
      texts.set(p, Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
    }
    bindings[p] = entries.get(p).gitBlobSha;
    return texts.get(p);
  };
  for (const p of M11_COMMON_CONTEXT) await read(p, commonContextBindings);
  verifyViteProfile(texts.get('vite.config.ts'));
  const configFiles = M11_COMMON_CONTEXT.filter((p) => p.startsWith('tsconfig'));
  for (const p of configFiles) {
    const parsed = ts.parseConfigFileTextToJson(p, texts.get(p));
    assert(!parsed.error, 'invalid TypeScript configuration');
    const config = parsed.config;
    assert(!['paths', 'baseUrl', 'rootDirs', 'moduleSuffixes', 'customConditions'].some((k) => Object.hasOwn(config.compilerOptions ?? {}, k)), 'unsupported resolution configuration');
    assert(!config.extends || config.extends === './tsconfig.json', 'unsupported configuration inheritance');
    if (p === 'tsconfig.json') assert(config.compilerOptions?.moduleResolution?.toLowerCase() === 'bundler', 'Bundler resolution profile required');
  }
  const lock = JSON.parse(texts.get('package-lock.json'));
  assert(lock.lockfileVersion === 3 && lock.packages, 'lockfile v3 required');
  const pkg = JSON.parse(texts.get('package.json'));
  for (const key of ['dependencies', 'devDependencies']) assert(m11Digest(pkg[key] ?? {}) === m11Digest(lock.packages['']?.[key] ?? {}), 'package and lockfile disagree');
  const edges = [], externalInputs = [], unknowns = [];
  const queue = sorted(inventory.cases.flatMap((r) => [r.referenceSuite, ...r.targets]));
  const visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const p = queue[cursor]; if (visited.has(p)) continue; visited.add(p);
    const text = await read(p, sourceBindings);
    const pinned = inventory.metadata.sources[p]?.gitBlobSha;
    assert(!pinned || pinned === sourceBindings[p], 'snapshot changes inventory source');
    const extracted = extractReferences(p, text);
    unknowns.push(...extracted.unknowns.map((u) => ({ fromPath: p, ...u })));
    for (const ref of extracted.refs) {
      const result = resolveReference(p, ref, entries);
      if (result.problem) { unknowns.push({ fromPath: p, ...ref, reason: result.problem }); continue; }
      if (result.external) {
        if (isBuiltin(ref.specifier)) externalInputs.push({ fromPath: p, specifier: ref.specifier, boundary: 'node-builtin' });
        else {
          const packageName = ref.specifier.startsWith('@') ? ref.specifier.split('/').slice(0, 2).join('/') : ref.specifier.split('/')[0];
          const record = lock.packages[`node_modules/${packageName}`];
          if (!record?.version || !record?.integrity) unknowns.push({ fromPath: p, ...ref, reason: 'unlocked-external-module' });
          else externalInputs.push({ fromPath: p, specifier: ref.specifier, boundary: 'locked-package', packageName,
            version: record.version, integrity: record.integrity });
        }
      } else {
        edges.push({ fromPath: p, toPath: result.toPath, kind: ref.kind, line: ref.line, specifier: ref.specifier });
        queue.push(result.toPath);
      }
    }
  }
  for (const row of inventory.cases) assert(texts.get(row.referenceSuite).includes(row.referenceTest), 'reference control missing');
  edges.sort((a, b) => compare(m11Digest(a), m11Digest(b)));
  externalInputs.sort((a, b) => compare(m11Digest(a), m11Digest(b)));
  unknowns.sort((a, b) => compare(m11Digest(a), m11Digest(b)));
  const clusters = m11ClusterClosures(inventory, sourceBindings, edges);
  const body = { schemaVersion: 1, kind: 'm11-repository-file-closure', profile: M11_CLOSURE_PROFILE,
    inventorySha256: expectedInventorySha256, snapshotSha256: expectedSnapshotSha256,
    sourceRevision: snapshot.sourceRevision, gitTreeSha: snapshot.gitTreeSha,
    parser: { packageVersion: createRequire(import.meta.url)('@typescript/typescript6/package.json').version, compilerVersion: ts.version },
    commonContextBindings, runtimeContext: { nodeVersion: process.version },
    sourceBindings: Object.fromEntries(Object.entries(sourceBindings).sort(([a], [b]) => compare(a, b))),
    edges, externalInputs, unknowns, clusters, components: m11ClosureComponents(inventory, clusters),
    repositoryFileClosureComplete: unknowns.length === 0,
    futureObservationLineageComplete: false,
    boundary: 'Repository file dependencies for source/coverage inputs; packages and Node are pinned common context. Remote service behavior and future fact roots require separate receipts.' };
  return { ...body, closureSha256: m11Digest(body) };
}

export function refreezeM11Inventory({ inventory, expectedInventorySha256, closure }) {
  validateM11Inventory(inventory, expectedInventorySha256);
  const { closureSha256, ...body } = closure;
  assert(closureSha256 === m11Digest(body) && closure.inventorySha256 === expectedInventorySha256
    && closure.sourceRevision === inventory.metadata.sourceRevision && closure.profile === M11_CLOSURE_PROFILE,
  'closure identity mismatch');
  assert(closure.repositoryFileClosureComplete === true && closure.unknowns.length === 0, 'unresolved repository closure');
  assert(m11Digest(m11ClusterClosures(inventory, closure.sourceBindings, closure.edges)) === m11Digest(closure.clusters), 'cluster closure identity mismatch');
  const components = m11ClosureComponents(inventory, closure.clusters);
  assert(m11Digest(components) === m11Digest(closure.components), 'component identity mismatch');
  const mapping = new Map(components.flatMap((c) => c.originalClusters.map((name) => [name, c])));
  const rows = inventory.cases.map((r) => {
    const c = mapping.get(r.cluster); assert(c, 'missing cluster');
    return { ...r, originalCluster: r.cluster, cluster: c.component, split: c.split };
  });
  const componentCounts = Object.fromEntries(['development', 'evaluation'].map((s) => [s, components.filter((c) => c.split === s).length]));
  const result = freezeCases(rows, { experimentId: inventory.experiment_id, protocolVersion: '0.2-draft', metadata: {
    ...inventory.metadata, status: 'refrozen-source-split-only', supersedesInventorySha256: expectedInventorySha256,
    repositoryClosureSha256: closureSha256, closureProfile: M11_CLOSURE_PROFILE, independentRepositoryComponents: componentCounts,
    splitRule: 'Entire shared-repository-file components remain together. Any component with a prior development anchor remains development; all other components remain evaluation. No outcome-based reassignment.',
    sourceInventoryScope: 'Primary source identities retained; full repository-file membership is bound by the closure artifact. Future observation lineage must be checked separately.',
    evaluationReadiness: componentCounts.evaluation ? 'descriptive-feasibility-only' : 'blocked-no-evaluation-component',
  } });
  validateM11Inventory(result, result.manifest_sha256);
  return result;
}
