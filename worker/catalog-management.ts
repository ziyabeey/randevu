import { Hono } from 'hono';
import {
  canManage,
  first,
  readJson,
  requireMember,
  supabaseRequest,
  type AuthEnv,
} from './auth.ts';

type RpcError = { message?: string };
type RpcRow = Record<string, unknown>;
type AssignmentVersion = { updated_at: string };

const catalogManagement = new Hono<{ Bindings: AuthEnv }>();

function validName(value: unknown) {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120;
}

function validCategory(value: unknown) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

function integerIn(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validCurrency(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim());
}

function validPriceType(value: unknown): value is 'fixed' | 'range' {
  return value === 'fixed' || value === 'range';
}

function validExpected(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validOptionalExpected(value: unknown) {
  return value === undefined || value === null || validExpected(value);
}

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null ? String((data as RpcError).message ?? '') : '';
}

function rowFrom(data: RpcRow | RpcRow[] | null | undefined) {
  return Array.isArray(data) ? first(data) : data ?? null;
}

function mutationError(message: string, fallbackCode: string, fallbackMessage: string) {
  if (message.includes('STALE_WRITE')) {
    return { code: 'STALE_WRITE', message: 'Bu kayıt başka bir oturumda değişti. Güncel bilgileri yükleyip tekrar deneyin.', status: 409 as const };
  }
  if (message.includes('CATALOG_SERVICES_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_SERVICES_LIMIT_EXCEEDED', message: 'Hizmet sayısı güvenli katalog sınırına ulaştı.', status: 409 as const };
  }
  if (message.includes('CATALOG_STAFF_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_STAFF_LIMIT_EXCEEDED', message: 'Personel sayısı güvenli katalog sınırına ulaştı.', status: 409 as const };
  }
  if (message.includes('CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED')) {
    return { code: 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED', message: 'Hizmet yetkinliği sayısı güvenli katalog sınırına ulaştı.', status: 409 as const };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { code: 'SERVICE_NOT_FOUND', message: 'Hizmet bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('STAFF_NOT_FOUND')) {
    return { code: 'STAFF_NOT_FOUND', message: 'Personel bulunamadı veya bu işletmeye ait değil.', status: 404 as const };
  }
  if (message.includes('ASSIGNMENT_NOT_FOUND')) {
    return { code: 'ASSIGNMENT_NOT_FOUND', message: 'Hizmet ve personel eşleşmesi bu işletmede bulunamadı.', status: 404 as const };
  }
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.', status: 403 as const };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { code: 'NOT_ALLOWED', message: 'Bu işlem için işletme sahibi veya yönetici yetkisi gerekli.', status: 403 as const };
  }
  if (message.includes('INVALID_')) {
    return { code: fallbackCode, message: fallbackMessage, status: 400 as const };
  }
  return { code: fallbackCode, message: fallbackMessage, status: 400 as const };
}

async function requireManager(context: Parameters<typeof requireMember>[0]) {
  const access = await requireMember(context);
  if ('error' in access) return access;
  if (access.auth.passwordRecovery) {
    return {
      error: context.json({
        error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' },
      }, 403),
    } as const;
  }
  if (!canManage(access.membership)) {
    return {
      error: context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işlem için işletme sahibi veya yönetici yetkisi gerekli.' } }, 403),
    } as const;
  }
  return access;
}

catalogManagement.post('/services', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  const before = body.bufferBeforeMinutes ?? 0;
  const after = body.bufferAfterMinutes ?? 0;
  const hasLegacyPrice = body.priceMinor !== undefined;
  const hasCanonicalPrice = body.priceType !== undefined
    || body.priceMinMinor !== undefined
    || body.priceMaxMinor !== undefined
    || body.currency !== undefined;
  const legacyOnly = hasLegacyPrice && body.category === undefined && body.sortOrder === undefined;

  if (hasLegacyPrice && hasCanonicalPrice) {
    return context.json({ error: { code: 'INVALID_SERVICE', message: 'Eski ve yeni fiyat alanları aynı istekte birlikte kullanılamaz.' } }, 400);
  }

  const priceType = hasLegacyPrice ? 'fixed' : body.priceType;
  const priceMinMinor = hasLegacyPrice ? body.priceMinor : body.priceMinMinor;
  const priceMaxMinor = hasLegacyPrice ? body.priceMinor : body.priceMaxMinor;
  const currency = hasLegacyPrice ? 'TRY' : (body.currency ?? 'TRY');
  const category = body.category ?? 'Genel';
  const sortOrder = body.sortOrder ?? null;

  if (!validName(body.name)
      || !integerIn(body.durationMinutes, 5, 720)
      || !integerIn(before, 0, 240)
      || !integerIn(after, 0, 240)
      || !validCategory(category)
      || (sortOrder !== null && !integerIn(sortOrder, 0, 1000000))
      || !validPriceType(priceType)
      || !integerIn(priceMinMinor, 0, 100000000)
      || !integerIn(priceMaxMinor, 0, 100000000)
      || priceMinMinor > priceMaxMinor
      || (priceType === 'fixed' && priceMinMinor !== priceMaxMinor)
      || !validCurrency(currency)) {
    return context.json({ error: { code: 'INVALID_SERVICE', message: 'Hizmet adı, kategori, sıralama, süre, tampon veya fiyat geçerli değil.' } }, 400);
  }

  const result = legacyOnly
    ? await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/create_service_guarded', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: access.membership.business_id,
          p_name: String(body.name).trim(),
          p_duration_minutes: body.durationMinutes,
          p_buffer_before_minutes: before,
          p_buffer_after_minutes: after,
          p_price_minor: priceMinMinor,
        }),
      }, access.auth.accessToken)
    : await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/create_service_priced_guarded', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: access.membership.business_id,
          p_name: String(body.name).trim(),
          p_duration_minutes: body.durationMinutes,
          p_buffer_before_minutes: before,
          p_buffer_after_minutes: after,
          p_category: String(category).trim(),
          p_sort_order: sortOrder,
          p_price_type: priceType,
          p_price_min_minor: priceMinMinor,
          p_price_max_minor: priceMaxMinor,
          p_currency: String(currency).trim().toUpperCase(),
        }),
      }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'SERVICE_CREATE_FAILED', 'Hizmet kaydedilemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ service: rowFrom(result.data) }, 201);
});

