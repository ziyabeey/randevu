import app from './index.ts';
import availability from './availability.ts';
import bookings from './bookings.ts';
import publicBookingRecovery from './public-booking-recovery.ts';
import publicBooking from './public-booking.ts';
import customerManage from './customer-manage.ts';
import calendar from './calendar.ts';
import { isPasswordRecovery } from './auth.ts';

function protectedFeaturePath(path: string) {
  return path === '/api/availability'
    || path.startsWith('/api/availability/')
    || path === '/api/bookings'
    || path.startsWith('/api/bookings/')
    || path === '/api/calendar'
    || path.startsWith('/api/calendar/')
    || path === '/api/public/settings';
}

// Account routes defined in index.ts already enforce the same recovery-only gate.
// This middleware is registered before the remaining feature routers so a recovery
// session cannot use booking/calendar/settings APIs until a new password is set.
app.use('/api/*', async (context, next) => {
  if (protectedFeaturePath(context.req.path) && isPasswordRecovery(context)) {
    return context.json({
      error: {
        code: 'PASSWORD_UPDATE_REQUIRED',
        message: 'Devam etmeden önce yeni parolanızı belirleyin.',
      },
    }, 403);
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
