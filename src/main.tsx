import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRouter from './AppRouter';
import { initLocale, useLocale } from './i18n';
import { setWorkspaceGuard } from './api';
import { captureTeamInviteFromLocation, readPendingTeamInvite } from './teamInvite';
import { installWorkspaceCoherence, workspaceGuard } from './workspace-coherence';
import { resolveAppRoute } from './workspace-route';
import './styles.css';
import './phase4.css';
import './phase5.css';
import './calendar.css';
import './public-booking.css';
import './public-profile.css';
import './customer-manage.css';
import './customers.css';
import './products.css';
import './expenses.css';
import './financial-reports.css';
import './team.css';
import './onboarding.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing.');

const managementPath = window.location.pathname === '/m' || window.location.pathname === '/m/';
if (!managementPath) captureTeamInviteFromLocation();

let initialRoute = resolveAppRoute(window.location.pathname, Boolean(readPendingTeamInvite()));
if (initialRoute.kind === 'redirect') {
  const next = `${initialRoute.to}${window.location.search}${window.location.hash}`;
  window.history.replaceState({}, '', next);
  initialRoute = resolveAppRoute(window.location.pathname, Boolean(readPendingTeamInvite()));
}

if (initialRoute.kind === 'workspace') {
  installWorkspaceCoherence({ readsSessionItself: true });
  setWorkspaceGuard(workspaceGuard);
} else {
  setWorkspaceGuard(null);
}

// F16-08: a language change remounts the app so every screen re-renders in
// the new language; Turkish needs no catalog, English loads it lazily first.
function LocaleRoot() {
  const locale = useLocale();
  return <AppRouter key={locale} />;
}

void initLocale().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <LocaleRoot />
    </StrictMode>,
  );
});
