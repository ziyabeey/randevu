import { Hono } from 'hono';
import coreApp from './index.ts';
import availability from './availability.ts';
import bookings from './bookings.ts';
import publicBookingRecovery from './public-booking-recovery.ts';
import publicBooking from './public-booking.ts';
import customerManage from './customer-manage.ts';
import calendar from './calendar.ts';
import {
  mutationSecurityError,
  type AuthEnv,
} from './auth.ts';
import type { PublicAbuseEnv } from './public-abuse.ts';

type Env = AuthEnv & PublicAbuseEnv & {
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
};

type MutationClass = 'safe' | 'cookie' | 'public' | 'capability';

const app = new Hono<{ Bindings: Env }>();

function mutationClass(method: string, path: string): MutationClass {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return 'safe';
  }

  if (path === '/api/public/booking/recover'
      || /^\/api\/public\/business\/[^/]+\/book$/.test(path)) {
    return 'public';
  }

  if (path === '/api/manage/view'
      || path === '/api/manage/slots'
      || path === '/api/manage/reschedule'
      || path === '/api/manage/cancel') {
    return 'capability';
  }

  return 'cookie';
}

// Cookie-authenticated browser mutations fail closed. Public booking and
// management-capability routes are explicit exceptions with their own proof,
// abuse and idempotency contracts. Unknown unsafe /api routes never inherit an
// exception accidentally.
app.use('/api/*', async (context, next) => {
  if (mutationClass(context.req.method, context.req.path) !== 'cookie') {
    await next();
    return;
  }

  if (!context.req.header('Origin')) {
    return context.json({
      error: {
        code: 'ORIGIN_FORBIDDEN',
        message: 'İstek kaynağı doğrulanamadı. Sayfayı yenileyip tekrar deneyin.',
      },
    }, 403);
  }

  const securityError = mutationSecurityError(context);
  if (securityError) return context.json({ error: securityError }, 403);
  await next();
});

app.route('/', coreApp);
app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBookingRecovery);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);
app.route('/api/calendar', calendar);

export default app;
