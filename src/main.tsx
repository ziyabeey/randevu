import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AvailabilityPage from './AvailabilityPage';
import BookingPage from './BookingPage';
import CalendarPage from './CalendarPage';
import CustomersPage from './CustomersPage';
import InvitePage from './InvitePage';
import OnboardingPage from './OnboardingPage';
import PublicSalonPage from './PublicSalonPage';
import PublicBookingSettingsPage from './PublicBookingSettingsPage';
import ManageAppointmentPage from './ManageAppointmentPage';
import TeamPage from './TeamPage';
import { captureTeamInviteFromLocation, readPendingTeamInvite } from './teamInvite';
import { setWorkspaceGuard } from './api';
import { installWorkspaceCoherence, workspaceGuard } from './workspace-coherence';
import './styles.css';
import './phase4.css';
import './phase5.css';
import './calendar.css';
import './public-booking.css';
import './public-profile.css';
import './customer-manage.css';
import './customers.css';
import './team.css';
import './onboarding.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The application root element is missing.');
}

const path = window.location.pathname;
const isAvailability = path === '/availability';
const isBookings = path === '/bookings';
const isCalendar = path === '/calendar';
const isCustomers = path === '/customers';
const isPublicSettings = path === '/public-booking';
const isTeam = path === '/team';
const isSetup = path === '/setup';
const publicSlug = path.startsWith('/r/') ? decodeURIComponent(path.slice(3).split('/')[0] ?? '') : null;
const isManagementPage = path === '/m' || path === '/m/';
const managementToken = isManagementPage ? window.location.hash.replace(/^#/, '') : null;
const isPublicPage = publicSlug !== null;

if (!isManagementPage) captureTeamInviteFromLocation();
const isInviteFlow = path === '/' && Boolean(readPendingTeamInvite());

// Operator workspace pages are bound to the session/business they rendered so a
// change made in another tab cannot be written through, or presented by, this
// one. Calendar, public-booking settings and team do not read the session
// themselves, so the binding is read once for them.
if (!isManagementPage && !isPublicPage && !isInviteFlow) {
  installWorkspaceCoherence({ readsSessionItself: !(isCalendar || isPublicSettings || isTeam) });
  setWorkspaceGuard(workspaceGuard);
}

createRoot(root).render(
  <StrictMode>
    {isManagementPage
      ? <ManageAppointmentPage token={managementToken ?? ''} />
      : isPublicPage && publicSlug
        ? <PublicSalonPage slug={publicSlug} />
        : isInviteFlow
          ? <InvitePage />
          : isSetup
            ? <OnboardingPage />
            : isCustomers
              ? <CustomersPage />
              : isCalendar
                ? <CalendarPage />
                : isAvailability
                  ? <AvailabilityPage />
                  : isBookings
                    ? <BookingPage />
                    : isPublicSettings
                      ? <PublicBookingSettingsPage />
                      : isTeam
                        ? <TeamPage />
                        : <App />}
    {!isPublicPage && !isManagementPage && !isInviteFlow && (
      <nav className="phase-nav" aria-label="Çalışma alanları">
        <a href="/calendar" aria-current={isCalendar ? 'page' : undefined}>Takvim</a>
        <a href="/bookings" aria-current={isBookings ? 'page' : undefined}>Randevular</a>
        <a href="/customers" aria-current={isCustomers ? 'page' : undefined}>Müşteriler</a>
        <a href="/availability" aria-current={isAvailability ? 'page' : undefined}>Müsaitlik</a>
        <a href="/setup" aria-current={isSetup ? 'page' : undefined}>Kurulum</a>
        <a href="/" aria-current={!isCalendar && !isCustomers && !isAvailability && !isBookings && !isPublicSettings && !isTeam && !isSetup ? 'page' : undefined}>Hizmetler</a>
        <a href="/team" aria-current={isTeam ? 'page' : undefined}>Ekip</a>
        <a href="/public-booking" aria-current={isPublicSettings ? 'page' : undefined}>Public Sayfa</a>
      </nav>
    )}
  </StrictMode>,
);
