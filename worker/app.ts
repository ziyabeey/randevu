import app from './index.ts';
import availability from './availability.ts';
import bookings from './bookings.ts';
import publicBookingRecovery from './public-booking-recovery.ts';
import publicBooking from './public-booking.ts';
import customerManage from './customer-manage.ts';
import calendar from './calendar.ts';
import { AuthUnavailableError, resolveAuth } from './auth.ts';

function protectedFeaturePath(path: string) {
  return path === '/api/availability'
    || path.startsWith('/api/availability/')
    || path === '/api/bookings'
    || path.startsWith('/api/bookings/')
    || path === '/api/calendar'
    || path.startsWith('/api/calendar/')
    || path === '/api/public/settings';
}

// Account routes defined in index.ts use the same verified-session authority.
// Remaining feature modules still own their normal membership checks, but a
// recovery session is stopped here before those legacy helpers can widen it.
app.use('/api/*', async (context, next) => {
  if (!protectedFeaturePath(context.req.path)) {
    await next();
    return;
  }

  try {
    const auth = await resolveAuth(context);
    if (auth?.passwordRecovery) {
      return context.json({
        error: {
          code: 'PASSWORD_UPDATE_REQUIRED',
          message: 'Devam etmeden önce yeni parolanızı belirleyin.',
        },
      }, 403);
    }
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      return context.json({
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Oturum şu anda doğrulanamıyor. Lütfen tekrar deneyin.',
        },
      }, 503);
    }
    throw error;
  }

  await next();
});

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBookingRecovery);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);
app.route('/api/calendar', calendar);

export default app;
