import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const workflow = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const packageJsonText = await readFile(path.join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageJsonText);
const searchable = `${workflow}\n${JSON.stringify(packageJson.scripts ?? {})}`;

const groups = [
  { dir: 'supabase/migrations', suffix: '.sql', wildcard: null },
  { dir: 'supabase/tests', suffix: '.sql', wildcard: null },
  { dir: 'tests', suffix: '.test.mjs', wildcard: 'tests/*.test.mjs' },
];

const missing = [];
let checked = 0;

for (const group of groups) {
  const absoluteDir = path.join(root, group.dir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const wildcardCovered = group.wildcard ? searchable.includes(group.wildcard) : false;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(group.suffix)) continue;
    const relative = `${group.dir}/${entry.name}`;
    checked += 1;
    if (!wildcardCovered && !searchable.includes(relative)) missing.push(relative);
  }
}

if (missing.length > 0) {
  console.error('CI coverage gate failed. These test/migration files are not wired into CI:');
  for (const file of missing.sort()) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`CI coverage gate passed for ${checked} migration/test files.`);
