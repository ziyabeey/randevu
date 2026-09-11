export type NotificationEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
  NOTIFICATION_DISPATCH_SECRET?: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  PUBLIC_APP_ORIGIN?: string;
};

type ClaimRow = {
  job_id: string;
  lease_token: string;
  appointment_id: string;
  recovery_id: string;
  recipient: string;
  provider: string;
  provider_idempotency_key: string;
  attempt_count: number;
  retry_until: string;
  business_name: string;
  customer_name: string;
  starts_at: string;
  timezone: string;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  management_token_ciphertext: string | null;
  management_token_iv: string | null;
  key_version: number;
};

type ProviderResult =
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'failed'; errorClass: string; retryable: boolean; retryAfterSeconds?: number };

type RpcResult<T> = { ok: boolean; data: T | null; status: number };

export type NotificationDispatchSummary = {
  status: 'ok' | 'disabled' | 'claim_failed';
  claimed: number;
  sent: number;
  retrying: number;
  failedTerminal: number;
  leaseErrors: number;
};

const AAD_PREFIX = 'public-booking-recovery:v1|';
const PROVIDER_TIMEOUT_MS = 10_000;
const BACKOFF_SECONDS = [60, 300, 900, 3_600, 14_400, 43_200, 86_400] as const;

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function validSecret(value: string | undefined) {
  const secret = value?.trim() ?? '';
  return secret.length >= 43 && secret.length <= 256 ? secret : null;
}

