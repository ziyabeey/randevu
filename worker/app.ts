import { Hono } from 'hono';
import coreApp from './index.ts';
import availability from './availability.ts';
import bookings from './bookings.ts';
import f11Groups from './f11-group-http.ts';
import f11GroupManagement from './f11-group-management-http.ts';
import f11GroupLineManagement from './f11-group-line-management-http.ts';
import f11GroupConsumerReads from './f11-group-consumer-reads.ts';
import publicBookingRecovery from './public-booking-recovery.ts';
import publicBooking from './public-booking.ts';
import publicProfile from './public-profile.ts';
import customerManage from './customer-manage.ts';
import customers from './customers.ts';
import calendar from './calendar.ts';
import snapshotReads from './snapshot-reads.ts';
import team from './team.ts';
import tickets from './tickets.ts';
import products from './products.ts';
import onboarding from './onboarding.ts';
import {
  mutationSecurityError,
  type AuthEnv,
} from './auth.ts';
import type { PublicAbuseEnv } from './public-abuse.ts';
import { deploymentHealth, type DeploymentEnv } from './deployment-health.ts';

type Env = AuthEnv & PublicAbuseEnv & DeploymentEnv & {
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1?: string;
};

type MutationClass = 'safe' | 'cookie' | 'public' | 'capability';

const app = new Hono<{ Bindings: Env }>();

// A version preview is a key-verification surface, never a second booking/auth
// origin. Run this before routing or session work; client Origin headers do not
// establish which Worker hostname received the request.
app.use('*', async (context, next) => {
  if (context.env.DEPLOYMENT_PROBE_ENABLED === 'true'
      && !(context.req.method === 'GET' && context.req.path === '/api/deployment-health')) {
    let canonical = '';
    try { canonical = new URL(context.env.PUBLIC_APP_ORIGIN ?? '').origin; } catch { /* fail closed */ }
    if (new URL(context.req.url).origin !== canonical) {
      return context.json({ error: 'NOT_FOUND' }, 404, { 'Cache-Control': 'no-store' });
    }
  }
  await next();
});

function mutationClass(method: string, path: string): MutationClass {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return 'safe';
  }

  if (normalizedMethod === 'POST' && (path === '/api/public/booking/recover'
      || path === '/api/public/booking/resolve'
      || /^\/api\/public\/business\/[^/]+\/book$/.test(path)
      || /^\/api\/public\/business\/[^/]+\/group-slots$/.test(path)
      || /^\/api\/public\/business\/[^/]+\/group-book$/.test(path))) {
    return 'public';
  }

  if (normalizedMethod === 'POST' && (path === '/api/manage/view'
      || path === '/api/manage/slots'
      || path === '/api/manage/reschedule'
      || path === '/api/manage/cancel')) {
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

  const securityError = mutationSecurityError(context);
  if (securityError) return context.json({ error: securityError }, 403);
  await next();
});

app.get('/api/deployment-health', (context) => deploymentHealth(context.req.raw, context.env));
// F11-03 exact live group-rooted reads are registered before the older snapshot
// handlers. Legacy physical-line reads remain available for old clients.
app.route('/api', f11GroupConsumerReads);
// C2b exact read routes preserve existing response shapes while probing max+1.
// They are registered before the legacy handlers so overflow can never become a
// partial successful snapshot. Mutations continue through their existing routers.
app.route('/', snapshotReads);
app.route('/', coreApp);
// F11-03 native group mutation surfaces. Line-local writes share the same group
// optimistic version and are still protected by the default cookie mutation
// guard above.
app.route('/api', f11GroupLineManagement);
app.route('/api', f11GroupManagement);
// F11-02 exact group create/availability routes stay isolated behind management.
app.route('/api', f11Groups);
app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/customers', customers);
app.route('/api/public', publicBookingRecovery);
app.route('/api/public', publicProfile);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);
app.route('/api/calendar', calendar);
app.route('/api/team', team);
app.route('/api', tickets);
app.route('/api', products);
app.route('/api/onboarding', onboarding);

export default app;
