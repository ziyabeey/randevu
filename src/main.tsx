import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AvailabilityPage from './AvailabilityPage';
import BookingPage from './BookingPage';
import './styles.css';
import './phase4.css';
import './phase5.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root element is missing.');
}

const path = window.location.pathname;
const isAvailability = path === '/availability';
const isBookings = path === '/bookings';

createRoot(root).render(
  <StrictMode>
    {isAvailability ? <AvailabilityPage /> : isBookings ? <BookingPage /> : <App />}
    <nav className="phase-nav" aria-label="Çalışma alanları">
      <a href="/" aria-current={!isAvailability && !isBookings ? 'page' : undefined}>Hizmet & Ekip</a>
      <a href="/availability" aria-current={isAvailability ? 'page' : undefined}>Müsaitlik</a>
      <a href="/bookings" aria-current={isBookings ? 'page' : undefined}>Randevular</a>
    </nav>
  </StrictMode>,
);
