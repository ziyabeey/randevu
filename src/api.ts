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

// Operator pages register the cross-tab workspace coherence guard at startup
// (see workspace-coherence.ts); public and customer-management pages never do,
// so for them the client behaves exactly as before.
type WorkspaceGuard = {
  writeAllowed(path: string): Promise<boolean>;
  expectedContext(path: string): { userId: string; businessId: string | null } | null;
  noteResponse(path: string, method: string, requestBody: unknown, responseBody: unknown): void;
};
let workspaceGuard: WorkspaceGuard | null = null;

export function setWorkspaceGuard(guard: WorkspaceGuard | null) {
  workspaceGuard = guard;
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
 * Stores a shape-validated CSRF token supplied by the caller for reuse by guarded requests.
 * This validates only token format; provenance remains the caller's responsibility.
 */
export function seedCsrfToken(value: unknown) {
  if (validCsrf(value)) csrfToken = value;
}

/** Clears cached CSRF state so the next guarded write re-fetches it. */
export function clearCsrfToken() {
  csrfToken = null;
  csrfRequest = null;
}

async function obtainCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = (async () => {
      let response: Response;
      try {
        response = await fetch('/api/csrf', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          credentials: 'same-origin',
        });
      } catch (error) {
        throw normalizeFetchError(error);
      }
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

function normalizeFetchError(error: unknown) {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError(
    'Bağlantı kurulamadı. Lütfen tekrar deneyin.',
    0,
    'NETWORK_UNAVAILABLE',
  );
}

async function fetchText(path: string, init: RequestInit, timeoutMs?: number) {
  if (timeoutMs === undefined) {
    try {
      const response = await fetch(path, init);
      return { response, text: await response.text() };
    } catch (error) {
      if (init.signal?.aborted) throw abortReason(init.signal);
      throw normalizeFetchError(error);
    }
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
    try {
      const response = await fetch(path, { ...init, signal: controller.signal });
      return { response, text: await response.text() };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? error;
      throw normalizeFetchError(error);
    }
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
 * Default guarded writes attach CSRF; `csrf: 'skip'` omits it. CSRF_INVALID retries once.
 * A request timeout is enforced only when `timeoutMs` is supplied.
 */
export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { csrf = 'required', skipCsrfRetry = false, timeoutMs, ...requestInit } = init;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const method = (init.method ?? 'GET').toUpperCase();
  const unsafe = unsafeMethod(method);
  if (workspaceGuard && unsafe && !(await workspaceGuard.writeAllowed(path))) {
    throw new ApiRequestError(
      'Başka bir sekmede oturum veya işletme değişti. Sayfa güncel bilgilerle yenileniyor.',
      409,
      'WORKSPACE_CONTEXT_CHANGED',
    );
  }
  const expectedWorkspace = workspaceGuard && unsafe ? workspaceGuard.expectedContext(path) : null;
  if (expectedWorkspace) {
    headers.set('X-YZT-Expected-User', expectedWorkspace.userId);
    headers.set('X-YZT-Expected-Business', expectedWorkspace.businessId ?? 'none');
  }

  const csrfRequired = unsafe && csrf !== 'skip';
  if (csrfRequired) {
    headers.set('X-YZT-CSRF', await obtainCsrfToken());
  }

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
  workspaceGuard?.noteResponse(path, method, init.body, body);
  return body as T;
}
