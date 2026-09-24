import { Hono } from 'hono';
import {
  requireMember,
  supabaseRequest,
  upstreamUnavailable,
  type AuthEnv,
} from './auth.ts';

type ReportContext = Parameters<typeof requireMember>[0];
type RpcError = { message?: string };
type FinancialReport = Record<string, unknown>;

const reports = new Hono<{ Bindings: AuthEnv }>();

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
  return typeof data === 'object' && data !== null ? String((data as RpcError).message ?? '') : '';
}

function reportError(message: string) {
  if (message.includes('PASSWORD_UPDATE_REQUIRED')) {
    return { status: 403 as const, code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' };
  }
  if (message.includes('FINANCIAL_REPORTS_PERMISSION_REQUIRED') || message.includes('NOT_ALLOWED')) {
    return { status: 403 as const, code: 'FINANCIAL_REPORTS_PERMISSION_REQUIRED', message: 'Mali raporları görüntülemek için yetkiniz yok.' };
  }
  if (message.includes('INVALID_REPORT_RANGE')) {
    return { status: 400 as const, code: 'INVALID_REPORT_RANGE', message: 'Rapor tarih aralığı geçerli değil.' };
  }
  if (message.includes('REPORT_CURRENCY_MIXED')) {
    return { status: 409 as const, code: 'REPORT_CURRENCY_MIXED', message: 'Aynı rapor aralığında birden fazla para birimi var; aralığı daraltın.' };
  }
  return { status: 400 as const, code: 'REPORT_READ_FAILED', message: 'Mali rapor hazırlanamadı.' };
}

reports.get('/reports/financial', async (context: ReportContext) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  if (access.auth.passwordRecovery) {
    return context.json({ error: { code: 'PASSWORD_UPDATE_REQUIRED', message: 'Devam etmeden önce yeni parolanızı belirleyin.' } }, 403);
  }

  const startDate = dateOnly(context.req.query('startDate'));
  const endDate = dateOnly(context.req.query('endDate'));
  if (!startDate || !endDate) {
    return context.json({ error: { code: 'INVALID_REPORT_RANGE', message: 'Başlangıç ve bitiş tarihi gerekli.' } }, 400);
  }

  const result = await supabaseRequest<FinancialReport>(
    context.env,
    'rest/v1/rpc/get_financial_day_report',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
    },
    access.auth.accessToken,
  );

  if (!result.ok || !result.data) {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'REPORT_READ_UNAVAILABLE', message: 'Mali rapor şu anda hazırlanamadı. Lütfen tekrar deneyin.' } }, 503);
    }
    const error = reportError(rpcMessage(result.data));
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  return context.json({ report: result.data });
});

export default reports;
