import app from './index';
import availability from './availability';
import bookings from './bookings';
import publicBookingRecovery from './public-booking-recovery';
import publicBooking from './public-booking';
import customerManage from './customer-manage';
import calendar from './calendar';

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBookingRecovery);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);
app.route('/api/calendar', calendar);

export default app;
