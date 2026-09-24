import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  PUBLIC_BOOKING_GATE_SECRET: 'G'.repeat(48),
};
const user = { id: 'f1640000-0000-4000-8000-000000000401', email: 'f1604@example.test' };
const businessId = 'f1640000-0000-4000-8000-000000000402';
const feedbackId = 'f1640000-0000-4000-8000-000000000403';
const token = 'T'.repeat(43);
const csrf = 'C'.repeat(43);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: user.id, role: 'authenticated', session_id: 'f1640000-0000-4000-8000-000000000404',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}
function memberHeaders(extra = {}) {
  return { Origin: 'http://localhost', Cookie: `yzt_access=${accessToken()}; yzt_refresh=r; yzt_business=${businessId}; yzt_csrf=${csrf}`, 'X-YZT-CSRF': csrf, 'Content-Type': 'application/json', ...extra };
}

async function withFetch(handler, run, role = 'owner') {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([{ id: 'f1640000-0000-4000-8000-000000000405', business_id: businessId, role, active: true }]);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, body });
    const result = await handler({ path: url.pathname, body });
    if (!result) throw new Error(`unexpected fetch ${url.pathname}`);
    return result;
  };
  try { await run(calls); } finally { globalThis.fetch = realFetch; }
}

await test('F16-04 customer feedback uses only the capability gateway with the token in the body', async () => {
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/execute_public_feedback_operation');
    assert.match(body.p_actor_hash, /^[0-9a-f]{64}$/);
    assert.equal(body.p_gate_secret, env.PUBLIC_BOOKING_GATE_SECRET);
    if (body.p_action === 'manage_feedback_view') {
      assert.deepEqual(body.p_args, { p_token: token });
      return json({ ok: true, data: [{ eligible: true, reason: null, rating: null, comment: null, publish_consent: null, status: null, submitted_at: null }] });
    }
    assert.equal(body.p_action, 'manage_feedback_submit');
    assert.deepEqual(body.p_args, { p_token: token, p_rating: 5, p_comment: 'Harika', p_publish_consent: true });
    return json({ ok: true, data: [{ eligible: false, reason: 'submitted', rating: 5, comment: 'Harika', publish_consent: true, status: 'pending', submitted_at: '2026-09-24T10:00:00Z' }] });
  }, async (calls) => {
    const view = await app.request('http://localhost/api/manage/feedback/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.60' }, body: JSON.stringify({ token }),
    }, env);
    assert.equal(view.status, 200);
    assert.equal((await view.json()).feedback.eligible, true);
    const submit = await app.request('http://localhost/api/manage/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.60' },
      body: JSON.stringify({ token, rating: 5, comment: 'Harika', publishConsent: true }),
    }, env);
    assert.equal(submit.status, 201);
    const payload = await submit.json();
    assert.equal(payload.feedback.status, 'pending');
    assert.equal(payload.feedback.publishConsent, true);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => !call.path.includes(token)), 'token never appears in an upstream URL');
  });
});

await test('F16-04 customer feedback validation rejects before any upstream call', async () => {
  const cases = [
    [{ token: 'short', rating: 5, publishConsent: true }, 404],
    [{ token, rating: 0, publishConsent: true }, 400],
    [{ token, rating: 4.5, publishConsent: true }, 400],
    [{ token, rating: '5', publishConsent: true }, 400],
    [{ token, rating: 5 }, 400],
    [{ token, rating: 5, publishConsent: 'yes' }, 400],
    [{ token, rating: 5, publishConsent: true, comment: 'x'.repeat(1001) }, 400],
    [{ token, rating: 5, publishConsent: true, comment: 12 }, 400],
  ];
  for (const [body, status] of cases) {
    await withFetch(async () => null, async (calls) => {
      const response = await app.request('http://localhost/api/manage/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.61' }, body: JSON.stringify(body),
      }, env);
      assert.equal(response.status, status, JSON.stringify(body));
      assert.equal(calls.length, 0);
    });
  }
});

await test('F16-04 gateway errors map to customer-safe codes and rate limits keep Retry-After', async () => {
  for (const [message, status, code] of [
    ['FEEDBACK_NOT_ELIGIBLE', 409, 'FEEDBACK_NOT_ELIGIBLE'],
    ['FEEDBACK_ALREADY_SUBMITTED', 409, 'FEEDBACK_ALREADY_SUBMITTED'],
    ['MANAGEMENT_NOT_FOUND', 404, 'MANAGEMENT_NOT_FOUND'],
    ['PUBLIC_OPERATION_UNAVAILABLE', 503, 'FEEDBACK_UNAVAILABLE'],
  ]) {
    await withFetch(async () => json({ ok: false, error: { message } }), async () => {
      const response = await app.request('http://localhost/api/manage/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.62' },
        body: JSON.stringify({ token, rating: 4, publishConsent: false }),
      }, env);
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    });
  }
  await withFetch(async () => json({ ok: false, error: { message: 'PUBLIC_BOOKING_RATE_LIMITED:17' } }), async () => {
    const response = await app.request('http://localhost/api/manage/feedback/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.63' }, body: JSON.stringify({ token }),
    }, env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '17');
  });
});

