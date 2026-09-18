type ApiErrorBody = { error?: { code?: string; message?: string } };

type ApiInit = RequestInit & {
  skipCsrfRetry?: boolean;
  csrf?: 'required' | 'skip';
  timeoutMs?: number;
};

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

function unsafeMethod(method: string | undefined) {
  const value = (method ?? 'GET').toUpperCase();
  return value !== 'GET' && value !== 'HEAD' && value !== 'OPTIONS';
}

function validCsrf(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

/**
 * Stores a trusted CSRF token that will be reused for subsequent mutating requests.
 *
 * The token is accepted only when it matches the server-issued format required by
 * the public API layer.
 */
export function seedCsrfToken(value: unknown) {
  if (validCsrf(value)) csrfToken = value;
}

/**
 * Clears the cached CSRF state so the next guarded write request re-fetches it.
 */
export function clearCsrfToken() {
  csrfToken = null;
  csrfRequest = null;
}

async function obtainCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = (async () => {
      const response = await fetch('/api/csrf', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const body = await response.json().catch(() => null) as { csrfToken?: unknown } | null;
      if (!response.ok || !validCsrf(body?.csrfToken)) {
        throw new ApiRequestError('Güvenlik doğrulaması hazırlanamadı.', response.status || 503, 'CSRF_UNAVAILABLE');
      }
      csrfToken = body.csrfToken;
      return csrfToken;
    })().finally(() => { csrfRequest = null; });
  }
  return csrfRequest;
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

async function fetchText(path: string, init: RequestInit, timeoutMs?: number) {
  if (timeoutMs === undefined) {
    const response = await fetch(path, init);
    return { response, text: await response.text() };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be a positive finite number');

  const callerSignal = init.signal;
  if (callerSignal?.aborted) throw abortReason(callerSignal);
  const controller = new AbortController();
  let rejectBoundary: (reason?: unknown) => void = () => undefined;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const abortFromCaller = () => {
    const reason = abortReason(callerSignal!);
    controller.abort(reason);
    rejectBoundary(reason);
  };
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    const error = new ApiRequestError(
      'İstek zamanında tamamlanamadı. Lütfen sonucu tekrar kontrol edin.',
      0,
      'REQUEST_TIMEOUT',
    );
    controller.abort(error);
    rejectBoundary(error);
  }, timeoutMs);
  const operation = (async () => {
    const response = await fetch(path, { ...init, signal: controller.signal });
    return { response, text: await response.text() };
  })();
  try {
    return await Promise.race([operation, boundary]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function parseBody<T>(text: string) {
  if (!text) return {} as T & ApiErrorBody;
  try { return JSON.parse(text) as T & ApiErrorBody; }
  catch { return {} as T & ApiErrorBody; }
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  if (/^[0-9]+$/.test(value)) return Number(value);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : undefined;
}

/**
 * Sends a JSON request through the browser-facing API wrapper.
 *
 * Mutating requests automatically attach the cached CSRF token and retry once when
 * the server reports an invalid token. The timeout is enforced per request so the
 * UI can surface a friendly error instead of hanging on stalled network calls.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { csrf = 'required', skipCsrfRetry = false, timeoutMs, ...requestInit } = init;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const csrfRequired = unsafeMethod(init.method) && csrf !== 'skip';
  if (csrfRequired) {
    headers.set('X-YZT-CSRF', await obtainCsrfToken());
  }

  // The app treats a stalled fetch as a user-visible error rather than leaving the
  // state silently pending in a background request.
  const { response, text } = await fetchText(path, {
    ...requestInit,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  }, timeoutMs);
  const body = parseBody<T>(text);

  if (!response.ok) {
    const code = body.error?.code;
    if (csrfRequired && response.status === 403 && code === 'CSRF_INVALID' && !skipCsrfRetry) {
      clearCsrfToken();
      return api<T>(path, { ...init, skipCsrfRetry: true });
    }
    throw new ApiRequestError(
      body.error?.message ?? 'İşlem tamamlanamadı.',
      response.status,
      code,
      retryAfterSeconds(response),
    );
  }

  const candidate = body as T & { csrfToken?: unknown };
  seedCsrfToken(candidate.csrfToken);
  return body as T;
}
