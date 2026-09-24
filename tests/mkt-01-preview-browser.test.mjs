import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createPreviewServer,
  findChrome,
  holdBrowserSlot,
  launchDebugChrome,
  pressEnter,
  pressSpace,
  pressTab,
  runChrome,
  waitFor,
  waitForServer,
} from './helpers/marketing-chrome.mjs';

holdBrowserSlot();

async function renderReducedPreview(page, url, viewport) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await page.send('Page.navigate', { url });
  await waitFor(
    () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector("#mkt-main")) && Boolean(document.querySelector(".mkt-transformation-fallback"))'),
    `Marketing preview did not render at ${viewport.width}px`,
  );
}

test('MKT-01 standalone preview renders the approved reduced-motion homepage in real Chrome', { timeout: 30_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const { server, origin } = await createPreviewServer();
  try {
    const url = `${origin}/marketing-preview.html?legacy=1&reduced=1&clean=1`;
    await waitForServer(url);
    const result = await runChrome(chromeBin, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--virtual-time-budget=3500', '--dump-dom', url,
    ]);
    assert.equal(result.status, 0, result.stderr || `Chrome exited via ${result.signal ?? 'unknown signal'}`);

    const html = result.stdout;
    for (const expected of [
      'Randevu kolay.', 'Müşteri kendi alsın.', 'Kim boş, kim dolu? Bakınca belli.',
      'Karışıklık gider, düzen kalır.', 'Bugün ne olmuş? Tek yerde.',
      'Kısa cevaplar.', 'İşin sana kalsın.', 'Giriş yap',
    ]) {
      assert.ok(html.includes(expected), `Rendered preview is missing: ${expected}`);
    }
    assert.match(html, /href="\/app"/);
    assert.match(html, /class="mkt-mobile-nav"/);
    assert.match(html, /id="nasil-calisiyor"/);
    assert.match(html, /id="donusum"/);
    assert.match(html, /id="yardim"/);
    assert.match(html, /id="kurulum"/);
    assert.doesNotMatch(html, /<aside[^>]*class="[^"]*mkt-preview-diagnostics/);
  } finally {
    await server.close();
  }
});

