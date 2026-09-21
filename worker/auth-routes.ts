import { Hono } from 'hono';
import {
  AuthUnavailableError,
  accessTokenRecoveryState,
  applicationOrigin,
  beginAuthFlow,
  clearBusinessCookie,
  clearPasswordRecoveryCookie,
  clearSessionCookies,
  ensureCsrfToken,
  findAuthFlow,
  getActiveBusinessId,
  readJson,
  removeAuthFlow,
  requireAuth,
  resolveAuth,
  setPasswordRecoveryCookie,
  setSessionCookies,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
  type AuthFlowAction,
  type AuthUser,
  type Membership,
  type TokenResponse,
} from './auth.ts';

type MembershipWithBusiness = Membership & {
  businesses: null | { id: string; name: string; slug: string; timezone: string };
};
type SignupResponse = Partial<TokenResponse> & { user?: AuthUser };
type VerifyType = 'signup' | 'recovery';
type SupabaseError = { code?: string; message?: string; msg?: string };
type AuthContext = AppContext<AuthEnv>;

const authRoutes = new Hono<{ Bindings: AuthEnv }>();

function validEmail(value: unknown) {
  return typeof value === 'string'
    && value.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPassword(value: unknown) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128 && value.trim().length >= 10;
}

function callbackUrl(context: AuthContext, state: string) {
  const url = new URL('/api/auth/callback', applicationOrigin(context));
  url.searchParams.set('state', state);
  return url.toString();
}

function authResultUrl(context: AuthContext, result: string) {
  const url = new URL('/app', applicationOrigin(context));
  url.searchParams.set('auth', result);
  return url.toString();
}

function upstreamMessage(data: unknown) {
  if (typeof data !== 'object' || data === null) return '';
  const error = data as SupabaseError;
  return String(error.message ?? error.msg ?? error.code ?? '');
}

function sessionMatchesAction(token: TokenResponse, action: AuthFlowAction) {
  const passwordRecovery = accessTokenRecoveryState(token.access_token);
  return passwordRecovery !== null && passwordRecovery === (action === 'recovery');
}

function authLinkInvalid(context: AuthContext) {
  return context.json({
    error: {
      code: 'AUTH_LINK_INVALID',
      message: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Lütfen yeni bir bağlantı isteyin.',
    },
  }, 400);
}

authRoutes.get('/csrf', (context) => context.json({ csrfToken: ensureCsrfToken(context) }));

