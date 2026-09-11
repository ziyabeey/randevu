import app from './index';
import availability from './availability';

app.route('/api/availability', availability);

export default app;
