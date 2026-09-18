export type AuthoritySignal = 'privilege-denial' | 'transient' | 'rejected';

function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  return null;
}

/**
 * A privileged denial is the only failure that proves the client's authority
 * view is wrong. Anything that still might succeed on a retry (provider 5xx,
 * rate limit, timeout, dropped connection) must not be reported as access loss.
 */
export function authoritySignal(error: unknown): AuthoritySignal {
  const status = statusOf(error);
  if (status === null) return 'transient';
  if (status === 401 || status === 403) return 'privilege-denial';
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  return 'rejected';
}

export function isPrivilegedAuthorityDenial(error: unknown): boolean {
  return authoritySignal(error) === 'privilege-denial';
}

export function isTransientAuthorityRead(error: unknown): boolean {
  return authoritySignal(error) === 'transient';
}

export function retainsVerifiedAuthorityView(error: unknown): boolean {
  return authoritySignal(error) !== 'privilege-denial';
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}