authRoutes.post('/auth/signup', async (context) => {
  const body = await readJson(context);
  const email = validEmail(body?.email) ? String(body?.email).trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  if (!email || !validPassword(password) || fullName.length > 120) {
    return context.json({
      error: {
        code: 'INVALID_SIGNUP',
        message: 'Geçerli e-posta ve en az 10 karakter parola gerekli.',
      },
    }, 400);
  }

  const { flow, challenge } = await beginAuthFlow(context, 'signup');
  const redirectTo = callbackUrl(context, flow.state);
  const result = await supabaseRequest<SignupResponse>(
    context.env,
    `auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        data: { full_name: fullName || undefined },
        code_challenge: challenge,
        code_challenge_method: 's256',
      }),
    },
  );

  if (result.status === 0 || result.status >= 500) {
    removeAuthFlow(context, flow.state);
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Hesap servisine şu anda ulaşılamıyor.' } }, 503);
  }
  if (!result.ok || !result.data) {
    removeAuthFlow(context, flow.state);
    return context.json({ error: { code: 'SIGNUP_FAILED', message: 'Hesap oluşturulamadı.' } }, 400);
  }

  const hasSession = Boolean(result.data.access_token && result.data.refresh_token && result.data.user);
  if (hasSession) {
    const token = result.data as TokenResponse;
    if (!sessionMatchesAction(token, 'signup')) {
      removeAuthFlow(context, flow.state);
      return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Hesap oturumu doğrulanamadı.' } }, 503);
    }
    clearSessionCookies(context);
    setSessionCookies(context, token);
    clearPasswordRecoveryCookie(context);
    removeAuthFlow(context, flow.state);
  }
  return context.json({ ok: true, requiresEmailConfirmation: !hasSession }, 201);
});

authRoutes.post('/auth/login', async (context) => {
  const body = await readJson(context);
  const email = validEmail(body?.email) ? String(body?.email).trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) {
    return context.json({ error: { code: 'LOGIN_FAILED', message: 'E-posta veya parola doğrulanamadı.' } }, 401);
  }

  const result = await supabaseRequest<TokenResponse>(context.env, 'auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (result.status === 0 || result.status >= 500) {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Giriş servisine şu anda ulaşılamıyor.' } }, 503);
  }
  if (!result.ok || !result.data?.access_token || !result.data.refresh_token || !result.data.user) {
    return context.json({ error: { code: 'LOGIN_FAILED', message: 'E-posta veya parola doğrulanamadı.' } }, 401);
  }
  if (!sessionMatchesAction(result.data, 'signup')) {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Giriş oturumu doğrulanamadı.' } }, 503);
  }

  clearSessionCookies(context);
  setSessionCookies(context, result.data);
  clearPasswordRecoveryCookie(context);
  clearBusinessCookie(context);
  return context.json({ ok: true });
});

authRoutes.post('/auth/logout', async (context) => {
  try {
    const auth = await resolveAuth(context);
    if (auth) {
      await supabaseRequest(context.env, 'auth/v1/logout?scope=local', { method: 'POST' }, auth.accessToken);
    }
  } catch {
    // Local cookie clearing is authoritative for the browser even if Auth is unavailable.
  }
  clearSessionCookies(context);
  return context.json({ ok: true });
});

authRoutes.post('/auth/recovery', async (context) => {
  const body = await readJson(context);
  const email = validEmail(body?.email) ? String(body?.email).trim().toLowerCase() : '';
  if (!email) {
    return context.json({ error: { code: 'INVALID_EMAIL', message: 'Geçerli bir e-posta adresi yazın.' } }, 400);
  }

  const { flow, challenge } = await beginAuthFlow(context, 'recovery');
  const redirectTo = callbackUrl(context, flow.state);
  const result = await supabaseRequest<Record<string, never>>(
    context.env,
    `auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        code_challenge: challenge,
        code_challenge_method: 's256',
      }),
    },
  );

  if (result.status === 0 || result.status >= 500) {
    removeAuthFlow(context, flow.state);
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Kurtarma e-postası şu anda hazırlanamadı.' } }, 503);
  }
  if (result.status === 429) {
    removeAuthFlow(context, flow.state);
    return context.json({ error: { code: 'RECOVERY_RATE_LIMITED', message: 'Yeni bağlantı istemeden önce biraz bekleyin.' } }, 429);
  }

  // Supabase intentionally does not reveal whether the account exists.
  return context.json({
    ok: true,
    message: 'Bu e-posta bir hesaba bağlıysa kurtarma bağlantısı gönderildi.',
  }, 202);
});

authRoutes.get('/auth/callback', async (context) => {
  const state = context.req.query('state') ?? '';
  const code = context.req.query('code') ?? '';
  const flow = state ? findAuthFlow(context, state) : null;
  if (!flow || !code || context.req.query('error')) {
    return context.redirect(authResultUrl(context, 'link-invalid'), 303);
  }

  const result = await supabaseRequest<TokenResponse>(context.env, 'auth/v1/token?grant_type=pkce', {
    method: 'POST',
    body: JSON.stringify({ auth_code: code, code_verifier: flow.verifier }),
  });

  if (result.status === 0 || result.status >= 500) {
    return context.redirect(authResultUrl(context, 'unavailable'), 303);
  }
  if (!result.ok || !result.data?.access_token || !result.data.refresh_token || !result.data.user) {
    removeAuthFlow(context, flow.state);
    return context.redirect(authResultUrl(context, 'link-invalid'), 303);
  }
  if ((result.data.type && result.data.type !== flow.action) || !sessionMatchesAction(result.data, flow.action)) {
    removeAuthFlow(context, flow.state);
    return context.redirect(authResultUrl(context, 'link-invalid'), 303);
  }

  clearSessionCookies(context);
  setSessionCookies(context, result.data);
  if (flow.action === 'recovery') setPasswordRecoveryCookie(context);
  else clearPasswordRecoveryCookie(context);
  removeAuthFlow(context, flow.state);
  return context.redirect(authResultUrl(context, flow.action === 'recovery' ? 'recovery' : 'confirmed'), 303);
});

