import { Hono } from 'hono';
import { canManage, readJson, requireMember, supabaseRequest, type AuthEnv } from './auth.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { feedbackOperation } from './public-rpc.ts';

// F16-04 customer feedback, business moderation and public reviews. Customers
// act only through their management capability (token in the POST body, never
// the URL); the business side is a normal cookie-authenticated member surface.

type Env = AuthEnv & PublicAbuseEnv;
type FeedbackState = {
  eligible: boolean;
  reason: string | null;
  rating: number | null;
  comment: string | null;
  publish_consent: boolean | null;
  status: string | null;
  submitted_at: string | null;
};
type PublicReview = {
  display_name: string;
  rating: number;
  comment: string | null;
  published_at: string;
  total_count: number;
  average_rating: number | string;
};
type BusinessFeedback = {
  id: string;
  appointment_group_id: string;
  customer_name: string;
  display_name: string;
  rating: number;
  comment: string | null;
  publish_consent: boolean;
  status: 'pending' | 'published' | 'hidden';
  created_at: string;
  published_at: string | null;
  moderated_at: string | null;
  appointment_starts_at: string | null;
  service_names: string | null;
  can_moderate: boolean;
};

const feedback = new Hono<{ Bindings: Env }>();

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}
function rpcMessage(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const value = data as { message?: unknown; error?: { message?: unknown } };
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error?.message === 'string') return value.error.message;
  return '';
}

