import app from './index';
import availability from './availability';
import bookings from './bookings';

app.route('/api/availability', availability);
app.route('/api/bookings', bookings);

export default app;
