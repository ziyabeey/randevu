const required = ['STAGING_APP_ORIGIN', 'STAGING_OWNER_A_EMAIL', 'STAGING_OWNER_A_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const cookies = new Map();

function absorbCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set('Cookie', cookieHeader());
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
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

const health = await request('/api/health');
if (!health.response.ok || health.data?.status !== 'ok') {
  throw new Error(`Staging health check failed with HTTP ${health.response.status}`);
}

const login = await request('/api/auth/login', {
  method: 'POST',
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

const selectBusiness = await request('/api/businesses/select', {
  method: 'POST',
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

console.log(`Staging smoke passed at ${origin} for business ${businessId}.`);
