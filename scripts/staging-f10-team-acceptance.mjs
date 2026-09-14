import { execFileSync } from 'node:child_process';

const required = [
  'STAGING_APP_ORIGIN',
  'STAGING_DATABASE_URL',
  'STAGING_OWNER_A_EMAIL',
  'STAGING_OWNER_A_PASSWORD',
  'STAGING_OWNER_B_EMAIL',
  'STAGING_OWNER_B_PASSWORD',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required F10-02 staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const dbUrl = process.env.STAGING_DATABASE_URL;
const ownerAEmail = process.env.STAGING_OWNER_A_EMAIL.trim().toLowerCase();
const ownerAPassword = process.env.STAGING_OWNER_A_PASSWORD;
const ownerBEmail = process.env.STAGING_OWNER_B_EMAIL.trim().toLowerCase();
const ownerBPassword = process.env.STAGING_OWNER_B_PASSWORD;

const BUSINESS_A = 'f1700000-0000-4000-8000-000000000001';
const BUSINESS_B = 'f1700000-0000-4000-8000-000000000002';
const OWNER_A_MEMBERSHIP = 'f1710000-0000-4000-8000-000000000001';
const OWNER_B_MEMBERSHIP = 'f1710000-0000-4000-8000-000000000002';
const STAFF_A = 'f1730000-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const PERMISSION = 'payments_write';

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
    if (!cookieValue || /(?:^|;)\s*max-age=0(?:;|$)/i.test(value)) jar.delete(name);
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
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  absorbCookies(jar, response);
  const text = await response.text();
  return { response, text, data: jsonBody(text) };
}