function validOrigin(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function encryptionKey(env: NotificationEnv) {
  const raw = env.MANAGEMENT_LINK_ENCRYPTION_KEY_V1?.trim();
  if (!raw) return null;
  try {
    const bytes = base64UrlToBytes(raw);
    if (bytes.length !== 32) return null;
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
  } catch {
    return null;
  }
}

async function decryptManagementToken(env: NotificationEnv, row: ClaimRow) {
  if (row.key_version !== 1 || !row.management_token_ciphertext || !row.management_token_iv) return null;
  const key = await encryptionKey(env);
  if (!key) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(row.management_token_iv),
        additionalData: new TextEncoder().encode(`${AAD_PREFIX}${row.recovery_id}`),
      },
      key,
      base64UrlToBytes(row.management_token_ciphertext),
    );
    const token = bytesToText(new Uint8Array(decrypted));
    return /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function rpc<T>(
  env: NotificationEnv,
  fn: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<RpcResult<T>> {
  const headers = new Headers({
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  try {
    const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try { data = JSON.parse(text) as T; }
      catch { data = null; }
    }
    return { ok: response.ok, data, status: response.status };
  } catch {
    return { ok: false, data: null, status: 0 };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function retryDelay(attemptCount: number, providerDelay?: number) {
  const index = Math.max(0, Math.min(BACKOFF_SECONDS.length - 1, attemptCount - 1));
  const normal = BACKOFF_SECONDS[index] ?? 60;
  if (!providerDelay || !Number.isFinite(providerDelay)) return normal;
  return Math.max(normal, Math.min(Math.floor(providerDelay), 86_400));
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

async function sendResend(
  env: NotificationEnv,
  row: ClaimRow,
  manageUrl: string,
  fetchImpl: typeof fetch,
): Promise<ProviderResult> {
  const apiKey = env.RESEND_API_KEY!.trim();
  const from = env.NOTIFICATION_FROM_EMAIL!.trim();
  const dateTime = formatDateTime(row.starts_at, row.timezone);
  const price = formatMoney(row.price_minor, row.currency);
  const business = escapeHtml(row.business_name);
  const customer = escapeHtml(row.customer_name);
  const service = escapeHtml(row.service_name);
  const staff = escapeHtml(row.staff_name);
  const safeManageUrl = escapeHtml(manageUrl);

  const text = [
    `Merhaba ${row.customer_name},`,
    '',
    `${row.business_name} randevunuz oluşturuldu.`,
    `Hizmet: ${row.service_name}`,
    `Personel: ${row.staff_name}`,
    `Tarih: ${dateTime}`,
    `Ücret: ${price}`,
    '',
    'Randevunuzu görüntülemek, taşımak veya iptal etmek için:',
    manageUrl,
    '',
    'Bu bağlantı randevunuzu yönetme yetkisi verir. Başkalarıyla paylaşmayın.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="tr"><body style="font-family:Arial,sans-serif;background:#f7f7f8;color:#18181b;margin:0;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#71717a">RANDEVU ONAYI</p>
<h1 style="font-size:24px;margin:0 0 20px">${business}</h1>
<p>Merhaba ${customer}, randevunuz oluşturuldu.</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0">
<tr><td style="padding:8px 0;color:#71717a">Hizmet</td><td style="padding:8px 0;text-align:right">${service}</td></tr>
<tr><td style="padding:8px 0;color:#71717a">Personel</td><td style="padding:8px 0;text-align:right">${staff}</td></tr>
<tr><td style="padding:8px 0;color:#71717a">Tarih</td><td style="padding:8px 0;text-align:right">${escapeHtml(dateTime)}</td></tr>
<tr><td style="padding:8px 0;color:#71717a">Ücret</td><td style="padding:8px 0;text-align:right">${escapeHtml(price)}</td></tr>
</table>
<p style="margin:24px 0"><a href="${safeManageUrl}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">Randevumu yönet</a></p>
<p style="font-size:13px;color:#71717a">Bu bağlantı randevuyu görüntüleme, taşıma ve iptal etme yetkisi verir. Başkalarıyla paylaşmayın.</p>
</div></body></html>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': row.provider_idempotency_key,
      },
      body: JSON.stringify({
        from,
        to: [row.recipient],
        subject: `${row.business_name} randevu onayı`,
        text,
        html,
        tags: [
          { name: 'category', value: 'booking_confirmation' },
          { name: 'appointment', value: row.appointment_id },
        ],
      }),
    });

    const raw = await response.text();
    let parsed: { id?: string; name?: string } = {};
    if (raw) {
      try { parsed = JSON.parse(raw) as { id?: string; name?: string }; }
      catch { parsed = {}; }
    }

    if (response.ok && parsed.id) {
      return { status: 'accepted', providerMessageId: parsed.id };
    }

    const errorName = parsed.name ?? `http_${response.status}`;
    const retryable = response.status === 408
      || response.status === 429
      || response.status >= 500
      || errorName === 'concurrent_idempotent_requests';
    return {
      status: 'failed',
      errorClass: `resend_${errorName}`.slice(0, 120),
      retryable,
      retryAfterSeconds: retryAfterSeconds(response),
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return {
      status: 'failed',
      errorClass: aborted ? 'resend_timeout' : 'resend_network_error',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function release(
  env: NotificationEnv,
  secret: string,
  row: ClaimRow,
  errorClass: string,
  retryable: boolean,
  delay: number,
  fetchImpl: typeof fetch,
) {
  return rpc<string>(env, 'release_notification_job', {
    p_dispatch_secret: secret,
    p_job_id: row.job_id,
    p_lease_token: row.lease_token,
    p_error_class: errorClass,
    p_retryable: retryable,
    p_retry_after_seconds: delay,
  }, fetchImpl);
}

export async function dispatchNotificationBatch(
  env: NotificationEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<NotificationDispatchSummary> {
  const dispatchSecret = validSecret(env.NOTIFICATION_DISPATCH_SECRET);
  const origin = validOrigin(env.PUBLIC_APP_ORIGIN);
  const encryption = await encryptionKey(env);
  if (!dispatchSecret || !origin || !encryption || !env.RESEND_API_KEY?.trim() || !env.NOTIFICATION_FROM_EMAIL?.trim()) {
    return { status: 'disabled', claimed: 0, sent: 0, retrying: 0, failedTerminal: 0, leaseErrors: 0 };
  }

  const claimed = await rpc<ClaimRow[]>(env, 'claim_notification_jobs', {
    p_dispatch_secret: dispatchSecret,
    p_limit: 10,
    p_lease_seconds: 45,
  }, fetchImpl);
  if (!claimed.ok || !Array.isArray(claimed.data)) {
    return { status: 'claim_failed', claimed: 0, sent: 0, retrying: 0, failedTerminal: 0, leaseErrors: 0 };
  }

  const summary: NotificationDispatchSummary = {
    status: 'ok',
    claimed: claimed.data.length,
    sent: 0,
    retrying: 0,
    failedTerminal: 0,
    leaseErrors: 0,
  };

  await Promise.all(claimed.data.map(async (row) => {
    const managementToken = await decryptManagementToken(env, row);
    if (!managementToken) {
      const released = await release(env, dispatchSecret, row, 'management_decrypt_failed', true, retryDelay(row.attempt_count), fetchImpl);
      if (!released.ok) summary.leaseErrors += 1;
      else if (released.data === 'failed_terminal') summary.failedTerminal += 1;
      else summary.retrying += 1;
      return;
    }

    const manageUrl = `${origin}/m#${encodeURIComponent(managementToken)}`;
    const provider = await sendResend(env, row, manageUrl, fetchImpl);
    if (provider.status === 'accepted') {
      const completed = await rpc<boolean>(env, 'complete_notification_job', {
        p_dispatch_secret: dispatchSecret,
        p_job_id: row.job_id,
        p_lease_token: row.lease_token,
        p_provider_message_id: provider.providerMessageId,
      }, fetchImpl);
      if (completed.ok) summary.sent += 1;
      else summary.leaseErrors += 1;
      return;
    }

    const released = await release(
      env,
      dispatchSecret,
      row,
      provider.errorClass,
      provider.retryable,
      retryDelay(row.attempt_count, provider.retryAfterSeconds),
      fetchImpl,
    );
    if (!released.ok) summary.leaseErrors += 1;
    else if (released.data === 'failed_terminal') summary.failedTerminal += 1;
    else summary.retrying += 1;
  }));

  return summary;
}
