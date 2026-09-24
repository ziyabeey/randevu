import { Hono } from 'hono';
import { readJson, type AuthEnv } from './auth.ts';
import {
  publicGateUnavailableBody,
  publicRateLimitedBody,
  rateLimitFromRpcError,
  resolvePublicAbuseIdentity,
  type PublicAbuseEnv,
} from './public-abuse.ts';
import { publicOperation } from './public-rpc.ts';
import {
  checkWhatsappVerification,
  issueWhatsappPhoneProof,
  normalizeWhatsappPhone,
  phoneProofSecret,
  startWhatsappVerification,
  twilioVerifyConfigured,
  type TwilioVerifyEnv,
} from './whatsapp-verify.ts';

type Env = AuthEnv & PublicAbuseEnv & TwilioVerifyEnv;
type PublicBusiness = { name: string; slug: string };

const router = new Hono<{ Bindings: Env }>();

function validSlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 60
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

async function validatePublicBusiness(context: any, slug: string) {
  const abuse = await resolvePublicAbuseIdentity(context);
  if (!abuse) return { response: context.json(publicGateUnavailableBody(), 503) } as const;

  const result = await publicOperation<PublicBusiness[]>(
    context.env,
    'business',
    { p_slug: slug },
    abuse,
  );
  if (!result.ok) {
    const retryAfter = rateLimitFromRpcError(result.data);
    if (retryAfter) {
      const response = context.json(publicRateLimitedBody(retryAfter), 429);
      response.headers.set('Retry-After', String(retryAfter));
      return { response } as const;
    }
    return {
      response: context.json({
        error: { code: 'WHATSAPP_OTP_UNAVAILABLE', message: 'Telefon doğrulama şu anda kullanılamıyor.' },
      }, 503),
    } as const;
  }
  if (!result.data?.length) {
    return {
      response: context.json({
        error: { code: 'PUBLIC_BOOKING_NOT_FOUND', message: 'Bu rezervasyon bağlantısı şu anda aktif değil.' },
      }, 404),
    } as const;
  }
  return { abuse } as const;
}

router.post('/verify/whatsapp/start', async (context) => {
  const body = await readJson(context);
  const slug = body?.slug;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (!validSlug(slug) || !normalizeWhatsappPhone(phone)) {
    return context.json({
      error: { code: 'INVALID_WHATSAPP_OTP_REQUEST', message: 'Telefon bilgisi geçerli değil.' },
    }, 400);
  }
  if (!twilioVerifyConfigured(context.env) || !phoneProofSecret(context.env)) {
    return context.json({
      error: { code: 'WHATSAPP_OTP_UNAVAILABLE', message: 'WhatsApp doğrulama henüz hazır değil.' },
    }, 503);
  }

  const validated = await validatePublicBusiness(context, slug);
  if ('response' in validated) return validated.response;

  const result = await startWhatsappVerification(context.env, phone);
  if (result.status !== 'pending') {
    if (result.retryAfterSeconds) context.header('Retry-After', String(result.retryAfterSeconds));
    return context.json({
      error: {
        code: result.retryable ? 'WHATSAPP_OTP_TEMPORARILY_UNAVAILABLE' : 'WHATSAPP_OTP_SEND_FAILED',
        message: result.retryable
          ? 'WhatsApp doğrulama kodu şu anda gönderilemedi. Biraz sonra tekrar deneyin.'
          : 'WhatsApp doğrulama kodu gönderilemedi.',
      },
    }, result.retryable ? 503 : 400);
  }

  return context.json({
    ok: true,
    channel: 'whatsapp',
    expiresInSeconds: 600,
    retryAfterSeconds: 30,
  }, 202);
});

router.post('/verify/whatsapp/check', async (context) => {
  const body = await readJson(context);
  const slug = body?.slug;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!validSlug(slug) || !normalizeWhatsappPhone(phone) || !/^\d{4,10}$/.test(code)) {
    return context.json({
      error: { code: 'INVALID_WHATSAPP_OTP_CHECK', message: 'Doğrulama kodu geçerli değil.' },
    }, 400);
  }
  if (!twilioVerifyConfigured(context.env) || !phoneProofSecret(context.env)) {
    return context.json({
      error: { code: 'WHATSAPP_OTP_UNAVAILABLE', message: 'WhatsApp doğrulama henüz hazır değil.' },
    }, 503);
  }

  const validated = await validatePublicBusiness(context, slug);
  if ('response' in validated) return validated.response;

  const result = await checkWhatsappVerification(context.env, phone, code);
  if (result.status !== 'approved') {
    return context.json({
      error: {
        code: result.retryable ? 'WHATSAPP_OTP_TEMPORARILY_UNAVAILABLE' : 'WHATSAPP_OTP_INVALID',
        message: result.retryable
          ? 'Doğrulama servisine şu anda ulaşılamıyor.'
          : 'Kod yanlış veya süresi dolmuş.',
      },
    }, result.retryable ? 503 : 400);
  }

  const proof = await issueWhatsappPhoneProof(phoneProofSecret(context.env) ?? '', slug, phone);
  if (!proof) {
    return context.json({
      error: { code: 'WHATSAPP_OTP_UNAVAILABLE', message: 'Telefon doğrulama kanıtı hazırlanamadı.' },
    }, 503);
  }

  return context.json({
    ok: true,
    channel: 'whatsapp',
    phoneVerificationToken: proof,
    expiresInSeconds: 600,
  });
});

export default router;
