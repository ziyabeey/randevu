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
const marketingCss = read('src/marketing/marketing.css');
const mobileNavCss = read('src/marketing/mobile-nav.css');
const marketingPolishCss = read('src/marketing/marketing-polish.css');
const transformation = read('src/marketing/transformation/TransformationSection.tsx');
const transformationTuning = read('src/marketing/transformation/transformation-tuning.css');
const bookingScrollCss = read('src/marketing/booking-scroll.css');
const bookingScrollHook = read('src/marketing/useScrollScene.ts');
const scrubHook = read('src/marketing/transformation/useVideoScrollScrub.ts');
const releaseGates = read('src/marketing/releaseGates.ts');
const assets = read('src/marketing/assets.ts');
const assetContract = read('src/marketing/asset-contract.ts');
const documentMeta = read('src/marketing/useMarketingDocumentMeta.ts');
const domainContract = read('src/marketing/domainContract.ts');
const previewEntry = read('src/marketing/preview-entry.tsx');
const previewModes = read('src/marketing/previewModes.ts');
const previewHtml = read('marketing-preview.html');
const marketingCopy = `${hero}\n${home}\n${productStories}\n${transformation}`;
const timeline = await import('../src/marketing/transformation/timeline.ts');

function cssHexToken(name) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(marketingCss);
  assert.ok(match, `Missing CSS color token --${name}`);
  return match[1];
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

