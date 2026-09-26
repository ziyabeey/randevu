import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeRelativePath } from './ci-files.mjs';
import { runF17DatabaseRestoreDrill } from './f17-db-restore-drill.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');
export const defaultPostgresPlanPath = path.join(path.dirname(modulePath), 'ci-postgres-plan.json');

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain only: ${wanted.join(', ')}`);
  }
}

export function validatePostgresPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('PostgreSQL plan must be an object');
  }
  assertExactKeys(plan, ['version', 'groups'], 'PostgreSQL plan');
  if (plan.version !== 1) throw new Error('PostgreSQL plan version must be 1');
  if (!Array.isArray(plan.groups) || plan.groups.length === 0) {
    throw new Error('PostgreSQL plan must contain at least one group');
  }

  const groupNames = new Set();
  for (const [groupIndex, group] of plan.groups.entries()) {
    const groupLabel = `PostgreSQL plan group ${groupIndex + 1}`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error(`${groupLabel} must be an object`);
    assertExactKeys(group, ['name', 'steps'], groupLabel);
    if (typeof group.name !== 'string' || group.name.trim() === '') throw new Error(`${groupLabel} needs a name`);
    if (groupNames.has(group.name)) throw new Error(`Duplicate PostgreSQL plan group: ${group.name}`);
    groupNames.add(group.name);
    if (!Array.isArray(group.steps) || group.steps.length === 0) throw new Error(`${groupLabel} must contain steps`);

    for (const [stepIndex, step] of group.steps.entries()) {
      const stepLabel = `${groupLabel}, step ${stepIndex + 1}`;
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${stepLabel} must be an object`);
      const hasFile = Object.hasOwn(step, 'file');
      const hasSql = Object.hasOwn(step, 'sql');
      if (hasFile === hasSql) throw new Error(`${stepLabel} must contain exactly one of file or sql`);
      assertExactKeys(step, ['database', hasFile ? 'file' : 'sql'], stepLabel);
      if (typeof step.database !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(step.database)) {
        throw new Error(`${stepLabel} has an invalid database`);
      }

      if (hasFile) {
        assertSafeRelativePath(step.file, `${stepLabel} file`);
        if (!/^supabase\/(?:migrations|tests)\/(?:[^/]+\/)*[^/]+\.sql$/.test(step.file)) {
          throw new Error(`${stepLabel} file must be a SQL file under supabase/migrations or supabase/tests`);
        }
      } else if (typeof step.sql !== 'string' || step.sql.trim() === '' || step.sql.includes('\0')) {
        throw new Error(`${stepLabel} SQL must be a non-empty string`);
      }
    }
  }
  return plan;
}

export function readPostgresPlan(planPath = defaultPostgresPlanPath) {
  let text;
  try {
    text = readFileSync(planPath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read PostgreSQL plan: ${planPath}`, { cause: error });
  }

  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed PostgreSQL plan JSON: ${planPath}`, { cause: error });
  }
  return validatePostgresPlan(plan);
}

export function flattenPostgresPlan(plan) {
  validatePostgresPlan(plan);
  return plan.groups.flatMap((group) => group.steps);
}

export function postgresArgsForStep(step) {
  const action = Object.hasOwn(step, 'file') ? ['-f', step.file] : ['-c', step.sql];
  return ['-h', '127.0.0.1', '-U', 'postgres', '-d', step.database, '-v', 'ON_ERROR_STOP=1', ...action];
}

function assertExecutableFile(root, relativeFile) {
  const rootPath = path.resolve(root);
  const rootStat = lstatSync(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('PostgreSQL runner root must be a real directory');

  let candidate = rootPath;
  const segments = assertSafeRelativePath(relativeFile, 'PostgreSQL plan file');
  for (const [index, segment] of segments.entries()) {
    candidate = path.join(candidate, segment);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error(`PostgreSQL plan file uses a symlink: ${relativeFile}`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`PostgreSQL plan path is not a directory: ${relativeFile}`);
    if (index === segments.length - 1 && !stat.isFile()) throw new Error(`PostgreSQL plan file is not a file: ${relativeFile}`);
  }
}

export class ChildProcessFailure extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ChildProcessFailure';
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0 ? exitCode : 1;
  }
}

export function runPostgresPlan(plan, options = {}) {
  validatePostgresPlan(plan);
  const cwd = path.resolve(options.cwd ?? repoRoot);
  const spawn = options.spawn ?? spawnSync;
  const logger = options.logger ?? console;
  let completed = 0;

  for (const group of plan.groups) {
    logger.log(`PostgreSQL: ${group.name}`);
    for (const step of group.steps) {
      if (Object.hasOwn(step, 'file')) assertExecutableFile(cwd, step.file);
      const result = spawn('psql', postgresArgsForStep(step), {
        cwd,
        shell: false,
        stdio: 'inherit',
      });
      if (result?.error) throw new ChildProcessFailure(`psql could not start in group "${group.name}"`);
      if (result?.status !== 0) {
        throw new ChildProcessFailure(`psql failed in group "${group.name}"`, result?.status);
      }
      completed += 1;
    }
  }
  return completed;
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === modulePath;
}

if (isMain()) {
  try {
    const completed = runPostgresPlan(readPostgresPlan());
    console.log(`PostgreSQL plan passed (${completed} steps).`);
    runF17DatabaseRestoreDrill({
      toolContainer: process.env.GITHUB_ACTIONS === 'true' ? 'randevu-ci-postgres' : null,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error?.exitCode ?? 1;
  }
}
