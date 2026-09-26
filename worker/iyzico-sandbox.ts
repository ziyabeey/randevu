/**
 * IYZ-01A: isolated, server-only Checkout Form adapter candidate.
 * No router, database, environment auto-read, global fetch fallback or import-time I/O.
 * Only sandbox, TRY, single installment and virtual service items are supported.
 * A verified response is evidence, NOT permission to mutate a tenant's ledger.
 */
export type IyzicoSandboxEnv = {
  IYZICO_SANDBOX_API_KEY?: string;
  IYZICO_SANDBOX_SECRET_KEY?: string;
};
export type SandboxTransport = (url: string, init: RequestInit) => Promise<Response>;
export type IyzicoResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'INVALID_INPUT' | 'UNCONFIRMED' | 'INVALID_RESPONSE' | 'PENDING_REVIEW' };
export type CheckoutBuyer = {
  id: string; name: string; surname: string; email: string; identityNumber: string;
  registrationAddress: string; city: string; country: string; ip: string;
  gsmNumber?: string;
};
export type CheckoutAddress = { contactName: string; address: string; city: string; country: string };
export type SandboxCheckoutInput = {
  conversationId: string; basketId: string; amountMinor: number;
  buyer: CheckoutBuyer; billingAddress: CheckoutAddress;
  items: Array<{ id: string; name: string; category: string; amountMinor: number }>;
};
/** These values must come from a persisted, tenant-authorized server attempt, never callback fields. */
export type ExpectedSandboxPayment = {
  conversationId: string; basketId: string; amountMinor: number; token: string;
};
export type SandboxSession = { token: string; paymentPageUrl: string; expiresInSeconds: number };
export type VerifiedSandboxPayment = {
  kind: 'verified_sandbox_payment'; paymentId: string; conversationId: string;
  basketId: string; amountMinor: number; currency: 'TRY';
};

const API = 'https://sandbox-api.iyzipay.com';
const INITIALIZE = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
const RETRIEVE = '/payment/iyzipos/checkoutform/auth/ecom/detail';
const REQUEST_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 256 * 1024;
const MAX_MINOR = 100_000_000;
const encoder = new TextEncoder();
const fail = (code: 'INVALID_INPUT' | 'UNCONFIRMED' | 'INVALID_RESPONSE' | 'PENDING_REVIEW') =>
  ({ ok: false, code } as const);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function identifier(value: unknown): value is string {
  return text(value, 128) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}
function tokenValue(value: unknown): value is string {
  return text(value, 256) && /^[A-Za-z0-9_-]+$/u.test(value);
}
function minor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR;
}
function decimal(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
/** Exact cents; accept trailing zero precision, never round a fractional cent. */
function responseMinor(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,8}))?$/u.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (/[1-9]/u.test(fraction.slice(2))) return null;
  const amount = Number(match[1]) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return minor(amount) ? amount : null;
}
/** iyzico signs price fields without decimal trailing zeros (50.00 -> 50).
 * Call only after exact-cents validation; never normalize by rounding money.
 */