test('MKT-01 mobile preview has no horizontal overflow and supports keyboard navigation at 360/390', { timeout: 45_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-mobile-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/marketing-preview.html?legacy=1&clean=1`;
    await waitForServer(url);
    ({ chrome, page } = await launchDebugChrome(chromeBin, work));

    for (const viewport of [
      { width: 360, height: 800, mobile: true },
      { width: 390, height: 844, mobile: true },
    ]) {
      await renderReducedPreview(page, url, viewport);

      const metrics = await page.evaluate(`(() => {
        const root = document.documentElement;
        const mobileNav = document.querySelector('.mkt-mobile-nav');
        const desktopLinks = document.querySelector('.mkt-nav-links');
        const summary = document.querySelector('.mkt-mobile-nav summary');
        const cta = document.querySelector('.mkt-nav-cta');
        return {
          innerWidth: window.innerWidth,
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          mobileNavDisplay: mobileNav ? getComputedStyle(mobileNav).display : null,
          desktopLinksDisplay: desktopLinks ? getComputedStyle(desktopLinks).display : null,
          summaryHeight: summary ? summary.getBoundingClientRect().height : 0,
          ctaHeight: cta ? cta.getBoundingClientRect().height : 0,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
          video: Boolean(document.querySelector('video.mkt-transformation-video')),
        };
      })()`);

      assert.equal(metrics.innerWidth, viewport.width, `Unexpected CSS viewport at ${viewport.width}px`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Horizontal overflow at ${viewport.width}px: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
      assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth + 1, `Body overflow at ${viewport.width}px: ${metrics.bodyScrollWidth} > ${metrics.clientWidth}`);
      assert.notEqual(metrics.mobileNavDisplay, 'none', `Mobile menu is hidden at ${viewport.width}px`);
      assert.equal(metrics.desktopLinksDisplay, 'none', `Desktop links leak into ${viewport.width}px layout`);
      assert.ok(metrics.summaryHeight >= 44, `Mobile menu target is ${metrics.summaryHeight}px at ${viewport.width}px`);
      assert.ok(metrics.ctaHeight >= 44, `Mobile CTA target is ${metrics.ctaHeight}px at ${viewport.width}px`);
      assert.equal(metrics.reduced, true, 'Browser reduced-motion preference was not applied');
      assert.equal(metrics.fallback, true, 'Reduced-motion fallback did not render');
      assert.equal(metrics.video, false, 'Reduced-motion mode should not mount the scrub video');

      assert.equal(await page.evaluate(`(() => {
        const summary = document.querySelector('.mkt-mobile-nav summary');
        summary?.focus();
        return document.activeElement === summary;
      })()`), true, `Mobile menu summary could not receive focus at ${viewport.width}px`);

      await pressSpace(page);
      await waitFor(
        () => page.evaluate('document.querySelector(".mkt-mobile-nav")?.open === true'),
        `Keyboard Space did not open the mobile menu at ${viewport.width}px`,
      );

      const openMenu = await page.evaluate(`(() => {
        const links = [...document.querySelectorAll('.mkt-mobile-nav-panel a')];
        return {
          heights: links.map((link) => link.getBoundingClientRect().height),
          firstHref: links[0]?.getAttribute('href') ?? null,
          loginHref: links.at(-1)?.getAttribute('href') ?? null,
        };
      })()`);
      assert.ok(openMenu.heights.length >= 5, 'Mobile menu is missing expected links');
      assert.ok(openMenu.heights.every((height) => height >= 44), `A mobile menu target is below 44px at ${viewport.width}px`);
      assert.equal(openMenu.firstHref, '#nasil-calisiyor');
      assert.equal(openMenu.loginHref, '/app');

      assert.equal(await page.evaluate(`(() => {
        const link = document.querySelector('.mkt-mobile-nav-panel a[href="#nasil-calisiyor"]');
        link?.focus();
        return document.activeElement === link;
      })()`), true, `First mobile link could not receive focus at ${viewport.width}px`);

      await pressEnter(page);
      await waitFor(
        () => page.evaluate(`location.hash === '#nasil-calisiyor'
          && document.querySelector('.mkt-mobile-nav')?.open === false
          && document.activeElement === document.querySelector('.mkt-mobile-nav summary')`),
        `Keyboard navigation did not close the mobile menu and restore focus at ${viewport.width}px`,
      );
    }
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test('MKT-01 desktop preview preserves nav, layout, reduced motion, and skip-link keyboard flow at 1440px', { timeout: 35_000 }, async (t) => {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }

  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-mkt-desktop-'));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;

  try {
    const url = `${origin}/marketing-preview.html?legacy=1&clean=1`;
    await waitForServer(url);
    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await renderReducedPreview(page, url, { width: 1440, height: 900, mobile: false });

    const metrics = await page.evaluate(`(() => {
      const root = document.documentElement;
      const desktopLinks = document.querySelector('.mkt-nav-links');
      const mobileNav = document.querySelector('.mkt-mobile-nav');
      const login = document.querySelector('.mkt-nav-login');
      const cta = document.querySelector('.mkt-nav-cta');
      const skip = document.querySelector('.mkt-skip-link');
      return {
        innerWidth: window.innerWidth,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        desktopLinksDisplay: desktopLinks ? getComputedStyle(desktopLinks).display : null,
        mobileNavDisplay: mobileNav ? getComputedStyle(mobileNav).display : null,
        loginDisplay: login ? getComputedStyle(login).display : null,
        loginHref: login?.getAttribute('href') ?? null,
        ctaHeight: cta ? cta.getBoundingClientRect().height : 0,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        fallback: Boolean(document.querySelector('.mkt-transformation-fallback')),
        video: Boolean(document.querySelector('video.mkt-transformation-video')),
        skipBeforeTop: skip ? skip.getBoundingClientRect().top : null,
        initialFocusIsBody: document.activeElement === document.body,
      };
    })()`);

    assert.equal(metrics.innerWidth, 1440);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Desktop horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
    assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth + 1, `Desktop body overflow: ${metrics.bodyScrollWidth} > ${metrics.clientWidth}`);
    assert.notEqual(metrics.desktopLinksDisplay, 'none', 'Desktop navigation links are hidden');
    assert.equal(metrics.mobileNavDisplay, 'none', 'Mobile menu leaks into desktop layout');
    assert.notEqual(metrics.loginDisplay, 'none', 'Desktop login link is hidden');
    assert.equal(metrics.loginHref, '/app');
    assert.ok(metrics.ctaHeight >= 44, `Desktop CTA target is ${metrics.ctaHeight}px`);
    assert.equal(metrics.reduced, true);
    assert.equal(metrics.fallback, true);
    assert.equal(metrics.video, false);
    assert.ok(metrics.skipBeforeTop < 0, `Skip link should begin offscreen, got top=${metrics.skipBeforeTop}`);
    assert.equal(metrics.initialFocusIsBody, true, 'Desktop preview did not start with body focus');

    await pressTab(page);
    await waitFor(
      () => page.evaluate(`(() => {
        const skip = document.querySelector('.mkt-skip-link');
        if (!skip || document.activeElement !== skip) return false;
        const rect = skip.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= 900;
      })()`),
      'Keyboard Tab did not focus and reveal the skip link',
    );

    await pressEnter(page);
    await waitFor(
      () => page.evaluate(`location.hash === '#mkt-main'
        && document.activeElement === document.querySelector('#mkt-main')`),
      'Skip link did not navigate and move focus to main content',
    );

    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    await page.send('Page.navigate', { url });
    await waitFor(
      () => page.evaluate(`document.readyState === "complete"
        && Boolean(document.querySelector('.mkt-booking-scene'))
        && matchMedia('(prefers-reduced-motion: no-preference)').matches`),
      'Animated marketing preview did not become ready',
    );

    const bookingBeats = await page.evaluate(`(async () => {
      const section = document.querySelector('.mkt-booking-scene');
      const phone = document.querySelector('.mkt-booking-phone');
      const proof = document.querySelector('.mkt-booking-proof');
      const finalStep = document.querySelector('.mkt-proof-step.is-final');
      if (!section || !phone || !proof || !finalStep) return null;

      const top = window.scrollY + section.getBoundingClientRect().top;
      const range = Math.max(1, section.offsetHeight - window.innerHeight);
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const sample = async (progress) => {
        window.scrollTo(0, top + (range * progress));
        window.dispatchEvent(new Event('scroll'));
        await settle();
        const sticky = document.querySelector('.mkt-booking-sticky');
        const copy = document.querySelector('.mkt-booking-copy');
        const phoneBar = document.querySelector('.mkt-booking-phone-bar');
        const phoneRect = phone.getBoundingClientRect();
        return {
          requested: progress,
          progress: Number(section.dataset.bookingProgress ?? '-1'),
          phoneTransform: getComputedStyle(phone).transform,
          phoneOpacity: Number(getComputedStyle(phone).opacity),
          phoneCenterX: phoneRect.left + (phoneRect.width / 2),
          phoneWidth: phoneRect.width,
          phoneBarOpacity: phoneBar ? Number(getComputedStyle(phoneBar).opacity) : -1,
          copyOpacity: copy ? Number(getComputedStyle(copy).opacity) : -1,
          proofTransform: getComputedStyle(proof).transform,
          finalOpacity: Number(getComputedStyle(finalStep).opacity),
          overlayOpacity: sticky ? Number(getComputedStyle(sticky, '::before').opacity) : -1,
        };
      };

      return {
        enter: await sample(0.18),
        flow: await sample(0.52),
        zoom: await sample(0.78),
        exit: await sample(0.95),
      };
    })()`);

    assert.ok(bookingBeats, 'Booking scroll scene could not be sampled');
    for (const beat of Object.values(bookingBeats)) {
      assert.ok(Math.abs(beat.progress - beat.requested) < 0.03,
        `Booking progress drifted: requested ${beat.requested}, got ${beat.progress}`);
    }
    assert.notEqual(bookingBeats.enter.phoneTransform, bookingBeats.flow.phoneTransform,
      'Phone did not settle from its entry pose');
    assert.ok(bookingBeats.flow.finalOpacity > bookingBeats.enter.finalOpacity,
      'Booking steps did not reveal as scroll advanced');
    assert.ok(bookingBeats.flow.phoneCenterX > 800,
      `Phone should hold on the right while copy is readable, got center ${bookingBeats.flow.phoneCenterX}`);
    assert.ok(bookingBeats.zoom.phoneCenterX < bookingBeats.flow.phoneCenterX - 40,
      `Phone did not travel toward center for screen focus: flow ${bookingBeats.flow.phoneCenterX}, zoom ${bookingBeats.zoom.phoneCenterX}`);
    assert.ok(bookingBeats.zoom.phoneWidth > bookingBeats.flow.phoneWidth * 1.5,
      `Phone zoom is too weak: flow ${bookingBeats.flow.phoneWidth}, zoom ${bookingBeats.zoom.phoneWidth}`);
    assert.ok(bookingBeats.zoom.copyOpacity < bookingBeats.flow.copyOpacity,
      'Copy did not yield to the focused phone screen');
    assert.ok(bookingBeats.zoom.phoneBarOpacity < bookingBeats.flow.phoneBarOpacity,
      'Phone chrome did not recede during the screen-focus beat');
    assert.notEqual(bookingBeats.flow.proofTransform, bookingBeats.zoom.proofTransform,
      'Phone screen did not refocus during the zoom beat');
    assert.ok(bookingBeats.exit.overlayOpacity > 0.65,
      `Full-bleed cobalt transition is too faint: ${bookingBeats.exit.overlayOpacity}`);
    assert.ok(bookingBeats.exit.phoneOpacity < 0.7,
      `Phone did not begin clearing for the next scene: ${bookingBeats.exit.phoneOpacity}`);
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
