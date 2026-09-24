#!/usr/bin/env node
// Rakip sitelerinin pazarlama metnini Chromium ile açıp çıkarır (siteler JS ile çiziliyor).
// Çıktı: rakip/sayfalar/<rakip>.json — bizim.json ile aynı biçim.
//
//   node rakip/collect.mjs [--only=SalonJet] [--url=https://… (tek sayfa denemesi)]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values: args } = parseArgs({ options: { only: { type: 'string' }, url: { type: 'string' } } });
const here = new URL('.', import.meta.url);
const { rakipler } = JSON.parse(readFileSync(new URL('siteler.json', here), 'utf8'));
const targets = args.url ? [{ ad: 'deneme', urls: [args.url] }] : rakipler.filter((r) => !args.only || r.ad === args.only);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
});
const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 900 } });

function extract() {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const text = (el) => (el.innerText ?? '').replace(/\s+/g, ' ').trim();
  const uniq = (list, max) => [...new Set(list.filter(Boolean))].slice(0, max);
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() ?? '';
  const h1s = [...document.querySelectorAll('h1')].filter(visible).map(text);
  let heroAlt = '';
  const h1 = [...document.querySelectorAll('h1')].find(visible);
  if (h1) {
    let node = h1.nextElementSibling;
    for (let i = 0; node && i < 4 && heroAlt.length < 300; i += 1, node = node.nextElementSibling) {
      if (/^H[1-3]$/.test(node.tagName)) break;
      heroAlt += ` ${text(node)}`;
    }
    heroAlt = heroAlt.trim();
    // Başlık bir sarmalayıcının içindeyse kardeşi olmayabilir; sarmalayıcının kalan metnini al.
    for (let parent = h1.parentElement, i = 0; !heroAlt && parent && i < 3; parent = parent.parentElement, i += 1) {
      heroAlt = text(parent).replace(text(h1), '').trim();
    }
    heroAlt = heroAlt.slice(0, 400);
  }
  const headings = [...document.querySelectorAll('h2, h3')].filter(visible).map(text).filter((t) => t.length > 2 && t.length < 160);
  const ctas = [...document.querySelectorAll('button, a[role=button], a[class*=btn], a[class*=button], a[class*=cta], [class*=cta] a')]
    .filter((el) => visible(el) && !el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup'))
    .map(text).filter((t) => t.length >= 2 && t.length <= 40);
  const lines = (document.body?.innerText ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const price = lines.filter((l) => l.length < 160 && /(₺|\bTL\b|\$|€)\s*\d|\d[\d.,]*\s*(₺|TL\b)|\/\s*ay\b|aylık|yıllık|ücretsiz|free/i.test(l));
  return {
    baslik: document.title.trim(),
    meta: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    h1: uniq(h1s, 3),
    hero_alt: heroAlt,
    basliklar: uniq(headings, 30),
    ctalar: uniq(ctas, 20),
    fiyat: uniq(price, 20),
  };
}

mkdirSync(new URL('sayfalar/', here), { recursive: true });
for (const target of targets) {
  const sayfalar = [];
  for (const url of target.urls) {
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      sayfalar.push({ url, status: response?.status() ?? null, ...(await page.evaluate(extract)) });
    } catch (error) {
      sayfalar.push({ url, error: String(error?.message ?? error).split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  const slug = target.ad.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]+/g, '-');
  writeFileSync(new URL(`sayfalar/${slug}.json`, here), JSON.stringify({ ad: target.ad, toplandi: new Date().toISOString(), sayfalar }, null, 2));
  const ok = sayfalar.filter((s) => !s.error);
  console.log(`${target.ad.padEnd(14)} ${ok.length}/${sayfalar.length} sayfa${sayfalar.find((s) => s.error) ? ` · hata: ${sayfalar.find((s) => s.error).error.slice(0, 90)}` : ''}`);
}
await browser.close();
