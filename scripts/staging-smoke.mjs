const required = ['STAGING_APP_ORIGIN', 'STAGING_OWNER_A_EMAIL', 'STAGING_OWNER_A_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const cookies = new Map();
const HEALTH_ATTEMPTS = 8;
const HEALTH_RETRY_DELAY_MS = 1500;

function absorbCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const cookieValue = pair.slice(index + 1);
    if (!cookieValue || /(?:^|;)\s*max-age=0(?:;|$)/i.test(value)) cookies.delete(name);
    else cookies.set(name, cookieValue);
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set('Cookie', cookieHeader());
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  absorbCookies(response);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

function browserHeaders(csrfToken) {
  return {
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'X-YZT-CSRF': csrfToken,
  };
}

async function csrf() {
  const result = await request('/api/csrf');
  const token = String(result.data?.csrfToken ?? '');
  if (!result.response.ok || !/^[A-Za-z0-9_-]{43,128}$/.test(token) || cookies.get('yzt_csrf') !== token) {
    throw new Error(`Staging CSRF bootstrap failed with HTTP ${result.response.status}`);
  }
  return token;
}

async function waitForHealth() {
  let lastStatus = 'no response';
  let lastError = null;

  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const health = await request('/api/health');
      lastStatus = `HTTP ${health.response.status}`;
      if (health.response.ok && health.data?.status === 'ok') return;
    } catch (error) {
      lastError = error;
      lastStatus = error instanceof Error ? error.message : String(error);
    }

    if (attempt < HEALTH_ATTEMPTS) {
      console.log(`Staging health not ready (${lastStatus}); retrying ${attempt}/${HEALTH_ATTEMPTS - 1}...`);
      await sleep(HEALTH_RETRY_DELAY_MS);
    }
  }

  const suffix = lastError ? `; last request error: ${lastStatus}` : `; last status: ${lastStatus}`;
  throw new Error(`Staging health check failed after ${HEALTH_ATTEMPTS} attempts${suffix}`);
}

function sessionDiagnostic(result) {
  const data = typeof result.data === 'object' && result.data !== null && !Array.isArray(result.data)
    ? result.data
    : {};
  const user = typeof data.user === 'object' && data.user !== null && !Array.isArray(data.user)
    ? data.user
    : null;
  const error = typeof data.error === 'object' && data.error !== null && !Array.isArray(data.error)
    ? data.error
    : null;
  return {
    status: result.response.status,
    hasUser: Boolean(user?.id),
    membershipsCount: Array.isArray(data.memberships) ? data.memberships.length : null,
    hasActiveBusiness: Boolean(data.activeBusinessId),
    passwordRecovery: data.passwordRecovery === true,
    errorCode: typeof error?.code === 'string' ? error.code : null,
    hasAccessCookie: cookies.has('yzt_access'),
    hasRefreshCookie: cookies.has('yzt_refresh'),
  };
}

await waitForHealth();
const loginCsrf = await csrf();

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: browserHeaders(loginCsrf),
  body: JSON.stringify({
    email: process.env.STAGING_OWNER_A_EMAIL,
    password: process.env.STAGING_OWNER_A_PASSWORD,
  }),
});
if (!login.response.ok || login.data?.ok !== true) {
  throw new Error(`Staging app login failed with HTTP ${login.response.status}`);
}
if (!cookies.has('yzt_access') || !cookies.has('yzt_refresh')) {
  throw new Error('Staging app login did not issue the expected HttpOnly session cookies');
}

const session = await request('/api/session');
if (!session.response.ok || !session.data?.user?.id) {
  console.error(`STAGING_SESSION_DIAGNOSTIC ${JSON.stringify(sessionDiagnostic(session))}`);
  throw new Error(`Staging session lookup failed with HTTP ${session.response.status}`);
}
if (String(session.data.user.email ?? '').toLowerCase() !== process.env.STAGING_OWNER_A_EMAIL.toLowerCase()) {
  throw new Error('Staging session resolved an unexpected Auth user');
}
if (!Array.isArray(session.data.memberships) || session.data.memberships.length < 1) {
  throw new Error('Staging owner has no active fixture membership');
}

