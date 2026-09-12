import app from './index.ts';
import availability from './availability.ts';
import bookings from './bookings.ts';
import publicBookingRecovery from './public-booking-recovery.ts';
import publicBooking from './public-booking.ts';
import customerManage from './customer-manage.ts';
import calendar from './calendar.ts';

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBookingRecovery);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);
app.route('/api/calendar', calendar);

export default app;
