import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { normalizeTwilioRecipient } from '../worker/twilio.ts';

const required = [
  'STAGING_DATABASE_URL',
  'STAGING_OWNER_A_ID',
  'TWILLO_ID',
  'TWILLO_SECRET_API',
  'TWILIO_TEST_RECIPIENT',
];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required F16 SMS staging setting: ${name}`);
}

const dbUrl = process.env.STAGING_DATABASE_URL;
const ownerId = process.env.STAGING_OWNER_A_ID.trim();
const rawRecipient = process.env.TWILIO_TEST_RECIPIENT.trim();
const recipient = normalizeTwilioRecipient(rawRecipient);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
  throw new Error('F16 SMS acceptance owner id is invalid');
}
if (!recipient) throw new Error('F16 SMS acceptance recipient must be a valid E.164/Turkish mobile number');

process.stdout.write(`::add-mask::${rawRecipient}\n::add-mask::${recipient}\n`);

const BUSINESS_ID = 'f1700000-0000-4000-8000-000000000001';
const SERVICE_ID = 'f1720000-0000-4000-8000-000000000001';
const STAFF_ID = 'f1730000-0000-4000-8000-000000000001';
const DISPATCH_TIMEOUT_MS = 180_000;
const DELIVERY_TIMEOUT_MS = 360_000;
const POLL_MS = 5_000;
const DELIVERY_POLL_MS = 15_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  try {
    return execFileSync(
      'psql',
      [dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atq'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    throw new Error('F16 SMS staging database operation failed');
  }
}

function psqlJson(sql) {
  const raw = psql(sql);
  if (!raw) return null;
  const line = raw.split('\n').map((value) => value.trim()).filter(Boolean).at(-1);
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    throw new Error('F16 SMS staging database result was not valid JSON');
  }
}

const slot = psql(`
  select coalesce((
    select s.starts_at::text
    from generate_series(current_date + 1, current_date + 30, interval '1 day') d(day)
    cross join lateral public.f11_compute_group_slots_internal(
      ${sqlLiteral(BUSINESS_ID)}::uuid,
      d.day::date,
      jsonb_build_array(jsonb_build_object(
        'serviceId', ${sqlLiteral(SERVICE_ID)},
        'staffId', ${sqlLiteral(STAFF_ID)}
      )),
      15
    ) s
    where s.starts_at > clock_timestamp() + interval '2 hours'
    order by s.starts_at
    limit 1
  ), '');
`);
if (!slot || !Number.isFinite(Date.parse(slot))) {
  throw new Error('F16 SMS acceptance could not find a safe future staging slot');
}

const runLabel = String(process.env.GITHUB_RUN_ID ?? Date.now()).replace(/\D/g, '').slice(-24);
const idempotencyKey = `f16-twilio-${runLabel}-${randomUUID()}`.slice(0, 120);
const group = psqlJson(`
  begin;
  set local role authenticated;
  do $f16_accept_auth$
  begin
    perform set_config('request.jwt.claim.sub', ${sqlLiteral(ownerId)}, true);
    perform set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
  end
  $f16_accept_auth$;
  select public.create_appointment_group_with_notifications(
    ${sqlLiteral(BUSINESS_ID)}::uuid,
    ${sqlLiteral(idempotencyKey)},
    'F16 Twilio Acceptance',
    jsonb_build_array(jsonb_build_object(
      'serviceId', ${sqlLiteral(SERVICE_ID)},
      'staffId', ${sqlLiteral(STAFF_ID)}
    )),
    ${sqlLiteral(slot)}::timestamptz,
    ${sqlLiteral(recipient)},
    null,
    'Hosted Twilio trial acceptance',
    false,
    true,
    null
  );
  commit;
`);
const groupId = String(group?.groupId ?? '');
if (!/^[0-9a-f-]{36}$/i.test(groupId)) {
  throw new Error('F16 SMS acceptance did not create a booking group');
}

const job = psqlJson(`
  select row_to_json(x)
  from (
    select
      id as job_id,
      provider,
      event_reason,
      provider_reference_id,
      template_version,
      channel
    from public.appointment_notification_jobs
    where business_id=${sqlLiteral(BUSINESS_ID)}::uuid
      and group_id=${sqlLiteral(groupId)}::uuid
      and is_current
      and event_reason='created'
      and kind='booking_lifecycle'
      and channel='sms'
    order by created_at desc
    limit 1
  ) x;
`);
if (!job?.job_id || job.provider !== 'twilio' || job.template_version !== 3 || job.channel !== 'sms') {
  throw new Error('F16 SMS acceptance did not enqueue the canonical Twilio lifecycle job');
}

async function waitForDispatch() {
  const deadline = Date.now() + DISPATCH_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = psqlJson(`
      select row_to_json(x)
      from (
        select state, provider, provider_message_id, provider_reference_id,
               request_fingerprint, last_error_class, delivery_certainty
        from public.appointment_notification_jobs
        where id=${sqlLiteral(job.job_id)}::uuid
      ) x;
    `);
    if (last?.state === 'sent' && /^SM[0-9a-f]{32}$/i.test(String(last.provider_message_id ?? ''))) {
      if (last.provider !== 'twilio') throw new Error('F16 SMS provider changed after enqueue');
      if (!/^[0-9a-f]{64}$/i.test(String(last.request_fingerprint ?? ''))) {
        throw new Error('F16 SMS dispatched without the immutable request fingerprint');
      }
      return last;
    }
    if (last?.state === 'failed_terminal') {
      throw new Error(`F16 SMS dispatch became terminal: ${last.last_error_class ?? 'unknown'}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`F16 SMS dispatch did not reach Twilio acceptance within ${DISPATCH_TIMEOUT_MS / 1000}s`);
}

async function waitForDelivery(providerMessageId) {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = psqlJson(`
      select row_to_json(x)
      from (
        select provider_delivery_status, provider_delivery_checked_at, delivered_at
        from public.appointment_notification_jobs
        where id=${sqlLiteral(job.job_id)}::uuid
          and provider='twilio'
          and provider_message_id=${sqlLiteral(providerMessageId)}
      ) x;
    `);
    if (last?.delivered_at && last.provider_delivery_status === 'delivered') return last;
    if (last?.provider_delivery_status
        && !['waiting', 'delivered'].includes(last.provider_delivery_status)) {
      throw new Error(`F16 SMS provider reported terminal delivery status: ${last.provider_delivery_status}`);
    }
    await sleep(DELIVERY_POLL_MS);
  }
  throw new Error(`F16 SMS did not reach delivered within ${DELIVERY_TIMEOUT_MS / 1000}s`);
}

const dispatched = await waitForDispatch();
await waitForDelivery(dispatched.provider_message_id);

console.log(
  `F16-02 hosted Twilio acceptance passed: one scheduled-Worker lifecycle SMS reached delivered; provider_sid=${dispatched.provider_message_id}; trial_template=sms_appointment_reminders.`,
);
