import app from './index';
import availability from './availability';
import bookings from './bookings';
import publicBooking from './public-booking';

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);
app.route('/api/public', publicBooking);

export default app;
