import assert from 'node:assert/strict';
import test from 'node:test';

import { changedLineNumbers, extractFacts, functionBodies, versionGuardCount } from './extractor.mjs';

const locked = `
begin
  select * into v from t where id = p_id
  for update;
  update t set n = 1 where id = p_id;
end
`;

test('lock_context and inside region follow the first lock line', () => {
  const after = locked.replace('set n = 1', 'set n = 2');
  const facts = extractFacts(locked, after, { removed: [4], added: [4] });
  assert.equal(facts.lock_context, true);
  assert.equal(facts.changed_inside_locked_region, true);
  assert.equal(facts.guard_delta, 'unchanged');
  assert.equal(extractFacts(locked, after, { removed: [1], added: [1] }).changed_inside_locked_region, false);
});

test('guard_delta counts locks and WHERE version guards, never SET clauses', () => {
  assert.equal(extractFacts(locked, locked.replace('\n  for update;', ';'), { removed: [3], added: [] }).guard_delta, 'removed');
  const guarded = 'update g set version = version + 1 where id = p and version = p_expected_version;';
  assert.equal(versionGuardCount(guarded), 1);
  assert.equal(versionGuardCount('update g set version = version + 1, updated_at = now() where id = p;'), 0);
  assert.equal(extractFacts('begin end', `begin ${guarded} end`, { removed: [], added: [0] }).guard_delta, 'added');
  assert.throws(() => extractFacts(locked, `${guarded}\n${locked.replace('for update', '')}`, { removed: [], added: [] }));
});

test('facts are descriptive only', () => {
  const keys = Object.keys(extractFacts('begin end', 'begin end', { removed: [], added: [] }));
  assert.deepEqual(keys, ['lock_context', 'version_guard', 'changed_inside_locked_region', 'guard_delta', 'retry_path', 'transaction_boundary']);
  assert.ok(!keys.some((key) => /risk|broken|race|weaken|check_then_act/.test(key)));
});

test('advisory, no key update and skip locked count as locks; for share does not', () => {
  for (const body of ['perform pg_advisory_xact_lock(1);', 'select 1 from t for no key update;', 'select 1 from t for update skip locked;']) {
    assert.equal(extractFacts(body, body, { removed: [], added: [] }).lock_context, true, body);
  }
  assert.equal(extractFacts('select 1 from t for share;', 'x', { removed: [], added: [] }).lock_context, false);
});

test('changed line numbers are read from unified hunks', () => {
  const patch = '@@ -10,4 +10,5 @@ fn\n a\n-b\n+c\n+d\n e';
  assert.deepEqual(changedLineNumbers(patch), { removed: [11], added: [11, 12] });
});

test('function bodies are located in migration text', () => {
  const sql = 'create or replace function public.f(a int) returns void language plpgsql as $$\nbegin null; end\n$$;';
  const fn = functionBodies(sql).get('public.f');
  assert.equal(fn.body, '\nbegin null; end\n');
});
