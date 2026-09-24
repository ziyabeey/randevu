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
import { webpDimensions } from './public-profile.ts';

// F16-03 private appointment photos. Objects live in a non-public bucket and are
// only ever streamed through this Worker with the caller's own JWT, so storage
// RLS re-checks the active membership on every view. Nothing here issues a
// signed or public URL for private content, and the storage read policy only
// admits Storage's direct authenticated download, so a member cannot mint one.

type Env = AuthEnv;
type BaseContext = AppContext<Env>;
type PrivateMedia = {
  id: string;
  appointment_group_id: string;
  service_id: string | null;
  service_name?: string | null;
  customer_name?: string;
  caption: string | null;
  width: number;
  height: number;
  size_bytes?: number;
  created_at: string;
  published?: boolean;
  can_delete?: boolean;
  can_publish?: boolean;
  status?: string;
};
type MediaObject = { storage_path: string; mime_type: string };
type PublishSource = { storage_path: string; caption: string | null; size_bytes: number; width: number; height: number };
type CleanupMedia = { id: string; storage_path: string };

const PRIVATE_BUCKET = 'appointment-private-media';
const PUBLIC_BUCKET = 'salon-public-media';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 2000;
const STORAGE_TIMEOUT_MS = 10_000;

const privateMedia = new Hono<{ Bindings: Env }>();

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function encodeStoragePath(path: string) { return path.split('/').map((part) => encodeURIComponent(part)).join('/'); }

async function storageFetch(env: AuthEnv, accessToken: string, bucket: string, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeStoragePath(path)}`,
      { ...init, headers, signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }
}

function rpcMessage(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const value = data as { message?: unknown; error?: { message?: unknown } };
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error?.message === 'string') return value.error.message;
  return '';
}

export function privateMediaError(message: string) {
  if (message.includes('PRIVATE_MEDIA_LIMIT_EXCEEDED')) return { code: 'PRIVATE_MEDIA_LIMIT_EXCEEDED', message: 'Bir randevuya en fazla 10 fotoğraf eklenebilir.', status: 409 as const };
  if (message.includes('INVALID_PRIVATE_MEDIA')) return { code: 'INVALID_PRIVATE_MEDIA', message: 'Fotoğraf yalnız WebP, en fazla 5 MB ve 2000 px uzun kenar olabilir; hizmet bu randevuya ait olmalı.', status: 400 as const };
  if (message.includes('PRIVATE_MEDIA_GROUP_NOT_FOUND')) return { code: 'PRIVATE_MEDIA_GROUP_NOT_FOUND', message: 'Randevu bulunamadı.', status: 404 as const };
  if (message.includes('PRIVATE_MEDIA_NOT_FOUND')) return { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.', status: 404 as const };
  if (message.includes('PRIVATE_MEDIA_CONSENT_REQUIRED')) return { code: 'PRIVATE_MEDIA_CONSENT_REQUIRED', message: 'Yayınlamadan önce müşterinin açık onayını işaretleyin.', status: 400 as const };
  if (message.includes('PRIVATE_MEDIA_ALREADY_PUBLISHED')) return { code: 'PRIVATE_MEDIA_ALREADY_PUBLISHED', message: 'Bu fotoğraf zaten salon galerisinde yayında.', status: 409 as const };
  if (message.includes('PUBLIC_MEDIA_LIMIT_EXCEEDED')) return { code: 'PUBLIC_MEDIA_LIMIT_EXCEEDED', message: 'Salon galerisi 20 fotoğraf sınırına ulaştı.', status: 409 as const };
  if (message.includes('PRIVATE_MEDIA_STATE_CONFLICT')) return { code: 'PRIVATE_MEDIA_STATE_CONFLICT', message: 'Fotoğraf başka bir işlemle değişti. Listeyi yenileyin.', status: 409 as const };
  if (message.includes('PASSWORD_UPDATE_REQUIRED') || message.includes('AUTH_')) return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu fotoğraf işlemi için yetkiniz yok.', status: 403 as const };
  return { code: 'PRIVATE_MEDIA_FAILED', message: 'Fotoğraf işlemi tamamlanamadı.', status: 502 as const };
}

function errorResponse(context: BaseContext, data: unknown) {
  const error = privateMediaError(rpcMessage(data));
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

function rpc<T>(context: BaseContext, name: string, body: Record<string, unknown>, accessToken: string) {
  return supabaseRequest<T>(context.env, `rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }, accessToken);
}

function projection(row: PrivateMedia) {
  return {
    id: row.id,
    groupId: row.appointment_group_id,
    serviceId: row.service_id,
    serviceName: row.service_name ?? null,
    customerName: row.customer_name ?? null,
    caption: row.caption,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    published: row.published === true,
    canDelete: row.can_delete === true,
    canPublish: row.can_publish === true,
    contentUrl: `/api/private-media/${row.id}/content`,
  };
}

