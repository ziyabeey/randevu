import { Hono } from 'hono';
import {
  canManage,
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AppContext,
  type AuthEnv,
} from './auth.ts';
import {
  publicGateUnavailableBody,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { publicOperation } from './public-rpc.ts';
import { isUuid, stringOrNull } from '../shared/validation.ts';
import { rpcErrorMessage } from './common.ts';

type Env = AuthEnv & PublicAbuseEnv;
type BaseContext = AppContext<Env>;

type PublicMedia = {
  id: string;
  alt_text: string | null;
  sort_order: number;
  width: number;
  height: number;
};
type BusinessHour = { weekday: number; starts_local: string; ends_local: string };
type PublicProfile = {
  business_id?: string;
  public_name: string;
  short_description: string | null;
  long_description: string | null;
  public_phone: string | null;
  public_email: string | null;
  public_website: string | null;
  public_whatsapp: string | null;
  address_text: string | null;
  show_work_hours: boolean;
  cover_media_id: string | null;
  work_hours: BusinessHour[];
  media: PublicMedia[];
};
type MediaObject = { storage_path: string; mime_type: string };
type PendingMedia = MediaObject & PublicMedia & {
  status: 'pending' | 'ready' | 'deleting' | 'cleanup';
  size_bytes: number;
};
type DeleteStart = { storage_path: string; was_cover: boolean };
type CleanupMedia = { id: string; storage_path: string };

const PUBLIC_MEDIA_BUCKET = 'salon-public-media';
const PUBLIC_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const PUBLIC_MEDIA_MAX_EDGE = 2000;
const STORAGE_TIMEOUT_MS = 10_000;

const publicProfile = new Hono<{ Bindings: Env }>();

function encodeStoragePath(path: string) { return path.split('/').map((part) => encodeURIComponent(part)).join('/'); }

async function storageFetch(env: AuthEnv, accessToken: string | undefined, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${accessToken ?? env.SUPABASE_ANON_KEY}`);
  try {
    return await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${PUBLIC_MEDIA_BUCKET}/${encodeStoragePath(path)}`,
      { ...init, headers, signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }
}

function readLe16(bytes: Uint8Array, offset: number) { return bytes[offset]! | (bytes[offset + 1]! << 8); }
function readLe24(bytes: Uint8Array, offset: number) { return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16); }
function readLe32(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}
function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

export function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, 4);
    const size = readLe32(bytes, offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (kind === 'VP8X' && size >= 10) {
      return { width: readLe24(bytes, data + 4) + 1, height: readLe24(bytes, data + 7) + 1 };
    }
    if (kind === 'VP8 ' && size >= 10
        && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return { width: readLe16(bytes, data + 6) & 0x3fff, height: readLe16(bytes, data + 8) & 0x3fff };
    }
    if (kind === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1]!;
      const b2 = bytes[data + 2]!;
      const b3 = bytes[data + 3]!;
      const b4 = bytes[data + 4]!;
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function profileRpcBody(body: Record<string, unknown>, businessId: string) {
  return {
    p_business_id: businessId,
    p_public_name: stringOrNull(body.publicName),
    p_short_description: stringOrNull(body.shortDescription),
    p_long_description: stringOrNull(body.longDescription),
    p_public_phone: stringOrNull(body.publicPhone),
    p_public_email: stringOrNull(body.publicEmail),
    p_public_website: stringOrNull(body.publicWebsite),
    p_public_whatsapp: stringOrNull(body.publicWhatsapp),
    p_address_text: stringOrNull(body.addressText),
    p_show_work_hours: body.showWorkHours === undefined ? true : body.showWorkHours,
    p_cover_media_id: body.coverMediaId === null || body.coverMediaId === undefined ? null : body.coverMediaId,
  };
}

function profileError(message: string) {
  if (message.includes('PUBLIC_MEDIA_LIMIT_EXCEEDED')) return { code: 'PUBLIC_MEDIA_LIMIT_EXCEEDED', message: 'En fazla 20 public salon görseli yükleyebilirsiniz.', status: 409 as const };
  if (message.includes('INVALID_PUBLIC_MEDIA')) return { code: 'INVALID_PUBLIC_MEDIA', message: 'Görsel yalnız WebP, en fazla 5 MB ve 2000 px uzun kenar olabilir.', status: 400 as const };
  if (message.includes('INVALID_PUBLIC_PROFILE')) return { code: 'INVALID_PUBLIC_PROFILE', message: 'Salon profilindeki alanlardan biri geçerli değil.', status: 400 as const };
  if (message.includes('PUBLIC_MEDIA_NOT_FOUND')) return { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.', status: 404 as const };
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işletmenin public profilini değiştirme yetkiniz yok.', status: 403 as const };
  return { code: 'PUBLIC_PROFILE_FAILED', message: 'Salon profili işlemi tamamlanamadı.', status: 502 as const };
}

async function cleanupMarkedMedia(context: BaseContext, businessId: string, accessToken: string) {
  const listed = await supabaseRequest<CleanupMedia[]>(context.env, 'rest/v1/rpc/list_business_public_media_cleanup', {
    method: 'POST', body: JSON.stringify({ p_business_id: businessId }),
  }, accessToken);
  if (!listed.ok) return 0;
  let cleaned = 0;
  for (const item of listed.data ?? []) {
    const response = await storageFetch(context.env, accessToken, item.storage_path, { method: 'DELETE' }).catch(() => null);
    if (!response || (!response.ok && response.status !== 404)) continue;
    const finished = await supabaseRequest<boolean>(context.env, 'rest/v1/rpc/finish_business_public_media_delete', {
      method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_media_id: item.id }),
    }, accessToken);
    if (finished.ok && finished.data === true) cleaned += 1;
  }
  return cleaned;
}

