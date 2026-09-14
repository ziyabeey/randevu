import { Hono } from 'hono';
import {
  applicationOrigin,
  canManage,
  clearBusinessCookie,
  first,
  readJson,
  requireAuth,
  requireMember,
  setBusinessCookie,
  supabaseRequest,
  upstreamUnavailable,
  type AppContext,
  type AuthEnv,
  type Role,
  type SupabaseResult,
} from './auth.ts';

type TeamContext = AppContext<AuthEnv>;
type PermissionKey =
  | 'payments_write'
  | 'pricing_adjustments_write'
  | 'financial_reports_read'
  | 'inventory_write'
  | 'expenses_write';

type InvitationRow = {
  invitation_id: string;
  business_id: string;
  email: string;
  role: Role;
  expires_at: string;
};

type MembershipRow = {
  membership_id: string;
  role: Role;
  active: boolean;
};

type AcceptedInvitationRow = {
  business_id: string;
  membership_id: string;
  role: Role;
};

type TeamSnapshot = {
  actor?: { membershipId?: string; role?: Role };
  members?: unknown[];
  staff?: unknown[];
  invitations?: unknown[];
  financialPermissions?: unknown[];
  effectiveFinancialPermissions?: PermissionKey[];
};

type RpcError = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };

const team = new Hono<{ Bindings: AuthEnv }>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set<Role>(['owner', 'manager', 'staff']);
const PERMISSIONS = new Set<PermissionKey>([
  'payments_write',
  'pricing_adjustments_write',
  'financial_reports_read',
  'inventory_write',
  'expenses_write',
]);

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.has(value as Role);
}

function isPermission(value: unknown): value is PermissionKey {
  return typeof value === 'string' && PERMISSIONS.has(value as PermissionKey);
}

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}

function randomInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rpcMessage(data: unknown) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return '';
  const error = data as RpcError;
  return typeof error.message === 'string' ? error.message : '';
}

function rpcFailure<T>(context: TeamContext, result: SupabaseResult<T>, fallbackCode: string, fallbackMessage: string) {
  if (upstreamUnavailable(result.status)) {
    return context.json({ error: { code: 'TEAM_UNAVAILABLE', message: 'Ekip işlemleri şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } }, 503);
  }

  const message = rpcMessage(result.data);
  if (message.includes('AUTH_REQUIRED')) {
    return context.json({ error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } }, 401);
  }
  if (message.includes('TEAM_FORBIDDEN')) {
    clearBusinessCookie(context);
    return context.json({ error: { code: 'TENANT_REQUIRED', message: 'Bu işletmeye erişiminiz artık yok.' } }, 403);
  }
  if (message.includes('OWNER_ROLE_REQUIRES_OWNER')) {
    return context.json({ error: { code: 'OWNER_ROLE_REQUIRES_OWNER', message: 'Owner rolünü yalnız mevcut owner yönetebilir.' } }, 403);
  }
  if (message.includes('FINANCIAL_PERMISSION_OWNER_REQUIRED')) {
    return context.json({ error: { code: 'FINANCIAL_PERMISSION_OWNER_REQUIRED', message: 'Mali izinleri yalnız owner yönetebilir.' } }, 403);
  }
  if (message.includes('INVITATION_EMAIL_MISMATCH')) {
    return context.json({ error: { code: 'INVITATION_EMAIL_MISMATCH', message: 'Bu davet giriş yaptığınız hesaba ait değil.' } }, 403);
  }
  if (message.includes('INVITATION_NOT_FOUND')) {
    return context.json({ error: { code: 'INVITATION_NOT_FOUND', message: 'Davet bulunamadı.' } }, 404);
  }
  if (message.includes('MEMBERSHIP_NOT_FOUND')) {
    return context.json({ error: { code: 'MEMBERSHIP_NOT_FOUND', message: 'Üyelik bulunamadı.' } }, 404);
  }
  if (message.includes('STAFF_NOT_FOUND')) {
    return context.json({ error: { code: 'STAFF_NOT_FOUND', message: 'Personel kaydı bulunamadı.' } }, 404);
  }
  if (message.includes('ACTIVE_MEMBERSHIP_NOT_FOUND')) {
    return context.json({ error: { code: 'ACTIVE_MEMBERSHIP_NOT_FOUND', message: 'Bağlanacak aktif üyelik bulunamadı.' } }, 404);
  }
  if (message.includes('INVITATION_ALREADY_PENDING')) {
    return context.json({ error: { code: 'INVITATION_ALREADY_PENDING', message: 'Bu e-posta için bekleyen bir davet zaten var.' } }, 409);
  }
  if (message.includes('ALREADY_ACTIVE_MEMBER')) {
    return context.json({ error: { code: 'ALREADY_ACTIVE_MEMBER', message: 'Bu hesap zaten aktif ekip üyesi.' } }, 409);
  }
  if (message.includes('INVITATION_ALREADY_USED')) {
    return context.json({ error: { code: 'INVITATION_ALREADY_USED', message: 'Bu davet daha önce kullanılmış.' } }, 409);
  }
  if (message.includes('INVITATION_REVOKED')) {
    return context.json({ error: { code: 'INVITATION_REVOKED', message: 'Bu davet geri alınmış.' } }, 409);
  }
  if (message.includes('INVITATION_EXPIRED')) {
    return context.json({ error: { code: 'INVITATION_EXPIRED', message: 'Bu davetin süresi dolmuş.' } }, 409);
  }
  if (message.includes('LAST_ACTIVE_OWNER')) {
    return context.json({ error: { code: 'LAST_ACTIVE_OWNER', message: 'İşletmenin son aktif owner hesabı kaldırılamaz.' } }, 409);
  }
  if (message.includes('FINANCIAL_PERMISSION_STAFF_ONLY')) {
    return context.json({ error: { code: 'FINANCIAL_PERMISSION_STAFF_ONLY', message: 'Açık mali izinler yalnız staff rolüne atanır.' } }, 409);
  }
  if (message.includes('TEAM_MEMBERS_LIMIT_EXCEEDED')
      || message.includes('TEAM_STAFF_LIMIT_EXCEEDED')
      || message.includes('TEAM_INVITATIONS_LIMIT_EXCEEDED')) {
    return context.json({ error: { code: 'TEAM_LIMIT_EXCEEDED', message: 'Ekip görünümü güvenli liste sınırını aştı.' } }, 409);
  }

  return context.json({ error: { code: fallbackCode, message: fallbackMessage } }, result.status === 401 ? 401 : 400);
}

async function requireStandardAuth(context: TeamContext) {
  const access = await requireAuth(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: {
          code: 'PASSWORD_UPDATE_REQUIRED',
          message: 'Devam etmeden önce yeni parolanızı belirleyin.',
        },
      }, 403),
    } as const;
  }
  return access;
}