test('MKT-01 keeps the approved homepage story spine and navigation contract', () => {
  for (const copy of [
    'Randevu kolay.',
    'Müşteri kendi alsın.',
    'Kim boş, kim dolu? Bakınca belli.',
    'Uğraş?',
    'Sen uğraşma.',
    'Fiyatı da kolay olsun.',
    'Bugün ne olmuş? Tek yerde.',
    'Randevu kolay.<br />İşin sana kalsın.',
  ]) assert.ok(marketingCopy.includes(copy), `Missing approved marketing copy: ${copy}`);

  assert.match(home, /href="#nasil-calisiyor"/);
  assert.match(productStories, /id="nasil-calisiyor"/);
  assert.match(productStories, /id="isletmen-icin"/);
  assert.match(productStories, /id="yardim"/);
  assert.match(home, /id="kurulum"/);
  assert.match(home, /<details className="mkt-mobile-nav"[^>]*>/);
  assert.match(home, /<summary aria-label="Randevu menüsü">/);
  assert.match(home, /className="mkt-nav-login" href=\{WORKSPACE_HOME_PATH\}>Giriş yap/);
  assert.match(home, /href=\{WORKSPACE_HOME_PATH\} onClick=\{closeMobileMenu\}>Giriş yap/);
  assert.match(home, /handleMobileSectionClick\(event, "#nasil-calisiyor"\)/);
  assert.match(home, /window\.history\.pushState\(null, "", targetHash\)/);
  assert.match(home, /focus\(\{ preventScroll: true \}\)/);
  assert.match(home, /<main id="mkt-main" tabIndex=\{-1\}>/);
  assert.match(home, /onClick=\{handleSkipToContent\}/);
  assert.match(mobileNavCss, /\.mkt-mobile-nav summary \{[\s\S]*?min-height:\s*44px/);
  assert.match(mobileNavCss, /\.mkt-mobile-nav-panel a \{[\s\S]*?min-height:\s*44px/);
  assert.match(mobileNavCss, /\.mkt-nav-actions \.mkt-nav-cta \{[\s\S]*?min-height:\s*44px/);
  assert.match(marketingPolishCss, /\.mkt-skip-link:focus,[\s\S]*?\.mkt-skip-link:focus-visible/);
});

test('MKT-01 booking demo uses a scroll-owned phone scene with a reduced-motion escape hatch', () => {
  assert.match(home, /import "\.\/booking-scroll\.css"/);
  assert.match(productStories, /useScrollScene\(bookingSectionRef/);
  assert.match(productStories, /className="mkt-booking-sticky"/);
  assert.match(productStories, /className="mkt-booking-phone"/);
  assert.match(productStories, /className="mkt-booking-proof" aria-label="Online rezervasyon akışı örneği"/);
  assert.match(bookingScrollHook, /requestAnimationFrame/);
  assert.match(bookingScrollHook, /typeof ResizeObserver === "undefined"/);
  assert.match(bookingScrollHook, /visualViewport\?\.addEventListener\("resize"/);
  assert.match(bookingScrollCss, /--mkt-booking-progress/);
  assert.match(bookingScrollCss, /--mkt-booking-enter/);
  assert.match(bookingScrollCss, /--mkt-booking-flow/);
  assert.match(bookingScrollCss, /--mkt-booking-zoom/);
  assert.match(bookingScrollCss, /--mkt-booking-exit/);
  assert.match(bookingScrollCss, /height:\s*250svh/);
  assert.match(bookingScrollCss, /position:\s*sticky/);
  assert.match(bookingScrollCss, /\.mkt-booking-sticky::before[\s\S]*?background:\s*var\(--mkt-cobalt\)/);
  assert.match(bookingScrollCss, /scroll-margin-top:\s*0/);
  assert.match(bookingScrollCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.mkt-booking-sticky::before[\s\S]*?display:\s*none/);
  assert.match(marketingPolishCss, /\.mkt-product-story:not\(\.mkt-booking-scene\)/);
  assert.match(bookingScrollCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('MKT-DOMAIN-01 keeps Randevu Kolay outward while separating public and private origins', () => {
  assert.match(domainContract, /MARKETING_ORIGIN = "https:\/\/randevukolay\.net"/);
  assert.match(domainContract, /PRIVATE_OPERATOR_APP_ORIGIN = "https:\/\/randevu\.kepenk\.ai"/);
  assert.match(domainContract, /PUBLIC_TENANT_ORIGIN_PATTERN = "https:\/\/\{business-slug\}\.randevukolay\.net"/);
  assert.match(domainContract, /LOCAL_PREVIEW_OPERATOR_PATH = "\/app"/);
  assert.doesNotMatch(domainContract, /app\.randevukolay\.net/);

  assert.match(hero, />Randevu Kolay<\/p>/);
  assert.match(home, /<strong>Randevu Kolay<\/strong>/);
  assert.match(home, /<span>randevukolay\.net<\/span>/);
  assert.match(transformation, />Randevu Kolay<\/p>/);
  assert.doesNotMatch(marketingCopy, /Kepenk\.ai sunar/);
  assert.doesNotMatch(home, /Kepenk\.ai ürünü/);
});

test('MKT-01 brand text color pairs keep WCAG AA contrast', () => {
  const pairs = [
    [cssHexToken('mkt-cobalt-deep'), '#ffffff', 7],
    [cssHexToken('mkt-lime'), cssHexToken('mkt-cobalt-deep'), 7],
    [cssHexToken('mkt-cobalt'), '#ffffff', 4.5],
    [cssHexToken('mkt-ink'), cssHexToken('mkt-cream'), 7],
  ];

  for (const [foreground, background, minimum] of pairs) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= minimum, `${foreground} on ${background} contrast ${ratio.toFixed(2)} is below ${minimum}:1`);
  }
});

test('MKT-01 hero exposes its LCP media as a priority image', () => {
  assert.match(hero, /<img/);
  assert.match(hero, /src=\{MARKETING_ASSETS\.heroModel\}/);
  assert.match(hero, /loading="eager"/);
  assert.match(hero, /fetchPriority="high"/);
  assert.match(hero, /decoding="async"/);
  assert.match(hero, /width=\{1928\}/);
  assert.match(hero, /height=\{1072\}/);
});

test('MKT-DOMAIN-01 production metadata uses the public marketing origin while preview stays noindex', () => {
  assert.match(home, /useMarketingDocumentMeta\(\)/);
  assert.match(documentMeta, /Randevu kolay\. \| Randevu Kolay/);
  assert.match(documentMeta, /MARKETING_ORIGIN/);
  assert.match(documentMeta, /randevu-hero-model\.webp/);
  assert.match(documentMeta, /siteName: "Randevu Kolay"/);
  assert.match(documentMeta, /tr_TR/);
  assert.match(documentMeta, /og:title/);
  assert.match(documentMeta, /og:description/);
  assert.match(documentMeta, /og:type/);
  assert.match(documentMeta, /og:url/);
  assert.match(documentMeta, /og:image/);
  assert.match(documentMeta, /og:image:alt/);
  assert.match(documentMeta, /twitter:card/);
  assert.match(documentMeta, /summary_large_image/);
  assert.match(documentMeta, /twitter:image/);
  assert.match(previewHtml, /name="robots" content="noindex,nofollow"/);
});

test('MKT-01 publish gates stay explicit and fail closed where policy or acceptance is not ready', () => {
  for (const gate of [
    'publicBooking: true',
    'calendarAvailability: true',
    'onboardingAssistance: true',
    'dailyAppointmentSummary: true',
    'customerMemory: true',
  ]) assert.ok(releaseGates.includes(gate), `Expected released gate: ${gate}`);

  assert.match(releaseGates, /reminders:\s*false/);
  assert.match(releaseGates, /MARKETING_CONTACT_HREF:\s*string \| null = null/);
  assert.match(releaseGates, /pricingPolicy:\s*false/);
  assert.match(releaseGates, /pilotProof:\s*false/);
  assert.match(releaseGates, /contactFlow:\s*MARKETING_CONTACT_HREF !== null/);
  assert.match(transformation, /Müşteri detayları da sırada\./);
  assert.match(transformation, /kabul süreci tamamlandığında burada gerçek ürün kanıtını göstereceğiz\./);
  assert.match(transformation, /Hatırlatma akışı hazırlanıyor\./);
  assert.match(transformation, /Yayına girdiğinde burada gerçek akışı göstereceğiz\./);
  assert.match(transformation, /Müşteri detayları ve hatırlatma akışları hazır olduğunda burada gerçek ürün kanıtıyla gösterelim\./);
  // Released customer memory must not leave the reduced-motion fallback promising it as upcoming.
  assert.match(transformation, /MARKETING_RELEASE_GATES\.customerMemory\s*\?\s*"Müşteri kendi alsın\. Son randevusu ve notu bir yerde dursun\. Hatırlatma akışı hazır olduğunda/);
});

test('MKT-01 prelaunch pricing and contact states are explicit instead of dead or misleading controls', () => {
  assert.match(transformation, /Fiyatlandırma yakında/);
  assert.match(transformation, /Paket yapısı netleştiğinde fiyatı burada açıkça göstereceğiz\./);
  assert.match(transformation, /Fiyat politikası netleşiyor\./);
  assert.doesNotMatch(transformation, /Ne alacağını, ne ödeyeceğini ilk bakışta gör\./);

  assert.match(home, /data-contact-flow-ready=\{contactReady \? "true" : "false"\}/);
  assert.match(home, /Birlikte kurulum yakında açılıyor\./);
  assert.match(home, /İletişim kanalı yayın entegrasyonuyla birlikte aktif olacak\./);
  assert.doesNotMatch(home, /<button[\s\S]*?disabled/);
});

test('MKT-01 does not publish fake pricing, finance claims, or fabricated social proof', () => {
  assert.doesNotMatch(marketingCopy, /₺\s*\d/i);
  assert.doesNotMatch(marketingCopy, /\b\d{2,6}\s*TL\b/i);
  assert.doesNotMatch(marketingCopy, /\b(adisyon|tahsilat|stok|kasa|prim)\b/i);
  assert.match(productStories, /Gerçek işletme sonuçları geldikçe/);
  assert.match(transformation, /Fiyat ve paket yapısı yayın öncesi ticari kararla netleşecek/);
});

test('MKT-01 timeline follows the real Kling beats and keeps local progress bounded', () => {
  const { TRANSFORMATION_PHASES, clamp01, getTransformationPhase, getTransformationPhaseProgress } = timeline;
  const epsilon = 1e-6;
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(getTransformationPhase(-1), 'reminder');
  assert.equal(getTransformationPhase(TRANSFORMATION_PHASES.reminder.end - epsilon), 'reminder');
  assert.equal(getTransformationPhase(TRANSFORMATION_PHASES.reminder.end), 'friction');
  assert.equal(getTransformationPhase(TRANSFORMATION_PHASES.friction.end), 'sweep');
  assert.equal(getTransformationPhase(TRANSFORMATION_PHASES.sweep.end), 'pricing');
  assert.equal(getTransformationPhase(2), 'pricing');
  assert.equal(getTransformationPhaseProgress(TRANSFORMATION_PHASES.sweep.start, 'sweep'), 0);
  assert.equal(getTransformationPhaseProgress(TRANSFORMATION_PHASES.sweep.end, 'sweep'), 1);
  const sweepMid = (TRANSFORMATION_PHASES.sweep.start + TRANSFORMATION_PHASES.sweep.end) / 2;
  assert.ok(Math.abs(getTransformationPhaseProgress(sweepMid, 'sweep') - 0.5) < epsilon);
});

test('MKT-01 motion remains scroll-owned, bounded, non-autoplay, and hides inactive CTA from tab order', () => {
  assert.match(scrubHook, /video\.currentTime/);
  assert.match(scrubHook, /requestAnimationFrame/);
  assert.match(scrubHook, /IntersectionObserver/);
  assert.match(scrubHook, /video\.preload = "auto"/);
  assert.doesNotMatch(scrubHook, /video\.play\s*\(/);
  assert.match(transformation, /muted/);
  assert.match(transformation, /playsInline/);
  assert.match(transformation, /preload="metadata"/);
  assert.match(transformation, /MARKETING_ASSETS\.transformationMobileVideo/);
  assert.match(transformation, /media="\(max-width: 680px\)"/);
  assert.match(transformation, /MARKETING_ASSETS\.transformationVideo/);
  assert.match(transformation, /MARKETING_ASSETS\.transformationPoster/);
  assert.match(transformation, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(transformationTuning, /randevu-transformation-final\.webp/);
});

test('MKT-01 canonical asset manifest and hash contract contain every required binary handoff', () => {
  const requiredAssets = [
    'randevu-hero-model.webp',
    'randevu-transformation-master.mp4',
    'randevu-transformation-mobile.mp4',
    'randevu-transformation-poster.webp',
    'randevu-transformation-final.webp',
  ];
  for (const asset of requiredAssets) {
    assert.ok(assets.includes(asset), `Missing marketing asset manifest entry: ${asset}`);
  }

  assert.match(assetContract, /MARKETING_ASSETS\.transformationVideo/);
  assert.match(assetContract, /MARKETING_ASSETS\.transformationMobileVideo/);
  assert.match(assetContract, /f4984cc62143e744ee5bffd378a00eee0efdae909d6170d5a9210465b1873bc3/);
  assert.match(assetContract, /MARKETING_ASSETS\.transformationPoster/);
  assert.match(assetContract, /MARKETING_ASSETS\.transformationFinal/);
  assert.match(assetContract, /MARKETING_ASSETS\.heroModel/);
  assert.match(previewEntry, /MARKETING_PREVIEW_ASSETS/);
  assert.match(transformation, /MARKETING_ASSETS/);
});

test('MKT-01 standalone preview exposes diagnostic, clean, debug, and reduced-motion modes', () => {
  assert.match(previewHtml, /src\/marketing\/preview-entry\.tsx/);
  assert.match(previewEntry, /readMarketingPreviewMode/);
  assert.match(previewEntry, /asset eksik/);
  assert.match(previewModes, /params\.get\("reduced"\) === "1"/);
  assert.match(previewModes, /params\.get\("clean"\) === "1"/);
  assert.match(previewModes, /params\.get\("debug"\) === "1"/);
});
