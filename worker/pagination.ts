export type PageKind = 'bookings' | 'events';

export type PageCursor = {
  at: string;
  id: string;
};

type CursorEnvelope = PageCursor & {
  v: 1;
  k: PageKind;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_CURSOR');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

export function parsePageLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return 25;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
}

export function encodePageCursor(kind: PageKind, cursor: PageCursor) {
  const envelope: CursorEnvelope = { v: 1, k: kind, at: cursor.at, id: cursor.id };
  return base64UrlEncode(JSON.stringify(envelope));
}

export function decodePageCursor(value: string | undefined, kind: PageKind): PageCursor | null | undefined {
  if (value === undefined || value === '') return null;
  if (value.length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const cursor = parsed as Partial<CursorEnvelope>;
    if (cursor.v !== 1 || cursor.k !== kind || !validTimestamp(cursor.at) || !UUID_PATTERN.test(String(cursor.id ?? ''))) {
      return undefined;
    }
    return { at: cursor.at, id: String(cursor.id) };
  } catch {
    return undefined;
  }
}

export function pageResult<T>(
  rows: T[],
  limit: number,
  kind: PageKind,
  cursorFor: (row: T) => PageCursor,
) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodePageCursor(kind, cursorFor(last)) : null,
    },
  };
}
