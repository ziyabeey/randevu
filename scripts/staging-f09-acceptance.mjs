import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const required = [
  'STAGING_APP_ORIGIN',
  'STAGING_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'RESEND_API_KEY',
  'NOTIFICATION_FROM_EMAIL',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required F09 staging environment variable: ${name}`);
}

const origin = process.env.STAGING_APP_ORIGIN.replace(/\/$/, '');
const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const dbUrl = process.env.STAGING_DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;
const notificationFrom = process.env.NOTIFICATION_FROM_EMAIL;
const slug = 'staging-salon-a';
const cookies = new Map();

const DISPATCH_TIMEOUT_MS = 180_000;
const RESEND_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

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

async function appRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set('Cookie', cookieHeader());
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  absorbCookies(response);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

async function expectError(path, init, status, code) {
  const result = await appRequest(path, init);
  if (result.response.status !== status || result.data?.error?.code !== code) {
    throw new Error(`${path} expected HTTP ${status}/${code}, got HTTP ${result.response.status}/${result.data?.error?.code ?? 'unknown'}`);
  }
}

function addDays(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + count));
  return value.toISOString().slice(0, 10);
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

async function verifyAnonymousCannotForgeReceipt() {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/complete_notification_job_v2`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_dispatch_secret: createSecret(48),
      p_job_id: randomUUID(),
      p_receipt_token: randomUUID(),
      p_provider_message_id: 'forged-f09-05',
      p_request_fingerprint: 'f'.repeat(64),
    }),
  });
  const text = await response.text();
  if (response.ok || !text.includes('NOTIFICATION_DISPATCH_UNAUTHORIZED')) {
    throw new Error(`Anonymous fake notification receipt was not rejected as expected (HTTP ${response.status})`);
  }
}

async function findAvailableSlot() {
  const page = await appRequest(`/api/public/business/${slug}`);
  if (!page.response.ok || !page.data?.business || !Array.isArray(page.data?.services) || page.data.services.length < 1) {
    throw new Error(`Public booking page failed with HTTP ${page.response.status}`);
  }

  const service = page.data.services[0];
  const localDate = page.data.business.local_date;
  const maxDate = page.data.business.max_date;
  let date = localDate;

  while (date <= maxDate) {
    const params = new URLSearchParams({
      serviceId: service.service_id,
      staffId: 'any',
      date,
    });
    const slots = await appRequest(`/api/public/business/${slug}/slots?${params}`);
    if (!slots.response.ok) {
      throw new Error(`Public slot lookup failed with HTTP ${slots.response.status}`);
    }
    if (Array.isArray(slots.data?.slots) && slots.data.slots.length > 0) {
      return {
        business: page.data.business,
        service,
        slot: slots.data.slots[0],
        date,
      };
    }
    date = addDays(date, 1);
  }

  throw new Error('No public staging slot was available inside the configured booking horizon');
}

async function createBookingAndDropResult(payload, idempotencyKey) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Idempotency-Key': idempotencyKey,
  });
  if (cookies.size) headers.set('Cookie', cookieHeader());

  const response = await fetch(`${origin}/api/public/business/${slug}/book`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'manual',
  });
  absorbCookies(response);
  if (response.body) await response.body.cancel();
}

async function recover(recoveryId, idempotencyKey, recoverySecret) {
  return appRequest('/api/public/booking/recover', {
    method: 'POST',
    body: JSON.stringify({ recoveryId, idempotencyKey, recoverySecret }),
  });
}

