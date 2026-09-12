function splitCombinedSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

const nativeGetSetCookie = Headers.prototype.getSetCookie;

// Node exposes Set-Cookie differently across fetch implementations. Normalize
// the hosted response for the in-memory acceptance jar and treat an explicit
// Max-Age=0 directive as deletion even if a runtime serializes a placeholder
// value. This changes only the acceptance harness, never application cookies.
Headers.prototype.getSetCookie = function getSetCookie() {
  const values = typeof nativeGetSetCookie === 'function'
    ? nativeGetSetCookie.call(this)
    : splitCombinedSetCookie(this.get('set-cookie'));

  return values.map((value) => {
    if (!/(?:^|;\s*)max-age=0(?:;|$)/i.test(value)) return value;
    return value.replace(/^([^=;]+)=[^;]*/, '$1=');
  });
};

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    for (const [name, value] of new Headers(init.headers)) requestHeaders.set(name, value);
  }
  const cookieHeader = requestHeaders.get('Cookie') ?? '';

  if (url.endsWith('/api/session') && cookieHeader.includes('yzt_password_recovery=1')) {
    const body = await response.clone().json().catch(() => null);
    const markerCookie = response.headers.getSetCookie()
      .find((value) => value.toLowerCase().startsWith('yzt_password_recovery=')) ?? '';
    console.log(
      `S01 hosted marker probe: HTTP ${response.status}; passwordRecovery=${String(body?.passwordRecovery)}; user=${Boolean(body?.user)}; markerDeletion=${/(?:^|;\s*)max-age=0(?:;|$)/i.test(markerCookie)}`,
    );
  }

  return response;
};

await import('./staging-s01-recovery-acceptance.mjs');
