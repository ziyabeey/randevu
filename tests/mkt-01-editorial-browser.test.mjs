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
  waitFor,
  waitForServer,
} from './helpers/marketing-chrome.mjs';

// The editorial homepage ("Bir salonun günü", 2026-09-24) in real Chrome:
// the same accessibility floor the legacy page was held to, plus its film.
holdBrowserSlot();

async function withPreview(t, name, run) {
  const chromeBin = findChrome();
  if (!chromeBin) {
    t.skip('Chrome/Chromium is unavailable in this environment');
    return;
  }
  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), `randevu-mkt-editorial-${name}-`));
  const { server, origin } = await createPreviewServer();
  let chrome;
  let page;
  try {
    await waitForServer(`${origin}/marketing-preview.html?clean=1`);
    ({ chrome, page } = await launchDebugChrome(chromeBin, work));
    await run(page, origin);
  } finally {
    page?.close();
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

async function renderEditorial(page, url, viewport, reduced) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
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
    () => page.evaluate('document.readyState === "complete" && Boolean(document.querySelector(".ed-root #ed-main"))'),
    `Editorial preview did not render at ${viewport.width}px`,
  );
}

test('MKT-01 editorial page keeps the approved story, nav, skip link and a static salon in reduced motion at 1440px', { timeout: 45_000 }, async (t) => {
  await withPreview(t, 'desktop', async (page, origin) => {
    await renderEditorial(page, `${origin}/marketing-preview.html?clean=1`, { width: 1440, height: 900, mobile: false }, true);

    const metrics = await page.evaluate(`(() => {
      const root = document.documentElement;
      const text = document.querySelector('.ed-root').textContent.replace(/\\s+/g, ' ');
      const links = document.querySelector('.ed-links');
      const login = document.querySelector('.ed-login');
      const cta = document.querySelector('.ed-nav .ed-cta');
      const skip = document.querySelector('.ed-skip');
      return {
        text,
        ids: ['acilis', 'nasil-calisiyor', 'isletmen-icin', 'donusum', 'gun-sonu', 'kurulum', 'yardim'].filter((id) => document.getElementById(id)),
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        linksDisplay: links ? getComputedStyle(links).display : null,
        loginDisplay: login ? getComputedStyle(login).display : null,
        loginHref: login?.getAttribute('href') ?? null,
        ctaHeight: cta ? cta.getBoundingClientRect().height : 0,
        skipTop: skip ? skip.getBoundingClientRect().top : null,
        still: Boolean(document.querySelector('#donusum .ed-salon-still')),
        canvas: Boolean(document.querySelector('#donusum canvas')),
        journey: document.querySelector('.ed-root').dataset.journey ?? null,
        shutter: Boolean(document.querySelector('.ed-shutter--opening')),
      };
    })()`);

    for (const copy of [
      'Randevu kolay.', 'Müşteri kendi alsın.', 'Kim boş, kim dolu? Bakınca belli.',
      'Bugün ne olmuş? Tek yerde.', 'İşin sana kalsın.', 'Kısa cevaplar.', 'Giriş yap',
    ]) assert.ok(metrics.text.includes(copy), `Editorial page is missing: ${copy}`);
    assert.deepEqual(metrics.ids, ['acilis', 'nasil-calisiyor', 'isletmen-icin', 'donusum', 'gun-sonu', 'kurulum', 'yardim']);
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
    assert.notEqual(metrics.linksDisplay, 'none', 'Section links are hidden at 1440px');
    assert.notEqual(metrics.loginDisplay, 'none', 'Login link is hidden at 1440px');
    assert.equal(metrics.loginHref, '/app');
    assert.ok(metrics.ctaHeight >= 44, `Nav CTA target is ${metrics.ctaHeight}px`);
    assert.ok(metrics.skipTop < 0, `Skip link should start off screen, got ${metrics.skipTop}`);
    assert.equal(metrics.still, true, 'Reduced motion should show the salon still');
    assert.equal(metrics.canvas, false, 'Reduced motion should not mount the film canvas');
    assert.equal(metrics.journey, null, 'Reduced motion should not run the travelling token');
    assert.equal(metrics.shutter, false, 'Reduced motion should skip the opening shutter');

    await pressTab(page);
    await waitFor(
      () => page.evaluate(`(() => {
        const skip = document.querySelector('.ed-skip');
        if (document.activeElement !== skip) return false;
        const rect = skip.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= 900;
      })()`),
      'Tab did not focus and reveal the skip link',
    );
    await pressEnter(page);
    await waitFor(
      () => page.evaluate(`location.hash === '#ed-main' && document.activeElement === document.querySelector('#ed-main')`),
      'Skip link did not move focus to the main content',
    );
  });
});

