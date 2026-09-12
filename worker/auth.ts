import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export type AuthEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  COOKIE_SECURE?: string;
  PUBLIC_APP_ORIGIN?: string;
};

export type Role = 'owner' | 'manager' | 'staff';
export type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
};
export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user: AuthUser;
  type?: string;
};
export type AuthSession = {
  accessToken: string;
  user: AuthUser;
  passwordRecovery: boolean;
};
export type Membership = {
  id: string;
  business_id: string;
  role: Role;
  active: boolean;
};
export type SupabaseResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};
export type AppContext<E extends AuthEnv = AuthEnv> = Context<{ Bindings: E }>;
export type AuthAccess =
  | { auth: AuthSession; error?: never }
  | { error: Response; auth?: never };
export type MemberAccess =
  | { auth: AuthSession; membership: Membership; error?: never }
  | { error: Response; auth?: never; membership?: never };
export type AuthFlowAction = 'signup' | 'recovery';
export type AuthFlow = {
  action: AuthFlowAction;
  state: string;
  verifier: string;
  expiresAt: number;
};

const ACCESS_COOKIE = 'yzt_access';
const REFRESH_COOKIE = 'yzt_refresh';
const BUSINESS_COOKIE = 'yzt_business';
const CSRF_COOKIE = 'yzt_csrf';
const AUTH_FLOW_COOKIE = 'yzt_auth_flows';
const PASSWORD_RECOVERY_COOKIE = 'yzt_password_recovery';
const FLOW_TTL_SECONDS = 10 * 60;
const MAX_AUTH_FLOWS = 4;

export class AuthUnavailableError extends Error {
  constructor() {
    super('Authentication service unavailable');
    this.name = 'AuthUnavailableError';
  }
}

function secureCookies(env: AuthEnv) {
  return env.COOKIE_SECURE !== 'false';
}

export function cookieOptions(env: AuthEnv, maxAge: number, path = '/') {
  return {
    httpOnly: true,
    secure: secureCookies(env),
    sameSite: 'Lax' as const,
    path,
    maxAge,
  };
}

export function setSessionCookies<E extends AuthEnv>(context: AppContext<E>, token: TokenResponse) {
  setCookie(context, ACCESS_COOKIE, token.access_token, cookieOptions(context.env, Math.max(60, token.expires_in ?? 3600)));
  setCookie(context, REFRESH_COOKIE, token.refresh_token, cookieOptions(context.env, 60 * 60 * 24 * 30));
}

export function clearSessionCookies<E extends AuthEnv>(context: AppContext<E>) {
  deleteCookie(context, ACCESS_COOKIE, { path: '/' });
  deleteCookie(context, REFRESH_COOKIE, { path: '/' });
  deleteCookie(context, BUSINESS_COOKIE, { path: '/' });
  deleteCookie(context, PASSWORD_RECOVERY_COOKIE, { path: '/' });
}

export function setBusinessCookie<E extends AuthEnv>(context: AppContext<E>, businessId: string) {
  setCookie(context, BUSINESS_COOKIE, businessId, cookieOptions(context.env, 60 * 60 * 24 * 30));
}

export function clearBusinessCookie<E extends AuthEnv>(context: AppContext<E>) {
  deleteCookie(context, BUSINESS_COOKIE, { path: '/' });
}

export function setPasswordRecoveryCookie<E extends AuthEnv>(context: AppContext<E>) {
  setCookie(context, PASSWORD_RECOVERY_COOKIE, '1', cookieOptions(context.env, 15 * 60));
}

export function clearPasswordRecoveryCookie<E extends AuthEnv>(context: AppContext<E>) {
  deleteCookie(context, PASSWORD_RECOVERY_COOKIE, { path: '/' });
}

export function isPasswordRecovery<E extends AuthEnv>(context: AppContext<E>) {
  return getCookie(context, PASSWORD_RECOVERY_COOKIE) === '1';
}

