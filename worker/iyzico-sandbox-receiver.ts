/**
 * IYZ-01B: isolated Sandbox CF callback/HPP HTTP receiver; NOT registered in the app.
 * Database, admission and atomic ledger commit implementations are deliberately absent.
 * A 200 is possible only after the injected durable port returns a matching commit receipt.
 */
import { createIyzicoSandboxClient } from './iyzico-sandbox.ts';
import type { IyzicoSandboxEnv, SandboxTransport, VerifiedSandboxPayment } from './iyzico-sandbox.ts';
import { verifyIyzicoSandboxNotification } from './iyzico-sandbox-webhook.ts';

export type SandboxAttemptBinding = Readonly<{
  attemptId: string; businessId: string; ticketId: string;
  accountRef: string; environment: 'sandbox'; revision: number;
  conversationId: string; basketId: string; token: string; amountMinor: number;
  paymentId: string | null;
}>;
export type SandboxCommitReceipt =
  | Readonly<{ kind: 'applied' | 'already_applied'; attemptId: string; paymentId: string }>
  | Readonly<{ kind: 'conflict' }>;

/** All ports are trusted server configuration, never values or functions supplied by a request. */
export type SandboxReceiverPorts = {
  /** Must enforce real resource limits before body reading, lookup, or provider work. */
  admit(request: Request, signal: AbortSignal): Promise<boolean>;
  /** Lookup is scoped to this configured Sandbox merchant account; token is only a lookup key. */
  findAttempt(accountRef: string, token: string, signal: AbortSignal): Promise<SandboxAttemptBinding | null>;
  /**
   * Must atomically revalidate business/ticket/account/amount/revision, deduplicate payment ID
   * and attempt, and commit ledger + attempt together before returning. An in-memory adapter
   * cannot satisfy this in production. A timeout may commit late; never retry as a NEW payment.
   */
  commitVerifiedPayment(
    attempt: SandboxAttemptBinding, payment: Readonly<VerifiedSandboxPayment>, signal: AbortSignal,
  ): Promise<SandboxCommitReceipt>;
};
export type SandboxReceiverOptions = {
  accountRef: string; callbackUrl: string; webhookUrl: string;
  /** Includes admission, request body, store lookup, provider retrieval and commit. */
  timeoutMs?: number;
};

const LIMIT = 16 * 1024;
const tokenValue = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v);
const providerId = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,31}$/u.test(v);
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

function result(status: number): Response {
  // Never reflect a token, attempt, user data, provider error, or financial amount.
  return new Response(JSON.stringify({ status: status === 200 ? 'processed' : status === 503 ? 'unconfirmed' : 'rejected' }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(status === 405 ? { Allow: 'POST' } : {}),
      ...(status === 503 ? { 'Retry-After': '60' } : {}) },
  });
}
function endpoint(value: string): string {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error();
  return u.toString();
}
function snapshotAttempt(raw: unknown, accountRef: string, receivedToken: string): SandboxAttemptBinding | null {
  const r = object(raw);
  if (!r || r.environment !== 'sandbox' || r.accountRef !== accountRef || r.token !== receivedToken
    || !uuid(r.attemptId) || !uuid(r.businessId) || !uuid(r.ticketId)
    || !identifier(r.conversationId) || !identifier(r.basketId) || !tokenValue(r.token)
    || typeof r.amountMinor !== 'number' || !Number.isSafeInteger(r.amountMinor)
    || r.amountMinor < 1 || r.amountMinor > 100_000_000
    || typeof r.revision !== 'number' || !Number.isSafeInteger(r.revision) || r.revision < 0
    || (r.paymentId !== null && !providerId(r.paymentId))) return null;
  return Object.freeze({ attemptId: r.attemptId, businessId: r.businessId, ticketId: r.ticketId,
    accountRef, environment: 'sandbox', revision: r.revision, conversationId: r.conversationId,
    basketId: r.basketId, token: r.token, amountMinor: r.amountMinor, paymentId: r.paymentId });
}