async function waitForNotificationJob(appointmentId) {
  const safeAppointment = sqlLiteral(appointmentId);
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  let last = 'missing';

  while (Date.now() < deadline) {
    const row = psqlScalar(`
      select state || '|' || coalesce(provider_message_id, '') || '|' || coalesce(last_error_class, '')
      from public.appointment_notification_jobs
      where appointment_id = ${safeAppointment}::uuid
        and kind = 'public_booking_confirmation'
        and channel = 'email'
        and is_current
      order by event_version desc, created_at desc
      limit 1
    `);
    if (row) {
      last = row;
      const [state, providerMessageId, errorClass] = row.split('|');
      if (state === 'sent' && providerMessageId) return providerMessageId;
      if (state === 'failed_terminal') {
        throw new Error(`Real notification job became terminal before delivery (${errorClass || 'unknown'})`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Notification job did not reach sent within ${DISPATCH_TIMEOUT_MS / 1000}s (last=${last})`);
}

async function waitForResendDelivery(providerMessageId, recipient, businessName) {
  const deadline = Date.now() + RESEND_TIMEOUT_MS;
  let lastEvent = 'unknown';

  while (Date.now() < deadline) {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, {
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok || !data) {
      throw new Error(`Resend retrieve-email failed with HTTP ${response.status}`);
    }

    const recipients = Array.isArray(data.to) ? data.to : [];
    if (!recipients.includes(recipient)) throw new Error('Resend record resolved an unexpected recipient');
    if (data.from !== notificationFrom) throw new Error('Resend record resolved an unexpected sender');
    if (typeof data.subject !== 'string' || !data.subject.includes(businessName)) {
      throw new Error('Resend record resolved an unexpected booking subject');
    }
    const rendered = `${data.text ?? ''}\n${data.html ?? ''}`;
    if (!rendered.includes(`${origin}/m#`)) {
      throw new Error('Delivered booking email did not contain the staging management-link origin');
    }

    lastEvent = String(data.last_event ?? 'unknown');
    if (lastEvent === 'delivered') return;
    if (['bounced', 'complained', 'failed', 'suppressed'].includes(lastEvent)) {
      throw new Error(`Resend reported terminal delivery event ${lastEvent}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Resend email did not reach delivered within ${RESEND_TIMEOUT_MS / 1000}s (last_event=${lastEvent})`);
}

await verifyAnonymousCannotForgeReceipt();

const selected = await findAvailableSlot();
const idempotencyKey = `f09-${randomUUID()}`;
const managementToken = createSecret();
const recoveryId = randomUUID();
const recoverySecret = createSecret();
const runLabel = String(process.env.GITHUB_RUN_ID ?? Date.now()).replace(/\D/g, '').slice(-30) || Date.now().toString();
const recipient = `delivered+f0905${runLabel}@resend.dev`;

const payload = {
  customerName: 'F09-05 Acceptance',
  customerPhone: null,
  customerEmail: recipient,
  notes: 'Automated staging integration acceptance',
  serviceId: selected.service.service_id,
  staffId: selected.slot.staff_id,
  startsAt: selected.slot.starts_at,
  managementToken,
  recoveryId,
  recoverySecret,
};

// Deliberately discard the create response. Recovery must prove the committed result
// without trusting the original HTTP response.
await createBookingAndDropResult(payload, idempotencyKey);

const recovered = await recover(recoveryId, idempotencyKey, recoverySecret);
if (!recovered.response.ok || !recovered.data?.appointment?.appointment_id) {
  throw new Error(`Lost-response recovery failed with HTTP ${recovered.response.status}`);
}
const appointmentId = recovered.data.appointment.appointment_id;
if (recovered.data?.management?.url !== `/m#${encodeURIComponent(managementToken)}`) {
  throw new Error('Recovered management URL did not match the original capability');
}

const managed = await appRequest('/api/manage/view', {
  method: 'POST',
  body: JSON.stringify({ token: managementToken }),
});
if (!managed.response.ok || managed.data?.appointment?.appointment_id !== appointmentId) {
  throw new Error(`Management capability lookup failed with HTTP ${managed.response.status}`);
}

await expectError(
  '/api/manage/view',
  { method: 'POST', body: JSON.stringify({ token: createSecret() }) },
  404,
  'MANAGEMENT_NOT_FOUND',
);

const duplicate = await appRequest(`/api/public/business/${slug}/book`, {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify(payload),
});
if (!duplicate.response.ok || duplicate.data?.appointment?.appointment_id !== appointmentId) {
  throw new Error('Safe duplicate booking retry did not resolve the original appointment');
}

await expectError(
  `/api/public/business/${slug}/book`,
  {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...payload, notes: 'Conflicting replay must be rejected' }),
  },
  409,
  'IDEMPOTENCY_CONFLICT',
);

await expectError(
  '/api/public/booking/recover',
  {
    method: 'POST',
    body: JSON.stringify({
      recoveryId,
      idempotencyKey,
      recoverySecret: createSecret(),
    }),
  },
  404,
  'BOOKING_RECOVERY_NOT_FOUND',
);

const providerMessageId = await waitForNotificationJob(appointmentId);
await waitForResendDelivery(providerMessageId, recipient, selected.business.name);

// Recovery authority is intentionally expired only after the durable provider path
// is complete, so the acceptance run cannot destroy ciphertext before dispatch.
const expiredRows = psqlScalar(`
  with changed as (
    update public.public_booking_recoveries
    set expires_at = now() - interval '1 minute'
    where recovery_id = ${sqlLiteral(recoveryId)}::uuid
      and appointment_id = ${sqlLiteral(appointmentId)}::uuid
    returning 1
  )
  select count(*) from changed
`);
if (expiredRows !== '1') throw new Error('Could not expire the acceptance recovery row');

await expectError(
  '/api/public/booking/recover',
  {
    method: 'POST',
    body: JSON.stringify({ recoveryId, idempotencyKey, recoverySecret }),
  },
  404,
  'BOOKING_RECOVERY_NOT_FOUND',
);

console.log(
  `F09-05 staging acceptance passed at ${origin}: booking/recovery/idempotency/capability/fake-receipt/provider-delivery verified for appointment ${appointmentId}.`,
);
