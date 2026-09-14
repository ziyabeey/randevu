const STORAGE_KEY = 'yzt.team.invite.v1';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

let memoryToken: string | null = null;

export function parseTeamInviteHash(hash: string) {
  if (!hash.startsWith('#invite=')) return null;
  const value = hash.slice('#invite='.length);
  return TOKEN_PATTERN.test(value) ? value : null;
}

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function captureTeamInviteFromLocation() {
  if (window.location.pathname === '/m' || window.location.pathname === '/m/') return null;
  const token = parseTeamInviteHash(window.location.hash);
  if (!token) return null;

  memoryToken = token;
  try {
    safeSessionStorage()?.setItem(STORAGE_KEY, token);
  } catch {
    // The in-memory copy still preserves the capability for this SPA session.
  }

  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
  return token;
}

export function readPendingTeamInvite() {
  if (memoryToken && TOKEN_PATTERN.test(memoryToken)) return memoryToken;
  try {
    const stored = safeSessionStorage()?.getItem(STORAGE_KEY) ?? null;
    if (stored && TOKEN_PATTERN.test(stored)) {
      memoryToken = stored;
      return stored;
    }
    if (stored) safeSessionStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Treat unavailable storage as an empty store.
  }
  return null;
}

export function clearPendingTeamInvite() {
  memoryToken = null;
  try {
    safeSessionStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to clear.
  }
}
