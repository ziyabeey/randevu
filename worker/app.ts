import app from './index';
import availability from './availability';
import bookings from './bookings';
import publicBooking from './public-booking';
import customerManage from './customer-manage';

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBooking);
app.route('/api/manage', customerManage);

export default app;
