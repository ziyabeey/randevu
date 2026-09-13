import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PublicBookingPage from '../../src/PublicBookingPage.tsx';
import {
  PUBLIC_BOOKING_RECOVERY_TTL_MS,
  PUBLIC_BOOKING_SETTLE_MS,
  acquirePublicBookingIntent,
  completePublicBookingIntent,
  dismissPublicBookingRecord,
  forgetLegacyBookingRecord,
  loadPublicBookingRecords,
  markPublicBookingUnresolved,
} from '../../src/public-booking-pending.ts';
import { derivePublicBookingIntentV2, sha256Hex } from '../../shared/public-booking-intent.ts';

const LEGACY_PREFIX = 'yzt-public-booking-pending-v1:';

function secret(seed: number) {
  const bytes = new Uint8Array(32).fill(seed & 255);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function candidate(slug: string, seed: number) {
  const sampledAtEpochMs = Date.now();
  const submitDeadlineEpochSeconds = Math.floor(sampledAtEpochMs / 1000) + 300;
  const recoveryId = `80000000-0000-4000-8000-${seed.toString(16).padStart(12, '0')}`;
  const recoverySecret = secret(seed);
  const intent = await derivePublicBookingIntentV2(
    recoveryId,
    submitDeadlineEpochSeconds,
    recoverySecret,
  );
  if (!intent) throw new Error('candidate derivation failed');
  return {
    slug,
    idempotencyKey: intent.idempotencyKey,
    recoveryId,
    recoverySecret,
    requestFingerprint: await sha256Hex(`browser-payload-${seed}`),
    sampledAtEpochMs,
    expiresAtEpochMs: sampledAtEpochMs + PUBLIC_BOOKING_RECOVERY_TTL_MS,
    submitDeadlineEpochSeconds,
    settleAfterEpochMs: sampledAtEpochMs + PUBLIC_BOOKING_SETTLE_MS,
    ownerId: `browser-owner-${seed}`,
  };
}

function legacyValue(slug: string, seed: number, ageMs = 0) {
  return JSON.stringify({
    slug,
    idempotencyKey: `pub-browser-legacy-${seed}`,
    recoveryId: `70000000-0000-4000-8000-${seed.toString(16).padStart(12, '0')}`,
    recoverySecret: secret(seed),
    requestFingerprint: seed.toString(16).padStart(64, '0'),
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  });
}

function setLegacy(slug: string, raw: string) {
  sessionStorage.setItem(`${LEGACY_PREFIX}${slug}`, raw);
}

function hasLegacy(slug: string) {
  return sessionStorage.getItem(`${LEGACY_PREFIX}${slug}`) !== null;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

async function injectCorruptRecord(slug: string) {
  const databases = await indexedDB.databases();
  const metadata = databases.find((item) => item.name?.includes('public-booking-pending'));
  if (!metadata?.name) throw new Error('production IndexedDB database not found');
  const database = await requestResult(indexedDB.open(metadata.name, metadata.version));
  const storeName = database.objectStoreNames.item(0);
  if (!storeName) throw new Error('production IndexedDB store not found');
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put({
    id: `corrupt:${slug}`,
    slug: slug.toLowerCase(),
    version: 2,
    source: 'v2',
    status: 'submitting',
    recoverySecret: 'must-not-survive',
    createdAtEpochMs: Date.now(),
    updatedAtEpochMs: Date.now(),
  });
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
  database.close();
}

async function until<T>(read: () => T | null | undefined | false, description: string): Promise<T> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`UI did not show ${description}`);
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function uiSubmit() {
  const picker = await until(
    () => document.querySelector<HTMLFormElement>('.public-picker-form'),
    'booking picker',
  );
  picker.requestSubmit();
  const slot = await until(
    () => document.querySelector<HTMLButtonElement>('.public-slot'),
    'an available slot',
  );
  slot.click();
  const form = await until(
    () => document.querySelector<HTMLFormElement>('.public-customer-form'),
    'customer form',
  );
  setValue(form.elements.namedItem('customerName') as HTMLInputElement, 'Browser Customer');
  setValue(form.elements.namedItem('customerEmail') as HTMLInputElement, 'browser@example.test');
  await until(() => {
    const button = form.querySelector<HTMLButtonElement>('.public-book-button');
    return button && !button.disabled ? button : null;
  }, 'enabled booking submit');
  form.requestSubmit();
}

function clickButton(fragment: string) {
  const wanted = fragment.toLocaleLowerCase('tr-TR');
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.toLocaleLowerCase('tr-TR').includes(wanted));
  if (!button) throw new Error(`button not found: ${fragment}`);
  button.click();
  return { disabled: button.disabled, text: button.textContent };
}

const testApi = {
  candidate,
  legacyValue,
  setLegacy,
  hasLegacy,
  injectCorruptRecord,
  load: loadPublicBookingRecords,
  acquire: acquirePublicBookingIntent,
  unresolved: markPublicBookingUnresolved,
  complete: completePublicBookingIntent,
  dismiss: dismissPublicBookingRecord,
  forgetLegacy: forgetLegacyBookingRecord,
  uiSubmit,
  clickButton,
  text: () => document.body.innerText,
  buttons: () => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .map((button) => ({ text: button.textContent ?? '', disabled: button.disabled })),
  links: () => [...document.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.getAttribute('href')),
};

Object.defineProperty(window, '__s07', { value: testApi, configurable: true });

const params = new URLSearchParams(location.search);
if (params.get('mode') === 'ui') {
  const slug = params.get('slug') ?? 'browser-salon';
  createRoot(document.getElementById('root')!).render(createElement(PublicBookingPage, { slug }));
}
document.documentElement.dataset.s07Ready = 'true';
