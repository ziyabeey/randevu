import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, '.github/workflows/ci.yml');
const workflow = await readFile(workflowPath, 'utf8');

const groups = [
  { dir: 'supabase/migrations', suffix: '.sql' },
  { dir: 'supabase/tests', suffix: '.sql' },
  { dir: 'tests', suffix: '.test.mjs' },
];

const missing = [];
let checked = 0;

for (const group of groups) {
  const absoluteDir = path.join(root, group.dir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(group.suffix)) continue;
    const relative = `${group.dir}/${entry.name}`;
    checked += 1;
    if (!workflow.includes(relative)) missing.push(relative);
  }
}

if (missing.length > 0) {
  console.error('CI coverage gate failed. These test/migration files are not referenced by .github/workflows/ci.yml:');
  for (const file of missing.sort()) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`CI coverage gate passed for ${checked} migration/test files.`);
