import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.resolve(here, '../scripts/verify-ci-coverage.mjs');

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'randevu-ci-coverage-'));
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
  await mkdir(path.join(root, 'supabase/tests'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });

  await writeFile(path.join(root, 'supabase/migrations/001_test.sql'), '-- migration\n');
  await writeFile(path.join(root, 'supabase/tests/test_acceptance.sql'), '-- acceptance\n');
  await writeFile(path.join(root, 'tests/example.test.mjs'), '// node test\n');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { 'test:http': 'node --test tests/*.test.mjs' } }),
  );
  return root;
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifier], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('CI coverage gate rejects an unwired SQL acceptance file', async () => {
  const root = await makeFixture();
  try {
    await writeFile(
      path.join(root, '.github/workflows/ci.yml'),
      'run: psql -f supabase/migrations/001_test.sql\n',
    );

    const result = runVerifier(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /supabase\/tests\/test_acceptance\.sql/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CI coverage gate accepts explicit SQL wiring plus wildcard Node tests', async () => {
  const root = await makeFixture();
  try {
    await writeFile(
      path.join(root, '.github/workflows/ci.yml'),
      [
        'run: psql -f supabase/migrations/001_test.sql',
        'run: psql -f supabase/tests/test_acceptance.sql',
      ].join('\n'),
    );

    const result = runVerifier(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed for 3 migration\/test files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
