import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { bytesToBase64Url } from '../../shared/base64.ts';
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
  return bytesToBase64Url(bytes);
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

type AbortHook = {
  add: typeof IDBObjectStore.prototype.add;
  put: typeof IDBObjectStore.prototype.put;
  database: string;
  store: string;
  slug: string;
  matched: boolean;
  abortError: string | null;
};
let abortHook: AbortHook | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

async function productionStore() {
  const metadata = (await indexedDB.databases()).find((item) => item.name?.includes('public-booking-pending'));
  if (!metadata?.name) throw new Error('production IndexedDB database not found');
  const database = await requestResult(indexedDB.open(metadata.name, metadata.version));
  const store = database.objectStoreNames.item(0);
  if (!store) throw new Error('production IndexedDB store not found');
  return { database, store };
}

async function armTransactionAbort(slug: string) {
  if (abortHook) throw new Error('transaction abort hook already armed');
  const { database, store } = await productionStore();
  abortHook = {
    add: IDBObjectStore.prototype.add,
    put: IDBObjectStore.prototype.put,
    database: database.name,
    store,
    slug: slug.toLocaleLowerCase('en-US'),
    matched: false,
    abortError: null,
  };
  database.close();
  const wrap = (original: typeof IDBObjectStore.prototype.add) => function wrapped(
    this: IDBObjectStore,
    ...args: unknown[]
  ) {
    const request = Reflect.apply(original, this, args) as IDBRequest;
    const value = args[0] as { slug?: unknown } | undefined;
    const hook = abortHook;
    if (hook && !hook.matched && this.transaction.db.name === hook.database
        && this.name === hook.store && value?.slug === hook.slug) {
      hook.matched = true;
      IDBObjectStore.prototype.add = hook.add;
      IDBObjectStore.prototype.put = hook.put;
      const transaction = this.transaction;
      request.addEventListener('success', () => {
        try { transaction.abort(); }
        catch (error) { hook.abortError = error instanceof Error ? error.message : String(error); }
      }, { once: true });
    }
    return request;
  };
  IDBObjectStore.prototype.add = wrap(abortHook.add);
  IDBObjectStore.prototype.put = wrap(abortHook.put) as typeof IDBObjectStore.prototype.put;
}

function clearTransactionAbort() {
  const hook = abortHook;
  if (!hook) return { matched: false, abortError: 'hook was not armed' };
  IDBObjectStore.prototype.add = hook.add;
  IDBObjectStore.prototype.put = hook.put;
  abortHook = null;
  return { matched: hook.matched, abortError: hook.abortError };
}

async function storedRecordCount(slug: string) {
  const { database, store } = await productionStore();
  const transaction = database.transaction(store, 'readonly');
  const values = await requestResult(transaction.objectStore(store).getAll()) as Array<{ slug?: unknown }>;
  database.close();
  return values.filter((value) => value?.slug === slug.toLocaleLowerCase('en-US')).length;
}

async function injectCorruptRecord(slug: string) {
  const { database, store } = await productionStore();
  const transaction = database.transaction(store, 'readwrite');
  transaction.objectStore(store).put({
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
  setValue(form.elements.namedItem('customerPhone') as HTMLInputElement, '05550000707');
  clickButton('WhatsApp kodu gönder');
  const code = await until(
    () => document.querySelector<HTMLInputElement>('input[aria-label="WhatsApp doğrulama kodu"]'),
    'WhatsApp OTP code input',
  );
  setValue(code, '123456');
  await until(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes('Kodu doğrula'));
    return button && !button.disabled ? button : null;
  }, 'enabled WhatsApp OTP check');
  clickButton('Kodu doğrula');
  await until(() => document.body.innerText.includes('WhatsApp doğrulandı') ? true : null, 'verified WhatsApp phone');
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
  armTransactionAbort,
  clearTransactionAbort,
  storedRecordCount,
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
  createRoot(document.getElementById('root')!).render(createElement(PublicBookingPage, {
    slug,
    informationContact: {
      businessName: 'Browser Recovery Salon',
      phone: '+905550007070',
      email: 'destek@recovery.example.test',
      kvkkNoticeText: 'S07 Chrome fixture işletmesinin yayınladığı test aydınlatma metni.',
      kvkkNoticeUrl: 'https://recovery.example.test/kvkk',
      privacyPolicyUrl: 'https://recovery.example.test/privacy',
      bookingTermsText: 'S07 Chrome fixture işletmesinin yayınladığı test randevu koşulları.',
      bookingTermsUrl: 'https://recovery.example.test/terms',
    },
  }));
}
document.documentElement.dataset.s07Ready = 'true';