test('MKT-01 editorial page has no overflow and a keyboard-operable menu at 360/390px', { timeout: 60_000 }, async (t) => {
  await withPreview(t, 'mobile', async (page, origin) => {
    for (const viewport of [{ width: 360, height: 800, mobile: true }, { width: 390, height: 844, mobile: true }]) {
      await renderEditorial(page, `${origin}/marketing-preview.html?clean=1`, viewport, true);

      const metrics = await page.evaluate(`(() => {
        const root = document.documentElement;
        const button = document.querySelector('.ed-menu-button');
        const links = document.querySelector('.ed-links');
        return {
          innerWidth,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          buttonDisplay: button ? getComputedStyle(button).display : null,
          buttonHeight: button ? button.getBoundingClientRect().height : 0,
          linksDisplay: links ? getComputedStyle(links).display : null,
        };
      })()`);
      assert.equal(metrics.innerWidth, viewport.width);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `Horizontal overflow at ${viewport.width}px: ${metrics.scrollWidth}`);
      assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth + 1, `Body overflow at ${viewport.width}px: ${metrics.bodyScrollWidth}`);
      assert.notEqual(metrics.buttonDisplay, 'none', `Menu button hidden at ${viewport.width}px`);
      assert.equal(metrics.linksDisplay, 'none', `Section links leak into ${viewport.width}px`);
      assert.ok(metrics.buttonHeight >= 44, `Menu button target is ${metrics.buttonHeight}px at ${viewport.width}px`);

      assert.equal(await page.evaluate(`(() => { const b = document.querySelector('.ed-menu-button'); b.focus(); return document.activeElement === b; })()`), true);
      await pressSpace(page);
      await waitFor(
        () => page.evaluate(`document.querySelector('.ed-menu')?.dataset.open === 'true'
          && document.activeElement === document.querySelector('.ed-menu a')`),
        `Space did not open the menu and move focus into it at ${viewport.width}px`,
      );

      const menu = await page.evaluate(`(() => {
        const links = [...document.querySelectorAll('.ed-menu a')];
        return {
          heights: links.map((link) => link.getBoundingClientRect().height),
          first: links[0]?.getAttribute('href'),
          last: links.at(-1)?.getAttribute('href'),
          ring: getComputedStyle(document.activeElement).outlineStyle,
          kolay: document.querySelector('.ed-wordmark em').getBoundingClientRect().width,
        };
      })()`);
      assert.equal(menu.ring, 'solid', `Focused menu link has no visible ring at ${viewport.width}px`);
      assert.ok(menu.kolay > 20, 'The open menu covers the hero, so its wordmark should carry "kolay"');
      assert.ok(menu.heights.length >= 5, 'Menu is missing links');
      assert.ok(menu.heights.every((height) => height >= 44), `A menu target is below 44px at ${viewport.width}px: ${menu.heights.join(',')}`);
      assert.equal(menu.first, '#nasil-calisiyor');
      assert.equal(menu.last, '/app');

      await pressEnter(page);
      await waitFor(
        () => page.evaluate(`location.hash === '#nasil-calisiyor'
          && document.querySelector('.ed-menu')?.dataset.open === 'false'
          && document.activeElement === document.querySelector('.ed-menu-button')`),
        `Menu link did not navigate, close the menu and return focus at ${viewport.width}px`,
      );
    }
  });
});

