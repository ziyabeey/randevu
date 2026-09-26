import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractSqlRoutines } from '../extractors/sql-routines.mjs';
import { extractTypeScriptUnits } from '../extractors/typescript-units.mjs';
import { extractPythonUnits, extractPythonUnitsBatch } from '../extractors/python-units.mjs';
import { extractTreeSitterUnits } from '../extractors/tree-sitter-units.mjs';

const DEFAULT_EXTENSIONS = new Set(['.sql','.ts','.tsx','.js','.jsx','.mjs','.cjs','.py']);
const DEFAULT_IGNORES = new Set(['.git','node_modules','dist','build','.next','coverage','.h19']);
const sha = (x) => createHash('sha256').update(String(x)).digest('hex');

async function walk(root, current, {
  extensions = DEFAULT_EXTENSIONS,
  ignores = DEFAULT_IGNORES,
} = {}, out = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      if (ignores.has(entry.name)) continue;
    }
    if (ignores.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, { extensions, ignores }, out);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(root, full).replaceAll('\\', '/'));
    }
  }
  return out;
}

export async function sourceFiles(root = process.cwd(), options = {}) {
  return (await walk(root, root, options)).sort();
}

export async function extractFileUnits(root, relativePath, { treeSitterFallbacks = {} } = {}) {
  const full = path.join(root, relativePath);
  const text = await readFile(full, 'utf8');
  const ext = path.extname(relativePath).toLowerCase();
  let units = [];
  if (ext === '.sql') units = extractSqlRoutines(text, { path: relativePath }).map((x) => ({
    ...x,
    language: 'sql',
    kind: 'routine',
    startLine: text.slice(0, x.startOffset).split(/\r?\n/).length,
    endLine: text.slice(0, x.endOffset).split(/\r?\n/).length,
    digest: sha(x.definition),
  }));
  else if (ext === '.py') units = await extractPythonUnits(text, { path: relativePath });
  else if (['.ts','.tsx','.js','.jsx','.mjs','.cjs'].includes(ext)) {
    units = extractTypeScriptUnits(text, { path: relativePath });
  } else {
    const fallback = treeSitterFallbacks[ext];
    if (!fallback) throw new Error(`unsupported source extension: ${ext}`);
    units = extractTreeSitterUnits(text, {
      path: relativePath,
      profile: fallback.profile,
      runtime: fallback.runtime,
      failOnParseError: fallback.failOnParseError ?? true,
    });
  }
  return units;
}

export async function repositoryInventory(root = process.cwd(), options = {}) {
  const treeSitterFallbacks = options.treeSitterFallbacks ?? {};
  const configuredExtensions = options.extensions
    ? new Set(options.extensions)
    : new Set(DEFAULT_EXTENSIONS);
  for (const ext of Object.keys(treeSitterFallbacks)) configuredExtensions.add(ext);

  const files = await sourceFiles(root, { ...options, extensions: configuredExtensions });
  const units = [];
  const errors = [];

  const pythonFiles = files.filter((file) => path.extname(file).toLowerCase() === '.py');
  if (pythonFiles.length) {
    try {
      const batch = await extractPythonUnitsBatch(await Promise.all(
        pythonFiles.map(async (file) => ({
          path: file,
          text: await readFile(path.join(root, file), 'utf8'),
        })),
      ));
      for (const row of batch.results) units.push(...row.units);
      errors.push(...batch.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const file of pythonFiles) errors.push({ path: file, error: message });
    }
  }

  for (const file of files) {
    if (path.extname(file).toLowerCase() === '.py') continue;
    try {
      units.push(...await extractFileUnits(root, file, { treeSitterFallbacks }));
    } catch (error) {
      errors.push({ path: file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    version: 1,
    root,
    filesScanned: files.length,
    units: units.sort((a, b) => a.path.localeCompare(b.path) || (a.startLine ?? 0) - (b.startLine ?? 0)),
    errors: errors.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
