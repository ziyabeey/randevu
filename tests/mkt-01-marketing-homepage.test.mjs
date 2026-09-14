import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const hero = read('src/marketing/MarketingHero.tsx');
const home = read('src/marketing/MarketingHome.tsx');
const productStories = read('src/marketing/ProductStorySections.tsx');
const transformation = read('src/marketing/transformation/TransformationSection.tsx');
const scrubHook = read('src/marketing/transformation/useVideoScrollScrub.ts');
const releaseGates = read('src/marketing/releaseGates.ts');
const previewEntry = read('src/marketing/preview-entry.tsx');
const previewHtml = read('marketing-preview.html');
const marketingCopy = `${hero}\n${home}\n${productStories}\n${transformation}`;

test('MKT-01 keeps the approved homepage story spine', () => {
  for (const copy of [
    'Randevu kolay.',
    'Müşteri kendi alsın.',
    'Kim boş, kim dolu? Bakınca belli.',
    'Uğraş?',
    'Sen uğraşma.',
    'Fiyatı da kolay olsun.',
    'Bugün ne olmuş? Tek yerde.',
    'Randevu kolay.<br />İşin sana kalsın.',
  ]) {
    assert.ok(marketingCopy.includes(copy), `Missing approved marketing copy: ${copy}`);
  }

  assert.match(home, /href="#nasil-calisiyor"/);
  assert.match(productStories, /id="nasil-calisiyor"/);
  assert.match(productStories, /id="isletmen-icin"/);
  assert.match(productStories, /id="yardim"/);
  assert.match(home, /id="kurulum"/);
  assert.match(home, /<details className="mkt-mobile-nav">/);
  assert.match(home, /<summary aria-label="Randevu menüsünü aç">/);
});

test('MKT-01 publish gates stay explicit and fail closed where policy is not ready', () => {
  for (const gate of [
    'publicBooking: true',
    'calendarAvailability: true',
    'reminders: true',
    'onboardingAssistance: true',
    'dailyAppointmentSummary: true',
    'customerMemory: true',
  ]) {
    assert.ok(releaseGates.includes(gate), `Expected released gate: ${gate}`);
  }

  assert.match(releaseGates, /MARKETING_CONTACT_HREF:\s*string \| null = null/);
  assert.match(releaseGates, /pricingPolicy:\s*false/);
  assert.match(releaseGates, /pilotProof:\s*false/);
  assert.match(releaseGates, /contactFlow:\s*MARKETING_CONTACT_HREF !== null/);
});

test('MKT-01 does not publish fake pricing, finance claims, or fabricated social proof', () => {
  assert.doesNotMatch(marketingCopy, /₺\s*\d/i);
  assert.doesNotMatch(marketingCopy, /\b\d{2,6}\s*TL\b/i);
  assert.doesNotMatch(marketingCopy, /\b(adisyon|tahsilat|stok|kasa|prim)\b/i);

  assert.match(productStories, /Gerçek işletme sonuçları geldikçe/);
  assert.match(transformation, /Fiyat ve paket yapısı yayın öncesi ticari kararla netleşecek/);
});

test('MKT-01 motion remains scroll-owned, bounded, and non-autoplay', () => {
  assert.match(scrubHook, /video\.currentTime/);
  assert.match(scrubHook, /requestAnimationFrame/);
  assert.match(scrubHook, /IntersectionObserver/);
  assert.match(scrubHook, /video\.preload = "auto"/);
  assert.doesNotMatch(scrubHook, /video\.play\s*\(/);

  assert.match(transformation, /muted/);
  assert.match(transformation, /playsInline/);
  assert.match(transformation, /preload="metadata"/);
  assert.match(transformation, /randevu-transformation-final\.webp/);
});

test('MKT-01 standalone preview exposes diagnostic, clean, and reduced-motion modes', () => {
  assert.match(previewHtml, /src\/marketing\/preview-entry\.tsx/);
  assert.match(previewEntry, /get\("reduced"\) === "1"/);
  assert.match(previewEntry, /get\("clean"\) === "1"/);
  assert.match(previewEntry, /randevu-transformation-master\.mp4/);
  assert.match(previewEntry, /randevu-transformation-final\.webp/);
  assert.match(previewEntry, /asset eksik/);
});
