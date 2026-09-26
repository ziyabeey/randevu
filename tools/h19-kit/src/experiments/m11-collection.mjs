import path from 'node:path';
import { createRequire } from 'node:module';
import ts from '@typescript/typescript6';
import {
  m11Digest, m11SourceBlobSha, validateM11Inventory, validateM11SourcePath,
} from './m11-materializer.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const sorted = (items) => [...new Set(items)].sort();
const parserPackageVersion = createRequire(import.meta.url)('@typescript/typescript6/package.json').version;

// Positive witnesses only: absence of an edge never certifies full closure.
export async function auditM11CollectionSources({ inventory, expectedInventorySha256, recipe, readSource }) {
  inventory = structuredClone(inventory);
  recipe = structuredClone(recipe);
  validateM11Inventory(inventory, expectedInventorySha256);
  assert(recipe?.schemaVersion === 1 && recipe.kind === 'm11-collection-recipe', 'invalid collection recipe');
  assert(recipe.inventorySha256 === expectedInventorySha256
    && recipe.sourceRevision === inventory.metadata.sourceRevision, 'stale collection recipe');
  const { recipeSha256, ...recipeBody } = recipe;
  assert(recipeSha256 === m11Digest(recipeBody), 'recipe identity mismatch');
  assert(recipe.sourceBindings && Object.keys(recipe.sourceBindings).length, 'source bindings required');
  const sourceTexts = {};
  const known = Object.fromEntries(Object.entries(inventory.metadata.sources).map(([p, b]) => [p, b.gitBlobSha]));
  for (const [p, sha] of Object.entries(recipe.sourceBindings).sort(([a], [b]) => a.localeCompare(b))) {
    validateM11SourcePath(p);
    assert(/^[a-f0-9]{40}$/.test(sha), 'invalid blob identity');
    assert(!known[p] || known[p] === sha, 'recipe changes inventory binding');
    const bytes = await readSource(p);
    assert(m11SourceBlobSha(bytes) === sha, `source identity mismatch: ${p}`);
    sourceTexts[p] = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
    known[p] = sha;
  }
  const development = inventory.cases.filter((r) => r.split === 'development');
  const suites = sorted(development.map((r) => r.referenceSuite));
  assert(JSON.stringify(recipe.referenceSuites) === JSON.stringify(suites), 'recipe must select exactly development suites');
  for (const row of development) {
    for (const p of [row.referenceSuite, ...row.targets]) {
      assert(Object.hasOwn(sourceTexts, p), `development source absent: ${p}`);
    }
    assert(sourceTexts[row.referenceSuite].includes(row.referenceTest), 'reference control absent');
  }

  const edges = [];
  const unresolvedImports = [];
  for (const [fromPath, text] of Object.entries(sourceTexts)) {
    if (!/\.(?:tsx?|[cm]?jsx?)$/.test(fromPath)) continue;
    const file = ts.createSourceFile(fromPath, text, ts.ScriptTarget.Latest, true);
    assert(!file.parseDiagnostics.length, `source parse failed: ${fromPath}`);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const literal = statement.moduleSpecifier;
      if (!literal || !ts.isStringLiteral(literal)) continue;
      const specifier = literal.text;
      if (!specifier.startsWith('.')) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
      const candidates = Object.hasOwn(known, base) ? [base] :
        [base + '.ts', base + '.tsx', base + '.js', base + '.mjs', base + '/index.ts', base + '/index.tsx']
          .filter((p) => Object.hasOwn(known, p));
      if (candidates.length !== 1) {
        unresolvedImports.push({ fromPath, specifier });
        continue;
      }
      edges.push({ fromPath, toPath: candidates[0], specifier,
        line: file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1,
        statement: statement.getText(file) });
    }
  }
  edges.sort((a, b) => a.fromPath.localeCompare(b.fromPath) || a.toPath.localeCompare(b.toPath));
  const clusters = sorted(inventory.cases.map((r) => r.cluster)).map((cluster) => {
    const rows = inventory.cases.filter((r) => r.cluster === cluster);
    const roots = sorted(rows.flatMap((r) => [r.referenceSuite, ...r.targets]));
    const routes = new Map(roots.map((p) => [p, [p]]));
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++) {
      for (const edge of edges.filter((e) => e.fromPath === queue[i])) {
        if (!routes.has(edge.toPath)) {
          routes.set(edge.toPath, [...routes.get(edge.fromPath), edge.toPath]);
          queue.push(edge.toPath);
        }
      }
    }
    return { cluster, split: rows[0].split, roots, routes };
  });
  const conflicts = [];
  for (const dev of clusters.filter((c) => c.split === 'development')) {
    for (const evaluation of clusters.filter((c) => c.split === 'evaluation')) {
      for (const sharedPath of sorted([...dev.routes.keys()].filter((p) => evaluation.routes.has(p)))) {
        conflicts.push({ developmentCluster: dev.cluster, evaluationCluster: evaluation.cluster, sharedPath,
          gitBlobSha: known[sharedPath], developmentRoute: dev.routes.get(sharedPath),
          evaluationRoute: evaluation.routes.get(sharedPath) });
      }
    }
  }
  const body = { schemaVersion: 1, kind: 'm11-dependency-witness-audit',
    inventorySha256: expectedInventorySha256, recipeSha256, sourceRevision: recipe.sourceRevision,
    parser: { name: '@typescript/typescript6', packageVersion: parserPackageVersion, compilerVersion: ts.version },
    sourceBindings: recipe.sourceBindings, scope: 'bounded-static-import-witnesses', complete: false,
    status: conflicts.length ? 'blocked-cross-split-dependency' : 'incomplete-no-conflict-found',
    edges, unresolvedImports, conflicts };
  return { audit: { ...body, auditSha256: m11Digest(body) }, sourceTexts };
}