const businessId = session.data.memberships[0]?.business_id;
if (!businessId) throw new Error('Staging session membership did not include a business id');
const mutationCsrf = String(session.data.csrfToken ?? '');
if (!/^[A-Za-z0-9_-]{43,128}$/.test(mutationCsrf)) {
  throw new Error('Staging session did not return a usable CSRF token');
}

const selectBusiness = await request('/api/businesses/select', {
  method: 'POST',
  headers: browserHeaders(mutationCsrf),
  body: JSON.stringify({ businessId }),
});
if (!selectBusiness.response.ok || selectBusiness.data?.ok !== true || !cookies.has('yzt_business')) {
  throw new Error(`Staging business selection failed with HTTP ${selectBusiness.response.status}`);
}

const catalog = await request('/api/catalog');
if (!catalog.response.ok) throw new Error(`Staging catalog failed with HTTP ${catalog.response.status}`);
if (!Array.isArray(catalog.data?.services) || catalog.data.services.length < 1) {
  throw new Error('Staging catalog did not return the fixture service');
}
if (!Array.isArray(catalog.data?.staff) || catalog.data.staff.length < 1) {
  throw new Error('Staging catalog did not return the fixture staff member');
}

// S02: exercise the same feature routers as the browser, using a real hosted
// session. Invalid bodies deliberately avoid writing salon/business data.
for (const path of ['/api/bookings', '/api/calendar', '/api/availability/setup', '/api/public/settings']) {
  const result = await request(path);
  if (!result.response.ok) throw new Error(`S02 feature read ${path} failed with HTTP ${result.response.status}`);
}

for (const [headers, expectedCode] of [
  [{}, 'ORIGIN_FORBIDDEN'],
  [{ Origin: 'https://invalid.example' }, 'ORIGIN_FORBIDDEN'],
  [{ Origin: origin, 'Sec-Fetch-Site': 'cross-site' }, 'ORIGIN_FORBIDDEN'],
  [{ Origin: origin }, 'CSRF_INVALID'],
  [browserHeaders('X'.repeat(43)), 'CSRF_INVALID'],
]) {
  const result = await request('/api/public/settings', { method: 'PUT', headers, body: '{}' });
  if (result.response.status !== 403 || result.data?.error?.code !== expectedCode) {
    throw new Error(`S02 mutation guard expected ${expectedCode}; got HTTP ${result.response.status}`);
  }
}

const validatedMutation = await request('/api/public/settings', {
  method: 'PUT', headers: browserHeaders(mutationCsrf), body: '{}',
});
if (validatedMutation.response.status !== 400 || validatedMutation.data?.error?.code !== 'INVALID_PUBLIC_SETTINGS') {
  throw new Error(`S02 valid Origin/CSRF did not reach settings validation: HTTP ${validatedMutation.response.status}`);
}

// Simulate an expired access cookie; Supabase must rotate refresh and preserve
// the selected business. Only this acceptance process's cookie jar is changed.
cookies.delete('yzt_access');
const refreshedFeature = await request('/api/bookings');
if (!refreshedFeature.response.ok || !cookies.has('yzt_access') || !cookies.has('yzt_refresh')
    || cookies.get('yzt_business') !== businessId) {
  throw new Error(`S02 feature refresh failed with HTTP ${refreshedFeature.response.status}`);
}

const invalidCapability = await request('/api/manage/view', { method: 'POST', body: '{}' });
if (invalidCapability.response.status !== 404 || invalidCapability.data?.error?.code !== 'MANAGEMENT_NOT_FOUND') {
  throw new Error(`S02 capability exception did not reach token validation: HTTP ${invalidCapability.response.status}`);
}

console.log(`Staging smoke and S02 auth/mutation checks passed at ${origin} for business ${businessId}.`);