team.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;

  const result = await supabaseRequest<TeamSnapshot>(context.env, 'rest/v1/rpc/get_team_snapshot', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id }),
  }, access.auth.accessToken);
  if (!result.ok || !result.data) {
    return rpcFailure(context, result, 'TEAM_READ_FAILED', 'Ekip bilgileri okunamadı.');
  }

  return context.json({ team: result.data });
});

team.post('/invitations', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Davet oluşturmak için yönetici yetkisi gerekli.' } }, 403);
  }

  const body = await readJson(context);
  const email = normalizeEmail(body?.email);
  const role = isRole(body?.role) ? body.role : null;
  if (!email || !role) {
    return context.json({ error: { code: 'INVALID_INVITATION', message: 'Geçerli e-posta ve rol gerekli.' } }, 400);
  }
  if (access.membership.role === 'manager' && role === 'owner') {
    return context.json({ error: { code: 'OWNER_ROLE_REQUIRES_OWNER', message: 'Owner rolünü yalnız mevcut owner verebilir.' } }, 403);
  }

  const token = randomInviteToken();
  const tokenHash = await sha256Hex(token);
  const result = await supabaseRequest<InvitationRow[]>(context.env, 'rest/v1/rpc/create_business_invitation', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_email: email,
      p_role: role,
      p_token_hash: tokenHash,
    }),
  }, access.auth.accessToken);
  const invitation = result.ok ? first(result.data) : null;
  if (!invitation) {
    return rpcFailure(context, result, 'INVITATION_CREATE_FAILED', 'Davet oluşturulamadı.');
  }

  // Fragment never reaches HTTP requests or Referer headers. The plaintext token
  // is intentionally returned once and is never persisted by this service.
  const inviteUrl = `${applicationOrigin(context)}/#invite=${token}`;
  return context.json({ invitation, inviteUrl }, 201);
});

