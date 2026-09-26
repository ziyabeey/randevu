import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import {
  normalizeWhatsappPhone,
  sendWhatsappVerificationCode,
  zernioWhatsappConfigured,
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
  'ZERNIO_API_KEY',
  'ZERNIO_WHATSAPP_ACCOUNT_ID',
  'ZERNIO_WHATSAPP_TEMPLATE_NAME',
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
const zernioConfig = zernioWhatsappConfigured(process.env);
if (!zernioConfig) throw new Error('G16 Zernio acceptance configuration is invalid');

const DELIVERY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  return execFileSync(
    'psql',
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
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
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  absorbCookies(jar, response);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const text = await response.text();
    return { response, text, data: jsonBody(text), bytes: null };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
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
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  const data = jsonBody(text);
  const token = String(data?.access_token ?? '');
  if (!response.ok || !token) throw new Error(`G16 Supabase password auth failed with HTTP ${response.status}`);
  return token;
}

async function storageRead(path, bearer) {
  return fetch(`${supabaseUrl}/storage/v1/object/appointment-private-media/${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${bearer}`,
      Accept: 'image/webp',
    },
  });
}

function validWebp() {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8X'), 12);
  bytes[16] = 10;
  bytes[24] = 0x1f; bytes[25] = 0x03; bytes[26] = 0x00;
  bytes[27] = 0x57; bytes[28] = 0x02; bytes[29] = 0x00;
  return bytes;
}

async function resolveAcceptancePhone() {
  const explicit = String(process.env.ZERNIO_ACCEPTANCE_PHONE ?? '').trim();
  if (explicit) {
    const normalized = normalizeWhatsappPhone(explicit);
    if (!normalized) throw new Error('G16 explicit acceptance phone is not a supported Turkish mobile number');
    return normalized;
  }

  const response = await fetch('https://zernio.com/api/v1/whatsapp/sandbox/sessions', {
    headers: { Authorization: `Bearer ${zernioConfig.apiKey}`, Accept: 'application/json' },
  });
  const text = await response.text();
  const data = jsonBody(text);
  if (!response.ok) {
    throw new Error(`G16 could not discover a verified sandbox recipient (HTTP ${response.status}); configure ZERNIO_ACCEPTANCE_PHONE instead`);
  }

  const now = Date.now();
  const active = (Array.isArray(data?.sessions) ? data.sessions : [])
    .filter((session) => String(session?.status ?? '').toLowerCase() === 'active')
    .filter((session) => {
      const expiresAt = Date.parse(String(session?.expiresAt ?? ''));
      return !Number.isFinite(expiresAt) || expiresAt > now;
    })
    .map((session) => normalizeWhatsappPhone(String(session?.phoneE164 ?? '')))
    .filter(Boolean);

  if (active.length !== 1) {
    throw new Error('G16 requires exactly one active verified Zernio sandbox recipient or ZERNIO_ACCEPTANCE_PHONE');
  }
  return active[0];
}

async function zernioMessages(conversationId) {
  const params = new URLSearchParams({
    accountId: zernioConfig.accountId,
    limit: '100',
    sortOrder: 'desc',
  });
  const response = await fetch(
    `https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    { headers: { Authorization: `Bearer ${zernioConfig.apiKey}`, Accept: 'application/json' } },
  );
  const text = await response.text();
  const data = jsonBody(text);
  if (!response.ok) throw new Error(`Zernio delivery readback failed with HTTP ${response.status}`);
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function verifyZernioDelivery() {
  const acceptancePhone = await resolveAcceptancePhone();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const sentAfterMs = Date.now() - 5_000;
  const sent = await sendWhatsappVerificationCode(process.env, acceptancePhone, code);
  if (sent.status !== 'sent') {
    throw new Error(`Zernio verified-recipient send failed: ${sent.errorClass}`);
  }

  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const messages = await zernioMessages(sent.conversationId);
    const outbound = messages.filter((item) => {
      const createdAt = Date.parse(String(item?.createdAt ?? ''));
      return String(item?.direction ?? '').toLowerCase() === 'outgoing'
        && Number.isFinite(createdAt)
        && createdAt >= sentAfterMs;
    });
    const message = outbound.find((item) => (
      typeof item?.message === 'string' && item.message.includes(code)
    )) ?? (outbound.length === 1 ? outbound[0] : null);
    if (message) {
      lastStatus = String(message.deliveryStatus ?? 'unknown').toLowerCase();
      if (lastStatus === 'delivered' || lastStatus === 'read') {
        console.log(`G16 Zernio verified-recipient delivery passed: ${lastStatus}; message ${sent.providerMessageId.slice(0, 14)}…`);
        return;
      }
      if (lastStatus === 'failed' || lastStatus === 'deleted') {
        const providerCode = message.deliveryError?.code ?? 'unknown';
        throw new Error(`Zernio recipient delivery failed with provider code ${providerCode}`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Zernio recipient was not delivered/read within ${DELIVERY_TIMEOUT_MS / 1000}s (last status: ${lastStatus})`);
}