export function getActiveBusinessId<E extends AuthEnv>(context: AppContext<E>) {
  return getCookie(context, BUSINESS_COOKIE) ?? null;
}

export async function supabaseRequest<T = unknown>(
  env: AuthEnv,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<SupabaseResult<T>> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${accessToken ?? env.SUPABASE_ANON_KEY}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/${path}`, { ...init, headers });
    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try { data = JSON.parse(text) as T; }
      catch { data = null; }
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function readJson<E extends AuthEnv>(context: AppContext<E>): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await context.req.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function first<T>(items: T[] | null): T | null {
  return items?.[0] ?? null;
}

function upstreamUnavailable(status: number) {
  return status === 0 || status >= 500;
}

export async function resolveAuth<E extends AuthEnv>(context: AppContext<E>): Promise<AuthSession | null> {
  const accessToken = getCookie(context, ACCESS_COOKIE);
  const refreshToken = getCookie(context, REFRESH_COOKIE);

  if (accessToken) {
    const current = await supabaseRequest<AuthUser>(context.env, 'auth/v1/user', {}, accessToken);
    if (current.ok && current.data) {
      return { accessToken, user: current.data, passwordRecovery: isPasswordRecovery(context) };
    }
    if (upstreamUnavailable(current.status)) throw new AuthUnavailableError();
  }

  if (!refreshToken) return null;

  const refreshed = await supabaseRequest<TokenResponse>(context.env, 'auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (upstreamUnavailable(refreshed.status)) throw new AuthUnavailableError();
  if (!refreshed.ok || !refreshed.data?.access_token || !refreshed.data.refresh_token || !refreshed.data.user) {
    clearSessionCookies(context);
    return null;
  }

  setSessionCookies(context, refreshed.data);
  return {
    accessToken: refreshed.data.access_token,
    user: refreshed.data.user,
    passwordRecovery: isPasswordRecovery(context),
  };
}

export async function activeMembership<E extends AuthEnv>(
  context: AppContext<E>,
  auth: AuthSession,
): Promise<Membership | null> {
  const businessId = getActiveBusinessId(context);
  if (!businessId) return null;

  const query = new URLSearchParams({
    select: 'id,business_id,role,active',
    business_id: `eq.${businessId}`,
    user_id: `eq.${auth.user.id}`,
    active: 'eq.true',
    limit: '1',
  });
  const result = await supabaseRequest<Membership[]>(context.env, `rest/v1/memberships?${query}`, {}, auth.accessToken);
  if (upstreamUnavailable(result.status)) throw new AuthUnavailableError();
  const membership = result.ok ? first(result.data) : null;
  if (!membership) clearBusinessCookie(context);
  return membership;
}

export async function requireAuth<E extends AuthEnv>(context: AppContext<E>): Promise<AuthAccess> {
  try {
    const auth = await resolveAuth(context);
    if (!auth) {
      return { error: context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401) };
    }
    return { auth };
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      return { error: context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Oturum şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503) };
    }
    throw error;
  }
}

export async function requireMember<E extends AuthEnv>(context: AppContext<E>): Promise<MemberAccess> {
  const resolved = await requireAuth(context);
  if (resolved.error) return { error: resolved.error };
  try {
    const membership = await activeMembership(context, resolved.auth);
    if (!membership) {
      return { error: context.json({ error: { code: 'TENANT_REQUIRED', message: 'Aktif işletme seçin.' } }, 403) };
    }
    return { auth: resolved.auth, membership };
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      return { error: context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Üyelik şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503) };
    }
    throw error;
  }
}

export function canManage(membership: Membership | null): membership is Membership {
  return membership?.role === 'owner' || membership?.role === 'manager';
}

function randomBase64Url(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function validFlow(value: unknown): value is AuthFlow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const flow = value as Partial<AuthFlow>;
  return (flow.action === 'signup' || flow.action === 'recovery')
    && typeof flow.state === 'string'
    && /^[A-Za-z0-9_-]{32,128}$/.test(flow.state)
    && typeof flow.verifier === 'string'
    && /^[A-Za-z0-9_-]{43,128}$/.test(flow.verifier)
    && typeof flow.expiresAt === 'number'
    && Number.isFinite(flow.expiresAt);
}

function readAuthFlows<E extends AuthEnv>(context: AppContext<E>) {
  const encoded = getCookie(context, AUTH_FLOW_COOKIE);
  if (!encoded) return [] as AuthFlow[];
  try {
    const decoded = JSON.parse(base64UrlToText(encoded)) as unknown;
    if (!Array.isArray(decoded)) return [];
    return decoded.filter(validFlow).filter((flow) => flow.expiresAt > Date.now()).slice(-MAX_AUTH_FLOWS);
  } catch {
    return [];
  }
}

function writeAuthFlows<E extends AuthEnv>(context: AppContext<E>, flows: AuthFlow[]) {
  if (!flows.length) {
    deleteCookie(context, AUTH_FLOW_COOKIE, { path: '/api/auth' });
    return;
  }
  setCookie(
    context,
    AUTH_FLOW_COOKIE,
    textToBase64Url(JSON.stringify(flows.slice(-MAX_AUTH_FLOWS))),
    cookieOptions(context.env, FLOW_TTL_SECONDS, '/api/auth'),
  );
}

export async function beginAuthFlow<E extends AuthEnv>(context: AppContext<E>, action: AuthFlowAction) {
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(24);
  const flow: AuthFlow = {
    action,
    state,
    verifier,
    expiresAt: Date.now() + FLOW_TTL_SECONDS * 1000,
  };
  writeAuthFlows(context, [...readAuthFlows(context), flow]);
  return { flow, challenge: await codeChallenge(verifier) };
}

export function findAuthFlow<E extends AuthEnv>(context: AppContext<E>, state: string) {
  return readAuthFlows(context).find((flow) => flow.state === state) ?? null;
}

export function removeAuthFlow<E extends AuthEnv>(context: AppContext<E>, state: string) {
  writeAuthFlows(context, readAuthFlows(context).filter((flow) => flow.state !== state));
}

function validHttpsOrigin(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password) return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function applicationOrigin<E extends AuthEnv>(context: AppContext<E>) {
  return validHttpsOrigin(context.env.PUBLIC_APP_ORIGIN) ?? new URL(context.req.url).origin;
}

function validCsrf(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{43,128}$/.test(value));
}

export function ensureCsrfToken<E extends AuthEnv>(context: AppContext<E>) {
  const current = getCookie(context, CSRF_COOKIE);
  if (validCsrf(current)) return current as string;
  const token = randomBase64Url(32);
  setCookie(context, CSRF_COOKIE, token, cookieOptions(context.env, 12 * 60 * 60));
  return token;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function mutationSecurityError<E extends AuthEnv>(context: AppContext<E>) {
  const method = context.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  const origin = context.req.header('Origin');
  const fetchSite = context.req.header('Sec-Fetch-Site');
  const browserLike = Boolean(origin || fetchSite);
  if (!browserLike) return null;

  if (!origin || origin !== applicationOrigin(context) || fetchSite === 'cross-site') {
    return {
      code: 'ORIGIN_FORBIDDEN',
      message: 'İstek kaynağı doğrulanamadı. Sayfayı yenileyip tekrar deneyin.',
    };
  }

  const cookieToken = getCookie(context, CSRF_COOKIE);
  const headerToken = context.req.header('X-YZT-CSRF');
  if (!validCsrf(cookieToken) || !validCsrf(headerToken) || !constantTimeEqual(cookieToken as string, headerToken as string)) {
    return {
      code: 'CSRF_INVALID',
      message: 'Güvenlik doğrulaması yenilenmeli. Sayfayı yenileyip tekrar deneyin.',
    };
  }

  return null;
}
