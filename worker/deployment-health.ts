// Staging control plane: authenticated by the private DB verifier, never a session.
// A verifier is a deployment credential and must not appear in logs or responses.
export type DeploymentEnv = {
  DEPLOYMENT_PROBE_ENABLED?: string;
  WORKER_VERSION?: { id: string };
  PUBLIC_BOOKING_GATE_SECRET?: string;
  NOTIFICATION_DISPATCH_SECRET?: string;
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (n) => Number.parseInt(n, 16));
const base64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unbase64 = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (n) => n.charCodeAt(0));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function hmacKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(key: CryptoKey, message: string) {
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}
export async function deploymentHealth(request: Request, env: DeploymentEnv): Promise<Response> {
  const reply = (value: unknown, status: number) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (env.DEPLOYMENT_PROBE_ENABLED !== 'true') return reply({ error: 'NOT_FOUND' }, 404);
  try {
    const raw = request.headers.get('X-Deployment-Challenge') ?? '';
    const signature = (request.headers.get('Authorization') ?? '').replace(/^Deployment /, '');
    if (raw.length > 2048 || !/^[0-9a-f]{64}$/.test(signature)) throw new Error();
    const challenge = JSON.parse(new TextDecoder().decode(unbase64(raw))) as {
      nonce: string; expires: number; version: string; canary?: { iv: string; ciphertext: string };
    };
    const now = Math.floor(Date.now() / 1000);
    if (!/^[0-9a-f]{64}$/.test(challenge.nonce) || !uuid.test(challenge.version)
        || challenge.version !== env.WORKER_VERSION?.id || !Number.isInteger(challenge.expires)
        || challenge.expires < now || challenge.expires > now + 90) throw new Error();
    const gate = env.PUBLIC_BOOKING_GATE_SECRET ?? '';
    const dispatch = env.NOTIFICATION_DISPATCH_SECRET ?? '';
    if (gate.length < 43 || gate.length > 256 || dispatch.length < 43 || dispatch.length > 256) throw new Error();
    const gateKey = await hmacKey(gate);
    if (!await crypto.subtle.verify('HMAC', gateKey, unhex(signature), encoder.encode(`s05:request:${raw}`))) throw new Error();
    const management = env.MANAGEMENT_LINK_ENCRYPTION_KEY_V1 ?? '';
    const master = unbase64(management);
    if (master.length !== 32) throw new Error();
    const aes = await crypto.subtle.importKey('raw', master, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const additionalData = encoder.encode('s05:management-canary:v1');
    let canary = challenge.canary;
    if (canary) {
      if (!/^[A-Za-z0-9_-]{16}$/.test(canary.iv) || !/^[A-Za-z0-9_-]{107}$/.test(canary.ciphertext)) throw new Error();
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(canary.iv), additionalData }, aes, unbase64(canary.ciphertext));
      if (new TextDecoder().decode(decrypted) !== challenge.nonce) throw new Error();
    } else {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, aes, encoder.encode(challenge.nonce));
      canary = { iv: base64(iv.buffer), ciphertext: base64(ciphertext) };
    }
    const payload = {
      version: challenge.version,
      dispatch: await sign(await hmacKey(dispatch), `s05:dispatch:${challenge.nonce}:${challenge.version}`),
      management: await sign(await hmacKey(management), `s05:management:${challenge.nonce}`),
      canary,
    };
    return reply({ ...payload, proof: await sign(gateKey, `s05:response:${raw}:${JSON.stringify(payload)}`) }, 200);
  } catch {
    return reply({ error: 'DEPLOYMENT_PROBE_DENIED' }, 403);
  }
}

export async function recordStagingHeartbeat(env: DeploymentEnv): Promise<void> {
  if (env.DEPLOYMENT_PROBE_ENABLED !== 'true' || !uuid.test(env.WORKER_VERSION?.id ?? '')
      || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.NOTIFICATION_DISPATCH_SECRET) return;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_staging_cron_heartbeat`, {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_dispatch_secret: env.NOTIFICATION_DISPATCH_SECRET, p_version_id: env.WORKER_VERSION?.id }),
    });
    await response.body?.cancel();
  } catch { /* Readiness stays false; existing delivery is independent of this probe. */ }
}