function signaturePrice(value: string | number): string {
  return String(value).replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
}
function exactFields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function checkoutBody(input: unknown, callbackUrl: string): Record<string, unknown> | null {
  const v = record(input);
  if (!v || !exactFields(v, ['conversationId', 'basketId', 'amountMinor', 'buyer', 'billingAddress', 'items'])
    || !identifier(v.conversationId) || !identifier(v.basketId) || !minor(v.amountMinor)
    || !Array.isArray(v.items) || v.items.length === 0 || v.items.length > 50) return null;
  const b = record(v.buyer), a = record(v.billingAddress);
  const buyerFields = ['id', 'name', 'surname', 'email', 'identityNumber', 'registrationAddress', 'city', 'country', 'ip'];
  const addressFields = ['contactName', 'address', 'city', 'country'];
  if (!b || !a || !exactFields(b, buyerFields, ['gsmNumber']) || !exactFields(a, addressFields)
    || !buyerFields.every((key) => text(b[key], 1000))
    || !addressFields.every((key) => text(a[key], 1000)) || !identifier(b.id)
    || (b.gsmNumber !== undefined && !text(b.gsmNumber, 32))) return null;
  const ids = new Set<string>();
  const basketItems: Record<string, unknown>[] = [];
  let sum = 0;
  for (const raw of v.items) {
    const item = record(raw);
    if (!item || !exactFields(item, ['id', 'name', 'category', 'amountMinor'])
      || !identifier(item.id) || ids.has(item.id) || !text(item.name)
      || !text(item.category) || !minor(item.amountMinor)) return null;
    ids.add(item.id);
    sum += item.amountMinor;
    basketItems.push({ id: item.id, name: item.name, category1: item.category,
      itemType: 'VIRTUAL', price: decimal(item.amountMinor) });
  }
  if (sum !== v.amountMinor) return null;
  return { locale: 'tr', conversationId: v.conversationId, basketId: v.basketId,
    price: decimal(v.amountMinor), paidPrice: decimal(v.amountMinor), currency: 'TRY',
    paymentGroup: 'PRODUCT', enabledInstallments: [1], callbackUrl,
    buyer: { ...b }, billingAddress: { ...a }, basketItems };
}
async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signature(key: CryptoKey, data: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function verified(key: CryptoKey, supplied: unknown, fields: Array<string | number>): Promise<boolean> {
  if (typeof supplied !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(supplied)) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(supplied.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(fields.join(':')));
}
async function boundedJson(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown> | null> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0, data = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > RESPONSE_LIMIT) { void reader.cancel().catch(() => {}); return null; }
      data += decoder.decode(part.value, { stream: true });
    }
    data += decoder.decode();
    return record(JSON.parse(data));
  } finally { reader.releaseLock(); }
}

