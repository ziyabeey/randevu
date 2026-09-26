/**
 * IYZ-01A: pure, server-only verifier for Sandbox Checkout Form HPP notifications.
 * This is not an HTTP endpoint. No network, automatic acknowledgement or ledger write.
 * A verified notification only requests a fresh, server-bound payment retrieval.
 */
export type SandboxWebhookExpectation = {
  conversationId: string;
  token: string;
  /** Optional only until the server has learned and persisted the provider payment ID. */
  paymentId?: string;
};
export type VerifiedSandboxNotification = {
  kind: 'verified_sandbox_notification';
  paymentId: string;
  conversationId: string;
  token: string;
  eventStatus: 'SUCCESS' | 'FAILURE';
  nextAction: 'retrieve_payment';
};
export type SandboxWebhookResult =
  | { ok: true; value: VerifiedSandboxNotification }
  | { ok: false; code: 'INVALID_INPUT' | 'INVALID_NOTIFICATION' };

const encoder = new TextEncoder();
const LIMIT = 16 * 1024;
const reject = (code: 'INVALID_INPUT' | 'INVALID_NOTIFICATION') => ({ ok: false, code } as const);
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(v);
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(v);
function paymentId(v: unknown): string | null {
  if (typeof v === 'number' && (!Number.isSafeInteger(v) || v <= 0)) return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const value = String(v);
  return /^[1-9][0-9]{0,31}$/u.test(value) ? value : null;
}

/**
 * expected MUST be loaded from an authorized server-side attempt, never the webhook.
 * signatureV3 MUST be the exact X-IYZ-SIGNATURE-V3 header; V1/V2 fallbacks are forbidden.
 * The HTTP layer must also bound body bytes/deadline before reading them into memory.
 * merchantId, event time and reference code are not signed in HPP and are not trusted here.
 */
export async function verifyIyzicoSandboxNotification(
  env: { IYZICO_SANDBOX_SECRET_KEY?: string },
  signatureV3: unknown,
  rawBody: unknown,
  expected: SandboxWebhookExpectation,
): Promise<SandboxWebhookResult> {
  const secret = env?.IYZICO_SANDBOX_SECRET_KEY;
  const e = object(expected);
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 512
    || secret.trim() !== secret || /[\u0000-\u001f\u007f]/u.test(secret)
    || !e || !Object.hasOwn(e,'conversationId') || !Object.hasOwn(e,'token')
    || !Object.keys(e).every(k => ['conversationId','token','paymentId'].includes(k))
    || !id(e.conversationId) || !token(e.token)
    || (e.paymentId !== undefined && (typeof e.paymentId !== 'string' || paymentId(e.paymentId) === null))) {
    return reject('INVALID_INPUT');
  }
  // Snapshot before crypto awaits; mutable input cannot change the trusted comparison.
  const binding = { conversationId:e.conversationId, token:e.token, paymentId:e.paymentId };
  if (typeof signatureV3 !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(signatureV3)
    || typeof rawBody !== 'string' || rawBody.length > LIMIT || encoder.encode(rawBody).byteLength > LIMIT) {
    return reject('INVALID_NOTIFICATION');
  }
  let p: Record<string, unknown> | null;
  try { p = object(JSON.parse(rawBody)); } catch { return reject('INVALID_NOTIFICATION'); }
  if (!p || p.iyziEventType !== 'CHECKOUT_FORM_AUTH'
    || (p.status !== 'SUCCESS' && p.status !== 'FAILURE')
    || p.paymentConversationId !== binding.conversationId || p.token !== binding.token) {
    return reject('INVALID_NOTIFICATION');
  }
  const providerId = paymentId(p.iyziPaymentId);
  if (!providerId || (binding.paymentId !== undefined && providerId !== binding.paymentId)) {
    return reject('INVALID_NOTIFICATION');
  }
  const eventStatus = p.status;
  // HPP V3 uses concatenation WITHOUT ':' separators, unlike response signatures.
  const message = secret + 'CHECKOUT_FORM_AUTH' + providerId + binding.token + binding.conversationId + eventStatus;
  const supplied = new Uint8Array(32);
  for (let i = 0; i < supplied.length; i++) supplied[i] = parseInt(signatureV3.slice(i * 2, i * 2 + 2),16);
  try {
    const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if (!await crypto.subtle.verify('HMAC',key,supplied,encoder.encode(message))) return reject('INVALID_NOTIFICATION');
  } catch { return reject('INVALID_NOTIFICATION'); }
  // Replay/deduplication belongs to the durable attempt/ledger layer, not memory or this value.
  // Even FAILURE wakes retrieval: delayed events must not regress a later verified payment.
  return {ok:true,value:{kind:'verified_sandbox_notification',paymentId:providerId,
    conversationId:binding.conversationId,token:binding.token,eventStatus,nextAction:'retrieve_payment'}};
}