/** New server code only; import/construct never reads secrets, calls fetch or modifies a store. */
export function createIyzicoSandboxReceiver(
  env: IyzicoSandboxEnv, transport: SandboxTransport, ports: SandboxReceiverPorts, options: SandboxReceiverOptions,
): (request: Request) => Promise<Response> {
  let callbackUrl: string, webhookUrl: string;
  const accountRef = options?.accountRef, timeoutMs = options?.timeoutMs ?? 12_000;
  try {
    callbackUrl = endpoint(options.callbackUrl); webhookUrl = endpoint(options.webhookUrl);
    if (!identifier(accountRef) || callbackUrl === webhookUrl || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 30_000 || typeof transport !== 'function'
      || typeof ports?.admit !== 'function' || typeof ports?.findAttempt !== 'function'
      || typeof ports?.commitVerifiedPayment !== 'function') throw new Error();
  } catch { throw new Error('IYZICO_SANDBOX_RECEIVER_CONFIGURATION_INVALID'); }
  const credentials = Object.freeze({ IYZICO_SANDBOX_API_KEY: env?.IYZICO_SANDBOX_API_KEY,
    IYZICO_SANDBOX_SECRET_KEY: env?.IYZICO_SANDBOX_SECRET_KEY });
  let client: ReturnType<typeof createIyzicoSandboxClient>;
  try { client = createIyzicoSandboxClient(credentials, transport, { callbackUrl, timeoutMs }); }
  catch { throw new Error('IYZICO_SANDBOX_RECEIVER_CONFIGURATION_INVALID'); }
  // Snapshot bound functions; mutating the ports object later cannot replace dependencies.
  const admit = ports.admit.bind(ports), find = ports.findAttempt.bind(ports);
  const commit = ports.commitVerifiedPayment.bind(ports);

  return async function receive(request: Request): Promise<Response> {
    const reply = (status: number) => {
      if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
      return result(status);
    };
    const kind = request.url === callbackUrl ? 'callback' : request.url === webhookUrl ? 'webhook' : null;
    if (!kind) return reply(404);
    if (request.method !== 'POST') return reply(405);
    const contentType = request.headers.get('content-type') ?? '';
    const expectedType = kind === 'callback' ? 'application/x-www-form-urlencoded' : 'application/json';
    if (!new RegExp(`^${expectedType}(?:\\s*;\\s*charset=(?:utf-8|"utf-8"))?\\s*$`, 'i').test(contentType)
      || !['', 'identity'].includes(request.headers.get('content-encoding') ?? '')) return reply(415);
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d{1,10}$/u.test(declared) || Number(declared) > LIMIT)) return reply(413);
    const header = request.headers.get('x-iyz-signature-v3');
    if (kind === 'webhook' && (header === null || !/^[0-9a-fA-F]{64}$/u.test(header))) return reply(401);
    if (!request.body || request.bodyUsed || request.signal.aborted) return reply(400);

    const controller = new AbortController();
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expire: () => void = () => {};
    const stop = () => {
      controller.abort();
      void activeReader?.cancel().catch(() => {});
      expire();
    };
    const expiration = new Promise<Response>(resolve => { expire = () => resolve(reply(503)); });
    const timer = setTimeout(stop, timeoutMs);
    request.signal.addEventListener('abort', stop, { once: true });
    if (request.signal.aborted) stop();
    const alive = () => { if (controller.signal.aborted) throw new Error(); };

    const work = (async (): Promise<Response> => {
      try {
        alive();
        const allowed = await admit(request, controller.signal);
        alive();
        if (allowed !== true) return reply(429);
        activeReader = request.body!.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, raw = '';
        try {
          while (true) {
            const part = await activeReader.read();
            alive();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > LIMIT) { void activeReader.cancel().catch(() => {}); return reply(413); }
            raw += decoder.decode(part.value, { stream: true });
          }
          raw += decoder.decode();
        } catch { return reply(controller.signal.aborted ? 503 : 400); }
        finally { activeReader.releaseLock(); activeReader = undefined; }
        alive();

        let receivedToken: unknown;
        if (kind === 'callback') {
          // The browser redirect posts only a lookup token; it supplies no trusted payment fields.
          // Reject extras and duplicate/encoded duplicate token fields, rather than selecting one.
          const form = new URLSearchParams(raw);
          let extras = false;
          form.forEach((_v, k) => { if (k !== 'token') extras = true; });
          if (extras || form.getAll('token').length !== 1) return reply(400);
          receivedToken = form.get('token');
        } else {
          try { receivedToken = object(JSON.parse(raw))?.token; }
          catch { return reply(400); }
        }
        if (!tokenValue(receivedToken)) return reply(400);
        const loaded = await find(accountRef, receivedToken, controller.signal);
        alive();
        const attempt = snapshotAttempt(loaded, accountRef, receivedToken);
        // Missing and malformed/unbound records share a response; no provider call either way.
        if (!attempt) return reply(400);

        let notificationPaymentId: string | null = null;
        if (kind === 'webhook') {
          const expectation = { conversationId: attempt.conversationId, token: attempt.token,
            ...(attempt.paymentId !== null ? { paymentId: attempt.paymentId } : {}) };
          const notification = await verifyIyzicoSandboxNotification(credentials, header, raw, expectation);
          alive();
          if (!notification.ok) return reply(401);
          notificationPaymentId = notification.value.paymentId;
        }
        const verified = await client.retrieve({ token: attempt.token, conversationId: attempt.conversationId,
          basketId: attempt.basketId, amountMinor: attempt.amountMinor });
        alive();
        if (!verified.ok) return reply(503);
        const payment = Object.freeze({ ...verified.value });
        if ((attempt.paymentId !== null && attempt.paymentId !== payment.paymentId)
          || (notificationPaymentId !== null && notificationPaymentId !== payment.paymentId)) return reply(503);
        // This port, NOT the provider signature or this process's memory, owns durable atomicity.
        const receipt = await commit(attempt, payment, controller.signal);
        alive();
        const r = object(receipt);
        if (!r || (r.kind !== 'applied' && r.kind !== 'already_applied')
          || r.attemptId !== attempt.attemptId || r.paymentId !== payment.paymentId) return reply(503);
        return reply(200);
      } catch { return reply(503); }
    })();
    try { return await Promise.race([work, expiration]); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', stop); }
  };
}
