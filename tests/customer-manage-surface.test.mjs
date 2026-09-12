import assert from 'node:assert/strict';
import test from 'node:test';
import customerManage from '../worker/customer-manage.ts';

const env = {
  SUPABASE_URL: 'https://example.supabase.test',
  SUPABASE_ANON_KEY: 'test-anon-key',
};

test('legacy two-step management provisioning route is removed', async () => {
  const response = await customerManage.request('/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, env);

  assert.equal(response.status, 404);
});

test('token-scoped management view route remains registered', async () => {
  const response = await customerManage.request('/view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, env);

  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error?.code, 'MANAGEMENT_NOT_FOUND');
});