async function cleanupMarked(context: BaseContext, businessId: string, accessToken: string) {
  const listed = await rpc<CleanupMedia[]>(context, 'list_appointment_private_media_cleanup', { p_business_id: businessId }, accessToken);
  if (!listed.ok) return 0;
  let cleaned = 0;
  for (const item of listed.data ?? []) {
    const removed = await storageFetch(context.env, accessToken, PRIVATE_BUCKET, item.storage_path, { method: 'DELETE' }).catch(() => null);
    if (!removed || (!removed.ok && removed.status !== 404)) continue;
    const finished = await rpc<boolean>(context, 'finish_appointment_private_media_delete', { p_business_id: businessId, p_media_id: item.id }, accessToken);
    if (finished.ok && finished.data === true) cleaned += 1;
  }
  return cleaned;
}

privateMedia.get('/bookings/groups/:groupId/photos', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  if (!isUuid(groupId)) return context.json({ error: { code: 'PRIVATE_MEDIA_GROUP_NOT_FOUND', message: 'Randevu bulunamadı.' } }, 404);
  const result = await rpc<PrivateMedia[]>(context, 'list_appointment_private_media', {
    p_business_id: access.membership.business_id, p_group_id: groupId,
  }, access.auth.accessToken);
  if (!result.ok) return errorResponse(context, result.data);
  return context.json({ photos: (result.data ?? []).map(projection), limit: 10 }, 200, { 'Cache-Control': 'no-store' });
});

privateMedia.post('/bookings/groups/:groupId/photos', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const groupId = context.req.param('groupId');
  if (!isUuid(groupId)) return context.json({ error: { code: 'PRIVATE_MEDIA_GROUP_NOT_FOUND', message: 'Randevu bulunamadı.' } }, 404);
  const url = new URL(context.req.url);
  const serviceId = url.searchParams.get('serviceId');
  if (serviceId !== null && serviceId !== '' && !isUuid(serviceId)) {
    return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Hizmet seçimi geçerli değil.' } }, 400);
  }
  const caption = url.searchParams.get('caption')?.trim() || null;
  if (caption && caption.length > 240) return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Açıklama en fazla 240 karakter olabilir.' } }, 400);
  const lengthHeader = Number(context.req.header('content-length') ?? '0');
  if (Number.isFinite(lengthHeader) && lengthHeader > MAX_BYTES) return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Fotoğraf en fazla 5 MB olabilir.' } }, 413);
  if ((context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !== 'image/webp') {
    return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Yüklenen fotoğraf WebP olmalı.' } }, 415);
  }
  const buffer = await context.req.raw.arrayBuffer();
  if (buffer.byteLength < 1 || buffer.byteLength > MAX_BYTES) return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Fotoğraf en fazla 5 MB olabilir.' } }, 413);
  const dimensions = webpDimensions(new Uint8Array(buffer));
  if (!dimensions || dimensions.width > MAX_EDGE || dimensions.height > MAX_EDGE) {
    return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Fotoğraf doğrulanamadı veya 2000 px sınırını aşıyor.' } }, 400);
  }

  const businessId = access.membership.business_id;
  const token = access.auth.accessToken;
  await cleanupMarked(context, businessId, token);
  const mediaId = crypto.randomUUID();
  const storagePath = `${businessId}/${groupId}/${mediaId}.webp`;
  const begun = await rpc<PrivateMedia[]>(context, 'begin_appointment_private_media_upload', {
    p_business_id: businessId, p_group_id: groupId, p_media_id: mediaId, p_storage_path: storagePath,
    p_service_id: serviceId || null, p_caption: caption, p_mime_type: 'image/webp',
    p_size_bytes: buffer.byteLength, p_width: dimensions.width, p_height: dimensions.height,
  }, token);
  if (!begun.ok || !first(begun.data)) return errorResponse(context, begun.data);

  const markFailed = async () => {
    await rpc(context, 'mark_appointment_private_media_cleanup', { p_business_id: businessId, p_media_id: mediaId }, token);
    await cleanupMarked(context, businessId, token);
  };
  const upload = await storageFetch(context.env, token, PRIVATE_BUCKET, storagePath, {
    method: 'POST', headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' }, body: buffer,
  }).catch(() => null);
  if (!upload?.ok) {
    await markFailed();
    return context.json({ error: { code: 'PRIVATE_MEDIA_STORAGE_FAILED', message: 'Fotoğraf depolamaya kaydedilemedi.' } }, 502);
  }
  const finalized = await rpc<PrivateMedia[]>(context, 'finalize_appointment_private_media_upload', {
    p_business_id: businessId, p_media_id: mediaId,
  }, token);
  const row = first(finalized.data ?? []);
  if (!finalized.ok || !row) {
    await markFailed();
    return context.json({ error: { code: 'PRIVATE_MEDIA_FINALIZE_FAILED', message: 'Fotoğraf yüklendi ancak kaydı tamamlanamadı.' } }, 502);
  }
  return context.json({ photo: projection({ ...row, can_delete: true, can_publish: canManage(access.membership), published: false }) }, 201);
});