authRoutes.post('/auth/confirm', async (context) => {
  const body = await readJson(context);
  const tokenHash = typeof body?.tokenHash === 'string' ? body.tokenHash.trim() : '';
  const type = body?.type === 'signup' || body?.type === 'recovery' ? body.type as VerifyType : null;
  if (!type || !/^[A-Za-z0-9_-]{16,512}$/.test(tokenHash)) return authLinkInvalid(context);

  const result = await supabaseRequest<TokenResponse>(context.env, 'auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  if (result.status === 0 || result.status >= 500) {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Doğrulama servisine şu anda ulaşılamıyor.' } }, 503);
  }
  if (!result.ok || !result.data?.access_token || !result.data.refresh_token || !result.data.user) {
    return authLinkInvalid(context);
  }
  if (!sessionMatchesAction(result.data, type)) return authLinkInvalid(context);

  clearSessionCookies(context);
  setSessionCookies(context, result.data);
  if (type === 'recovery') setPasswordRecoveryCookie(context);
  else clearPasswordRecoveryCookie(context);
  return context.json({ ok: true, type });
});

authRoutes.put('/auth/password', async (context) => {
  const resolved = await requireAuth(context);
  if ('error' in resolved) return resolved.error;

  const body = await readJson(context);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!validPassword(password)) {
    return context.json({
      error: {
        code: 'INVALID_PASSWORD',
        message: 'Yeni parola en az 10 karakter olmalı.',
      },
    }, 400);
  }

  const updated = await supabaseRequest<AuthUser>(context.env, 'auth/v1/user', {
    method: 'PUT',
    body: JSON.stringify({ password }),
  }, resolved.auth.accessToken);

  if (updated.status === 0 || updated.status >= 500) {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Parola şu anda güncellenemiyor.' } }, 503);
  }
  if (!updated.ok || !updated.data?.id) {
    const message = upstreamMessage(updated.data);
    const requiresRecentLogin = /reauth|recent|nonce/i.test(message);
    return context.json({
      error: {
        code: requiresRecentLogin ? 'REAUTH_REQUIRED' : 'PASSWORD_UPDATE_FAILED',
        message: requiresRecentLogin
          ? 'Parolayı değiştirmek için yeniden giriş yapın.'
          : 'Parola güncellenemedi.',
      },
    }, requiresRecentLogin ? 401 : 400);
  }

  await supabaseRequest(context.env, 'auth/v1/logout?scope=global', { method: 'POST' }, resolved.auth.accessToken);
  clearSessionCookies(context);
  return context.json({ ok: true, signedOut: true });
});

authRoutes.get('/session', async (context) => {
  const csrfToken = ensureCsrfToken(context);
  try {
    const auth = await resolveAuth(context);
    if (!auth) {
      return context.json({
        user: null,
        memberships: [],
        activeBusinessId: null,
        passwordRecovery: false,
        csrfToken,
      });
    }

    const query = new URLSearchParams({
      select: 'id,business_id,role,active,businesses(id,name,slug,timezone)',
      user_id: `eq.${auth.user.id}`,
      active: 'eq.true',
      order: 'created_at.asc',
    });
    const memberships = await supabaseRequest<MembershipWithBusiness[]>(
      context.env,
      `rest/v1/memberships?${query}`,
      {},
      auth.accessToken,
    );
    if (memberships.status === 0 || memberships.status >= 500) throw new AuthUnavailableError();
    if (!memberships.ok) {
      clearSessionCookies(context);
      return context.json({
        user: null,
        memberships: [],
        activeBusinessId: null,
        passwordRecovery: false,
        csrfToken,
      });
    }

    const activeMemberships = memberships.data ?? [];
    const selected = getActiveBusinessId(context);
    const activeBusinessId = selected && activeMemberships.some((membership) => membership.business_id === selected)
      ? selected
      : null;
    if (selected && !activeBusinessId) clearBusinessCookie(context);

    return context.json({
      user: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        fullName: auth.user.user_metadata?.full_name ?? null,
      },
      memberships: activeMemberships,
      activeBusinessId,
      passwordRecovery: auth.passwordRecovery,
      csrfToken,
    });
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      return context.json({
        error: {
          code: 'SESSION_UNAVAILABLE',
          message: 'Oturum şu anda doğrulanamıyor. Lütfen tekrar deneyin.',
        },
      }, 503);
    }
    throw error;
  }
});

export default authRoutes;