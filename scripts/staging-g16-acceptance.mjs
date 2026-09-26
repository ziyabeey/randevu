import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { formatG16ProviderFailure } from './staging-g16-provider-diagnostics.mjs';
import {
  normalizeWhatsappPhone,
  sendWhatsappVerificationCode,
  netgsmWhatsappConfigured,
} from '../worker/whatsapp-verify.ts';

const required = [
  'STAGING_APP_ORIGIN',
  'STAGING_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'STAGING_OWNER_A_EMAIL',
  'STAGING_OWNER_A_PASSWORD',
  'STAGING_OWNER_B_EMAIL',
  'STAGING_OWNER_B_PASSWORD',
  'NETGSM_USERCODE',
  'NETGSM_PASSWORD',
  'NETGSM_ACCEPTANCE_PHONE',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required G16 staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const dbUrl = process.env.STAGING_DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY;
const businessA = 'f1700000-0000-4000-8000-000000000001';
const businessB = 'f1700000-0000-4000-8000-000000000002';
const netgsmConfig = netgsmWhatsappConfigured(process.env);
if (!netgsmConfig) throw new Error('G16 Netgsm acceptance configuration is invalid');

function jsonBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  try {
    return execFileSync(
      'psql',
      ['--no-psqlrc', dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql],
      {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000, maxBuffer: 128 * 1024,
        env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
      },
    ).trim();
  } catch (error) {
    // Do not attach the original error: it can carry SQL, URI, stdout and stderr.
    const kind = error?.code === 'ETIMEDOUT' ? 'timeout'
      : error?.code === 'ENOBUFS' ? 'buffer_limit'
        : Number.isInteger(error?.status) ? `exit_${error.status}` : 'spawn_error';
    throw new Error(`G16 database command failed: ${kind}`);
  }
}

async function request(url, init = {}) {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error('G16 HTTP request failed');
  }
}

async function responseBytes(response) {
  try { return new Uint8Array(await response.arrayBuffer()); }
  catch { throw new Error('G16 HTTP response read failed'); }
}

async function responseText(response) {
  try { return await response.text(); }
  catch { throw new Error('G16 HTTP response read failed'); }
}

async function requireStorageDenial(response, label, missingOnly = false) {
  const data = jsonBody(await responseText(response));
  const code = data?.code ?? data?.error;
  const status = Number(data?.statusCode ?? data?.httpStatusCode ?? response.status);
  // A legacy HTTP 400 can wrap object-not-found 404. Never accept a bare 400,
  // InvalidJWT, NoSuchBucket, throttling, an HTML proxy response or an outage.
  const missing = [400, 404].includes(response.status) && status === 404
    && ['NoSuchKey', 'not_found'].includes(code);
  const denied = response.status === 403 && status === 403
    && ['AccessDenied', 'unauthorized'].includes(code);
  if (!missing && !(denied && !missingOnly)) {
    throw new Error(`${label} with expected Storage semantics (HTTP ${response.status})`);
  }
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
  const response = await request(`${origin}${path}`, { ...init, headers });
  absorbCookies(jar, response);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const text = await responseText(response);
    return { response, text, data: jsonBody(text), bytes: null };
  }
  const bytes = await responseBytes(response);
  return { response, text: '', data: null, bytes };
}

async function csrf(jar) {
  const result = await appRequest(jar, '/api/csrf', { headers: { Accept: 'application/json' } });
  const token = String(result.data?.csrfToken ?? '');
  if (!result.response.ok || !/^[A-Za-z0-9_-]{43,128}$/.test(token) || jar.get('yzt_csrf') !== token) {
    throw new Error(`G16 CSRF bootstrap failed with HTTP ${result.response.status}`);
  }
  return token;
}

function browserMutationHeaders(csrfToken, businessId, contentType = 'application/json') {
  return {
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    'X-YZT-CSRF': csrfToken,
    'X-YZT-Business': businessId,
    'Content-Type': contentType,
    Accept: 'application/json',
  };
}

function readHeaders(businessId) {
  return { 'X-YZT-Business': businessId, Accept: 'application/json' };
}

