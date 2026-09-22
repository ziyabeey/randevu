export type WorkspacePage =
  | 'calendar'
  | 'bookings'
  | 'customers'
  | 'services'
  | 'availability'
  | 'setup'
  | 'team'
  | 'public-booking'
  | 'not-found';

export type AppRoute =
  | { kind: 'management' }
  | { kind: 'public'; slug: string }
  | { kind: 'invite' }
  | { kind: 'workspace'; page: WorkspacePage }
  | { kind: 'redirect'; to: string }
  | { kind: 'not-found' };

const legacyWorkspaceRoutes: Record<string, string> = {
  '/calendar': '/app/calendar',
  '/bookings': '/app/bookings',
  '/customers': '/app/customers',
  '/services': '/app/services',
  '/availability': '/app/availability',
  '/setup': '/app/setup',
  '/team': '/app/team',
  '/public-booking': '/app/public-booking',
  '/account': '/app',
};

const workspaceRoutes: Record<string, WorkspacePage> = {
  '/app': 'calendar',
  '/app/': 'calendar',
  '/app/calendar': 'calendar',
  '/app/bookings': 'bookings',
  '/app/customers': 'customers',
  '/app/services': 'services',
  '/app/availability': 'availability',
  '/app/setup': 'setup',
  '/app/team': 'team',
  '/app/public-booking': 'public-booking',
};

export function resolveAppRoute(pathname: string, pendingInvite: boolean): AppRoute {
  if (pathname === '/m' || pathname === '/m/') return { kind: 'management' };

  if (pathname.startsWith('/r/')) {
    try {
      const slug = decodeURIComponent(pathname.slice(3).split('/')[0] ?? '');
      return slug ? { kind: 'public', slug } : { kind: 'not-found' };
    } catch {
      return { kind: 'not-found' };
    }
  }

  if (pathname === '/' && pendingInvite) return { kind: 'invite' };
  if (pathname === '/') return { kind: 'redirect', to: '/app' };

  const legacy = legacyWorkspaceRoutes[pathname];
  if (legacy) return { kind: 'redirect', to: legacy };

  const workspace = workspaceRoutes[pathname];
  if (workspace) return { kind: 'workspace', page: workspace };
  if (pathname.startsWith('/app/')) return { kind: 'workspace', page: 'not-found' };

  return { kind: 'not-found' };
}

const NAVIGATION_EVENT = 'randevu:navigate';

export function navigateApp(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function subscribeAppNavigation(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
}

export function workspaceHref(page: Exclude<WorkspacePage, 'not-found'>) {
  return page === 'calendar' ? '/app/calendar' : `/app/${page}`;
}