test('MKT-01 editorial salon film draws frames and keeps one "kolay" on screen', { timeout: 60_000 }, async (t) => {
  await withPreview(t, 'film', async (page, origin) => {
    await renderEditorial(page, `${origin}/marketing-preview.html?clean=1`, { width: 1440, height: 900, mobile: false }, false);
    await page.evaluate(`window.dispatchEvent(new WheelEvent('wheel'))`);
    await waitFor(() => page.evaluate(`!document.querySelector('.ed-shutter--opening')`), 'Opening shutter did not lift', 8_000);
    await waitFor(() => page.evaluate(`document.querySelector('.ed-root').dataset.navKolay === 'off'`), 'Hero "kolay" should hide the nav "kolay"');

    const scrollTo = (expression) => page.evaluate(`(async () => {
      window.scrollTo(0, ${expression});
      await new Promise((resolve) => setTimeout(resolve, 900));
      const salon = document.querySelector('#donusum');
      return {
        nav: document.querySelector('.ed-root').dataset.navKolay,
        phase: salon.dataset.phase,
        frame: Number(salon.dataset.frameIndex ?? '-1'),
        requests: Number(salon.dataset.frameRequestCount ?? '0'),
        failures: Number(salon.dataset.frameFailureCount ?? '0'),
        canvas: Boolean(salon.querySelector('canvas')),
      };
    })()`);

    const q = (selector) => `(document.querySelector('${selector}').getBoundingClientRect().top + scrollY)`;
    const booking = await scrollTo(`${q('#nasil-calisiyor')} + 600`);
    assert.equal(booking.nav, 'on', 'Nav should carry "kolay" when no other one is on screen');

    const salonRange = `(document.querySelector('#donusum').offsetHeight - innerHeight)`;
    const start = await scrollTo(`${q('#donusum')} + ${salonRange} * 0.2`);
    assert.equal(start.canvas, true, 'Salon film canvas did not mount');
    await waitFor(async () => (await scrollTo(`${q('#donusum')} + ${salonRange} * 0.25`)).frame >= 0, 'Salon film drew no frame', 15_000);

    const late = await scrollTo(`${q('#donusum')} + ${salonRange} * 0.9`);
    assert.equal(late.phase, 'pricing');
    // The shown time glides toward the scroll position; wait for it to arrive.
    await waitFor(
      () => page.evaluate(`Number(document.querySelector('#donusum').dataset.frameIndex ?? '-1') > 100`),
      'Late salon frame did not reach the dusk end of the film',
    );
    assert.ok(late.requests > 0, 'Salon film fetched no frames');
    assert.equal(late.failures, 0, 'Salon film reported failures');
    assert.equal(late.nav, 'off', 'Pricing beat "kolay" should hide the nav "kolay"');
  });
});

test('MKT-01 editorial journey token glides between waypoints without teleporting or going blank', { timeout: 90_000 }, async (t) => {
  await withPreview(t, 'journey', async (page, origin) => {
    await renderEditorial(page, `${origin}/marketing-preview.html?clean=1`, { width: 1440, height: 900, mobile: false }, false);
    await page.evaluate(`window.dispatchEvent(new WheelEvent('wheel'))`);
    await waitFor(() => page.evaluate(`!document.querySelector('.ed-shutter--opening')`), 'Opening shutter did not lift', 8_000);
    await page.evaluate(`(() => {
      window.__journey = [];
      const token = document.querySelector('.ed-token');
      const record = () => {
        const rect = token.getBoundingClientRect();
        const faces = [...token.querySelectorAll('[data-layer]')].map((layer) => Number(layer.style.opacity || 0));
        window.__journey.push({ at: token.dataset.at, x: rect.left, y: rect.top, w: rect.width, h: rect.height, opacity: Number(token.style.opacity || 1), face: Math.max(...faces) });
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    })()`);

    // Wheel notches through the hero, the phone's three states and into the calendar.
    const end = await page.evaluate(`document.querySelector('#isletmen-icin').getBoundingClientRect().top + scrollY + innerHeight`);
    for (let notch = 0; notch < 120; notch += 1) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: 100 });
      await new Promise((resolve) => setTimeout(resolve, 110));
      if (await page.evaluate('scrollY') >= end) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));

    const frames = await page.evaluate('window.__journey');
    const seen = new Set(frames.map((frame) => frame.at));
    for (const flight of ['word-service', 'service-slot', 'slot-done', 'done-block']) {
      assert.ok(seen.has(flight), `The token never flew ${flight}`);
    }
    let jump = 0;
    let fade = 0;
    let blank = 1;
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (Math.max(a.opacity, b.opacity) < 0.2) continue;
      const moved = Math.hypot(b.x - a.x, b.y - a.y);
      jump = Math.max(jump, moved);
      // Fades follow travel; a token that barely moved must not blink.
      if (moved < 40) fade = Math.max(fade, Math.abs(b.opacity - a.opacity));
      if (b.opacity > 0.5 && b.at.includes('-')) blank = Math.min(blank, b.face);
    }
    // A wheel notch moves the page 100px in one frame here; the token may follow the page, never outrun it.
    assert.ok(jump <= 150, `Token jumped ${Math.round(jump)}px in one frame`);
    assert.ok(fade <= 0.5, `Token opacity snapped by ${fade.toFixed(2)} while it barely moved`);
    assert.ok(blank >= 0.5, `Token went blank mid-flight (strongest face ${blank.toFixed(2)})`);
  });
});
