export type TwilioEnv = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILLO_ID?: string;
  TWILLO_SECRET_API?: string;
  TWILIO_FROM?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  TWILIO_TRIAL_MODE?: string;
};

export type TwilioSendResult =
  | { status: 'accepted'; providerMessageId: string }
  | {
      status: 'failed';
      errorClass: string;
      retryable: boolean;
      definitelyRejected: boolean;
      retryAfterSeconds?: number;
    };

export type TwilioDeliveryResult =
  | {
      status: 'ok';
      providerMessageId: string;
      providerStatus: string;
      delivered: boolean;
      waiting: boolean;
    }
  | { status: 'failed'; errorClass: string };

const API_ROOT = 'https://api.twilio.com/2010-04-01';
const REQUEST_TIMEOUT_MS = 10_000;

function clean(value: string | undefined) {
  const result = value?.trim() ?? '';
  return result || null;
}

function truthy(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

function basicAuth(username: string, password: string) {
  const raw = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function retryAfter(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(86_400, Math.floor(seconds));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(1, Math.min(86_400, Math.ceil((at - Date.now()) / 1000))) : undefined;
}

export function normalizeTwilioRecipient(value: string) {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  const digits = compact.replace(/^\+/, '');
  if (/^90(5\d{9})$/.test(digits)) return `+${digits}`;
  if (/^0(5\d{9})$/.test(digits)) return `+90${digits.slice(1)}`;
  if (/^5\d{9}$/.test(digits)) return `+90${digits}`;
  return null;
}

export function twilioConfigured(env: TwilioEnv) {
  const accountSid = clean(env.TWILIO_ACCOUNT_SID) ?? clean(env.TWILLO_ID);
  const authToken = clean(env.TWILIO_AUTH_TOKEN) ?? clean(env.TWILLO_SECRET_API);
  if (!accountSid || !/^AC[0-9a-fA-F]{32}$/.test(accountSid)) return null;
  if (!authToken || authToken.length < 16 || authToken.length > 256) return null;

  const trialMode = truthy(env.TWILIO_TRIAL_MODE);
  const from = clean(env.TWILIO_FROM);
  const messagingServiceSid = clean(env.TWILIO_MESSAGING_SERVICE_SID);
  if (messagingServiceSid && !/^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid)) return null;
  if (!trialMode && !from && !messagingServiceSid) return null;

  return {
    accountSid,
    authToken,
    trialMode,
    from,
    messagingServiceSid,
    senderLabel: messagingServiceSid ?? from ?? 'twilio-trial-managed',
  };
}

async function jsonWithTimeout(url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data: Record<string, unknown> | null = null;
    try { data = raw ? JSON.parse(raw) as Record<string, unknown> : null; }
    catch { data = null; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTwilioSms(
  env: TwilioEnv,
  input: { recipient: string; message: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioSendResult> {
  const config = twilioConfigured(env);
  if (!config) {
    return {
      status: 'failed',
      errorClass: 'twilio_not_configured',
      retryable: true,
      definitelyRejected: true,
    };
  }
  const recipient = normalizeTwilioRecipient(input.recipient);
  if (!recipient || !input.message.trim()) {
    return {
      status: 'failed',
      errorClass: 'twilio_invalid_payload',
      retryable: false,
      definitelyRejected: true,
    };
  }

  const form = new URLSearchParams();
  form.set('To', recipient);
  // Current Twilio trial Messaging requires one of Twilio's predefined body identifiers.
  // Production keeps the canonical product copy and requires From or MessagingServiceSid.
  form.set('Body', config.trialMode ? 'sms_appointment_reminders' : input.message);
  if (!config.trialMode) {
    if (config.messagingServiceSid) form.set('MessagingServiceSid', config.messagingServiceSid);
    else if (config.from) form.set('From', config.from);
  }

  try {
    const { response, data } = await jsonWithTimeout(
      `${API_ROOT}/Accounts/${config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      },
      fetchImpl,
    );

    const sid = typeof data?.sid === 'string' ? data.sid.trim() : '';
    if (response.ok && /^SM[0-9a-fA-F]{32}$/.test(sid)) {
      return { status: 'accepted', providerMessageId: sid };
    }

    const code = typeof data?.code === 'number' || typeof data?.code === 'string'
      ? String(data.code) : `http_${response.status}`;
    if (response.status === 429) {
      return {
        status: 'failed',
        errorClass: `twilio_${code}`.slice(0, 120),
        retryable: true,
        definitelyRejected: true,
        retryAfterSeconds: retryAfter(response),
      };
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return {
        status: 'failed',
        errorClass: `twilio_${code}`.slice(0, 120),
        retryable: false,
        definitelyRejected: true,
      };
    }
    return {
      status: 'failed',
      errorClass: `twilio_ambiguous_${code}`.slice(0, 120),
      retryable: false,
      definitelyRejected: false,
    };
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'twilio_send_timeout_ambiguous'
        : 'twilio_send_network_ambiguous',
      retryable: false,
      definitelyRejected: false,
    };
  }
}

export async function queryTwilioMessageStatus(
  env: TwilioEnv,
  providerMessageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioDeliveryResult> {
  const config = twilioConfigured(env);
  if (!config) return { status: 'failed', errorClass: 'twilio_not_configured' };
  if (!/^SM[0-9a-fA-F]{32}$/.test(providerMessageId)) {
    return { status: 'failed', errorClass: 'twilio_invalid_message_sid' };
  }

  try {
    const { response, data } = await jsonWithTimeout(
      `${API_ROOT}/Accounts/${config.accountSid}/Messages/${providerMessageId}.json`,
      {
        method: 'GET',
        headers: {
          Authorization: basicAuth(config.accountSid, config.authToken),
          Accept: 'application/json',
        },
      },
      fetchImpl,
    );
    if (!response.ok || !data) {
      return { status: 'failed', errorClass: `twilio_status_http_${response.status}` };
    }
    const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
    const waiting = ['accepted', 'scheduled', 'queued', 'sending', 'sent'].includes(status);
    const delivered = status === 'delivered';
    if (!waiting && !delivered && !['failed', 'undelivered', 'canceled'].includes(status)) {
      return { status: 'failed', errorClass: 'twilio_status_unknown' };
    }
    return {
      status: 'ok',
      providerMessageId,
      providerStatus: delivered ? 'delivered' : waiting ? 'waiting' : `twilio_${status}`,
      delivered,
      waiting,
    };
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'twilio_status_timeout'
        : 'twilio_status_network_error',
    };
  }
}
