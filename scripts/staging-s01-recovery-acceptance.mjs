import { randomBytes } from 'node:crypto';

const required = [
  'STAGING_APP_ORIGIN',
  'SUPABASE_URL',
  'SUPABASE_ADMIN_KEY',
  'RESEND_ACCEPTANCE_API_KEY',
  'S01_RECOVERY_EMAIL',
];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required S01 staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const adminKey = process.env.SUPABASE_ADMIN_KEY.trim();
const resendKey = process.env.RESEND_ACCEPTANCE_API_KEY.trim();
const recoveryEmail = process.env.S01_RECOVERY_EMAIL.trim().toLowerCase();
const initialPassword = `Rdv!S01-Initial-${randomBytes(18).toString('base64url')}9a`;
const updatedPassword = `Rdv!S01-Updated-${randomBytes(18).toString('base64url')}8b`;
const allowedCallbackOrigin = new URL(origin).origin;
const supabaseHost = new URL(supabaseUrl).hostname;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
  throw new Error('S01_RECOVERY_EMAIL must be a valid test mailbox address');
}
if (recoveryEmail.endsWith('@example.com') || recoveryEmail.endsWith('@example.test')) {
  throw new Error('S01_RECOVERY_EMAIL must be a real receiving mailbox, not an example domain');
}

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
    throw new Error(`S01 CSRF bootstrap failed with HTTP ${result.response.status}`);
  }
  return token;
}

function browserHeaders(csrfToken) {
  return {
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'X-YZT-CSRF': csrfToken,
  };
}