privateMedia.get('/private-media', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const url = new URL(context.req.url);
  const serviceId = url.searchParams.get('serviceId') || null;
  const beforeCreatedAt = url.searchParams.get('beforeCreatedAt') || null;
  const beforeId = url.searchParams.get('beforeId') || null;
  const limit = Number(url.searchParams.get('limit') ?? '25');
  if ((serviceId && !isUuid(serviceId)) || (beforeId && !isUuid(beforeId))
      || (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt)))
      || Boolean(beforeId) !== Boolean(beforeCreatedAt)
      || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Arşiv filtresi geçerli değil.' } }, 400);
  }
  // Probe one extra row so the client learns about the next page without a
  // silently truncated archive.
  const result = await rpc<PrivateMedia[]>(context, 'list_business_private_media_archive', {
    p_business_id: access.membership.business_id, p_service_id: serviceId,
    p_before_created_at: beforeCreatedAt, p_before_id: beforeId, p_limit: Math.min(100, limit + 1),
  }, access.auth.accessToken);
  if (!result.ok) return errorResponse(context, result.data);
  const rows = result.data ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next = rows.length > limit && last ? { beforeCreatedAt: last.created_at, beforeId: last.id } : null;
  return context.json({ photos: page.map(projection), next }, 200, { 'Cache-Control': 'no-store' });
});

privateMedia.get('/private-media/:mediaId/content', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.' } }, 404);
  const object = await rpc<MediaObject[]>(context, 'get_appointment_private_media_object', {
    p_business_id: access.membership.business_id, p_media_id: mediaId,
  }, access.auth.accessToken);
  const target = first(object.data ?? []);
  if (!object.ok) return errorResponse(context, object.data);
  if (!target) return context.json({ error: { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.' } }, 404);
  const response = await storageFetch(context.env, access.auth.accessToken, PRIVATE_BUCKET, target.storage_path).catch(() => null);
  if (!response?.ok) return context.json({ error: { code: 'PRIVATE_MEDIA_STORAGE_FAILED', message: 'Fotoğraf yüklenemedi.' } }, response?.status === 404 ? 404 : 502);
  return new Response(response.body, { status: 200, headers: {
    'Content-Type': target.mime_type,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  } });
});

privateMedia.delete('/private-media/:mediaId', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.' } }, 404);
  const businessId = access.membership.business_id;
  const token = access.auth.accessToken;
  const begun = await rpc<Array<{ storage_path: string }>>(context, 'begin_appointment_private_media_delete', {
    p_business_id: businessId, p_media_id: mediaId,
  }, token);
  const target = first(begun.data ?? []);
  if (!begun.ok || !target) return errorResponse(context, begun.data);
  const removed = await storageFetch(context.env, token, PRIVATE_BUCKET, target.storage_path, { method: 'DELETE' }).catch(() => null);
  if (!removed || (!removed.ok && removed.status !== 404)) {
    await rpc(context, 'restore_appointment_private_media_delete', { p_business_id: businessId, p_media_id: mediaId }, token);
    return context.json({ error: { code: 'PRIVATE_MEDIA_STORAGE_FAILED', message: 'Fotoğraf depolamadan silinemedi.' } }, 502);
  }
  const finished = await rpc<boolean>(context, 'finish_appointment_private_media_delete', { p_business_id: businessId, p_media_id: mediaId }, token);
  if (!finished.ok || finished.data !== true) {
    return context.json({ error: { code: 'PRIVATE_MEDIA_DELETE_INCOMPLETE', message: 'Fotoğraf silindi ancak kaydı henüz temizlenemedi.' } }, 502);
  }
  return context.json({ deleted: true });
});

privateMedia.post('/private-media/cleanup', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const cleaned = await cleanupMarked(context, access.membership.business_id, access.auth.accessToken);
  return context.json({ cleaned });
});

