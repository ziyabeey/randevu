import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AvailabilityPage from './AvailabilityPage';
import BookingPage from './BookingPage';
import PublicBookingPage from './PublicBookingPage';
import PublicBookingSettingsPage from './PublicBookingSettingsPage';
import ManageAppointmentPage from './ManageAppointmentPage';
import './styles.css';
import './phase4.css';
import './phase5.css';
import './public-booking.css';
import './customer-manage.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root element is missing.');
}

const path = window.location.pathname;
const isAvailability = path === '/availability';
const isBookings = path === '/bookings';
const isPublicSettings = path === '/public-booking';
const publicSlug = path.startsWith('/r/') ? decodeURIComponent(path.slice(3).split('/')[0] ?? '') : null;
const isManagementPage = path === '/m' || path === '/m/';
const managementToken = isManagementPage ? decodeURIComponent(window.location.hash.replace(/^#/, '')) : null;
const isPublicPage = publicSlug !== null;

createRoot(root).render(
  <StrictMode>
    {isManagementPage
      ? <ManageAppointmentPage token={managementToken ?? ''} />
      : isPublicPage && publicSlug
        ? <PublicBookingPage slug={publicSlug} />
        : isAvailability
          ? <AvailabilityPage />
          : isBookings
            ? <BookingPage />
            : isPublicSettings
              ? <PublicBookingSettingsPage />
              : <App />}
    {!isPublicPage && !isManagementPage && (
      <nav className="phase-nav" aria-label="Çalışma alanları">
        <a href="/" aria-current={!isAvailability && !isBookings && !isPublicSettings ? 'page' : undefined}>Hizmet & Ekip</a>
        <a href="/availability" aria-current={isAvailability ? 'page' : undefined}>Müsaitlik</a>
        <a href="/bookings" aria-current={isBookings ? 'page' : undefined}>Randevular</a>
        <a href="/public-booking" aria-current={isPublicSettings ? 'page' : undefined}>Public Sayfa</a>
      </nav>
    )}
  </StrictMode>,
);
