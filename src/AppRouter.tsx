import { lazy, Suspense, useEffect, useState } from 'react';
import { readPendingTeamInvite } from './teamInvite';
import { navigateApp, resolveAppRoute, subscribeAppNavigation } from './workspace-route';

const WorkspaceShell = lazy(() => import('./WorkspaceShell'));
const InvitePage = lazy(() => import('./InvitePage'));
const PublicSalonPage = lazy(() => import('./PublicSalonPage'));
const ManageAppointmentPage = lazy(() => import('./ManageAppointmentPage'));

function NotFoundPage() {
  return (
    <main className="center-card">
      <p className="eyebrow">SAYFA BULUNAMADI</p>
      <h1>Bu adres bulunamadı</h1>
      <p className="muted">İşletme çalışma alanına dönüp devam edebilirsiniz.</p>
      <a className="primary-link" href="/app">Çalışma alanına dön</a>
    </main>
  );
}

export default function AppRouter() {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeAppNavigation(() => setVersion((value) => value + 1)), []);

  const route = resolveAppRoute(window.location.pathname, Boolean(readPendingTeamInvite()));

  useEffect(() => {
    if (route.kind === 'redirect') navigateApp(route.to, { replace: true });
  }, [route.kind === 'redirect' ? route.to : null]);

  if (route.kind === 'redirect') {
    return <main className="route-loading" aria-busy="true">Çalışma alanı açılıyor…</main>;
  }

  return (
    <Suspense fallback={<main className="route-loading" aria-busy="true">Sayfa hazırlanıyor…</main>}>
      {route.kind === 'management'
        ? <ManageAppointmentPage token={window.location.hash.replace(/^#/, '')} />
        : route.kind === 'public'
          ? <PublicSalonPage slug={route.slug} />
          : route.kind === 'invite'
            ? <InvitePage />
            : route.kind === 'workspace'
              ? <WorkspaceShell page={route.page} />
              : <NotFoundPage />}
    </Suspense>
  );
}
