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

const h19GatePath = 'supabase/tests/h19_integrity_gate.sql';
const h19SupportPath = 'supabase/tests/h19_test_support.sql';

function isH19ScenarioFile(file) {
  return file.startsWith('supabase/tests/h19_')
    && file.endsWith('.sql')
    && file !== h19GatePath
    && file !== h19SupportPath;
}

function parseH19ExpectRows(source) {
  return [...source.matchAll(/^\s*select\s+pg_temp\.h19_expect\('([^']+)'\s*,\s*'([^']+)'\s*,\s*'(D[0-5])'\s*,\s*'(D[0-5])'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*;\s*$/gm)]
    .map((match) => match.slice(1));
}

function parseH19PassIds(source) {
  return [...source.matchAll(/^\s*select\s+pg_temp\.h19_pass\('([^']+)'\)\s*;\s*$/gm)]
    .map((match) => match[1]);
}

function verifyH19Manifest(root, sqlTests, planFiles) {
  const scenarioFiles = sqlTests.filter(isH19ScenarioFile).sort((a, b) => a.localeCompare(b, 'en'));
  const gateExists = sqlTests.includes(h19GatePath);

  if (!gateExists && scenarioFiles.length === 0) return;
  if (!gateExists) {
    throw new Error('CI coverage gate failed: H19 scenario files exist without supabase/tests/h19_integrity_gate.sql');
  }

  const gateSource = readFileSync(path.resolve(root, h19GatePath), 'utf8');
  const includedScenarios = parseRelativePsqlIncludes(gateSource)
    .map((include) => path.posix.normalize(path.posix.join(path.posix.dirname(h19GatePath), include)))
    .filter(isH19ScenarioFile);

  const includeCounts = new Map();
  for (const file of includedScenarios) includeCounts.set(file, (includeCounts.get(file) ?? 0) + 1);

  const missingFromGate = scenarioFiles.filter((file) => !includeCounts.has(file));
  const duplicateIncludes = [...includeCounts.entries()]
    .filter(([, count]) => count !== 1)
    .map(([file, count]) => file + ' (' + count + ' includes)');
  const unknownIncludes = [...includeCounts.keys()].filter((file) => !scenarioFiles.includes(file));
  const standalonePlanSteps = planFiles.filter(isH19ScenarioFile);
  const gatePlanCount = planFiles.filter((file) => file === h19GatePath).length;

  const expectRows = parseH19ExpectRows(gateSource);
  const expectedIds = expectRows.map(([id]) => id);
  const missingEvidence = expectRows
    .filter(([, , , , baselineCi, probeCi, cleanCi]) => [baselineCi, probeCi, cleanCi].some((value) => Number(value) < 1))
    .map(([id]) => id);
  const passedIds = parseH19PassIds(gateSource);
  const duplicateExpectedIds = expectedIds.filter((id, index) => expectedIds.indexOf(id) !== index);
  const duplicatePassedIds = passedIds.filter((id, index) => passedIds.indexOf(id) !== index);
  const expectedSet = new Set(expectedIds);
  const passedSet = new Set(passedIds);
  const missingPasses = [...expectedSet].filter((id) => !passedSet.has(id));
  const unknownPasses = [...passedSet].filter((id) => !expectedSet.has(id));

  const countMatches = [...gateSource.matchAll(/pg_temp\.h19_assert_complete\(\s*(\d+)\s*\)/g)];
  const declaredCount = countMatches.length === 1 ? Number(countMatches[0][1]) : null;

  const problems = [];
  if (gatePlanCount !== 1) problems.push('canonical H19 gate must appear exactly once in PostgreSQL plan (found ' + gatePlanCount + ')');
  if (standalonePlanSteps.length > 0) {
    problems.push('H19 scenarios must not have standalone PostgreSQL plan steps: ' + [...new Set(standalonePlanSteps)].join(', '));
  }
  if (missingFromGate.length > 0) problems.push('H19 scenario files missing from canonical gate: ' + missingFromGate.join(', '));
  if (duplicateIncludes.length > 0) problems.push('H19 scenario files included more than once: ' + duplicateIncludes.join(', '));
  if (unknownIncludes.length > 0) problems.push('unknown H19 scenario includes: ' + unknownIncludes.join(', '));
  if (duplicateExpectedIds.length > 0) problems.push('duplicate H19 manifest IDs: ' + [...new Set(duplicateExpectedIds)].join(', '));
  if (missingEvidence.length > 0) problems.push('H19 manifest entries missing valid evidence receipts: ' + missingEvidence.join(', '));
  if (duplicatePassedIds.length > 0) problems.push('duplicate H19 pass IDs: ' + [...new Set(duplicatePassedIds)].join(', '));
  if (missingPasses.length > 0) problems.push('H19 manifest IDs missing pass registration: ' + missingPasses.join(', '));
  if (unknownPasses.length > 0) problems.push('H19 pass IDs without manifest registration: ' + unknownPasses.join(', '));
  if (expectedIds.length !== scenarioFiles.length) {
    problems.push('H19 manifest/scenario count mismatch: manifest=' + expectedIds.length + ' files=' + scenarioFiles.length);
  }
  if (declaredCount === null) {
    problems.push('H19 gate must contain exactly one h19_assert_complete(N) call (found ' + countMatches.length + ')');
  } else if (declaredCount !== scenarioFiles.length) {
    problems.push('H19 assert_complete count mismatch: declared=' + declaredCount + ' files=' + scenarioFiles.length);
  }

  if (problems.length > 0) {
    throw new Error(['CI coverage gate failed: H19 manifest integrity violation.', ...problems.map((problem) => '- ' + problem)].join('\n'));
  }
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
  verifyH19Manifest(root, sqlTests, planFiles);
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
