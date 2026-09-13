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
  const executableSql = new Set(planFiles);
  const discoveredSet = new Set(discoveredSql);
  const missing = discoveredSql.filter((file) => !executableSql.has(file));
  const unknown = [...executableSql].filter((file) => !discoveredSet.has(file)).sort((left, right) => left.localeCompare(right, 'en'));

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