catalogManagement.patch('/services/:id', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  if (!validExpected(body.expectedUpdatedAt)) {
    return context.json({
      error: { code: 'STALE_WRITE', message: 'Hizmeti değiştirmeden önce güncel bilgileri yeniden yükleyin.' },
    }, 409);
  }

  const hasLegacyPrice = body.priceMinor !== undefined;
  const hasCanonicalPrice = body.priceType !== undefined
    || body.priceMinMinor !== undefined
    || body.priceMaxMinor !== undefined
    || body.currency !== undefined;
  if (hasLegacyPrice && hasCanonicalPrice) {
    return context.json({ error: { code: 'INVALID_SERVICE', message: 'Eski ve yeni fiyat alanları aynı istekte birlikte kullanılamaz.' } }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!validName(body.name)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Hizmet adı geçerli değil.' } }, 400);
    patch.name = String(body.name).trim();
  }
  if (body.durationMinutes !== undefined) {
    if (!integerIn(body.durationMinutes, 5, 720)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Süre 5–720 dakika olmalı.' } }, 400);
    patch.durationMinutes = body.durationMinutes;
  }
  if (body.bufferBeforeMinutes !== undefined) {
    if (!integerIn(body.bufferBeforeMinutes, 0, 240)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Tampon süre 0–240 dakika olmalı.' } }, 400);
    patch.bufferBeforeMinutes = body.bufferBeforeMinutes;
  }
  if (body.bufferAfterMinutes !== undefined) {
    if (!integerIn(body.bufferAfterMinutes, 0, 240)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Tampon süre 0–240 dakika olmalı.' } }, 400);
    patch.bufferAfterMinutes = body.bufferAfterMinutes;
  }
  if (body.category !== undefined) {
    if (!validCategory(body.category)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Kategori 1–80 karakter olmalı.' } }, 400);
    patch.category = String(body.category).trim();
  }
  if (body.sortOrder !== undefined) {
    if (!integerIn(body.sortOrder, 0, 1000000)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Sıralama değeri geçerli değil.' } }, 400);
    patch.sortOrder = body.sortOrder;
  }
  if (hasLegacyPrice) {
    if (!integerIn(body.priceMinor, 0, 100000000)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Fiyat geçerli değil.' } }, 400);
    patch.priceMinor = body.priceMinor;
  } else {
    if (body.priceType !== undefined) {
      if (!validPriceType(body.priceType)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Fiyat tipi geçerli değil.' } }, 400);
      patch.priceType = body.priceType;
    }
    if (body.priceMinMinor !== undefined) {
      if (!integerIn(body.priceMinMinor, 0, 100000000)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Alt fiyat geçerli değil.' } }, 400);
      patch.priceMinMinor = body.priceMinMinor;
    }
    if (body.priceMaxMinor !== undefined) {
      if (!integerIn(body.priceMaxMinor, 0, 100000000)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Üst fiyat geçerli değil.' } }, 400);
      patch.priceMaxMinor = body.priceMaxMinor;
    }
    if (body.currency !== undefined) {
      if (!validCurrency(body.currency)) return context.json({ error: { code: 'INVALID_SERVICE', message: 'Para birimi üç harfli kod olmalı.' } }, 400);
      patch.currency = String(body.currency).trim().toUpperCase();
    }
    if (body.priceMinMinor !== undefined && body.priceMaxMinor !== undefined && body.priceMinMinor > body.priceMaxMinor) {
      return context.json({ error: { code: 'INVALID_SERVICE', message: 'Alt fiyat üst fiyattan büyük olamaz.' } }, 400);
    }
    if (body.priceType === 'fixed'
        && body.priceMinMinor !== undefined
        && body.priceMaxMinor !== undefined
        && body.priceMinMinor !== body.priceMaxMinor) {
      return context.json({ error: { code: 'INVALID_SERVICE', message: 'Sabit fiyatta alt ve üst tutar aynı olmalı.' } }, 400);
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return context.json({ error: { code: 'INVALID_SERVICE', message: 'Hizmet durumu geçerli değil.' } }, 400);
    patch.active = body.active;
  }
  if (!Object.keys(patch).length) return context.json({ error: { code: 'EMPTY_PATCH', message: 'Değiştirilecek alan yok.' } }, 400);

  const result = await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/update_service_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_service_id: context.req.param('id'),
      p_expected_updated_at: body.expectedUpdatedAt,
      p_patch: patch,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'SERVICE_UPDATE_FAILED', 'Hizmet güncellenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ service: rowFrom(result.data) });
});

catalogManagement.post('/staff', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  if (!validName(body.name) || (phone && phone.length > 40)) {
    return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı veya telefon bilgisi geçerli değil.' } }, 400);
  }
  const result = await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/create_staff_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_name: String(body.name).trim(),
      p_phone: phone,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'STAFF_CREATE_FAILED', 'Personel kaydedilemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ staff: rowFrom(result.data) }, 201);
});

catalogManagement.patch('/staff/:id', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  if (!validExpected(body.expectedUpdatedAt)) {
    return context.json({
      error: { code: 'STALE_WRITE', message: 'Personeli değiştirmeden önce güncel bilgileri yeniden yükleyin.' },
    }, 409);
  }
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!validName(body.name)) return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel adı geçerli değil.' } }, 400);
    patch.name = String(body.name).trim();
  }
  if (body.phone !== undefined) {
    if (body.phone !== null && typeof body.phone !== 'string') return context.json({ error: { code: 'INVALID_STAFF', message: 'Telefon bilgisi geçerli değil.' } }, 400);
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
    if (phone && phone.length > 40) return context.json({ error: { code: 'INVALID_STAFF', message: 'Telefon alanı çok uzun.' } }, 400);
    patch.phone = phone;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return context.json({ error: { code: 'INVALID_STAFF', message: 'Personel durumu geçerli değil.' } }, 400);
    patch.active = body.active;
  }
  if (!Object.keys(patch).length) return context.json({ error: { code: 'EMPTY_PATCH', message: 'Değiştirilecek alan yok.' } }, 400);

  const result = await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/update_staff_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: context.req.param('id'),
      p_expected_updated_at: body.expectedUpdatedAt,
      p_patch: patch,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'STAFF_UPDATE_FAILED', 'Personel güncellenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ staff: rowFrom(result.data) });
});

catalogManagement.put('/staff/:staffId/services/:serviceId', async (context) => {
  const access = await requireManager(context);
  if ('error' in access) return access.error;
  const body = (await readJson(context)) ?? {};
  if (typeof body.active !== 'boolean' || !validOptionalExpected(body.expectedUpdatedAt)) {
    return context.json({ error: { code: 'INVALID_ASSIGNMENT', message: 'Hizmet yetkinliği bilgisi geçerli değil.' } }, 400);
  }

  let expectedUpdatedAt = body.expectedUpdatedAt ?? null;
  if (expectedUpdatedAt === null) {
    const query = new URLSearchParams({
      select: 'updated_at',
      business_id: `eq.${access.membership.business_id}`,
      staff_id: `eq.${context.req.param('staffId')}`,
      service_id: `eq.${context.req.param('serviceId')}`,
      limit: '1',
    });
    const current = await supabaseRequest<AssignmentVersion[]>(
      context.env,
      `rest/v1/staff_services?${query}`,
      {},
      access.auth.accessToken,
    );
    if (!current.ok) {
      return context.json({ error: { code: 'ASSIGNMENT_READ_FAILED', message: 'Hizmet yetkinliğinin güncel durumu doğrulanamadı.' } }, 502);
    }
    expectedUpdatedAt = first(current.data)?.updated_at ?? null;
  }

  const result = await supabaseRequest<RpcRow | RpcRow[]>(context.env, 'rest/v1/rpc/set_staff_service_guarded', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: access.membership.business_id,
      p_staff_id: context.req.param('staffId'),
      p_service_id: context.req.param('serviceId'),
      p_active: body.active,
      p_expected_updated_at: expectedUpdatedAt,
    }),
  }, access.auth.accessToken);
  if (!result.ok) {
    const error = mutationError(rpcMessage(result.data), 'ASSIGNMENT_FAILED', 'Hizmet yetkinliği güncellenemedi.');
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ assignment: rowFrom(result.data) });
});

export default catalogManagement;