privateMedia.post('/private-media/:mediaId/publish', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Fotoğrafı salon galerisinde owner veya manager yayınlayabilir.' } }, 403);
  const mediaId = context.req.param('mediaId');
  if (!isUuid(mediaId)) return context.json({ error: { code: 'PRIVATE_MEDIA_NOT_FOUND', message: 'Fotoğraf bulunamadı.' } }, 404);
  const body = await readJson(context);
  if (body?.consentConfirmed !== true) {
    return context.json({ error: { code: 'PRIVATE_MEDIA_CONSENT_REQUIRED', message: 'Yayınlamadan önce müşterinin açık onayını işaretleyin.' } }, 400);
  }
  const altInput = typeof body.altText === 'string' ? body.altText.trim() : '';
  if (altInput.length > 160) return context.json({ error: { code: 'INVALID_PRIVATE_MEDIA', message: 'Galeri açıklaması en fazla 160 karakter olabilir.' } }, 400);

  const businessId = access.membership.business_id;
  const token = access.auth.accessToken;
  const begun = await rpc<PublishSource[]>(context, 'begin_appointment_private_media_publish', {
    p_business_id: businessId, p_media_id: mediaId, p_consent_confirmed: true,
  }, token);
  const source = first(begun.data ?? []);
  if (!begun.ok || !source) return errorResponse(context, begun.data);

  const original = await storageFetch(context.env, token, PRIVATE_BUCKET, source.storage_path).catch(() => null);
  if (!original?.ok) return context.json({ error: { code: 'PRIVATE_MEDIA_STORAGE_FAILED', message: 'Özel fotoğraf okunamadı.' } }, 502);
  const bytes = await original.arrayBuffer();
  const dimensions = webpDimensions(new Uint8Array(bytes));
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES || !dimensions || dimensions.width > MAX_EDGE || dimensions.height > MAX_EDGE) {
    return context.json({ error: { code: 'PRIVATE_MEDIA_STORAGE_FAILED', message: 'Özel fotoğraf doğrulanamadı.' } }, 502);
  }

  // The public copy is a brand-new F12 media row with its own object path;
  // deleting it later never touches the private original.
  const publicId = crypto.randomUUID();
  const publicPath = `${businessId}/${publicId}.webp`;
  const altText = (altInput || source.caption || '').slice(0, 160) || null;
  const publicBegun = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/begin_business_public_media_upload', {
    method: 'POST', body: JSON.stringify({
      p_business_id: businessId, p_media_id: publicId, p_storage_path: publicPath, p_alt_text: altText,
      p_mime_type: 'image/webp', p_size_bytes: bytes.byteLength, p_width: dimensions.width, p_height: dimensions.height,
    }),
  }, token);
  if (!publicBegun.ok || !first(publicBegun.data ?? [])) return errorResponse(context, publicBegun.data);

  const abandonPublic = async () => {
    await supabaseRequest(context.env, 'rest/v1/rpc/mark_business_public_media_cleanup', {
      method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_media_id: publicId }),
    }, token);
    const removed = await storageFetch(context.env, token, PUBLIC_BUCKET, publicPath, { method: 'DELETE' }).catch(() => null);
    if (removed && (removed.ok || removed.status === 404)) {
      await supabaseRequest(context.env, 'rest/v1/rpc/finish_business_public_media_delete', {
        method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_media_id: publicId }),
      }, token);
    }
  };
  const upload = await storageFetch(context.env, token, PUBLIC_BUCKET, publicPath, {
    method: 'POST', headers: { 'Content-Type': 'image/webp', 'Cache-Control': '3600' }, body: bytes,
  }).catch(() => null);
  if (!upload?.ok) {
    await abandonPublic();
    return context.json({ error: { code: 'PRIVATE_MEDIA_PUBLISH_FAILED', message: 'Fotoğraf salon galerisine kopyalanamadı.' } }, 502);
  }
  const finalized = await supabaseRequest(context.env, 'rest/v1/rpc/finalize_business_public_media_upload', {
    method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_media_id: publicId }),
  }, token);
  if (!finalized.ok) {
    await abandonPublic();
    return context.json({ error: { code: 'PRIVATE_MEDIA_PUBLISH_FAILED', message: 'Galeri kaydı tamamlanamadı.' } }, 502);
  }
  const finished = await rpc<boolean>(context, 'finish_appointment_private_media_publish', {
    p_business_id: businessId, p_media_id: mediaId, p_public_media_id: publicId,
  }, token);
  if (!finished.ok || finished.data !== true) {
    // A concurrent publish or delete won; remove this duplicate public copy.
    const removed = await supabaseRequest<unknown[]>(context.env, 'rest/v1/rpc/begin_business_public_media_delete', {
      method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_media_id: publicId }),
    }, token);
    if (removed.ok) await abandonPublic();
    return errorResponse(context, finished.data);
  }
  return context.json({ published: true, publicMediaId: publicId }, 201);
});

export default privateMedia;