export function feedbackError(message: string) {
  if (message.includes('PUBLIC_BOOKING_GATE_') || message === 'PUBLIC_OPERATION_UNAVAILABLE') return { code: 'FEEDBACK_UNAVAILABLE', message: 'Değerlendirme şu anda kullanılamıyor. Lütfen tekrar deneyin.', status: 503 as const };
  if (message.includes('MANAGEMENT_NOT_FOUND') || message.includes('INVALID_MANAGEMENT_TOKEN')) return { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.', status: 404 as const };
  if (message.includes('PUBLIC_BOOKING_NOT_FOUND')) return { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu salon sayfası şu anda aktif değil.', status: 404 as const };
  if (message.includes('FEEDBACK_NOT_ELIGIBLE')) return { code: 'FEEDBACK_NOT_ELIGIBLE', message: 'Randevunuz tamamlandıktan sonra değerlendirme yapabilirsiniz.', status: 409 as const };
  if (message.includes('FEEDBACK_ALREADY_SUBMITTED')) return { code: 'FEEDBACK_ALREADY_SUBMITTED', message: 'Bu randevu için değerlendirmeniz zaten alındı.', status: 409 as const };
  if (message.includes('FEEDBACK_CONSENT_MISSING')) return { code: 'FEEDBACK_CONSENT_MISSING', message: 'Müşteri bu yorumun yayınlanmasına izin vermedi.', status: 409 as const };
  if (message.includes('FEEDBACK_STATE_CONFLICT')) return { code: 'FEEDBACK_STATE_CONFLICT', message: 'Yorum başka bir işlemle değişti. Listeyi yenileyin.', status: 409 as const };
  if (message.includes('FEEDBACK_NOT_FOUND')) return { code: 'FEEDBACK_NOT_FOUND', message: 'Yorum bulunamadı.', status: 404 as const };
  if (message.includes('INVALID_FEEDBACK') || message.includes('INVALID_PUBLIC_OPERATION')) return { code: 'INVALID_FEEDBACK', message: 'Değerlendirme bilgisi geçerli değil.', status: 400 as const };
  if (message.includes('PASSWORD_UPDATE_REQUIRED') || message.includes('AUTH_')) return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işlem için yetkiniz yok.', status: 403 as const };
  return { code: 'FEEDBACK_FAILED', message: 'Değerlendirme işlemi tamamlanamadı.', status: 502 as const };
}

function publicFailure(context: any, data: unknown) {
  const retryAfter = rateLimitFromRpcError(data);
  if (retryAfter) {
    context.header('Retry-After', String(retryAfter));
    return context.json(publicRateLimitedBody(retryAfter), 429);
  }
  const error = feedbackError(rpcMessage(data));
  return context.json({ error: { code: error.code, message: error.message } }, error.status);
}

function feedbackState(row: FeedbackState | undefined) {
  if (!row) return null;
  return {
    eligible: row.eligible === true,
    reason: row.reason,
    rating: row.rating,
    comment: row.comment,
    publishConsent: row.publish_consent,
    status: row.status,
    submittedAt: row.submitted_at,
  };
}

feedback.post('/manage/feedback/view', async (context) => {
  const body = await readJson(context);
  if (!validToken(body?.token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await feedbackOperation<FeedbackState[]>(context.env, 'manage_feedback_view', { p_token: body.token }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const state = feedbackState(result.data[0]);
  if (!state) return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  return context.json({ feedback: state }, 200, { 'Cache-Control': 'no-store' });
});

feedback.post('/manage/feedback', async (context) => {
  const body = await readJson(context);
  const rating = body?.rating;
  const comment = body?.comment === undefined || body?.comment === null ? null : body.comment;
  if (!validToken(body?.token)) {
    return context.json({ error: { code: 'MANAGEMENT_NOT_FOUND', message: 'Bu randevu yönetim bağlantısı geçerli değil.' } }, 404);
  }
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5
      || typeof body?.publishConsent !== 'boolean'
      || (comment !== null && (typeof comment !== 'string' || comment.trim().length > 1000))) {
    return context.json({ error: { code: 'INVALID_FEEDBACK', message: 'Puan 1-5 arasında olmalı; yorum en fazla 1000 karakter olabilir.' } }, 400);
  }
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await feedbackOperation<FeedbackState[]>(context.env, 'manage_feedback_submit', {
    p_token: body.token, p_rating: rating, p_comment: typeof comment === 'string' ? comment : null,
    p_publish_consent: body.publishConsent,
  }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const state = feedbackState(result.data[0]);
  if (!state) return context.json({ error: { code: 'FEEDBACK_FAILED', message: 'Değerlendirme sonucu alınamadı.' } }, 502);
  return context.json({ feedback: state }, 201);
});

feedback.get('/public/business/:slug/reviews', async (context) => {
  const slug = context.req.param('slug');
  if (!isSlug(slug)) return context.json({ error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu salon sayfası şu anda aktif değil.' } }, 404);
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return context.json(publicGateUnavailableBody(), 503);
  const result = await feedbackOperation<PublicReview[]>(context.env, 'reviews', { p_slug: slug, p_limit: 20 }, abuse);
  if (!result.ok) return publicFailure(context, result.data);
  const rows = result.data ?? [];
  const summary = rows[0]
    ? { count: Number(rows[0].total_count), average: Number(rows[0].average_rating) }
    : { count: 0, average: null };
  return context.json({
    reviews: rows.map((row) => ({ displayName: row.display_name, rating: row.rating, comment: row.comment, publishedAt: row.published_at })),
    summary,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

feedback.get('/feedback', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const url = new URL(context.req.url);
  const status = url.searchParams.get('status') || null;
  const beforeCreatedAt = url.searchParams.get('beforeCreatedAt') || null;
  const beforeId = url.searchParams.get('beforeId') || null;
  const limit = Number(url.searchParams.get('limit') ?? '25');
  if ((status && !['pending', 'published', 'hidden'].includes(status))
      || (beforeId && !isUuid(beforeId)) || (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt)))
      || Boolean(beforeId) !== Boolean(beforeCreatedAt)
      || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return context.json({ error: { code: 'INVALID_FEEDBACK', message: 'Yorum filtresi geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<BusinessFeedback[]>(context.env, 'rest/v1/rpc/list_business_feedback', {
    method: 'POST', body: JSON.stringify({
      p_business_id: access.membership.business_id, p_status: status,
      p_before_created_at: beforeCreatedAt, p_before_id: beforeId, p_limit: Math.min(100, limit + 1),
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = feedbackError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  const rows = result.data ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return context.json({
    feedback: page.map((row) => ({
      id: row.id, groupId: row.appointment_group_id, customerName: row.customer_name, displayName: row.display_name,
      rating: row.rating, comment: row.comment, publishConsent: row.publish_consent, status: row.status,
      createdAt: row.created_at, publishedAt: row.published_at, moderatedAt: row.moderated_at,
      appointmentStartsAt: row.appointment_starts_at, serviceNames: row.service_names, canModerate: row.can_moderate,
    })),
    next: rows.length > limit && last ? { beforeCreatedAt: last.created_at, beforeId: last.id } : null,
  }, 200, { 'Cache-Control': 'no-store' });
});

feedback.post('/feedback/:feedbackId/moderate', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return context.json({ error: { code: 'NOT_ALLOWED', message: 'Yorumları owner veya manager yayınlayabilir.' } }, 403);
  const feedbackId = context.req.param('feedbackId');
  const body = await readJson(context);
  if (!isUuid(feedbackId) || !['publish', 'hide'].includes(String(body?.action))
      || !['pending', 'published', 'hidden'].includes(String(body?.expectedStatus))) {
    return context.json({ error: { code: 'INVALID_FEEDBACK', message: 'Yorum işlemi geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<Array<{ id: string; status: string; published_at: string | null; moderated_at: string }>>(
    context.env, 'rest/v1/rpc/moderate_business_feedback', {
      method: 'POST', body: JSON.stringify({
        p_business_id: access.membership.business_id, p_feedback_id: feedbackId,
        p_action: body!.action, p_expected_status: body!.expectedStatus,
      }),
    }, access.auth.accessToken);
  const row = result.data?.[0];
  if (!result.ok || !row) {
    const error = feedbackError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ feedback: { id: row.id, status: row.status, publishedAt: row.published_at, moderatedAt: row.moderated_at } });
});

export default feedback;