/** Mandatory injected transport prevents hidden network access in offline tests or at import. */
export function createIyzicoSandboxClient(
  env: IyzicoSandboxEnv,
  transport: SandboxTransport,
  options: { callbackUrl: string; timeoutMs?: number },
) {
  const apiKey = env?.IYZICO_SANDBOX_API_KEY;
  const secret = env?.IYZICO_SANDBOX_SECRET_KEY;
  const timeoutMs = options?.timeoutMs ?? 8000;
  let callback: URL;
  try { callback = new URL(options.callbackUrl); } catch { throw new Error('IYZICO_SANDBOX_CONFIGURATION_INVALID'); }
  if (!text(apiKey, 512) || !/^[A-Za-z0-9._-]+$/u.test(apiKey) || !text(secret, 512)
    || typeof transport !== 'function' || callback.protocol !== 'https:'
    || callback.username || callback.password || callback.search || callback.hash
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('IYZICO_SANDBOX_CONFIGURATION_INVALID');
  }
  const callbackUrl = callback.toString();
  // Capture only validated primitive configuration; later env mutation cannot rotate credentials mid-call.
  const safeApiKey = apiKey, safeSecret = secret;

  async function post(path: typeof INITIALIZE | typeof RETRIEVE, body: Record<string, unknown>) {
    const serialized = JSON.stringify(body);
    if (encoder.encode(serialized).byteLength > REQUEST_LIMIT) return fail('INVALID_INPUT');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const expiration = new Promise<IyzicoResult<Record<string, unknown>>>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        void activeReader?.cancel().catch(() => {});
        resolve(fail('UNCONFIRMED'));
      }, timeoutMs);
    });
    const work = (async (): Promise<IyzicoResult<Record<string, unknown>>> => {
      try {
        const key = await importKey(safeSecret);
        const nonce = crypto.randomUUID().replaceAll('-', '');
        const mac = await signature(key, nonce + path + serialized);
        if (controller.signal.aborted) return fail('UNCONFIRMED');
        const authorization = btoa(`apiKey:${safeApiKey}&randomKey:${nonce}&signature:${mac}`);
        const response = await transport(API + path, {
          method: 'POST', headers: { Authorization: `IYZWSv2 ${authorization}`,
            'x-iyzi-rnd': nonce, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: serialized, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return fail('UNCONFIRMED'); }
        if (response.status !== 200 || response.redirected || (response.url && response.url !== API + path)) {
          void response.body?.cancel().catch(() => {});
          return fail('UNCONFIRMED');
        }
        // Keep the reader available to cancel a stalled body on timeout.
        if (!response.body) return fail('INVALID_RESPONSE');
        activeReader = response.body.getReader();
        const parsed = await boundedJson(activeReader);
        if (controller.signal.aborted) return fail('UNCONFIRMED');
        if (!parsed) return fail('INVALID_RESPONSE');
        // Transport/API success never means the card payment succeeded.
        if (parsed.status !== 'success') return fail('UNCONFIRMED');
        return { ok: true, value: parsed };
      } catch { return fail('UNCONFIRMED'); }
    })();
    try { return await Promise.race([work, expiration]); }
    finally { clearTimeout(timer); }
  }

  return Object.freeze({
    async initialize(input: SandboxCheckoutInput): Promise<IyzicoResult<SandboxSession>> {
      const body = checkoutBody(input, callbackUrl);
      if (!body) return fail('INVALID_INPUT');
      const result = await post(INITIALIZE, body);
      if (!result.ok) return result;
      const r = result.value;
      if (r.conversationId !== body.conversationId || !tokenValue(r.token)
        || !Number.isSafeInteger(r.tokenExpireTime) || Number(r.tokenExpireTime) <= 0
        || Number(r.tokenExpireTime) > 86400 || !text(r.paymentPageUrl, 4096)
        || !await verified(await importKey(safeSecret), r.signature, [String(r.conversationId), r.token])) {
        return fail('INVALID_RESPONSE');
      }
      let page: URL;
      try { page = new URL(r.paymentPageUrl); } catch { return fail('INVALID_RESPONSE'); }
      if (page.origin !== 'https://sandbox-cpp.iyzipay.com' || page.username || page.password || page.hash
        || page.pathname !== '/' || page.searchParams.getAll('token').length !== 1
        || page.searchParams.get('token') !== r.token) return fail('INVALID_RESPONSE');
      return { ok: true, value: { token: r.token, paymentPageUrl: page.toString(),
        expiresInSeconds: Number(r.tokenExpireTime) } };
    },
    async retrieve(expected: ExpectedSandboxPayment): Promise<IyzicoResult<VerifiedSandboxPayment>> {
      const v = record(expected);
      if (!v || !exactFields(v, ['conversationId', 'basketId', 'amountMinor', 'token'])
        || !identifier(v.conversationId) || !identifier(v.basketId) || !minor(v.amountMinor)
        || !tokenValue(v.token)) return fail('INVALID_INPUT');
      // Snapshot expectations before the first await; caller mutation cannot alter verification.
      const e = { conversationId: v.conversationId, basketId: v.basketId, amountMinor: v.amountMinor, token: v.token };
      const result = await post(RETRIEVE, { locale: 'tr', conversationId: e.conversationId, token: e.token });
      if (!result.ok) return result;
      const r = result.value;
      if (r.conversationId !== e.conversationId || r.basketId !== e.basketId || r.token !== e.token
        || r.currency !== 'TRY' || !identifier(r.paymentId)
        || responseMinor(r.price) !== e.amountMinor || responseMinor(r.paidPrice) !== e.amountMinor
        || r.installment !== 1 || !text(r.paymentStatus, 32)) return fail('INVALID_RESPONSE');
      if (!await verified(await importKey(safeSecret), r.signature, [r.paymentStatus, r.paymentId,
        'TRY', e.basketId, e.conversationId, signaturePrice(r.paidPrice as string | number),
        signaturePrice(r.price as string | number), e.token])) return fail('INVALID_RESPONSE');
      if (r.paymentStatus !== 'SUCCESS') return fail('UNCONFIRMED');
      if (r.fraudStatus === 0) return fail('PENDING_REVIEW');
      if (r.fraudStatus !== 1) return fail('UNCONFIRMED');
      return { ok: true, value: { kind: 'verified_sandbox_payment', paymentId: r.paymentId,
        conversationId: e.conversationId, basketId: e.basketId, amountMinor: e.amountMinor, currency: 'TRY' } };
    },
  });
}
