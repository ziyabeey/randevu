import { Hono } from 'hono';
import {
  canManage,
  readJson,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';
import { integerIn, isUuid, requireStandardMember } from './tickets.ts';

// F16-07 staff commission. The report is a read over the immutable commission
// ledger: financial report readers see every staff member, anyone else only
// their own staff profile. Rate versions are owner/manager writes. The tenant
// always comes from the active membership and every amount is computed by the
// database.

type CommissionContext = Parameters<typeof requireStandardMember>[0];
type CommissionAccess = { auth: { accessToken: string }; membership: { business_id: string } };

const commission = new Hono<{ Bindings: AuthEnv }>();

function dateOnly(value: string | undefined) {
  const text = value?.trim() ?? '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return text;
}

function rpcMessage(data: unknown) {
  return typeof data === 'object' && data !== null ? String((data as { message?: string }).message ?? '') : '';
}

export function commissionError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED') || message.includes('AUTH_SESSION_CLASS')) {
    return { status: 403 as const, code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' };
  }
  if (message.includes('FINANCIAL_REPORTS_PERMISSION_REQUIRED')) {
    return { status: 403 as const, code: 'FINANCIAL_REPORTS_PERMISSION_REQUIRED', message: 'Prim oranlarını görüntülemek için mali rapor yetkiniz yok.' };
  }
  if (message.includes('NOT_ALLOWED')) {
    return { status: 403 as const, code: 'COMMISSION_NOT_ALLOWED', message: 'Prim oranlarını yalnız işletme sahibi veya yönetici değiştirebilir.' };
  }
  if (message.includes('STALE_WRITE')) {
    return { status: 409 as const, code: 'STALE_WRITE', message: 'Oranlar bu arada güncellendi. Listeyi yenileyip tekrar deneyin.' };
  }
  if (message.includes('INVALID_COMMISSION_RATE')) {
    return { status: 400 as const, code: 'INVALID_COMMISSION_RATE', message: 'Prim oranı %0 ile %100 arasında olmalı.' };
  }
  if (message.includes('STAFF_NOT_FOUND')) {
    return { status: 404 as const, code: 'STAFF_NOT_FOUND', message: 'Çalışan bu işletmede bulunamadı.' };
  }
  if (message.includes('SERVICE_NOT_FOUND')) {
    return { status: 404 as const, code: 'SERVICE_NOT_FOUND', message: 'Hizmet bu işletmede bulunamadı.' };
  }
  if (message.includes('INVALID_REPORT_RANGE')) {
    return { status: 400 as const, code: 'INVALID_REPORT_RANGE', message: 'Rapor tarih aralığı geçerli değil (en fazla 92 gün).' };
  }
  if (message.includes('REPORT_CURRENCY_MIXED')) {
    return { status: 409 as const, code: 'REPORT_CURRENCY_MIXED', message: 'Aynı rapor aralığında birden fazla para birimi var; aralığı daraltın.' };
  }
  return { status: 400 as const, code: 'COMMISSION_REQUEST_FAILED', message: 'Prim işlemi tamamlanamadı.' };
}

async function commissionRpc(
  context: CommissionContext,
  access: CommissionAccess,
  name: string,
  body: Record<string, unknown>,
  wrap: (data: unknown) => Record<string, unknown>,
) {
  const result = await supabaseRequest<unknown>(
    context.env,
    `rest/v1/rpc/${name}`,
    { method: 'POST', body: JSON.stringify(body) },
    access.auth.accessToken,
  );
  if (!result.ok) {
    if (upstreamUnavailable(result.status)) {
      return context.json({
        error: { code: 'COMMISSION_UNAVAILABLE', message: 'Prim bilgisi şu anda hazırlanamadı. Lütfen tekrar deneyin.' },
      }, 503);
    }
    const error = commissionError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json(wrap(result.data));
}

function managerOnly(context: CommissionContext) {
  return context.json({
    error: { code: 'COMMISSION_NOT_ALLOWED', message: 'Prim oranlarını yalnız işletme sahibi veya yönetici değiştirebilir.' },
  }, 403);
}

commission.get('/reports/commission', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const startDate = dateOnly(context.req.query('startDate'));
  const endDate = dateOnly(context.req.query('endDate'));
  if (!startDate || !endDate || endDate < startDate) {
    return context.json({ error: { code: 'INVALID_REPORT_RANGE', message: 'Başlangıç ve bitiş tarihi gerekli.' } }, 400);
  }
  return commissionRpc(context, access, 'get_staff_commission_report', {
    p_business_id: access.membership.business_id,
    p_start_date: startDate,
    p_end_date: endDate,
  }, (data) => ({ report: data }));
});

commission.get('/commission-rates', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  return commissionRpc(context, access, 'list_staff_commission_rates', {
    p_business_id: access.membership.business_id,
  }, (data) => ({ staff: Array.isArray(data) ? data : [] }));
});

commission.post('/commission-rates/:staffId', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return managerOnly(context);
  const staffId = context.req.param('staffId');
  const body = (await readJson(context)) ?? {};
  if (!isUuid(staffId)
      || !integerIn(body.serviceRateBps, 0, 10000)
      || !integerIn(body.productRateBps, 0, 10000)
      || !integerIn(body.expectedVersion, 0, 99999)) {
    return context.json({ error: { code: 'INVALID_COMMISSION_RATE', message: 'Prim oranı %0 ile %100 arasında olmalı.' } }, 400);
  }
  return commissionRpc(context, access, 'set_staff_commission_rates_guarded', {
    p_business_id: access.membership.business_id,
    p_staff_id: staffId,
    p_service_rate_bps: body.serviceRateBps,
    p_product_rate_bps: body.productRateBps,
    p_expected_version: body.expectedVersion,
  }, (data) => ({ staff: data }));
});

commission.post('/commission-rates/:staffId/services/:serviceId', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  if (!canManage(access.membership)) return managerOnly(context);
  const staffId = context.req.param('staffId');
  const serviceId = context.req.param('serviceId');
  const body = (await readJson(context)) ?? {};
  if (!isUuid(staffId) || !isUuid(serviceId)
      || !(body.rateBps === null || integerIn(body.rateBps, 0, 10000))
      || !integerIn(body.expectedVersion, 0, 99999)) {
    return context.json({ error: { code: 'INVALID_COMMISSION_RATE', message: 'Hizmet prim oranı %0 ile %100 arasında olmalı ya da boş bırakılmalı.' } }, 400);
  }
  return commissionRpc(context, access, 'set_staff_service_commission_override_guarded', {
    p_business_id: access.membership.business_id,
    p_staff_id: staffId,
    p_service_id: serviceId,
    p_rate_bps: body.rateBps,
    p_expected_version: body.expectedVersion,
  }, (data) => ({ staff: data }));
});

export default commission;
