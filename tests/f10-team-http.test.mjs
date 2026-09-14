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

const user = {
  id: '91000000-0000-4000-8000-000000000001',
  email: 'f10-owner@example.test',
};
const businessId = '92000000-0000-4000-8000-000000000001';
const membershipId = '93000000-0000-4000-8000-000000000001';
const targetMembershipId = '93000000-0000-4000-8000-000000000002';
const staffId = '94000000-0000-4000-8000-000000000001';
const invitationId = '95000000-0000-4000-8000-000000000001';
const csrfValue = 'C'.repeat(43);

function membership(role = 'owner') {
  return { id: membershipId, business_id: businessId, role, active: true };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function accessToken(method = 'password') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://supabase.example.test/auth/v1',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: user.id,
    role: 'authenticated',
    session_id: '96000000-0000-4000-8000-000000000001',
    amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }],
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function cookieHeader({ business = true, recovery = false } = {}) {
  return [
    `yzt_access=${accessToken(recovery ? 'recovery' : 'password')}`,
    'yzt_refresh=f10-refresh-token',
    business ? `yzt_business=${businessId}` : '',
    `yzt_csrf=${csrfValue}`,
  ].filter(Boolean).join('; ');
}

function mutationHeaders(options) {
  return {
    Origin: 'http://localhost',
    Cookie: cookieHeader(options),
    'X-YZT-CSRF': csrfValue,
    'Content-Type': 'application/json',
  };
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

await test('F10 team read uses the currently selected membership and one bounded snapshot RPC', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const snapshot = {
    actor: { membershipId, role: 'owner' },
    members: [], staff: [], invitations: [], financialPermissions: [], effectiveFinancialPermissions: [],
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') {
      assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
      assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
      assert.equal(url.searchParams.get('active'), 'eq.true');
      return json([membership()]);
    }
    assert.equal(url.pathname, '/rest/v1/rpc/get_team_snapshot');
    assert.equal(JSON.parse(init.body).p_business_id, businessId);
    return json(snapshot);
  };
  try {
    const response = await app.request('http://localhost/api/team', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).team, snapshot);
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships', '/rest/v1/rpc/get_team_snapshot']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 owner invite returns plaintext once while Supabase receives only its SHA-256 hash', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/create_business_invitation');
    rpcBody = JSON.parse(init.body);
    return json([{
      invitation_id: invitationId,
      business_id: businessId,
      email: 'new-staff@example.test',
      role: 'staff',
      expires_at: '2026-09-16T00:00:00.000Z',
    }]);
  };
  try {
    const response = await app.request('http://localhost/api/team/invitations', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ email: '  New-Staff@Example.Test ', role: 'staff' }),
    }, env);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.invitation.email, 'new-staff@example.test');
    assert.match(payload.inviteUrl, /^http:\/\/localhost\/#invite=[A-Za-z0-9_-]{43}$/);
    const token = payload.inviteUrl.split('#invite=')[1];
    assert.equal(rpcBody.p_business_id, businessId);
    assert.equal(rpcBody.p_email, 'new-staff@example.test');
    assert.equal(rpcBody.p_role, 'staff');
    assert.match(rpcBody.p_token_hash, /^[0-9a-f]{64}$/);
    assert.equal(rpcBody.p_token_hash, await sha256Hex(token));
    assert.equal(JSON.stringify(rpcBody).includes(token), false, 'plaintext invitation token reached Supabase');
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 manager cannot create an owner invitation before invitation RPC', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership('manager')]);
    throw new Error(`unexpected F10 manager-owner fetch: ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/team/invitations', {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ email: 'owner-candidate@example.test', role: 'owner' }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'OWNER_ROLE_REQUIRES_OWNER');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 invite acceptance needs authentication and CSRF but not an existing business membership', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const token = 'T'.repeat(43);
  let rpcBody;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    assert.equal(url.pathname, '/rest/v1/rpc/accept_business_invitation');
    rpcBody = JSON.parse(init.body);
    return json([{ business_id: businessId, membership_id: targetMembershipId, role: 'staff' }]);
  };
  try {
    const response = await app.request('http://localhost/api/team/invitations/accept', {
      method: 'POST', headers: mutationHeaders({ business: false }),
      body: JSON.stringify({ token }),
    }, env);
    assert.equal(response.status, 200);
    assert.equal(rpcBody.p_token_hash, await sha256Hex(token));
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/rpc/accept_business_invitation']);
    assert.match(setCookieValues(response).join('\n'), new RegExp(`yzt_business=${businessId}`));
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 wrong-account invitation failure never selects the invited business', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    assert.equal(url.pathname, '/rest/v1/rpc/accept_business_invitation');
    return json({ message: 'INVITATION_EMAIL_MISMATCH' }, 403);
  };
  try {
    const response = await app.request('http://localhost/api/team/invitations/accept', {
      method: 'POST', headers: mutationHeaders({ business: false }),
      body: JSON.stringify({ token: 'W'.repeat(43) }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'INVITATION_EMAIL_MISMATCH');
    assert.doesNotMatch(setCookieValues(response).join('\n'), /yzt_business=/);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 staff cannot mutate membership role or active state', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership('staff')]);
    throw new Error(`unexpected F10 staff mutation fetch: ${url}`);
  };
  try {
    const response = await app.request(`http://localhost/api/team/members/${targetMembershipId}`, {
      method: 'PATCH', headers: mutationHeaders(),
      body: JSON.stringify({ role: 'manager', active: true }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'NOT_ALLOWED');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 manager cannot grant owner-only financial permissions', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership('manager')]);
    throw new Error(`unexpected F10 manager finance fetch: ${url}`);
  };
  try {
    const response = await app.request(`http://localhost/api/team/members/${targetMembershipId}/financial-permissions/payments_write`, {
      method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ enabled: true }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'FINANCIAL_PERMISSION_OWNER_REQUIRED');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 owner financial permission update forwards only selected tenant and narrow permission', async () => {
  const realFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/set_membership_financial_permission');
    rpcBody = JSON.parse(init.body);
    return json(true);
  };
  try {
    const response = await app.request(`http://localhost/api/team/members/${targetMembershipId}/financial-permissions/payments_write`, {
      method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ enabled: true }),
    }, env);
    assert.equal(response.status, 200);
    assert.deepEqual(rpcBody, {
      p_business_id: businessId,
      p_membership_id: targetMembershipId,
      p_permission: 'payments_write',
      p_enabled: true,
    });
    assert.equal((await response.json()).enabled, true);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 deactivated open session is denied on the next team request and loses only business selection', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([]);
    throw new Error(`unexpected F10 deactivated-session fetch: ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/team', {
      headers: { Cookie: cookieHeader() },
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'TENANT_REQUIRED');
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/memberships']);
    const cookies = setCookieValues(response).join('\n');
    assert.match(cookies, /yzt_business=;.*max-age=0/i);
    assert.doesNotMatch(cookies, /yzt_(access|refresh)=;.*max-age=0/i);
  } finally { globalThis.fetch = realFetch; }
});

await test('F10 cross-tenant staff link stays a fixed not-found error without leaking DB detail', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/memberships') return json([membership()]);
    assert.equal(url.pathname, '/rest/v1/rpc/set_staff_membership_link');
    return json({ message: 'ACTIVE_MEMBERSHIP_NOT_FOUND secret-db-detail' }, 400);
  };
  try {
    const response = await app.request(`http://localhost/api/team/staff/${staffId}/membership`, {
      method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ membershipId: targetMembershipId }),
    }, env);
    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.error?.code, 'ACTIVE_MEMBERSHIP_NOT_FOUND');
    assert.doesNotMatch(JSON.stringify(payload), /secret-db-detail/);
  } finally { globalThis.fetch = realFetch; }
});