publicProfile.get('/profile', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const result = await supabaseRequest<PublicProfile[]>(context.env, 'rest/v1/rpc/get_business_public_profile', {
    method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = profileError(rpcErrorMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ membership: access.membership, profile: first(result.data) });
});

publicProfile.put('/profile', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Salon profilini owner veya manager değiştirebilir.' } }, 403);
  const body = await readJson(context);
  if (!body || (body.showWorkHours !== undefined && typeof body.showWorkHours !== 'boolean')
      || (body.coverMediaId !== undefined && body.coverMediaId !== null && !isUuid(body.coverMediaId))) {
    return context.json({ error: { code: 'INVALID_PUBLIC_PROFILE', message: 'Salon profili bilgileri geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<PublicProfile[]>(context.env, 'rest/v1/rpc/update_business_public_profile', {
    method: 'POST', body: JSON.stringify(profileRpcBody(body, access.membership.business_id)),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = profileError(rpcErrorMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ profile: first(result.data) });
});

publicProfile.post('/profile/media/cleanup', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Public görselleri owner veya manager temizleyebilir.' } }, 403);
  const cleaned = await cleanupMarkedMedia(context, access.membership.business_id, access.auth.accessToken);
  return context.json({ cleaned });
});

publicProfile.post('/profile/media', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Public görselleri owner veya manager yükleyebilir.' } }, 403);
  const lengthHeader = Number(context.req.header('content-length') ?? '0');
  if (Number.isFinite(lengthHeader) && lengthHeader > PUBLIC_MEDIA_MAX_BYTES) return context.json({ error: { code: 'INVALID_PUBLIC_MEDIA', message: 'Görsel en fazla 5 MB olabilir.' } }, 413);
  if ((context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !== 'image/webp') return context.json({ error: { code: 'INVALID_PUBLIC_MEDIA', message: 'Yüklenen public görsel WebP olmalı.' } }, 415);
  const buffer = await context.req.raw.arrayBuffer();
  if (buffer.byteLength < 1 || buffer.byteLength > PUBLIC_MEDIA_MAX_BYTES) return context.json({ error: { code: 'INVALID_PUBLIC_MEDIA', message: 'Görsel en fazla 5 MB olabilir.' } }, 413);
  const dimensions = webpDimensions(new Uint8Array(buffer));
  if (!dimensions || dimensions.width > PUBLIC_MEDIA_MAX_EDGE || dimensions.height > PUBLIC_MEDIA_MAX_EDGE) return context.json({ error: { code: 'INVALID_PUBLIC_MEDIA', message: 'Görsel doğrulanamadı veya 2000 px sınırını aşıyor.' } }, 400);

  await cleanupMarkedMedia(context, access.membership.business_id, access.auth.accessToken);
  const mediaId = crypto.randomUUID();
  const storagePath = `${access.membership.business_id}/${mediaId}.webp`;
  const altText = new URL(context.req.url).searchParams.get('alt')?.trim() || null;
  const begun = await supabaseRequest<PendingMedia[]>(context.env, 'rest/v1/rpc/begin_business_public_media_upload', {
    method: 'POST', body: JSON.stringify({
      p_business_id: access.membership.business_id, p_media_id: mediaId, p_storage_path: storagePath,
      p_alt_text: altText, p_mime_type: 'image/webp', p_size_bytes: buffer.byteLength,
      p_width: dimensions.width, p_height: dimensions.height,
    }),
  }, access.auth.accessToken);
  if (!begun.ok || !first(begun.data)) {
    const error = profileError(rpcErrorMessage(begun.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  const upload = await storageFetch(context.env, access.auth.accessToken, storagePath, {
    method: 'POST', headers: { 'Content-Type': 'image/webp', 'Cache-Control': '3600' }, body: buffer,
  }).catch(() => null);
  if (!upload?.ok) {
    await supabaseRequest(context.env, 'rest/v1/rpc/mark_business_public_media_cleanup', {
      method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
    }, access.auth.accessToken);
    await cleanupMarkedMedia(context, access.membership.business_id, access.auth.accessToken);
    return context.json({ error: { code: 'PUBLIC_MEDIA_STORAGE_FAILED', message: 'Görsel depolamaya kaydedilemedi.' } }, 502);
  }

  const finalized = await supabaseRequest<PendingMedia | PendingMedia[]>(context.env, 'rest/v1/rpc/finalize_business_public_media_upload', {
    method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
  }, access.auth.accessToken);
  if (!finalized.ok) {
    await supabaseRequest(context.env, 'rest/v1/rpc/mark_business_public_media_cleanup', {
      method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
    }, access.auth.accessToken);
    await cleanupMarkedMedia(context, access.membership.business_id, access.auth.accessToken);
    return context.json({ error: { code: 'PUBLIC_MEDIA_FINALIZE_FAILED', message: 'Görsel yüklendi ancak profil kaydı tamamlanamadı.' } }, 502);
  }
  return context.json({ media: Array.isArray(finalized.data) ? first(finalized.data) : finalized.data }, 201);
});

publicProfile.delete('/profile/media/:mediaId', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Public görselleri owner veya manager silebilir.' } }, 403);
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.' } }, 404);
  const begun = await supabaseRequest<DeleteStart[]>(context.env, 'rest/v1/rpc/begin_business_public_media_delete', {
    method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
  }, access.auth.accessToken);
  const target = first(begun.data);
  if (!begun.ok || !target) {
    const error = profileError(rpcErrorMessage(begun.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const removed = await storageFetch(context.env, access.auth.accessToken, target.storage_path, { method: 'DELETE' }).catch(() => null);
  if (!removed || (!removed.ok && removed.status !== 404)) {
    await supabaseRequest(context.env, 'rest/v1/rpc/restore_business_public_media_delete', {
      method: 'POST', body: JSON.stringify({
        p_business_id: access.membership.business_id, p_media_id: mediaId, p_restore_cover: target.was_cover,
      }),
    }, access.auth.accessToken);
    return context.json({ error: { code: 'PUBLIC_MEDIA_STORAGE_FAILED', message: 'Görsel depolamadan silinemedi.' } }, 502);
  }
  const finished = await supabaseRequest<boolean>(context.env, 'rest/v1/rpc/finish_business_public_media_delete', {
    method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
  }, access.auth.accessToken);
  if (!finished.ok || finished.data !== true) return context.json({ error: { code: 'PUBLIC_MEDIA_DELETE_INCOMPLETE', message: 'Görsel silindi ancak profil kaydı henüz temizlenemedi.' } }, 502);
  return context.json({ deleted: true });
});

publicProfile.get('/profile/media/:mediaId/content', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.' } }, 404);
  const object = await supabaseRequest<MediaObject[]>(context.env, 'rest/v1/rpc/get_business_public_media_object', {
    method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id, p_media_id: mediaId }),
  }, access.auth.accessToken);
  const target = first(object.data);
  if (!object.ok || !target) return context.json({ error: { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.' } }, 404);
  const response = await storageFetch(context.env, access.auth.accessToken, target.storage_path).catch(() => null);
  if (!response?.ok) return context.json({ error: { code: 'PUBLIC_MEDIA_STORAGE_FAILED', message: 'Görsel yüklenemedi.' } }, 502);
  return new Response(response.body, { status: 200, headers: {
    'Content-Type': target.mime_type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff',
  } });
});

publicProfile.get('/business/:slug/profile', async (context) => {
  const slug = context.req.param('slug');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<PublicProfile[]>(context.env, 'profile', { p_slug: slug }, abuse);
  if (!result.ok) return context.json({ error: { code: 'PUBLIC_PROFILE_UNAVAILABLE', message: 'Salon profili şu anda yüklenemiyor.' } }, 503);
  const profile = first(result.data);
  if (!profile) return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' } }, 404);
  return context.json({ profile });
});

publicProfile.get('/media/:mediaId', async (context) => {
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.' } }, 404);
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await publicOperation<MediaObject[]>(context.env, 'media', { p_media_id: mediaId }, abuse);
  if (!result.ok) return context.json({ error: { code: 'PUBLIC_MEDIA_UNAVAILABLE', message: 'Görsel şu anda yüklenemiyor.' } }, 503);
  const target = first(result.data);
  if (!target) return context.json({ error: { code: 'PUBLIC_MEDIA_NOT_FOUND', message: 'Görsel bulunamadı.' } }, 404);
  const response = await storageFetch(context.env, undefined, target.storage_path).catch(() => null);
  if (!response?.ok) return context.json({ error: { code: 'PUBLIC_MEDIA_UNAVAILABLE', message: 'Görsel şu anda yüklenemiyor.' } }, response?.status === 404 ? 404 : 502);
  return new Response(response.body, { status: 200, headers: {
    'Content-Type': target.mime_type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff',
  } });
});

export default publicProfile;