async function browserMutation(jar, path, method, body, csrfToken) {
  return appRequest(jar, path, {
    method,
    headers: browserHeaders(csrfToken),
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
  return { ...result, jar };
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

async function findUserByEmail(email) {
  const payload = await adminRequest('users?page=1&per_page=1000');
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.find((user) => String(user?.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
}

async function resendRequest(path) {
  const response = await fetch(`https://api.resend.com${path}`, {
    headers: {
      Authorization: `Bearer ${resendKey}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  const data = jsonBody(text);
  if (!response.ok) {
    const scopeHint = response.status === 401 || response.status === 403
      ? ' The acceptance key must have Resend full_access permission.'
      : '';
    throw new Error(`Resend mailbox request failed with HTTP ${response.status}.${scopeHint}`);
  }
  return data;
}

async function listReceivedEmails() {
  const payload = await resendRequest('/emails/receiving?limit=100');
  return Array.isArray(payload?.data) ? payload.data : [];
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&#x3D;', '=')
    .replaceAll('&#61;', '=');
}

function emailLinks(email) {
  const source = decodeHtmlEntities(`${email?.html ?? ''}\n${email?.text ?? ''}`);
  const links = [];
  for (const match of source.matchAll(/href=["']([^"']+)["']/gi)) links.push(match[1]);
  for (const match of source.matchAll(/https?:\/\/[^\s"'<>]+/gi)) links.push(match[0]);
  return [...new Set(links.map((link) => decodeHtmlEntities(link).replace(/[).,;]+$/, '')))]
    .filter((link) => {
      try { return new URL(link).protocol === 'https:'; } catch { return false; }
    })
    .sort((left, right) => {
      const score = (value) => Number(value.includes('/auth/v1/verify')) * 4
        + Number(value.includes('type=recovery')) * 2
        + Number(value.includes('token='));
      return score(right) - score(left);
    });
}

async function followToCallback(candidate) {
  let current = candidate;
  let initialHost = '';
  try { initialHost = new URL(candidate).hostname; } catch { return null; }

  for (let hop = 0; hop < 8; hop += 1) {
    const currentUrl = new URL(current);
    if (currentUrl.origin === allowedCallbackOrigin && currentUrl.pathname === '/api/auth/callback') {
      return `${currentUrl.pathname}${currentUrl.search}`;
    }

    const allowedHost = currentUrl.hostname === initialHost
      || currentUrl.hostname === supabaseHost
      || currentUrl.origin === allowedCallbackOrigin;
    if (!allowedHost || currentUrl.protocol !== 'https:') return null;

    const response = await fetch(current, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) return null;
    current = new URL(location, current).toString();
  }
  return null;
}

async function callbackFromMailbox(previousIds) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const messages = await listReceivedEmails();
    const candidates = messages
      .filter((message) => !previousIds.has(String(message?.id ?? '')))
      .filter((message) => Array.isArray(message?.to)
        && message.to.some((recipient) => String(recipient).toLowerCase() === recoveryEmail))
      .sort((left, right) => Date.parse(String(right?.created_at ?? 0)) - Date.parse(String(left?.created_at ?? 0)));

    for (const message of candidates) {
      const id = String(message?.id ?? '');
      if (!id) continue;
      const detail = await resendRequest(`/emails/receiving/${encodeURIComponent(id)}`);
      for (const link of emailLinks(detail)) {
        const callbackPath = await followToCallback(link);
        if (callbackPath) return callbackPath;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Public recovery email did not reach the configured Resend test mailbox in time');
}

let userId = null;
try {
  // Fail before mutating Auth if the mailbox API or key scope is unavailable.
  const existingMessages = await listReceivedEmails();
  const previousIds = new Set(existingMessages.map((message) => String(message?.id ?? '')).filter(Boolean));

  const staleUser = await findUserByEmail(recoveryEmail);
  if (staleUser?.id) await adminRequest(`users/${staleUser.id}`, { method: 'DELETE' });

  const created = await adminRequest('users', {
    method: 'POST',
    body: JSON.stringify({
      email: recoveryEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { full_name: 'S01 Recovery Acceptance' },
    }),
  });
  userId = created?.id ?? created?.user?.id ?? null;
  if (!userId) throw new Error('Could not create the temporary S01 Auth user');

  const normal = await login(recoveryEmail, initialPassword);
  if (!normal.response.ok || normal.data?.ok !== true) {
    throw new Error(`Temporary S01 user login failed with HTTP ${normal.response.status}`);
  }
  normal.jar.set('yzt_password_recovery', '1');
  const normalSession = await appRequest(normal.jar, '/api/session');
  if (!normalSession.response.ok || normalSession.data?.passwordRecovery !== false || normal.jar.has('yzt_password_recovery')) {
    throw new Error('A forged recovery marker changed a normal hosted session');
  }

  const recoveryJar = new Map();
  const recoveryCsrf = await csrf(recoveryJar);
  const requested = await browserMutation(
    recoveryJar,
    '/api/auth/recovery',
    'POST',
    { email: recoveryEmail },
    recoveryCsrf,
  );
  if (requested.response.status !== 202 || requested.data?.ok !== true || !recoveryJar.has('yzt_auth_flows')) {
    throw new Error(`Public recovery request failed with HTTP ${requested.response.status}`);
  }

  const callbackPath = await callbackFromMailbox(previousIds);
  const callback = await appRequest(recoveryJar, callbackPath);
  if (callback.response.status !== 303 || callback.response.headers.get('location') !== `${origin}/?auth=recovery`) {
    throw new Error(`Public recovery PKCE callback failed with HTTP ${callback.response.status}`);
  }
  if (!recoveryJar.has('yzt_access') || !recoveryJar.has('yzt_refresh')) {
    throw new Error('Public recovery callback did not install the HttpOnly session');
  }
  if (callback.text.includes('access_token') || callback.text.includes('refresh_token')) {
    throw new Error('Public recovery callback exposed bearer values');
  }

  const recoverySession = await appRequest(recoveryJar, '/api/session');
  if (!recoverySession.response.ok || recoverySession.data?.user?.id !== userId || recoverySession.data?.passwordRecovery !== true) {
    throw new Error('Public recovery session was not classified as password-update-only');
  }

  recoveryJar.delete('yzt_password_recovery');
  const markerless = await appRequest(recoveryJar, '/api/session');
  if (!markerless.response.ok || markerless.data?.passwordRecovery !== true || recoveryJar.get('yzt_password_recovery') !== '1') {
    throw new Error('Deleting the recovery marker widened the hosted session');
  }

  const secondTab = new Map([
    ['yzt_access', recoveryJar.get('yzt_access')],
    ['yzt_refresh', recoveryJar.get('yzt_refresh')],
  ]);
  const secondTabSession = await appRequest(secondTab, '/api/session');
  if (!secondTabSession.response.ok || secondTabSession.data?.passwordRecovery !== true) {
    throw new Error('A second tab lost the hosted recovery session authority');
  }
  const secondTabCatalog = await appRequest(secondTab, '/api/catalog');
  await expectError(secondTabCatalog, 403, 'PASSWORD_UPDATE_REQUIRED', 'second-tab recovery catalog');
  const secondTabAvailability = await appRequest(secondTab, '/api/availability/setup');
  await expectError(secondTabAvailability, 403, 'PASSWORD_UPDATE_REQUIRED', 'second-tab recovery availability');

  const accessBeforeRefresh = secondTab.get('yzt_access');
  secondTab.delete('yzt_password_recovery');
  secondTab.set('yzt_access', 's01-expired-access-token');
  const refreshed = await appRequest(secondTab, '/api/session');
  if (!refreshed.response.ok
      || refreshed.data?.passwordRecovery !== true
      || !secondTab.get('yzt_access')
      || secondTab.get('yzt_access') === 's01-expired-access-token'
      || secondTab.get('yzt_access') === accessBeforeRefresh
      || secondTab.get('yzt_password_recovery') !== '1') {
    throw new Error('Refresh rotation did not preserve hosted recovery authority');
  }

  const invalid = await browserMutation(
    secondTab,
    '/api/auth/confirm',
    'POST',
    { tokenHash: 'A'.repeat(32), type: 'recovery' },
    refreshed.data.csrfToken,
  );
  await expectError(invalid, 400, 'AUTH_LINK_INVALID', 'invalid confirmation during recovery');
  secondTab.delete('yzt_password_recovery');
  const afterInvalid = await appRequest(secondTab, '/api/catalog');
  await expectError(afterInvalid, 403, 'PASSWORD_UPDATE_REQUIRED', 'recovery catalog after invalid confirmation');

  const replay = await appRequest(secondTab, callbackPath);
  if (replay.response.status !== 303 || replay.response.headers.get('location') !== `${origin}/?auth=link-invalid`) {
    throw new Error('Replayed PKCE callback was not rejected');
  }
  const afterReplay = await appRequest(secondTab, '/api/session');
  if (!afterReplay.response.ok || afterReplay.data?.passwordRecovery !== true) {
    throw new Error('Replayed callback widened the existing recovery session');
  }

  const oldBearerJar = new Map([
    ['yzt_access', secondTab.get('yzt_access')],
    ['yzt_refresh', secondTab.get('yzt_refresh')],
  ]);
  const passwordUpdate = await browserMutation(
    secondTab,
    '/api/auth/password',
    'PUT',
    { password: updatedPassword },
    afterReplay.data.csrfToken,
  );
  if (!passwordUpdate.response.ok || passwordUpdate.data?.ok !== true || passwordUpdate.data?.signedOut !== true) {
    throw new Error(`Public recovery password update failed with HTTP ${passwordUpdate.response.status}`);
  }
  if (secondTab.has('yzt_access') || secondTab.has('yzt_refresh') || secondTab.has('yzt_password_recovery')) {
    throw new Error('Password update did not clear the active recovery browser session');
  }

  const oldBearerSession = await appRequest(oldBearerJar, '/api/session');
  if (oldBearerSession.response.ok && oldBearerSession.data?.user && oldBearerSession.data?.passwordRecovery !== true) {
    throw new Error('An old recovery bearer became a normal hosted session after password update');
  }
  const oldBearerCatalog = await appRequest(oldBearerJar, '/api/catalog');
  if (oldBearerCatalog.response.ok) {
    throw new Error('An old recovery bearer accessed the catalog after password update');
  }
  const oldBearerCode = oldBearerCatalog.data?.error?.code;
  if (!['PASSWORD_UPDATE_REQUIRED', 'AUTH_REQUIRED'].includes(oldBearerCode)) {
    throw new Error(`Old recovery bearer failed with unexpected code ${oldBearerCode ?? 'unknown'}`);
  }

  const oldPassword = await login(recoveryEmail, initialPassword);
  await expectError(oldPassword, 401, 'LOGIN_FAILED', 'old password after public recovery');
  const newPassword = await login(recoveryEmail, updatedPassword);
  if (!newPassword.response.ok || newPassword.data?.ok !== true) {
    throw new Error(`Updated password login failed with HTTP ${newPassword.response.status}`);
  }
  const newSession = await appRequest(newPassword.jar, '/api/session');
  if (!newSession.response.ok || newSession.data?.passwordRecovery !== false) {
    throw new Error('Updated password established an unexpected recovery session');
  }

  console.log('S01 staging acceptance passed: public mailbox recovery, PKCE, marker deletion, refresh, second tab, replay, password update and old-bearer boundary verified.');
} finally {
  if (userId) {
    try { await adminRequest(`users/${userId}`, { method: 'DELETE' }); }
    catch { console.error('Could not delete the temporary S01 Auth user'); }
  }
}
