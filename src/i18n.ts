import { useSyncExternalStore } from 'react';

// F16-08 language boundary. Turkish is the default and the source language:
// every user-visible string is written in Turkish and passed through t(). The
// English catalog maps that Turkish text to English and is loaded lazily only
// when a visitor picks English. A string without a translation falls back to
// its Turkish source, so a technical key is never shown.

export type Locale = 'tr' | 'en';
export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

const STORAGE_KEY = 'yzt_locale';
type Catalog = Record<string, string>;

let current: Locale = 'tr';
let catalog: Catalog | null = null;
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is Locale {
  return value === 'tr' || value === 'en';
}

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function requestedLocale(): Locale | null {
  try {
    const value = new URLSearchParams(window.location.search).get('lang');
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

async function loadCatalog() {
  if (!catalog) catalog = (await import('./i18n-en')).default;
  return catalog;
}

function apply(next: Locale) {
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

// Runs once before the first render: an explicit ?lang= wins, then the saved
// choice, then Turkish. A catalog that fails to load keeps Turkish.
export async function initLocale() {
  if (typeof window === 'undefined') return current;
  const next = requestedLocale() ?? storedLocale() ?? 'tr';
  if (next === 'en') {
    try {
      await loadCatalog();
    } catch {
      apply('tr');
      return current;
    }
  }
  apply(next);
  return current;
}

export async function setLocale(next: Locale) {
  if (next === 'en') await loadCatalog();
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A private window can refuse storage; the choice still applies now.
  }
  apply(next);
}

export function getLocale() {
  return current;
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'tr' as Locale);
}

// BCP 47 tag for Intl date/number formatting in the active language.
export function intlLocale() {
  return current === 'en' ? 'en-GB' : 'tr-TR';
}

export function t(text: string, values?: Record<string, string | number>) {
  const template = current === 'en' ? (catalog?.[text] ?? text) : text;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export function formatMoney(minor: number, currency: string | null = 'TRY') {
  const value = minor / 100;
  if (!currency) return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  try {
    return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

export function formatDateTime(value: string | Date, options: Intl.DateTimeFormatOptions, timeZone?: string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(intlLocale(), { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
}
