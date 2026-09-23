import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverFiles } from './ci-files.mjs';
import {
  defaultPostgresPlanPath,
  flattenPostgresPlan,
  readPostgresPlan,
} from './ci-postgres.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');

function parseRelativePsqlIncludes(source) {
  const includes = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*\\ir\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/);
    if (match) includes.push(match[1] ?? match[2] ?? match[3]);
  }
  return includes;
}

function expandExecutableSql(root, planFiles, discoveredSet) {
  const executable = new Set(planFiles.filter((file) => discoveredSet.has(file)));
  const pending = [...planFiles];
  const parsed = new Set();

  while (pending.length > 0) {
    const file = pending.shift();
    if (parsed.has(file)) continue;
    parsed.add(file);

    const absoluteFile = path.resolve(root, file);
    if (!existsSync(absoluteFile)) continue;
    const source = readFileSync(absoluteFile, 'utf8');

    for (const include of parseRelativePsqlIncludes(source)) {
      if (path.posix.isAbsolute(include)) {
        throw new Error(`CI coverage gate failed: absolute \\ir include is not allowed: ${include}`);
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), include));
      if (resolved === '..' || resolved.startsWith('../')) {
        throw new Error(`CI coverage gate failed: \\ir include must stay inside the repository: ${include}`);
      }

      const absoluteInclude = path.resolve(root, resolved);
      if (!existsSync(absoluteInclude)) {
        throw new Error(`CI coverage gate failed: included SQL file does not exist: ${resolved}`);
      }

      if (discoveredSet.has(resolved)) executable.add(resolved);
      if (!parsed.has(resolved)) pending.push(resolved);
    }
  }

  return executable;
}

export async function verifyCiCoverage(options = {}) {
  const root = path.resolve(options.root ?? repoRoot);
  const planPath = options.planPath ?? defaultPostgresPlanPath;
  const [migrations, sqlTests, nodeTests] = await Promise.all([
    discoverFiles(root, 'supabase/migrations', '.sql'),
    discoverFiles(root, 'supabase/tests', '.sql'),
    discoverFiles(root, 'tests', '.test.mjs'),
  ]);

  const discoveredSql = [...migrations, ...sqlTests].sort((left, right) => left.localeCompare(right, 'en'));
  const plan = readPostgresPlan(planPath);
  const steps = flattenPostgresPlan(plan);
  const planFiles = steps.filter((step) => Object.hasOwn(step, 'file')).map((step) => step.file);
  const discoveredSet = new Set(discoveredSql);
  const executableSql = expandExecutableSql(root, planFiles, discoveredSet);
  const missing = discoveredSql.filter((file) => !executableSql.has(file));
  const unknown = [...new Set(planFiles)].filter((file) => !discoveredSet.has(file)).sort((left, right) => left.localeCompare(right, 'en'));

  if (missing.length > 0 || unknown.length > 0) {
    const lines = ['CI coverage gate failed.'];
    if (missing.length > 0) {
      lines.push('SQL files missing from the executable PostgreSQL plan:');
      lines.push(...missing.map((file) => `- ${file}`));
    }
    if (unknown.length > 0) {
      lines.push('Unknown SQL files referenced by the executable PostgreSQL plan:');
      lines.push(...unknown.map((file) => `- ${file}`));
    }
    throw new Error(lines.join('\n'));
  }
  if (nodeTests.length === 0) throw new Error('CI coverage gate failed: no Node test files were discovered');

  return {
    sqlFiles: discoveredSql.length,
    sqlInvocations: planFiles.length,
    inlineSqlSteps: steps.length - planFiles.length,
    nodeTests: nodeTests.length,
  };
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === modulePath;
}

if (isMain()) {
  try {
    const result = await verifyCiCoverage();
    console.log(
      `CI coverage gate passed: ${result.sqlFiles} SQL files, ${result.sqlInvocations} SQL file invocations, `
      + `${result.inlineSqlSteps} inline SQL steps, and ${result.nodeTests} recursive Node tests.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