async function verifyHostedPrivateStorage() {
  const customerId = randomUUID();
  const groupId = randomUUID();
  let mediaId = null;
  let storagePath = null;
  let ownerA = null;

  psql(`
    begin;
    insert into public.customers(id, business_id, name, created_by)
    values (${sqlLiteral(customerId)}::uuid, ${sqlLiteral(businessA)}::uuid, 'G16 Hosted Smoke', null);
    insert into public.appointment_groups(id, business_id, customer_id, status, source, version, created_by)
    values (${sqlLiteral(groupId)}::uuid, ${sqlLiteral(businessA)}::uuid, ${sqlLiteral(customerId)}::uuid, 'scheduled', 'operator', 1, null);
    commit;
  `);

  try {
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

    const upload = await appRequest(ownerA.jar, `/api/bookings/groups/${groupId}/photos?caption=G16%20hosted%20smoke`, {
      method: 'POST',
      headers: browserMutationHeaders(ownerA.csrfToken, businessA, 'image/webp'),
      body: validWebp(),
    });
    mediaId = String(upload.data?.photo?.id ?? '');
    if (upload.response.status !== 201 || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
      throw new Error(`Hosted private-media upload failed with HTTP ${upload.response.status}`);
    }
    storagePath = `${businessA}/${groupId}/${mediaId}.webp`;

    const workerRead = await appRequest(ownerA.jar, `/api/private-media/${mediaId}/content`, {
      headers: { 'X-YZT-Business': businessA, Accept: 'image/webp' },
    });
    if (!workerRead.response.ok || workerRead.bytes?.byteLength !== 30
        || workerRead.response.headers.get('cache-control') !== 'private, no-store') {
      throw new Error(`Hosted private-media Worker read failed with HTTP ${workerRead.response.status}`);
    }

    const foreignRead = await appRequest(ownerB.jar, `/api/private-media/${mediaId}/content`, {
      headers: readHeaders(businessB),
    });
    if (foreignRead.response.ok || foreignRead.response.status < 400 || foreignRead.response.status >= 500) {
      throw new Error(`Cross-tenant Worker denial was not a fail-closed 4xx (HTTP ${foreignRead.response.status})`);
    }

    const [ownerAToken, ownerBToken] = await Promise.all([
      supabasePasswordToken(process.env.STAGING_OWNER_A_EMAIL, process.env.STAGING_OWNER_A_PASSWORD),
      supabasePasswordToken(process.env.STAGING_OWNER_B_EMAIL, process.env.STAGING_OWNER_B_PASSWORD),
    ]);

    const directOwner = await storageRead(storagePath, ownerAToken);
    if (!directOwner.ok || (await directOwner.arrayBuffer()).byteLength !== 30) {
      throw new Error(`Hosted Storage owner RLS read failed with HTTP ${directOwner.status}`);
    }

    const directForeign = await storageRead(storagePath, ownerBToken);
    if (directForeign.ok || directForeign.status < 400 || directForeign.status >= 500) {
      throw new Error(`Hosted Storage cross-tenant RLS denial was not a fail-closed 4xx (HTTP ${directForeign.status})`);
    }

    const directAnon = await storageRead(storagePath, anonKey);
    if (directAnon.ok || directAnon.status < 400 || directAnon.status >= 500) {
      throw new Error(`Hosted Storage anonymous denial was not a fail-closed 4xx (HTTP ${directAnon.status})`);
    }

    const deleted = await appRequest(ownerA.jar, `/api/private-media/${mediaId}`, {
      method: 'DELETE',
      headers: browserMutationHeaders(ownerA.csrfToken, businessA),
    });
    if (!deleted.response.ok || deleted.data?.deleted !== true) {
      throw new Error(`Hosted private-media cleanup delete failed with HTTP ${deleted.response.status}`);
    }
    mediaId = null;

    const afterDelete = await storageRead(storagePath, ownerAToken);
    if (afterDelete.ok || afterDelete.status < 400 || afterDelete.status >= 500) {
      throw new Error(`Hosted Storage post-delete read was not a fail-closed 4xx (HTTP ${afterDelete.status})`);
    }

    console.log('G16 hosted private-media Storage smoke passed: owner read, tenant/anon denial, delete.');
  } finally {
    if (mediaId && ownerA) {
      try {
        const cleanup = await appRequest(ownerA.jar, `/api/private-media/${mediaId}`, {
          method: 'DELETE',
          headers: browserMutationHeaders(ownerA.csrfToken, businessA),
        });
        if (cleanup.response.ok && cleanup.data?.deleted === true) mediaId = null;
      } catch {}
    }
    if (!mediaId) {
      psql(`
        delete from public.appointment_groups
        where business_id = ${sqlLiteral(businessA)}::uuid and id = ${sqlLiteral(groupId)}::uuid;
        delete from public.customers
        where business_id = ${sqlLiteral(businessA)}::uuid and id = ${sqlLiteral(customerId)}::uuid;
      `);
    } else {
      console.error('G16 cleanup left the temporary group in place so the private Storage object remains authorizable for recovery.');
    }
  }
}

await verifyZernioDelivery();
await verifyHostedPrivateStorage();
console.log('G16 hosted acceptance passed.');