await test('F16-04 public reviews return masked published rows and a summary only', async () => {
  await withFetch(async ({ body }) => {
    assert.equal(body.p_action, 'reviews');
    assert.deepEqual(body.p_args, { p_slug: 'salon-a', p_limit: 20 });
    return json({ ok: true, data: [
      { display_name: 'Ayşe D.', rating: 5, comment: 'Harika', published_at: '2026-09-24T10:00:00Z', total_count: 2, average_rating: '4.5' },
      { display_name: 'Can', rating: 4, comment: null, published_at: '2026-09-23T10:00:00Z', total_count: 2, average_rating: '4.5' },
    ] });
  }, async () => {
    const response = await app.request('http://localhost/api/public/business/salon-a/reviews', { headers: { 'CF-Connecting-IP': '203.0.113.64' } }, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.summary, { count: 2, average: 4.5 });
    assert.deepEqual(Object.keys(payload.reviews[0]).sort(), ['comment', 'displayName', 'publishedAt', 'rating']);
  });
  await withFetch(async () => null, async (calls) => {
    const response = await app.request('http://localhost/api/public/business/Bad%20Slug!/reviews', {}, env);
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  });
});

await test('F16-04 member list is tenant-derived and bounded; moderation is owner/manager with CAS', async () => {
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/list_business_feedback');
    assert.equal(body.p_business_id, businessId);
    assert.equal(body.p_status, 'pending');
    assert.equal(body.p_limit, 3);
    return json([1, 2, 3].map((index) => ({
      id: `f1640000-0000-4000-8000-00000000041${index}`, appointment_group_id: businessId, customer_name: 'Ayşe Nur Demir', display_name: 'Ayşe D.',
      rating: 5, comment: null, publish_consent: true, status: 'pending', created_at: `2026-09-2${index}T10:00:00Z`, published_at: null,
      moderated_at: null, appointment_starts_at: null, service_names: 'Kesim', can_moderate: true,
    })));
  }, async () => {
    const response = await app.request('http://localhost/api/feedback?status=pending&limit=2', { headers: memberHeaders() }, env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.feedback.length, 2);
    assert.ok(payload.next);
  }, 'staff');
  for (const query of ['status=bad', 'limit=101', `beforeId=${feedbackId}`]) {
    await withFetch(async () => null, async (calls) => {
      const response = await app.request(`http://localhost/api/feedback?${query}`, { headers: memberHeaders() }, env);
      assert.equal(response.status, 400, query);
      assert.equal(calls.length, 0);
    });
  }
  await withFetch(async () => null, async (calls) => {
    const response = await app.request(`http://localhost/api/feedback/${feedbackId}/moderate`, {
      method: 'POST', headers: memberHeaders(), body: JSON.stringify({ action: 'publish', expectedStatus: 'pending' }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  }, 'staff');
  await withFetch(async ({ path, body }) => {
    assert.equal(path, '/rest/v1/rpc/moderate_business_feedback');
    assert.deepEqual(body, { p_business_id: businessId, p_feedback_id: feedbackId, p_action: 'publish', p_expected_status: 'pending' });
    return json([{ id: feedbackId, status: 'published', published_at: '2026-09-24T11:00:00Z', moderated_at: '2026-09-24T11:00:00Z' }]);
  }, async () => {
    const response = await app.request(`http://localhost/api/feedback/${feedbackId}/moderate`, {
      method: 'POST', headers: memberHeaders(), body: JSON.stringify({ action: 'publish', expectedStatus: 'pending' }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).feedback.status, 'published');
  }, 'manager');
  for (const [message, status] of [['FEEDBACK_CONSENT_MISSING', 409], ['FEEDBACK_STATE_CONFLICT', 409], ['FEEDBACK_NOT_FOUND', 404]]) {
    await withFetch(async () => json({ message }, 400), async () => {
      const response = await app.request(`http://localhost/api/feedback/${feedbackId}/moderate`, {
        method: 'POST', headers: memberHeaders(), body: JSON.stringify({ action: 'publish', expectedStatus: 'hidden' }),
      }, env);
      assert.equal(response.status, status, message);
      assert.equal((await response.json()).error.code, message);
    }, 'owner');
  }
});
