import { Hono } from 'hono';
import {
  requireMember,
  supabaseRequest,
  type AuthEnv,
} from './auth.ts';
import {
  decodePageCursor,
  pageResult,
  parsePageLimit,
} from './pagination.ts';
import {
  SNAPSHOT_LIMITS,
  snapshotOverflow,
  snapshotProbeLimit,
} from './snapshot-bounds.ts';
import { isDate, isUuid } from '../shared/validation.ts';
import { dateInTimezone, first, rpcErrorMessage, upstreamUnavailable } from './common.ts';

type Env = AuthEnv;
type Business = { id: string; name: string; timezone: string };
type Staff = { id: string; name: string; active: boolean };
type GroupBookingRow = {
  group_id: string;
  group_starts_at: string;
  booking: Record<string, unknown>;
};
type GroupAwareCalendarAppointment = {
  appointment_id: string;
  group_id: string;
  line_ordinal: number;
  group_status: string;
  group_version: number;
  group_legacy_appointment_id: string | null;
  group_line_count: number;
  group_starts_at: string;
  group_ends_at: string;
  staff_id: string;
  status: string;
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
type GroupAwareCustomerAppointment = {
  appointment_id: string;
  group_id: string;
  line_ordinal: number;
  group_status: string;
  group_version: number;
  group_legacy_appointment_id: string | null;
  group_line_count: number;
  group_starts_at: string;
  group_ends_at: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  service_name_snapshot: string;
  staff_name_snapshot: string;
  price_minor_snapshot: number;
  currency_snapshot: string;
  notes: string | null;
  cancellation_reason: string | null;
};

const reads = new Hono<{ Bindings: Env }>();

// Current operator booking list. It pages reservation groups, never physical
// service lines. Legacy one-line appointments are still represented as one
// deterministic group with managementMode=legacy_single.
reads.get('/bookings/groups', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'),'booking_groups');
  if (limit===null || cursor===undefined) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa boyutu veya devam anahtarı geçerli değil.' } },400);
  }

  const result = await supabaseRequest<GroupBookingRow[]>(
    context.env,
    'rest/v1/rpc/list_business_booking_groups_page_v3',
    {
      method:'POST',
      body:JSON.stringify({
        p_business_id:access.membership.business_id,
        p_limit:limit+1,
        p_after_starts_at:cursor?.at ?? null,
        p_after_id:cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const message=rpcErrorMessage(result.data);
    if (message.includes('NOT_ALLOWED')) {
      return context.json({ error: { code:'NOT_ALLOWED', message:'Bu işletme için işlem yetkiniz yok.' } },403);
    }
    if (message.includes('INVALID_PAGE')) {
      return context.json({ error: { code:'INVALID_PAGE', message:'Sayfa bilgisi geçerli değil.' } },400);
    }
    const isUnavailable=upstreamUnavailable(result.status);
    return context.json({ error: {
      code:isUnavailable?'BOOKING_GROUPS_UNAVAILABLE':'BOOKING_GROUPS_FAILED',
      message:isUnavailable?'Randevular şu anda okunamıyor. Lütfen tekrar deneyin.':'Randevular okunamadı.',
    } },isUnavailable?503:502);
  }

  const paged=pageResult(result.data ?? [],limit,'booking_groups',(row)=>({
    at:row.group_starts_at,
    id:row.group_id,
  }));
  return context.json({
    membership:access.membership,
    bookings:paged.items.map((row)=>row.booking),
    page:paged.page,
  });
});

// Exact live calendar replacement. Response envelope stays stable; appointment
// rows gain additive reservation-group metadata used by F11-aware consumers.
reads.get('/calendar', async (context) => {
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
  const staffQuery = new URLSearchParams({
    select: 'id,name,active',
    business_id: `eq.${businessId}`,
    order: 'name.asc',
    limit: String(snapshotProbeLimit(SNAPSHOT_LIMITS.staff)),
  });
  const [businessResult,staffResult] = await Promise.all([
    supabaseRequest<Business[]>(context.env,`rest/v1/businesses?${businessQuery}`,{},access.auth.accessToken),
    supabaseRequest<Staff[]>(context.env,`rest/v1/staff_profiles?${staffQuery}`,{},access.auth.accessToken),
  ]);
  const business = businessResult.ok ? first(businessResult.data) : null;
  if (!business || !staffResult.ok) {
    return context.json({ error: { code: 'CALENDAR_CONTEXT_FAILED', message: 'Takvim işletme veya ekip bilgileri yüklenemedi.' } }, 502);
  }
  if (snapshotOverflow(staffResult.data,SNAPSHOT_LIMITS.staff)) {
    return context.json({ error: { code: 'CALENDAR_STAFF_LIMIT_EXCEEDED', message: 'Takvim personel seçicisi güvenli snapshot sınırını aşıyor.' } }, 409);
  }

  const localDate = dateInTimezone(business.timezone);
  const date = requestedDate ?? localDate;
  const appointments = await supabaseRequest<GroupAwareCalendarAppointment[]>(
    context.env,
    'rest/v1/rpc/get_calendar_appointments_v2',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: businessId,
        p_start_date: date,
        p_days: days,
        p_staff_id: staffId,
      }),
    },
    access.auth.accessToken,
  );
  if (!appointments.ok) {
    const message = rpcErrorMessage(appointments.data);
    if (message.includes('NOT_ALLOWED')) {
      return context.json({ error: { code: 'NOT_ALLOWED', message: 'Bu işletmenin takvimine erişiminiz yok.' } }, 403);
    }
    if (message.includes('INVALID_CALENDAR_RANGE')) {
      return context.json({ error: { code: 'INVALID_CALENDAR_RANGE', message: 'Takvim tarih aralığı geçerli değil.' } }, 400);
    }
    const isUnavailable = upstreamUnavailable(appointments.status);
    return context.json({ error: {
      code: isUnavailable ? 'CALENDAR_UNAVAILABLE' : 'CALENDAR_READ_FAILED',
      message: isUnavailable ? 'Takvim şu anda doğrulanamıyor. Lütfen tekrar deneyin.' : 'Takvim yüklenemedi.',
    } }, isUnavailable ? 503 : 502);
  }

  return context.json({
    membership: access.membership,
    business,
    localDate,
    date,
    days,
    staff: staffResult.data ?? [],
    appointments: appointments.data ?? [],
  });
});