// Entries are the original V8 function/range records for one source path from
// one suite invocation, with machine-specific scriptId/URL fields removed.
export function summarizeM11V8Coverage(entries) {
  assert(Array.isArray(entries), 'coverage entries required');
  if (!entries.length) return { state: 'unknown', reason: 'target-not-observed-by-v8',
    observedNamedFunctions: null, calledNamedFunctions: null, uncalledNamedFunctions: null };
  const functions = new Map();
  for (const entry of entries) {
    assert(Array.isArray(entry.functions), 'malformed V8 script');
    for (const fn of entry.functions) {
      assert(typeof fn.functionName === 'string' && Array.isArray(fn.ranges) && fn.ranges.length,
        'malformed V8 function');
      for (const range of fn.ranges) {
        assert(Number.isSafeInteger(range.startOffset) && Number.isSafeInteger(range.endOffset)
          && range.startOffset >= 0 && range.endOffset > range.startOffset
          && Number.isSafeInteger(range.count) && range.count >= 0, 'invalid V8 range');
      }
      if (!fn.functionName) continue;
      const root = fn.ranges[0];
      const key = `${fn.functionName}:${root.startOffset}:${root.endOffset}`;
      const old = functions.get(key);
      functions.set(key, { name: fn.functionName, startOffset: root.startOffset,
        endOffset: root.endOffset, count: (old?.count ?? 0) + root.count });
    }
  }
  const records = [...functions.values()].sort((a, b) => a.startOffset - b.startOffset || a.name.localeCompare(b.name));
  return { state: 'observed', observedNamedFunctions: records.length,
    calledNamedFunctions: records.filter((r) => r.count > 0).length,
    uncalledNamedFunctions: records.filter((r) => r.count === 0).map(({ count, ...r }) => r) };
}

export function summarizeM11Tap(stdout) {
  const count = (name) => {
    const matches = [...stdout.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))];
    assert(matches.length === 1, `missing or ambiguous TAP ${name}`);
    return Number(matches[0][1]);
  };
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((name) => [name, count(name)]));
}
