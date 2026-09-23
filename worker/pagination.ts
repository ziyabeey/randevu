import { base64UrlToText, textToBase64Url } from '../shared/base64.ts';

export type PageKind = 'bookings' | 'booking_groups' | 'events' | 'customers' | 'customer_history' | 'customer_group_history' | 'tickets' | 'products' | 'product_movements' | 'expenses';

export type PageCursor = {
  at: string;
  id: string;
};

export type BookingPageCursor = PageCursor & {
  revision: string;
  rangeStart: string | null;
  rangeEnd: string | null;
};

type CursorEnvelope = PageCursor & {
  v: 1;
  k: PageKind;
};

type BookingCursorEnvelope = PageCursor & {
  v: 3;
  k: 'bookings';
  r: string;
  s: string | null;
  e: string | null;
};

export const BOOKING_CURSOR_RESTART_REQUIRED = 'BOOKING_CURSOR_RESTART_REQUIRED' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parsePageLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return 25;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : null;
}

export function encodePageCursor(kind: PageKind, cursor: PageCursor) {
  const envelope: CursorEnvelope = { v: 1, k: kind, at: cursor.at, id: cursor.id };
  return textToBase64Url(JSON.stringify(envelope));
}

export function decodePageCursor(value: string | undefined, kind: PageKind): PageCursor | null | undefined {
  if (value === undefined || value === '') return null;
  if (value.length > 512) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
    const parsed: unknown = JSON.parse(base64UrlToText(value));
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

export function encodeBookingPageCursor(cursor: BookingPageCursor) {
  const envelope: BookingCursorEnvelope = {
    v: 3,
    k: 'bookings',
    at: cursor.at,
    id: cursor.id,
    r: cursor.revision,
    s: cursor.rangeStart,
    e: cursor.rangeEnd,
  };
  return textToBase64Url(JSON.stringify(envelope));
}

export function decodeBookingPageCursor(
  value: string | undefined,
): BookingPageCursor | null | undefined | typeof BOOKING_CURSOR_RESTART_REQUIRED {
  if (value === undefined || value === '') return null;
  if (value.length > 512) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
    const parsed: unknown = JSON.parse(base64UrlToText(value));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const cursor = parsed as {
      v?: unknown; k?: unknown; at?: unknown; id?: unknown; r?: unknown; s?: unknown; e?: unknown;
    };
    const validKey = validTimestamp(cursor.at) && UUID_PATTERN.test(String(cursor.id ?? ''));
    if (cursor.k === 'bookings' && validKey && (
      cursor.v === 1
      || (cursor.v === 2 && UUID_PATTERN.test(String(cursor.r ?? '')))
    )) {
      return BOOKING_CURSOR_RESTART_REQUIRED;
    }
    const rangeValid = (cursor.s === null && cursor.e === null)
      || (validDate(cursor.s) && validDate(cursor.e) && cursor.s < cursor.e);
    if (cursor.v !== 3 || cursor.k !== 'bookings' || !validKey
        || !UUID_PATTERN.test(String(cursor.r ?? '')) || !rangeValid) {
      return undefined;
    }
    return {
      at: String(cursor.at),
      id: String(cursor.id),
      revision: String(cursor.r),
      rangeStart: cursor.s as string | null,
      rangeEnd: cursor.e as string | null,
    };
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

export function bookingPageResult<T>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => BookingPageCursor,
) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeBookingPageCursor(cursorFor(last)) : null,
    },
  };
}