// Group-rooted customer history for the current UI. One page item is one
// logical reservation and contains its ordered service lines.
reads.get('/customers/:id/group-history', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const customerId=context.req.param('id');
  const limit=parsePageLimit(context.req.query('limit'));
  const cursor=decodePageCursor(context.req.query('cursor'),'customer_group_history');
  if (!isUuid(customerId) || limit===null || cursor===undefined) {
    return context.json({ error: { code:'INVALID_PAGE', message:'Müşteri veya sayfa bilgisi geçerli değil.' } },400);
  }

  const result=await supabaseRequest<GroupBookingRow[]>(
    context.env,
    'rest/v1/rpc/list_business_customer_booking_groups_page_v3',
    {
      method:'POST',
      body:JSON.stringify({
        p_business_id:access.membership.business_id,
        p_customer_id:customerId,
        p_limit:limit+1,
        p_after_starts_at:cursor?.at ?? null,
        p_after_id:cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const message=rpcErrorMessage(result.data);
    if (message.includes('NOT_ALLOWED')) {
      return context.json({ error: { code:'TENANT_FORBIDDEN', message:'Bu işletmeye erişiminiz yok.' } },403);
    }
    if (message.includes('CUSTOMER_NOT_FOUND')) {
      return context.json({ error: { code:'CUSTOMER_NOT_FOUND', message:'Müşteri kaydı bulunamadı.' } },404);
    }
    if (message.includes('INVALID_PAGE')) {
      return context.json({ error: { code:'INVALID_PAGE', message:'Sayfa bilgisi geçerli değil.' } },400);
    }
    const isUnavailable=upstreamUnavailable(result.status);
    return context.json({ error: {
      code:isUnavailable?'CUSTOMERS_UNAVAILABLE':'CUSTOMERS_FAILED',
      message:isUnavailable?'Randevu geçmişi şu anda okunamıyor. Lütfen tekrar deneyin.':'Randevu geçmişi okunamadı.',
    } },isUnavailable?503:502);
  }

  const paged=pageResult(result.data ?? [],limit,'customer_group_history',(row)=>({
    at:row.group_starts_at,
    id:row.group_id,
  }));
  return context.json({ bookings:paged.items.map((row)=>row.booking),page:paged.page });
});

// Legacy physical-line customer history remains available for old clients. The
// current browser uses /group-history above so native groups cannot split across
// pages or render as multiple reservations.
reads.get('/customers/:id/history', async (context) => {
  const access = await requireMember(context);
  if ('error' in access) return access.error;
  const customerId = context.req.param('id');
  const limit = parsePageLimit(context.req.query('limit'));
  const cursor = decodePageCursor(context.req.query('cursor'),'customer_history');
  if (!isUuid(customerId) || limit===null || cursor===undefined) {
    return context.json({ error: { code: 'INVALID_PAGE', message: 'Müşteri veya sayfa bilgisi geçerli değil.' } }, 400);
  }

  const result = await supabaseRequest<GroupAwareCustomerAppointment[]>(
    context.env,
    'rest/v1/rpc/list_business_customer_appointments_page_v2',
    {
      method: 'POST',
      body: JSON.stringify({
        p_business_id: access.membership.business_id,
        p_customer_id: customerId,
        p_limit: limit+1,
        p_after_starts_at: cursor?.at ?? null,
        p_after_id: cursor?.id ?? null,
      }),
    },
    access.auth.accessToken,
  );
  if (!result.ok) {
    const message = rpcErrorMessage(result.data);
    if (message.includes('NOT_ALLOWED')) {
      return context.json({ error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } }, 403);
    }
    if (message.includes('CUSTOMER_NOT_FOUND')) {
      return context.json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Müşteri kaydı bulunamadı.' } }, 404);
    }
    if (message.includes('INVALID_PAGE')) {
      return context.json({ error: { code: 'INVALID_PAGE', message: 'Sayfa bilgisi geçerli değil.' } }, 400);
    }
    const isUnavailable = upstreamUnavailable(result.status);
    return context.json({ error: {
      code: isUnavailable ? 'CUSTOMERS_UNAVAILABLE' : 'CUSTOMERS_FAILED',
      message: isUnavailable ? 'Randevu geçmişi şu anda okunamıyor. Lütfen tekrar deneyin.' : 'Randevu geçmişi okunamadı.',
    } }, isUnavailable ? 503 : 502);
  }

  const paged = pageResult(result.data ?? [],limit,'customer_history',(row)=>({
    at: row.starts_at,
    id: row.appointment_id,
  }));
  return context.json({ appointments: paged.items, page: paged.page });
});

export default reads;
