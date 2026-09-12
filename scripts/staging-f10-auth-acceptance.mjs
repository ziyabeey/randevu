import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const required = [
  'STAGING_APP_ORIGIN',
  'STAGING_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ADMIN_KEY',
  'STAGING_OWNER_A_EMAIL',
  'STAGING_OWNER_A_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required F10 staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const dbUrl = process.env.STAGING_DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const adminKey = process.env.SUPABASE_ADMIN_KEY;
const ownerEmail = process.env.STAGING_OWNER_A_EMAIL.trim().toLowerCase();
const ownerPassword = process.env.STAGING_OWNER_A_PASSWORD;
const runLabel = String(process.env.GITHUB_RUN_ID ?? Date.now()).replace(/\D/g, '').slice(-24) || Date.now().toString();

function jsonBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function setCookieValues(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function absorbCookies(jar, response) {
  for (const value of setCookieValues(response)) {
    const pair = value.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const cookieValue = pair.slice(index + 1);
    if (!cookieValue) jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function appRequest(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set('Cookie', cookieHeader(jar));
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  absorbCookies(jar, response);
  const text = await response.text();
  return { response, text, data: jsonBody(text) };
}

async function csrf(jar) {
  const result = await appRequest(jar, '/api/csrf');
  const token = String(result.data?.csrfToken ?? '');
  if (!result.response.ok || !/^[A-Za-z0-9_-]{43,128}$/.test(token) || jar.get('yzt_csrf') !== token) {
    throw new Error(`Staging CSRF bootstrap failed with HTTP ${result.response.status}`);
  }
  return token;
}

function browserHeaders(csrfToken, requestOrigin = origin) {
  return {
    Origin: requestOrigin,
    'Sec-Fetch-Site': requestOrigin === origin ? 'same-origin' : 'cross-site',
    'X-YZT-CSRF': csrfToken,
  };
}

async function browserMutation(jar, path, method, body, csrfToken, requestOrigin = origin) {
  return appRequest(jar, path, {
    method,
    headers: browserHeaders(csrfToken, requestOrigin),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectError(result, status, code, label) {
  if (result.response.status !== status || result.data?.error?.code !== code) {
    throw new Error(`${label} expected HTTP ${status}/${code}, got HTTP ${result.response.status}/${result.data?.error?.code ?? 'unknown'}`);
  }
}

async function login(email, password) {
  const jar = new Map();
  const csrfToken = await csrf(jar);
  const result = await browserMutation(jar, '/api/auth/login', 'POST', { email, password }, csrfToken);
  return { ...result, jar, csrfToken };
}

async function adminRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('apikey', adminKey);
  headers.set('Authorization', `Bearer ${adminKey}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, { ...init, headers });
  const text = await response.text();
  const data = jsonBody(text);
  if (!response.ok) {
    const code = data?.code ?? data?.error_code ?? response.status;
    throw new Error(`Supabase Auth admin request failed (${code})`);
  }
  return data;
}

async function generateLink(type, email, password) {
  const payload = await adminRequest('generate_link', {
    method: 'POST',
    body: JSON.stringify({
      type,
      email,
      ...(password ? { password } : {}),
      redirect_to: `${origin}/api/auth/callback`,
    }),
  });
  const tokenHash = String(payload?.hashed_token ?? payload?.properties?.hashed_token ?? '');
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(tokenHash)) {
    throw new Error(`Supabase ${type} link response did not include a valid hashed token`);
  }
  return { payload, tokenHash };
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psqlScalar(sql) {
  return execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

async function findUserByEmail(email) {
  const payload = await adminRequest('users?page=1&per_page=1000');
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.find((user) => String(user?.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
}

let ownerUserId = null;
let ownerBusinessId = null;
let membershipDisabled = false;
let ownerPasswordChanged = false;
let signupUserId = null;
const temporaryPassword = `Rdv!F10-${randomBytes(18).toString('base64url')}9a`;
const signupPassword = `Rdv!Signup-${randomBytes(18).toString('base64url')}8b`;
const signupEmail = `randevu-f10-${runLabel}@example.com`;

try {
  const securityJar = new Map();
  const securityCsrf = await csrf(securityJar);
  const crossOrigin = await browserMutation(
    securityJar,
    '/api/auth/login',
    'POST',
    { email: ownerEmail, password: ownerPassword },
    securityCsrf,
    'https://cross-site.example',
  );
  await expectError(crossOrigin, 403, 'ORIGIN_FORBIDDEN', 'cross-origin login');

  const missingCsrf = await appRequest(securityJar, '/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  await expectError(missingCsrf, 403, 'CSRF_INVALID', 'missing-CSRF login');

  const loggedIn = await login(ownerEmail, ownerPassword);
  if (!loggedIn.response.ok || loggedIn.data?.ok !== true || !loggedIn.jar.has('yzt_access') || !loggedIn.jar.has('yzt_refresh')) {
    throw new Error(`Real staging owner login failed with HTTP ${loggedIn.response.status}`);
  }
  if (loggedIn.text.includes('access_token') || loggedIn.text.includes('refresh_token')) {
    throw new Error('Login response exposed session tokens to application JavaScript');
  }

  const session = await appRequest(loggedIn.jar, '/api/session');
  if (!session.response.ok || session.data?.user?.email?.toLowerCase() !== ownerEmail) {
    throw new Error(`Real staging session lookup failed with HTTP ${session.response.status}`);
  }
  if (!Array.isArray(session.data?.memberships) || session.data.memberships.length < 1) {
    throw new Error('Real staging owner session has no current active membership');
  }
  ownerUserId = session.data.user.id;
  ownerBusinessId = session.data.memberships[0].business_id;

  const selected = await browserMutation(
    loggedIn.jar,
    '/api/businesses/select',
    'POST',
    { businessId: ownerBusinessId },
    session.data.csrfToken,
  );
  if (!selected.response.ok || selected.data?.ok !== true) {
    throw new Error(`Real staging business selection failed with HTTP ${selected.response.status}`);
  }

  const oldAccess = loggedIn.jar.get('yzt_access');
  loggedIn.jar.set('yzt_access', 'f10-expired-access-token');
  const refreshed = await appRequest(loggedIn.jar, '/api/session');
  if (!refreshed.response.ok || refreshed.data?.user?.id !== ownerUserId) {
    throw new Error(`Refresh-token session recovery failed with HTTP ${refreshed.response.status}`);
  }
  if (!loggedIn.jar.get('yzt_access') || loggedIn.jar.get('yzt_access') === 'f10-expired-access-token' || loggedIn.jar.get('yzt_access') === oldAccess) {
    throw new Error('Refresh-token session recovery did not rotate the access cookie');
  }

  const disabled = psqlScalar(`
    update public.memberships
    set active = false, updated_at = now()
    where business_id = ${sqlLiteral(ownerBusinessId)}::uuid
      and user_id = ${sqlLiteral(ownerUserId)}::uuid
      and active
    returning count(*) over ()
  `);
  if (disabled !== '1') throw new Error('Could not temporarily disable the staging owner membership');
  membershipDisabled = true;

  const removedMembership = await appRequest(loggedIn.jar, '/api/session');
  if (!removedMembership.response.ok
      || !Array.isArray(removedMembership.data?.memberships)
      || removedMembership.data.memberships.length !== 0
      || removedMembership.data.activeBusinessId !== null
      || loggedIn.jar.has('yzt_business')) {
    throw new Error('Session did not re-check the current DB membership state');
  }

  psqlScalar(`
    update public.memberships
    set active = true, updated_at = now()
    where business_id = ${sqlLiteral(ownerBusinessId)}::uuid
      and user_id = ${sqlLiteral(ownerUserId)}::uuid
    returning 1
  `);
  membershipDisabled = false;

  const recoveryLink = await generateLink('recovery', ownerEmail);
  const recoveryJar = new Map();
  const recoveryCsrf = await csrf(recoveryJar);
  const confirmedRecovery = await browserMutation(
    recoveryJar,
    '/api/auth/confirm',
    'POST',
    { tokenHash: recoveryLink.tokenHash, type: 'recovery' },
    recoveryCsrf,
  );
  if (!confirmedRecovery.response.ok || confirmedRecovery.data?.ok !== true || confirmedRecovery.data?.type !== 'recovery') {
    throw new Error(`Hosted recovery token confirmation failed with HTTP ${confirmedRecovery.response.status}`);
  }
  if (confirmedRecovery.text.includes('access_token') || confirmedRecovery.text.includes('refresh_token')) {
    throw new Error('Recovery confirmation exposed session tokens to application JavaScript');
  }

  const recoverySession = await appRequest(recoveryJar, '/api/session');
  if (!recoverySession.response.ok || recoverySession.data?.user?.id !== ownerUserId || recoverySession.data?.passwordRecovery !== true) {
    throw new Error('Hosted recovery session did not enter password-update-only mode');
  }
  const blockedCatalog = await appRequest(recoveryJar, '/api/catalog');
  await expectError(blockedCatalog, 403, 'PASSWORD_UPDATE_REQUIRED', 'recovery-session catalog');

  const replayJar = new Map();
  const replayCsrf = await csrf(replayJar);
  const replay = await browserMutation(
    replayJar,
    '/api/auth/confirm',
    'POST',
    { tokenHash: recoveryLink.tokenHash, type: 'recovery' },
    replayCsrf,
  );
  await expectError(replay, 400, 'AUTH_LINK_INVALID', 'reused recovery token');

  const passwordUpdate = await browserMutation(
    recoveryJar,
    '/api/auth/password',
    'PUT',
    { password: temporaryPassword },
    recoverySession.data.csrfToken,
  );
  if (!passwordUpdate.response.ok || passwordUpdate.data?.ok !== true || passwordUpdate.data?.signedOut !== true) {
    throw new Error(`Recovery password update failed with HTTP ${passwordUpdate.response.status}`);
  }
  ownerPasswordChanged = true;
  if (recoveryJar.has('yzt_access') || recoveryJar.has('yzt_refresh') || recoveryJar.has('yzt_password_recovery')) {
    throw new Error('Password update did not clear the browser session');
  }

  const oldPasswordLogin = await login(ownerEmail, ownerPassword);
  await expectError(oldPasswordLogin, 401, 'LOGIN_FAILED', 'old password login after recovery');
  const newPasswordLogin = await login(ownerEmail, temporaryPassword);
  if (!newPasswordLogin.response.ok || newPasswordLogin.data?.ok !== true) {
    throw new Error(`New password login failed with HTTP ${newPasswordLogin.response.status}`);
  }

  await adminRequest(`users/${ownerUserId}`, {
    method: 'PUT',
    body: JSON.stringify({ password: ownerPassword, email_confirm: true }),
  });
  ownerPasswordChanged = false;
  const restoredLogin = await login(ownerEmail, ownerPassword);
  if (!restoredLogin.response.ok || restoredLogin.data?.ok !== true) {
    throw new Error('Original staging owner password could not be restored');
  }

  const signupLink = await generateLink('signup', signupEmail, signupPassword);
  signupUserId = signupLink.payload?.user?.id ?? signupLink.payload?.id ?? null;
  if (!signupUserId) signupUserId = (await findUserByEmail(signupEmail))?.id ?? null;
  if (!signupUserId) throw new Error('Hosted signup link did not create a staging Auth user');

  const signupJar = new Map();
  const signupCsrf = await csrf(signupJar);
  const confirmedSignup = await browserMutation(
    signupJar,
    '/api/auth/confirm',
    'POST',
    { tokenHash: signupLink.tokenHash, type: 'signup' },
    signupCsrf,
  );
  if (!confirmedSignup.response.ok || confirmedSignup.data?.ok !== true || confirmedSignup.data?.type !== 'signup') {
    throw new Error(`Hosted signup confirmation failed with HTTP ${confirmedSignup.response.status}`);
  }
  const signupSession = await appRequest(signupJar, '/api/session');
  if (!signupSession.response.ok || signupSession.data?.user?.email?.toLowerCase() !== signupEmail || signupSession.data?.passwordRecovery !== false) {
    throw new Error('Hosted signup confirmation did not establish the expected session');
  }

  const signupReplayJar = new Map();
  const signupReplayCsrf = await csrf(signupReplayJar);
  const signupReplay = await browserMutation(
    signupReplayJar,
    '/api/auth/confirm',
    'POST',
    { tokenHash: signupLink.tokenHash, type: 'signup' },
    signupReplayCsrf,
  );
  await expectError(signupReplay, 400, 'AUTH_LINK_INVALID', 'reused signup token');

  console.log('F10-01 staging acceptance passed: Origin/CSRF, refresh rotation, live membership re-check, hosted signup confirmation, recovery and password rotation verified.');
} finally {
  if (membershipDisabled && ownerBusinessId && ownerUserId) {
    try {
      psqlScalar(`
        update public.memberships
        set active = true, updated_at = now()
        where business_id = ${sqlLiteral(ownerBusinessId)}::uuid
          and user_id = ${sqlLiteral(ownerUserId)}::uuid
        returning 1
      `);
    } catch {
      console.error('Could not restore the staging owner membership');
    }
  }
  if (ownerPasswordChanged && ownerUserId) {
    try {
      await adminRequest(`users/${ownerUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ password: ownerPassword, email_confirm: true }),
      });
    } catch {
      console.error('Could not restore the staging owner password');
    }
  }
  if (signupUserId) {
    try {
      await adminRequest(`users/${signupUserId}`, { method: 'DELETE' });
    } catch {
      console.error('Could not remove the temporary staging signup user');
    }
  }
}
