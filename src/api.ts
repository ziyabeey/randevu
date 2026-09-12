type ApiErrorBody = { error?: { code?: string; message?: string } };

type ApiInit = RequestInit & {
  skipCsrfRetry?: boolean;
  csrf?: 'required' | 'skip';
};

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
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

export function seedCsrfToken(value: unknown) {
  if (validCsrf(value)) csrfToken = value;
}

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

async function parseBody<T>(response: Response) {
  const text = await response.text();
  if (!text) return {} as T & ApiErrorBody;
  try { return JSON.parse(text) as T & ApiErrorBody; }
  catch { return {} as T & ApiErrorBody; }
}

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const csrfRequired = unsafeMethod(init.method) && init.csrf !== 'skip';
  if (csrfRequired) {
    headers.set('X-YZT-CSRF', await obtainCsrfToken());
  }

  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = await parseBody<T>(response);

  if (!response.ok) {
    const code = body.error?.code;
    if (csrfRequired && response.status === 403 && code === 'CSRF_INVALID' && !init.skipCsrfRetry) {
      clearCsrfToken();
      return api<T>(path, { ...init, skipCsrfRetry: true });
    }
    throw new ApiRequestError(
      body.error?.message ?? 'İşlem tamamlanamadı.',
      response.status,
      code,
    );
  }

  const candidate = body as T & { csrfToken?: unknown };
  seedCsrfToken(candidate.csrfToken);
  return body as T;
}