async function login(email, password, businessId) {
  const jar = new Map();
  const csrfToken = await csrf(jar);
  const result = await appRequest(jar, '/api/auth/login', {
    method: 'POST',
    headers: browserMutationHeaders(csrfToken, businessId),
    body: JSON.stringify({ email, password }),
  });
  if (!result.response.ok || result.data?.ok !== true) {
    throw new Error(`G16 staging login failed with HTTP ${result.response.status}`);
  }
  return { jar, csrfToken };
}

async function supabasePasswordToken(email, password) {
  const response = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await responseText(response);
  const data = jsonBody(text);
  const token = String(data?.access_token ?? '');
  if (!response.ok || !token) throw new Error(`G16 Supabase password auth failed with HTTP ${response.status}`);
  return token;
}

async function storageRead(path, bearer = null) {
  const headers = { apikey: anonKey, Accept: 'image/webp' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return request(`${supabaseUrl}/storage/v1/object/appointment-private-media/${path}`, { headers });
}

function validWebp() {
  // Complete 1x1 lossless WebP, not merely a dimensions header.
  return Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQkEY0qP+BiOh/AAA=', 'base64');
}

function requireExactImage(response, bytes, expected, label) {
  if (response.status !== 200
      || response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'image/webp'
      || !Buffer.from(bytes ?? []).equals(expected)) {
    throw new Error(`${label} failed with HTTP ${response.status}: image bytes/type mismatch`);
  }
}

function resolveAcceptancePhone() {
  const explicit = String(process.env.NETGSM_ACCEPTANCE_PHONE ?? '').trim();
  if (!explicit) throw new Error('G16 Netgsm acceptance requires staging secret NETGSM_ACCEPTANCE_PHONE');
  const normalized = normalizeWhatsappPhone(explicit);
  if (!normalized) throw new Error('G16 Netgsm acceptance phone is not a supported Turkish mobile number');
  return normalized;
}

async function verifyNetgsmOtpSend() {
  const acceptancePhone = resolveAcceptancePhone();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const sent = await sendWhatsappVerificationCode(process.env, acceptancePhone, code);
  if (sent.status !== 'sent' || sent.providerCode !== '00') {
    // Preserve only approved failure classes; never echo provider details.
    const errorClass = formatG16ProviderFailure(sent);
    throw new Error(`Netgsm verified-recipient OTP send failed: ${errorClass}`);
  }
  console.log('G16 Netgsm verified-recipient OTP send accepted by provider: code 00.');
}

async function verifyHostedPrivateStorage() {
  const customerId = randomUUID();
  const groupId = randomUUID();
  const image = validWebp();
  let mediaId = null;
  let storagePath = null;
  let ownerA = null;
  let uploadStarted = false;
  let mediaRemoved = false;
  let primaryFailure = null;
  const cleanupFailures = [];

  async function deleteMedia() {
    const deleted = await appRequest(ownerA.jar, `/api/private-media/${mediaId}`, {
      method: 'DELETE',
      headers: browserMutationHeaders(ownerA.csrfToken, businessA),
    });
    if (!deleted.response.ok || deleted.data?.deleted !== true) {
      throw new Error(`Hosted private-media cleanup delete failed with HTTP ${deleted.response.status}`);
    }
    // A failed read alone may reflect RLS rather than deletion. Check the exact
    // object metadata too. This is not a claim about provider backup retention.
    const remaining = psql(`select count(*) from storage.objects
      where bucket_id = 'appointment-private-media' and name = ${sqlLiteral(storagePath)};`);
    if (remaining !== '0') throw new Error('G16 Storage metadata remains after delete');
    mediaRemoved = true;
    mediaId = null;
  }

  try {
    // Cleanup is armed before seeding, including a lost response after COMMIT.
    psql(`
      begin;
      insert into public.customers(id, business_id, name, created_by)
      values (${sqlLiteral(customerId)}::uuid, ${sqlLiteral(businessA)}::uuid, 'G16 Hosted Smoke', null);
      insert into public.appointment_groups(id, business_id, customer_id, status, source, version, created_by)
      values (${sqlLiteral(groupId)}::uuid, ${sqlLiteral(businessA)}::uuid, ${sqlLiteral(customerId)}::uuid, 'scheduled', 'operator', 1, null);
      commit;
    `);
    ownerA = await login(
      process.env.STAGING_OWNER_A_EMAIL.trim().toLowerCase(),
      process.env.STAGING_OWNER_A_PASSWORD,
      businessA,
    );
    const ownerB = await login(
      process.env.STAGING_OWNER_B_EMAIL.trim().toLowerCase(),
      process.env.STAGING_OWNER_B_PASSWORD,
      businessB,
    );

    uploadStarted = true;
    const upload = await appRequest(ownerA.jar, `/api/bookings/groups/${groupId}/photos?caption=G16%20hosted%20smoke`, {
      method: 'POST',
      headers: browserMutationHeaders(ownerA.csrfToken, businessA, 'image/webp'),
      body: image,
    });
    const uploadedId = String(upload.data?.photo?.id ?? '');
    if (upload.response.status !== 201 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uploadedId)) {
      throw new Error(`Hosted private-media upload failed with HTTP ${upload.response.status}`);
    }
    mediaId = uploadedId;
    storagePath = `${businessA}/${groupId}/${mediaId}.webp`;

    const workerRead = await appRequest(ownerA.jar, `/api/private-media/${mediaId}/content`, {
      headers: { 'X-YZT-Business': businessA, Accept: 'image/webp' },
    });
    requireExactImage(workerRead.response, workerRead.bytes, image, 'Hosted private-media Worker read');
    if (workerRead.response.headers.get('cache-control') !== 'private, no-store') {
      throw new Error('Hosted private-media Worker read failed: private cache policy missing');
    }

    const foreignRead = await appRequest(ownerB.jar, `/api/private-media/${mediaId}/content`, {
      headers: readHeaders(businessB),
    });
    if (![403, 404].includes(foreignRead.response.status)) {
      throw new Error(`Cross-tenant Worker denial was not a fail-closed 4xx with expected denial status (HTTP ${foreignRead.response.status})`);
    }

    const [ownerAToken, ownerBToken] = await Promise.all([
      supabasePasswordToken(process.env.STAGING_OWNER_A_EMAIL, process.env.STAGING_OWNER_A_PASSWORD),
      supabasePasswordToken(process.env.STAGING_OWNER_B_EMAIL, process.env.STAGING_OWNER_B_PASSWORD),
    ]);

    const directOwner = await storageRead(storagePath, ownerAToken);
    requireExactImage(directOwner, await responseBytes(directOwner), image, 'Hosted Storage owner RLS read');

    await requireStorageDenial(await storageRead(storagePath, ownerBToken), 'Hosted Storage cross-tenant RLS denial was not a fail-closed 4xx');
    await requireStorageDenial(await storageRead(storagePath), 'Hosted Storage anonymous denial was not a fail-closed 4xx');

    await deleteMedia();
    await requireStorageDenial(await storageRead(storagePath, ownerAToken), 'Hosted Storage post-delete read was not a fail-closed 4xx', true);
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (mediaId && ownerA && !mediaRemoved) {
      try { await deleteMedia(); }
      catch { cleanupFailures.push(new Error('G16 private-media cleanup failed')); }
    }
    if (!uploadStarted || mediaRemoved) {
      try {
        psql(`
          begin;
          delete from public.appointment_groups
          where business_id = ${sqlLiteral(businessA)}::uuid and id = ${sqlLiteral(groupId)}::uuid;
          delete from public.customers
          where business_id = ${sqlLiteral(businessA)}::uuid and id = ${sqlLiteral(customerId)}::uuid;
          commit;
        `);
      } catch {
        cleanupFailures.push(new Error('G16 fixture cleanup failed'));
      }
    } else {
      // Unknown upload outcome: preserve the group that authorizes object recovery.
      cleanupFailures.push(new Error(`G16 recovery required: temporary group ${groupId} and customer ${customerId} retained`));
    }
  }
  if (cleanupFailures.length) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures].filter(Boolean),
      'G16 hosted Storage acceptance/cleanup failed',
    );
  }
  if (primaryFailure) throw primaryFailure;
  console.log('G16 hosted private-media Storage smoke passed: byte equality, tenant/anon denial, API delete, metadata absence and fixture cleanup.');
}

await verifyNetgsmOtpSend();
await verifyHostedPrivateStorage();
console.log('G16 hosted acceptance passed.');