async function csrf(jar) {
  const result = await appRequest(jar, '/api/csrf');
  const token = String(result.data?.csrfToken ?? '');
  if (!result.response.ok || !INVITE_TOKEN.test(token) || jar.get('yzt_csrf') !== token) {
    throw new Error(`F10-02 staging CSRF bootstrap failed with HTTP ${result.response.status}`);
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psqlScalar(sql) {
  try {
    return execFileSync(
      'psql',
      [dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 },
    ).trim();
  } catch {
    throw new Error('F10-02 staging SQL operation failed');
  }
}

function assertUuid(value, label) {
  const normalized = String(value ?? '');
  if (!UUID.test(normalized)) throw new Error(`${label} was not a UUID`);
  return normalized;
}

async function loginOnly(email, password) {
  const jar = new Map();
  const csrfToken = await csrf(jar);
  const login = await browserMutation(jar, '/api/auth/login', 'POST', { email, password }, csrfToken);
  if (!login.response.ok || login.data?.ok !== true || !jar.has('yzt_access') || !jar.has('yzt_refresh')) {
    throw new Error(`F10-02 real staging login failed with HTTP ${login.response.status}`);
  }
  if (login.text.includes('access_token') || login.text.includes('refresh_token')) {
    throw new Error('F10-02 login exposed session tokens to application JavaScript');
  }
  const session = await appRequest(jar, '/api/session');
  if (!session.response.ok || String(session.data?.user?.email ?? '').toLowerCase() !== email) {
    throw new Error(`F10-02 staging session lookup failed with HTTP ${session.response.status}`);
  }
  return {
    jar,
    csrfToken: String(session.data?.csrfToken ?? csrfToken),
    userId: assertUuid(session.data?.user?.id, 'F10-02 staging user id'),
  };
}

async function selectFixtureBusiness(actor, businessId) {
  const session = await appRequest(actor.jar, '/api/session');
  if (!session.response.ok || !Array.isArray(session.data?.memberships)) {
    throw new Error(`F10-02 staging membership read failed with HTTP ${session.response.status}`);
  }
  const membership = session.data.memberships.find((item) => item?.business_id === businessId && item?.active !== false);
  if (!membership) throw new Error('F10-02 canonical fixture membership is missing');
  const result = await browserMutation(
    actor.jar,
    '/api/businesses/select',
    'POST',
    { businessId },
    String(session.data?.csrfToken ?? actor.csrfToken),
  );
  if (!result.response.ok || result.data?.ok !== true || actor.jar.get('yzt_business') !== businessId) {
    throw new Error(`F10-02 fixture business selection failed with HTTP ${result.response.status}`);
  }
  actor.csrfToken = String(session.data?.csrfToken ?? actor.csrfToken);
  return membership;
}

function canonicalizeFixture(ownerAId, ownerBId) {
  const result = psqlScalar(`
    begin;
    select pg_advisory_xact_lock(hashtextextended(${sqlLiteral(BUSINESS_A)}, 0));
    update public.staff_profiles
      set membership_id = null
      where id = ${sqlLiteral(STAFF_A)}::uuid and business_id = ${sqlLiteral(BUSINESS_A)}::uuid;
    delete from public.business_invitations
      where business_id = ${sqlLiteral(BUSINESS_A)}::uuid
        and email_normalized = ${sqlLiteral(ownerBEmail)};
    update public.memberships
      set role = 'owner', active = true, updated_at = now()
      where business_id = ${sqlLiteral(BUSINESS_A)}::uuid and user_id = ${sqlLiteral(ownerAId)}::uuid;
    update public.memberships
      set role = 'owner', active = true, updated_at = now()
      where business_id = ${sqlLiteral(BUSINESS_B)}::uuid and user_id = ${sqlLiteral(ownerBId)}::uuid;
    delete from public.memberships
      where business_id = ${sqlLiteral(BUSINESS_A)}::uuid and user_id = ${sqlLiteral(ownerBId)}::uuid;
    commit;
    select concat_ws(':',
      (select count(*) from public.memberships where business_id = ${sqlLiteral(BUSINESS_A)}::uuid and user_id = ${sqlLiteral(ownerAId)}::uuid and role = 'owner' and active),
      (select count(*) from public.memberships where business_id = ${sqlLiteral(BUSINESS_B)}::uuid and user_id = ${sqlLiteral(ownerBId)}::uuid and role = 'owner' and active),
      (select count(*) from public.memberships where business_id = ${sqlLiteral(BUSINESS_A)}::uuid and user_id = ${sqlLiteral(ownerBId)}::uuid),
      (select count(*) from public.business_invitations where business_id = ${sqlLiteral(BUSINESS_A)}::uuid and email_normalized = ${sqlLiteral(ownerBEmail)}),
      (select count(*) from public.staff_profiles where id = ${sqlLiteral(STAFF_A)}::uuid and membership_id is not null)
    );
  `);
  if (result !== '1:1:0:0:0') throw new Error('F10-02 canonical staging fixture could not be restored');
}

async function createInvite(ownerA, role = 'staff') {
  const result = await browserMutation(
    ownerA.jar,
    '/api/team/invitations',
    'POST',
    { email: ownerBEmail, role },
    ownerA.csrfToken,
  );
  if (result.response.status !== 201) {
    throw new Error(`F10-02 invitation creation failed with HTTP ${result.response.status}`);
  }
  const invitationId = assertUuid(result.data?.invitation?.invitation_id, 'F10-02 invitation id');
  const inviteUrl = String(result.data?.inviteUrl ?? '');
  let parsed;
  try { parsed = new URL(inviteUrl); } catch { throw new Error('F10-02 invite response did not contain a valid URL'); }
  const token = parsed.hash.startsWith('#invite=') ? parsed.hash.slice('#invite='.length) : '';
  if (parsed.origin !== origin || parsed.pathname !== '/' || !INVITE_TOKEN.test(token)) {
    throw new Error('F10-02 invitation URL violated the fragment capability contract');
  }
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${token}\n`);
  return { invitationId, token };
}

async function acceptInvite(actor, token) {
  return browserMutation(
    actor.jar,
    '/api/team/invitations/accept',
    'POST',
    { token },
    actor.csrfToken,
  );
}

async function teamRead(actor) {
  const result = await appRequest(actor.jar, '/api/team');
  if (!result.response.ok || !result.data?.team) {
    throw new Error(`F10-02 team snapshot failed with HTTP ${result.response.status}`);
  }
  return result.data.team;
}

let ownerA = null;
let ownerB = null;
let cleanupRequired = false;
let primaryError = null;

try {
  ownerA = await loginOnly(ownerAEmail, ownerAPassword);
  ownerB = await loginOnly(ownerBEmail, ownerBPassword);

  canonicalizeFixture(ownerA.userId, ownerB.userId);
  cleanupRequired = true;

  const membershipA = await selectFixtureBusiness(ownerA, BUSINESS_A);
  const membershipB = await selectFixtureBusiness(ownerB, BUSINESS_B);
  if (membershipA.id !== OWNER_A_MEMBERSHIP || membershipB.id !== OWNER_B_MEMBERSHIP) {
    throw new Error('F10-02 staging acceptance refused a non-canonical fixture membership');
  }

  const firstInvite = await createInvite(ownerA, 'staff');

  const wrongAccount = await acceptInvite(ownerA, firstInvite.token);
  await expectError(wrongAccount, 403, 'INVITATION_EMAIL_MISMATCH', 'wrong-account invitation');

  const accepted = await acceptInvite(ownerB, firstInvite.token);
  if (!accepted.response.ok
      || accepted.data?.membership?.business_id !== BUSINESS_A
      || accepted.data?.membership?.role !== 'staff') {
    throw new Error(`F10-02 correct invitation acceptance failed with HTTP ${accepted.response.status}`);
  }
  const inviteeMembership = assertUuid(accepted.data?.membership?.membership_id, 'F10-02 accepted membership id');
  if (ownerB.jar.get('yzt_business') !== BUSINESS_A) {
    throw new Error('F10-02 invitation acceptance did not select its authoritative business');
  }

  const replay = await acceptInvite(ownerB, firstInvite.token);
  await expectError(replay, 409, 'INVITATION_ALREADY_USED', 'invitation replay');

  // Selected-business authority cannot be used to mutate a membership from a
  // different tenant, even though this account is a real owner in both fixtures.
  await selectFixtureBusiness(ownerB, BUSINESS_B);
  const crossTenantMembership = await browserMutation(
    ownerB.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'staff', active: true },
    ownerB.csrfToken,
  );
  await expectError(crossTenantMembership, 404, 'MEMBERSHIP_NOT_FOUND', 'cross-tenant membership update');
  await selectFixtureBusiness(ownerB, BUSINESS_A);

  const staffEscalation = await browserMutation(
    ownerB.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'manager', active: true },
    ownerB.csrfToken,
  );
  await expectError(staffEscalation, 403, 'NOT_ALLOWED', 'staff self-escalation');

  const promoteManager = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'manager', active: true },
    ownerA.csrfToken,
  );
  if (!promoteManager.response.ok || promoteManager.data?.membership?.role !== 'manager') {
    throw new Error(`F10-02 manager promotion failed with HTTP ${promoteManager.response.status}`);
  }

  const managerOwnerEscalation = await browserMutation(
    ownerB.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'owner', active: true },
    ownerB.csrfToken,
  );
  await expectError(managerOwnerEscalation, 403, 'OWNER_ROLE_REQUIRES_OWNER', 'manager owner escalation');

  const managerFinance = await browserMutation(
    ownerB.jar,
    `/api/team/members/${inviteeMembership}/financial-permissions/${PERMISSION}`,
    'PUT',
    { enabled: true },
    ownerB.csrfToken,
  );
  await expectError(managerFinance, 403, 'FINANCIAL_PERMISSION_OWNER_REQUIRED', 'manager financial grant');

  const demoteStaff = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'staff', active: true },
    ownerA.csrfToken,
  );
  if (!demoteStaff.response.ok || demoteStaff.data?.membership?.role !== 'staff') {
    throw new Error(`F10-02 staff demotion failed with HTTP ${demoteStaff.response.status}`);
  }

  const grant = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}/financial-permissions/${PERMISSION}`,
    'PUT',
    { enabled: true },
    ownerA.csrfToken,
  );
  if (!grant.response.ok || grant.data?.enabled !== true) {
    throw new Error(`F10-02 owner financial grant failed with HTTP ${grant.response.status}`);
  }
  const grantedSnapshot = await teamRead(ownerB);
  if (!Array.isArray(grantedSnapshot.effectiveFinancialPermissions)
      || !grantedSnapshot.effectiveFinancialPermissions.includes(PERMISSION)) {
    throw new Error('F10-02 granted financial permission was not effective on the next request');
  }

  const revokeGrant = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}/financial-permissions/${PERMISSION}`,
    'PUT',
    { enabled: false },
    ownerA.csrfToken,
  );
  if (!revokeGrant.response.ok || revokeGrant.data?.enabled !== false) {
    throw new Error(`F10-02 owner financial revoke failed with HTTP ${revokeGrant.response.status}`);
  }
  const revokedSnapshot = await teamRead(ownerB);
  if (revokedSnapshot.effectiveFinancialPermissions?.includes(PERMISSION)) {
    throw new Error('F10-02 revoked financial permission survived the next request');
  }

  const link = await browserMutation(
    ownerA.jar,
    `/api/team/staff/${STAFF_A}/membership`,
    'PUT',
    { membershipId: inviteeMembership },
    ownerA.csrfToken,
  );
  if (!link.response.ok || link.data?.membershipId !== inviteeMembership) {
    throw new Error(`F10-02 staff-membership link failed with HTTP ${link.response.status}`);
  }
  const linkedSnapshot = await teamRead(ownerA);
  if (linkedSnapshot.staff?.find((item) => item.id === STAFF_A)?.membershipId !== inviteeMembership) {
    throw new Error('F10-02 team snapshot did not expose the intended staff-membership link');
  }

  const unlink = await browserMutation(
    ownerA.jar,
    `/api/team/staff/${STAFF_A}/membership`,
    'PUT',
    { membershipId: null },
    ownerA.csrfToken,
  );
  if (!unlink.response.ok || unlink.data?.membershipId !== null) {
    throw new Error(`F10-02 staff-membership unlink failed with HTTP ${unlink.response.status}`);
  }

  const deactivate = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'staff', active: false },
    ownerA.csrfToken,
  );
  if (!deactivate.response.ok || deactivate.data?.membership?.active !== false) {
    throw new Error(`F10-02 membership deactivation failed with HTTP ${deactivate.response.status}`);
  }
  const deactivatedSession = await appRequest(ownerB.jar, '/api/team');
  await expectError(deactivatedSession, 403, 'TENANT_REQUIRED', 'deactivated open session');
  if (ownerB.jar.has('yzt_business')) {
    throw new Error('F10-02 deactivated session retained its selected business cookie');
  }

  const revokedInvite = await createInvite(ownerA, 'staff');
  const revokeInvite = await browserMutation(
    ownerA.jar,
    `/api/team/invitations/${revokedInvite.invitationId}/revoke`,
    'POST',
    {},
    ownerA.csrfToken,
  );
  if (!revokeInvite.response.ok || revokeInvite.data?.ok !== true) {
    throw new Error(`F10-02 invitation revoke failed with HTTP ${revokeInvite.response.status}`);
  }
  const revokedAccept = await acceptInvite(ownerB, revokedInvite.token);
  await expectError(revokedAccept, 409, 'INVITATION_REVOKED', 'revoked invitation acceptance');

  const expiredInvite = await createInvite(ownerA, 'staff');
  const expiredUpdated = psqlScalar(`
    update public.business_invitations
    set created_at = now() - interval '2 hours',
        expires_at = now() - interval '1 hour'
    where id = ${sqlLiteral(expiredInvite.invitationId)}::uuid
      and business_id = ${sqlLiteral(BUSINESS_A)}::uuid
      and email_normalized = ${sqlLiteral(ownerBEmail)}
    returning 1;
  `);
  if (expiredUpdated !== '1') throw new Error('F10-02 could not prepare the bounded expiry fixture');
  const expiredAccept = await acceptInvite(ownerB, expiredInvite.token);
  await expectError(expiredAccept, 409, 'INVITATION_EXPIRED', 'expired invitation acceptance');

  const promoteOwner = await browserMutation(
    ownerA.jar,
    `/api/team/members/${inviteeMembership}`,
    'PATCH',
    { role: 'owner', active: true },
    ownerA.csrfToken,
  );
  if (!promoteOwner.response.ok || promoteOwner.data?.membership?.role !== 'owner') {
    throw new Error(`F10-02 second-owner preparation failed with HTTP ${promoteOwner.response.status}`);
  }
  await selectFixtureBusiness(ownerB, BUSINESS_A);

  const [raceA, raceB] = await Promise.all([
    browserMutation(
      ownerA.jar,
      `/api/team/members/${inviteeMembership}`,
      'PATCH',
      { role: 'staff', active: false },
      ownerA.csrfToken,
    ),
    browserMutation(
      ownerB.jar,
      `/api/team/members/${OWNER_A_MEMBERSHIP}`,
      'PATCH',
      { role: 'staff', active: false },
      ownerB.csrfToken,
    ),
  ]);
  const raceStatuses = [raceA.response.status, raceB.response.status].sort((left, right) => left - right);
  if (raceStatuses[0] !== 200 || raceStatuses[1] !== 403) {
    throw new Error(`F10-02 last-owner race expected one success and one denial, got ${raceStatuses.join('/')}`);
  }
  const activeOwners = psqlScalar(`
    select count(*)
    from public.memberships
    where business_id = ${sqlLiteral(BUSINESS_A)}::uuid
      and active and role = 'owner';
  `);
  if (activeOwners !== '1') throw new Error('F10-02 concurrent owner race left an invalid active-owner count');

  console.log('F10-02 staging acceptance passed: two real Auth accounts, invite binding/replay/revoke/expiry, tenant boundary, role and financial permissions, staff link, live deactivation and last-owner race verified.');
} catch (error) {
  primaryError = error;
} finally {
  if (cleanupRequired && ownerA?.userId && ownerB?.userId) {
    try {
      canonicalizeFixture(ownerA.userId, ownerB.userId);
    } catch {
      throw new Error('F10-02 staging acceptance cleanup failed; canonical fixture requires repair before reuse');
    }
  }
}

if (primaryError) throw primaryError;
