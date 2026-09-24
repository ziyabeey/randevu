export type NetgsmEnv = {
  NETGSM_USERCODE?: string;
  NETGSM_PASSWORD?: string;
  NETGSM_MSGHEADER?: string;
  NETGSM_APPNAME?: string;
};

export type NetgsmSendInput = {
  recipient: string;
  message: string;
  referenceId: string;
};

export type NetgsmSendResult =
  | { status: 'accepted'; providerMessageId: string }
  | {
      status: 'failed';
      errorClass: string;
      retryable: boolean;
      definitelyRejected: boolean;
      retryAfterSeconds?: number;
    };

const SEND_ENDPOINT = 'https://api.netgsm.com.tr/sms/rest/v2/send';
const LENGTH_ENDPOINT = 'https://api.netgsm.com.tr/sms/rest/v2/length';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SMS_PARTS = 6;

function clean(value: string | undefined) {
  const result = value?.trim() ?? '';
  return result || null;
}

export function netgsmConfigured(env: NetgsmEnv) {
  const usercode = clean(env.NETGSM_USERCODE);
  const password = clean(env.NETGSM_PASSWORD);
  const msgheader = clean(env.NETGSM_MSGHEADER);
  if (!usercode || !password || !msgheader) return null;
  if (usercode.length > 32 || password.length > 256) return null;
  if (msgheader.length < 3 || msgheader.length > 11) return null;
  return {
    usercode,
    password,
    msgheader,
    appname: clean(env.NETGSM_APPNAME),
  };
}

export function normalizeNetgsmRecipient(value: string) {
  const compact = value.replace(/[\s()-]/g, '');
  const digits = compact.replace(/^\+/, '');
  if (/^90(5\d{9})$/.test(digits)) return digits.slice(2);
  if (/^0(5\d{9})$/.test(digits)) return digits.slice(1);
  if (/^5\d{9}$/.test(digits)) return digits;
  return null;
}

function basicAuth(usercode: string, password: string) {
  const raw = new TextEncoder().encode(`${usercode}:${password}`);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function jsonWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? JSON.parse(text) as Record<string, unknown> : null;
    } catch {
      data = null;
    }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function providerCode(data: Record<string, unknown> | null) {
  return typeof data?.code === 'string' ? data.code.trim() : '';
}

function retryableRejectedCode(code: string) {
  return code === '80' || code === '85' || /^10\d$/.test(code);
}

function permanentRejectedCode(code: string) {
  return ['20', '30', '40', '50', '51', '70'].includes(code);
}

function retryAfter(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(86_400, Math.floor(seconds));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(1, Math.min(86_400, Math.ceil((at - Date.now()) / 1000))) : undefined;
}

export async function sendNetgsmSms(
  env: NetgsmEnv,
  input: NetgsmSendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<NetgsmSendResult> {
  const config = netgsmConfigured(env);
  if (!config) {
    return {
      status: 'failed',
      errorClass: 'netgsm_not_configured',
      retryable: false,
      definitelyRejected: true,
    };
  }
  const recipient = normalizeNetgsmRecipient(input.recipient);
  if (!recipient) {
    return {
      status: 'failed',
      errorClass: 'netgsm_invalid_recipient',
      retryable: false,
      definitelyRejected: true,
    };
  }
  if (!input.message.trim() || input.referenceId.length < 8 || input.referenceId.length > 200) {
    return {
      status: 'failed',
      errorClass: 'netgsm_invalid_payload',
      retryable: false,
      definitelyRejected: true,
    };
  }

  const auth = basicAuth(config.usercode, config.password);

  // Provider-side length calculation is a safe preflight. The official API
  // rejects content over six parts; never attempt the send when the bound cannot
  // be proven.
  try {
    const { response, data } = await jsonWithTimeout(
      LENGTH_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          context: input.message,
          encoding: 11,
          customHeader: true,
        }),
      },
      fetchImpl,
    );
    const parts = typeof data?.parts === 'number' ? data.parts : Number(data?.parts);
    if (!response.ok || !Number.isInteger(parts) || parts < 1) {
      return {
        status: 'failed',
        errorClass: `netgsm_length_${providerCode(data) || `http_${response.status}`}`.slice(0, 120),
        retryable: response.status === 429 || response.status >= 500,
        definitelyRejected: true,
        retryAfterSeconds: retryAfter(response),
      };
    }
    if (parts > MAX_SMS_PARTS) {
      return {
        status: 'failed',
        errorClass: 'netgsm_segment_limit_exceeded',
        retryable: false,
        definitelyRejected: true,
      };
    }
  } catch (error) {
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'netgsm_length_timeout'
        : 'netgsm_length_network_error',
      retryable: true,
      definitelyRejected: true,
    };
  }

  try {
    const { response, data } = await jsonWithTimeout(
      SEND_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          msgheader: config.msgheader,
          messages: [{ msg: input.message, no: recipient }],
          encoding: 'TR',
          iysfilter: '0',
          ...(config.appname ? { appname: config.appname } : {}),
          referansID: input.referenceId,
        }),
      },
      fetchImpl,
    );

    const code = providerCode(data);
    const jobid = typeof data?.jobid === 'string' ? data.jobid.trim() : '';
    if (response.ok && code === '00' && jobid) {
      return { status: 'accepted', providerMessageId: jobid };
    }

    if (permanentRejectedCode(code)) {
      return {
        status: 'failed',
        errorClass: `netgsm_${code}`,
        retryable: false,
        definitelyRejected: true,
      };
    }
    if (retryableRejectedCode(code) || response.status === 429) {
      return {
        status: 'failed',
        errorClass: `netgsm_${code || `http_${response.status}`}`.slice(0, 120),
        retryable: true,
        definitelyRejected: true,
        retryAfterSeconds: retryAfter(response),
      };
    }
    if (response.status >= 400 && response.status < 500) {
      return {
        status: 'failed',
        errorClass: `netgsm_${code || `http_${response.status}`}`.slice(0, 120),
        retryable: false,
        definitelyRejected: true,
      };
    }

    // A non-success response after the send request is not documented as an
    // idempotent replay boundary. Treat it as ambiguous and do not auto-resend.
    return {
      status: 'failed',
      errorClass: `netgsm_ambiguous_${code || `http_${response.status}`}`.slice(0, 120),
      retryable: false,
      definitelyRejected: false,
    };
  } catch (error) {
    // NetGSM does not document referansID as an idempotency guarantee. A timeout
    // may therefore hide an accepted send; automatic replay could duplicate SMS.
    return {
      status: 'failed',
      errorClass: error instanceof DOMException && error.name === 'AbortError'
        ? 'netgsm_send_timeout_ambiguous'
        : 'netgsm_send_network_ambiguous',
      retryable: false,
      definitelyRejected: false,
    };
  }
}
