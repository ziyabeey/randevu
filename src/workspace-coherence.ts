// Operator pages share one origin-wide session and selected-business cookie,
// while each open tab keeps rendering whatever context it loaded. Another tab
// can therefore switch the business or sign out underneath it, and the stale
// tab would then write to a business it is not showing or keep presenting a
// signed-out workspace.
//
// This module keeps a tab bound to the identity it rendered. Every unsafe
// request re-reads the server identity first and is never sent on a mismatch,
// and returning to the tab (focus, visibilitychange, pageshow) re-reads it too.
// On a mismatch the page reloads into the current context. The tab's own
// business switch, sign-in and sign-out move its binding instead. Public and
// customer-management pages never install it.

type Identity = { userId: string | null; businessId: string | null };

type InstallOptions = {
  // True when the mounted page reads /api/session itself; its first answer
  // then becomes the binding and no second, racing session read is made.
  readsSessionItself: boolean;
};

let installed = false;
let binding: Identity | null = null;
let reloading = false;
let returnCheck: Promise<void> | null = null;

// Requests that are the tab's own context transitions, or not bound to the
// operator workspace at all.
const UNBOUND_PATHS = ['/api/businesses/select', '/api/auth/', '/api/csrf', '/api/session', '/api/public/', '/api/manage/'];

function unbound(path: string) {
  return UNBOUND_PATHS.some((prefix) => path === prefix || path.startsWith(prefix));
}

function identityOf(session: unknown): Identity | null {
  if (!session || typeof session !== 'object') return null;
  const value = session as { user?: { id?: unknown } | null; activeBusinessId?: unknown };
  if (!('user' in value)) return null;
  const userId = value.user && typeof value.user.id === 'string' ? value.user.id : null;
  const businessId = userId && typeof value.activeBusinessId === 'string' ? value.activeBusinessId : null;
  return { userId, businessId };
}

function same(a: Identity, b: Identity) {
  return a.userId === b.userId && a.businessId === b.businessId;
}

// Reads the identity the server would apply right now. Null means it could not
// be verified (transient failure); that is never treated as a sign-out.
async function readServerIdentity(): Promise<Identity | null> {
  try {
    const response = await fetch('/api/session', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    return identityOf(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

function reloadIntoCurrentContext() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

// True when the server context still matches what this tab rendered.
async function confirmBinding(): Promise<boolean> {
  const current = await readServerIdentity();
  if (!current) return true;
  if (!binding) {
    binding = current;
    return true;
  }
  if (same(binding, current)) return true;
  reloadIntoCurrentContext();
  return false;
}

// Only a return to an already-rendered tab is checked. Before the page has
// established its own context there is nothing to compare, and an extra
// session read at load would race the page's own read.
function checkOnReturn() {
  if (!installed || reloading || returnCheck || !binding) return;
  if (document.visibilityState === 'hidden') return;
  returnCheck = confirmBinding().then(() => undefined).finally(() => { returnCheck = null; });
}

// pageshow also fires on every normal load; only a back/forward-cache restore
// is a return to a previously rendered page.
function checkOnPageShow(event: Event) {
  if ((event as PageTransitionEvent).persisted) checkOnReturn();
}

export function installWorkspaceCoherence(options: InstallOptions) {
  if (installed) return;
  installed = true;
  if (!options.readsSessionItself) {
    void readServerIdentity().then((identity) => {
      if (identity && !binding) binding = identity;
    });
  }
  window.addEventListener('focus', checkOnReturn);
  window.addEventListener('pageshow', checkOnPageShow);
  document.addEventListener('visibilitychange', checkOnReturn);
}

// Called by the API client before an unsafe request. False means the write
// must not be sent: the context changed and the page is reloading.
export async function workspaceWriteAllowed(path: string): Promise<boolean> {
  if (!installed || unbound(path)) return true;
  if (reloading) return false;
  return confirmBinding();
}

// Called by the API client after a successful response this tab will render
// or has caused.
export function noteWorkspaceResponse(path: string, method: string, requestBody: unknown, responseBody: unknown) {
  if (!installed) return;
  if (method === 'GET' && path === '/api/session') {
    binding = identityOf(responseBody) ?? binding;
    return;
  }
  if (method === 'GET') return;
  if (path === '/api/businesses/select' && binding) {
    let requested: unknown = null;
    try { requested = typeof requestBody === 'string' ? (JSON.parse(requestBody) as { businessId?: unknown }).businessId : null; }
    catch { requested = null; }
    if (typeof requested === 'string') binding = { ...binding, businessId: requested };
    return;
  }
  if (path.startsWith('/api/auth/')) binding = null;
}

// Registered with the API client by main.tsx for operator routes.
export const workspaceGuard = {
  writeAllowed: workspaceWriteAllowed,
  noteResponse: noteWorkspaceResponse,
};

// Test-only reset so node tests can exercise installation more than once.
export function resetWorkspaceCoherenceForTests() {
  if (installed && typeof window !== 'undefined') {
    window.removeEventListener('focus', checkOnReturn);
    window.removeEventListener('pageshow', checkOnPageShow);
    document.removeEventListener('visibilitychange', checkOnReturn);
  }
  installed = false;
  binding = null;
  reloading = false;
  returnCheck = null;
}
