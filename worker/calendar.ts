import { Hono } from 'hono';
import {
  first,
  requireMember,
  supabaseRequest,
  type AuthEnv,
} from './auth.ts';
import { isDate, isUuid } from '../shared/validation.ts';
import { dateInTimezone, rpcErrorMessage } from './common.ts';

type Env = AuthEnv;

type CalendarAppointment = {
  appointment_id: string;
  staff_id: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string;
  staff_name: string;
  price_minor: number;
  currency: string;
  notes: string | null;
  cancellation_reason: string | null;
  source: 'operator' | 'public';
};

type Staff = { id: string; name: string; active: boolean };
type Business = { id: string; name: string; timezone: string };

const calendar = new Hono<{ Bindings: Env }>();

function rpcError(data: unknown) {
  const message = rpcErrorMessage(data);
  if (message.includes('NOT_ALLOWED')) return { code: 'NOT_ALLOWED', message: 'Bu işletmenin takvimine erişiminiz yok.', status: 403 as const };
  if (message.includes('INVALID_CALENDAR_RANGE')) return { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarih aralığı geçerli değil.', status: 400 as const };
  return { code: 'CALENDAR_READ_FAILED', message: 'Takvim yüklenemedi.', status: 502 as const };
}

calendar.get('/', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;

  const requestedDate = context.req.query('date');
  const days = Number(context.req.query('days') ?? '1');
  const staffRaw = context.req.query('staffId');
  const staffId = staffRaw && staffRaw !== 'all' ? staffRaw : null;
  if ((requestedDate !== undefined && !isDate(requestedDate))
      || !Number.isInteger(days) || (days !== 1 && days !== 7)
      || (staffId !== null && !isUuid(staffId))) {
    return context.json({ error: { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarihi, görünümü veya personel filtresi geçerli değil.' } }, 400);
  }

  const businessId = access.membership.business_id;
  const businessQuery = new URLSearchParams({ select: 'id,name,timezone', id: `eq.${businessId}`, limit: '1' });
  const staffQuery = new URLSearchParams({ select: 'id,name,active', business_id: `eq.${businessId}`, order: 'name.asc' });
  const [businessResult, staffResult] = await Promise.all([
    supabaseRequest<Business[]>(context.env, `rest/v1/businesses?${businessQuery}`, {}, access.auth.accessToken),
    supabaseRequest<Staff[]>(context.env, `rest/v1/staff_profiles?${staffQuery}`, {}, access.auth.accessToken),
  ]);

  const business = businessResult.ok ? first(businessResult.data) : null;
  if (!business || !staffResult.ok) {
    return context.json({ error: { code: 'CALENDAR_CONTEXT_FAILED', message: 'Takvim işletme veya ekip bilgileri yüklenemedi.' } }, 502);
  }

  const localDate = dateInTimezone(business.timezone);
  const date = requestedDate ?? localDate;
  const appointmentsResult = await supabaseRequest<CalendarAppointment[]>(context.env, 'rest/v1/rpc/get_calendar_appointments', {
    method: 'POST',
    body: JSON.stringify({
      p_business_id: businessId,
      p_start_date: date,
      p_days: days,
      p_staff_id: staffId,
    }),
  }, access.auth.accessToken);

  if (!appointmentsResult.ok) {
    const error = rpcError(appointmentsResult.data);
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }

  return context.json({
    membership: access.membership,
    business,
    localDate,
    date,
    days,
    staff: staffResult.data ?? [],
    appointments: appointmentsResult.data ?? [],
  });
});

export default calendar;
