import type { Role } from '../shared/types.ts';

export function formatMoney(minor: number, currency = 'TRY'): string {
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function formatTry(minor: number): string {
  return formatMoney(minor, 'TRY');
}

export function formatDateTime(
  value: string,
  timezone?: string,
  dateStyle: 'long' | 'medium' | 'short' = 'long',
  timeStyle: 'short' | 'medium' = 'short',
): string {
  return new Intl.DateTimeFormat('tr-TR', {
    ...(timezone ? { timeZone: timezone } : {}),
    dateStyle,
    timeStyle,
  }).format(new Date(value));
}

export function formatTime(value: string, timezone?: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    ...(timezone ? { timeZone: timezone } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}

export function roleLabel(role: Role): string {
  if (role === 'owner') return 'İşletme sahibi';
  if (role === 'manager') return 'Yönetici';
  return 'Çalışan';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '').join('') || 'R').slice(0, 2);
}

export function parseMoney(value: FormDataEntryValue | unknown): number | null {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100);
}