team.post('/invitations/accept', async (context) => {
  const access = await requireStandardAuth(context);
  if ('error' in access) return access.error;

  const body = await readJson(context);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return context.json({ error: { code: 'INVITATION_INVALID', message: 'Davet bağlantısı geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<AcceptedInvitationRow[]>(context.env, 'rest/v1/rpc/accept_business_invitation', {
    method: 'POST',
    body: JSON.stringify({ p_token_hash: await sha256Hex(token) }),
  }, access.auth.accessToken);
  const accepted = result.ok ? first(result.data) : null;
  if (!accepted) {
    return rpcFailure(context, result, 'INVITATION_ACCEPT_FAILED', 'Davet kabul edilemedi.');
  }

  setBusinessCookie(context, accepted.business_id);
  return context.json({ membership: accepted });
});

team.post('/invitations/:id/revoke', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Davet geri almak için yönetici yetkisi gerekli.' } }, 403);
  }

  const invitationId = context.req.param('id');
  if (!isUuid(invitationId)) {
    return context.json({ error: { code: 'INVALID_INVITATION', message: 'Davet kimliği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<null>(context.env, 'rest/v1/rpc/revoke_business_invitation', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: access.membership.business_id, p_invitation_id: invitationId }),
  }, access.auth.accessToken);
  if (!result.ok) {
    return rpcFailure(context, result, 'INVITATION_REVOKE_FAILED', 'Davet geri alınamadı.');
  }
  return context.json({ ok: true });
});

team.patch('/members/:id', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Üyelik yönetimi için yönetici yetkisi gerekli.' } }, 403);
  }

  const membershipId = context.req.param('id');
  const body = await readJson(context);
  const role = isRole(body?.role) ? body.role : null;
  const active = typeof body?.active === 'boolean' ? body.active : null;
  if (!isUuid(membershipId) || !role || active === null) {
    return context.json({ error: { code: 'INVALID_MEMBERSHIP_UPDATE', message: 'Üyelik, rol veya aktiflik bilgisi geçerli değil.' } }, 400);
  }
  if (access.membership.role === 'manager' && role === 'owner') {
    return context.json({ error: { code: 'OWNER_ROLE_REQUIRES_OWNER', message: 'Owner rolünü yalnız mevcut owner verebilir.' } }, 403);
  }

  const result = await supabaseRequest<MembershipRow[]>(context.env, 'rest/v1/rpc/update_team_membership', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_membership_id: membershipId,
      p_role: role,
      p_active: active,
    }),
  }, access.auth.accessToken);
  const membership = result.ok ? first(result.data) : null;
  if (!membership) {
    return rpcFailure(context, result, 'MEMBERSHIP_UPDATE_FAILED', 'Üyelik güncellenemedi.');
  }
  return context.json({ membership });
});

team.put('/staff/:staffId/membership', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) {
    return context.json({ error: { code: 'NOT_ALLOWED', message: 'Personel-hesap bağlantısını yönetmek için yetkiniz yok.' } }, 403);
  }

  const staffId = context.req.param('staffId');
  const body = await readJson(context);
  const membershipId = body?.membershipId === null ? null : body?.membershipId;
  if (!isUuid(staffId) || (membershipId !== null && !isUuid(membershipId))) {
    return context.json({ error: { code: 'INVALID_STAFF_LINK', message: 'Personel veya üyelik kimliği geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<string | null>(context.env, 'rest/v1/rpc/set_staff_membership_link', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: staffId,
      p_membership_id: membershipId,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    return rpcFailure(context, result, 'STAFF_LINK_FAILED', 'Personel-hesap bağlantısı güncellenemedi.');
  }
  return context.json({ membershipId: result.data });
});

team.put('/members/:id/financial-permissions/:permission', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (access.membership.role !== 'owner') {
    return context.json({ error: { code: 'FINANCIAL_PERMISSION_OWNER_REQUIRED', message: 'Mali izinleri yalnız owner yönetebilir.' } }, 403);
  }

  const membershipId = context.req.param('id');
  const permission = context.req.param('permission');
  const body = await readJson(context);
  if (!isUuid(membershipId) || !isPermission(permission) || typeof body?.enabled !== 'boolean') {
    return context.json({ error: { code: 'INVALID_FINANCIAL_PERMISSION', message: 'Üyelik, izin veya durum bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<boolean>(context.env, 'rest/v1/rpc/set_membership_financial_permission', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_membership_id: membershipId,
      p_permission: permission,
      p_enabled: body.enabled,
    }),
  }, access.auth.accessToken);
  if (!result.ok || typeof result.data !== 'boolean') {
    return rpcFailure(context, result, 'FINANCIAL_PERMISSION_UPDATE_FAILED', 'Mali izin güncellenemedi.');
  }
  return context.json({ enabled: result.data });
});

export default team;
