import assert from 'node:assert/strict';
import { existsSync, closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const modulePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(modulePath), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const csrfToken = 'F'.repeat(43);

function assetContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

const ids = {
  user: 'fa000000-0000-4000-8000-000000000001',
  businessA: 'fa100000-0000-4000-8000-000000000001',
  businessB: 'fa100000-0000-4000-8000-000000000002',
  membershipA: 'fa200000-0000-4000-8000-000000000001',
  membershipB: 'fa200000-0000-4000-8000-000000000002',
  staffA: 'fa300000-0000-4000-8000-000000000001',
  staffB: 'fa300000-0000-4000-8000-000000000002',
  serviceA: 'fa400000-0000-4000-8000-000000000001',
  serviceB: 'fa400000-0000-4000-8000-000000000002',
};

function findChrome(explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable was not found. Set CHROME_BIN or install Chrome/Chromium.');
}

async function waitFor(read, message, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(60);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  static async connect(url) {
    const client = new Cdp(url);
    await Promise.race([
      new Promise((resolve, reject) => {
        client.ws.addEventListener('open', resolve, { once: true });
        client.ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once: true });
      }),
      sleep(5_000).then(() => { throw new Error('CDP WebSocket timed out'); }),
    ]);
    return client;
  }

  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnostics = [];
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails;
          const summary = details?.exception?.description ?? details?.text ?? 'browser exception';
          this.diagnostics.push(String(summary).slice(0, 2_000));
          if (this.diagnostics.length > 8) this.diagnostics.shift();
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMs = 8_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 8_000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

function membership(state, businessId) {
  return state.memberships[businessId];
}

function activeMemberships(state) {
  if (!state.loggedIn) return [];
  return Object.values(state.memberships)
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      business_id: item.businessId,
      role: item.role,
      active: true,
      businesses: {
        id: item.businessId,
        name: item.businessName,
        slug: item.slug,
        timezone: 'Europe/Istanbul',
      },
    }));
}

function sessionPayload(state) {
  return {
    user: state.loggedIn
      ? { id: ids.user, email: 'f10-owner@example.test', fullName: 'F10 Test Kullanıcısı' }
      : null,
    memberships: activeMemberships(state),
    activeBusinessId: state.loggedIn
      && membership(state, state.selected)?.active
      ? state.selected
      : null,
    passwordRecovery: false,
    csrfToken,
  };
}

function catalogPayload(state) {
  const current = membership(state, state.selected);
  return {
    membership: {
      id: current.id,
      business_id: current.businessId,
      role: current.role,
      active: current.active,
    },
    services: [{
      id: current.businessId === ids.businessA ? ids.serviceA : ids.serviceB,
      name: current.businessId === ids.businessA ? 'Salon A Kesim' : 'Salon B Bakım',
      duration_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      price_minor: 25000,
      currency: 'TRY',
      active: true,
    }],
    staff: [{
      id: current.businessId === ids.businessA ? ids.staffA : ids.staffB,
      membership_id: current.id,
      name: current.businessId === ids.businessA ? 'Salon A Uzmanı' : 'Salon B Uzmanı',
      phone: null,
      active: true,
    }],
    assignments: [{
      staff_id: current.businessId === ids.businessA ? ids.staffA : ids.staffB,
      service_id: current.businessId === ids.businessA ? ids.serviceA : ids.serviceB,
      active: true,
    }],
  };
}

function onboardingPayload(state) {
  const current = membership(state, state.selected);
  const serviceId = current.businessId === ids.businessA ? ids.serviceA : ids.serviceB;
  const staffId = current.businessId === ids.businessA ? ids.staffA : ids.staffB;
  return {
    membership: {
      id: current.id,
      business_id: current.businessId,
      role: current.role,
      active: current.active,
    },
    business: {
      id: current.businessId,
      name: current.businessName,
      slug: current.slug,
      timezone: 'Europe/Istanbul',
    },
    services: [{ id: serviceId, name: `${current.businessName} Hizmeti`, duration_minutes: 30, price_minor: 25000, currency: 'TRY', active: true }],
    staff: [{ id: staffId, membership_id: current.id, name: `${current.businessName} Uzmanı`, phone: null, active: true }],
    assignments: [{ staff_id: staffId, service_id: serviceId, active: true }],
    businessHours: [{ id: `${current.businessId}-bh`, weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }],
    staffHours: [{ id: `${current.businessId}-sh`, staff_id: staffId, weekday: 1, starts_local: '09:00:00', ends_local: '18:00:00', active: true }],
    settings: { business_id: current.businessId, enabled: true, step_minutes: 15, min_notice_minutes: 60, horizon_days: 60 },
    readiness: {
      business_id: current.businessId,
      has_active_service: true,
      has_active_staff: true,
      has_active_assignment: true,
      has_business_hours: true,
      has_staff_hours: true,
      has_overlapping_hours: true,
      publishable: true,
      missing_reasons: [],
    },
  };
}

function teamPayload(state) {
  const current = membership(state, state.selected);
  const currentStaff = current.businessId === ids.businessA ? ids.staffA : ids.staffB;
  return {
    actor: { membershipId: current.id, role: current.role },
    members: [
      {
        id: current.id,
        displayName: 'F10 Test Kullanıcısı',
        email: 'f10-owner@example.test',
        role: current.role,
        active: current.active,
      },
      {
        id: `${current.businessId.slice(0, -1)}9`,
        displayName: `${current.businessName} Çalışanı`,
        email: 'calisan@example.test',
        role: 'staff',
        active: true,
      },
    ],
    staff: [{ id: currentStaff, membershipId: current.id, name: `${current.businessName} Uzmanı`, active: true }],
    invitations: [],
    financialPermissions: [],
    effectiveFinancialPermissions: [],
  };
}

function userSafeForbidden(text) {
  return /\b(?:tenant|rpc|faz)\b/i.test(text);
}

function unfinishedActionVisible(buttons) {
  return buttons.some((label) => /^(?:tahsilat yap|ödeme al|adisyon oluştur|stok ekle|masraf ekle)$/i.test(label.trim()));
}

export async function runManagementAcceptance(options = {}) {
  const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f10-06-'));
  const bundleDir = path.join(work, 'bundle');
  const chromeLog = path.join(work, 'chrome.log');
  const sockets = new Set();
  const pages = [];
  const failures = [];
  let server;
  let chrome;
  let chromeFd;
  let origin;
  let appJs;
  let appCss = Buffer.alloc(0);
  let cssRequested = false;
  let chromeStartError;

  const state = {
    loggedIn: true,
    selected: ids.businessA,
    sessionFailureOnce: false,
    teamReadFailureOnce: false,
    failTeamReadAfterInvite: false,
    requests: [],
    // Every invitation POST the fixture answered: which business it was
    // written to (the shared selected business, exactly as the Worker resolves
    // it from the origin-wide cookie) and the HTTP status returned.
    invitationWrites: [],
    memberships: {
      [ids.businessA]: {
        id: ids.membershipA,
        businessId: ids.businessA,
        businessName: 'Salon A',
        slug: 'salon-a',
        role: 'owner',
        active: true,
      },
      [ids.businessB]: {
        id: ids.membershipB,
        businessId: ids.businessB,
        businessName: 'Salon B',
        slug: 'salon-b',
        role: 'manager',
        active: true,
      },
    },
  };

  function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error('Fixture request body exceeded 64 KiB');
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function denied(response, message = 'Bu işlem için artık yetkiniz yok. Ekip bilgilerini yenileyin.') {
    return sendJson(response, 403, { error: { code: 'NOT_ALLOWED', message } });
  }

  function requireSelectedAccess(response) {
    if (!state.loggedIn) {
      sendJson(response, 401, { error: { code: 'AUTH_REQUIRED', message: 'Oturumunuz sona erdi. Yeniden giriş yapın.' } });
      return null;
    }
    const current = membership(state, state.selected);
    if (!current?.active) {
      sendJson(response, 403, { error: { code: 'TENANT_REQUIRED', message: 'Bu işletme için erişiminiz artık aktif değil.' } });
      return null;
    }
    return current;
  }

  function requestCount(pathname, method) {
    return state.requests.filter((item) => item.path === pathname && (!method || item.method === method)).length;
  }

  try {
    await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'error',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: bundleDir,
        emptyOutDir: true,
        minify: false,
        lib: { entry: path.join(root, 'src/main.tsx'), formats: ['es'] },
        rollupOptions: { output: { entryFileNames: 'app.js' } },
      },
    });
    appJs = readFileSync(path.join(bundleDir, 'app.js'));
    const cssAsset = readdirSync(bundleDir).find((name) => name.endsWith('.css'));
    if (cssAsset) appCss = readFileSync(path.join(bundleDir, cssAsset));
    const bundleRoot = path.resolve(bundleDir);

    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/app.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(appJs);
          return;
        }
        if (url.pathname === '/app.css') {
          cssRequested = true;
          response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(appCss);
          return;
        }
        if (!url.pathname.startsWith('/api/') && path.extname(url.pathname)) {
          let relativePath;
          try {
            relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
          } catch {
            response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end('Bad asset path');
            return;
          }
          const assetPath = path.resolve(bundleRoot, relativePath);
          const insideBundle = assetPath.startsWith(`${bundleRoot}${path.sep}`);
          if (!insideBundle || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end('Asset not found');
            return;
          }
          response.writeHead(200, { 'Content-Type': assetContentType(assetPath), 'Cache-Control': 'no-store' });
          response.end(readFileSync(assetPath));
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
          return;
        }

        const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJson(request);
        state.requests.push({ method: request.method, path: url.pathname, body });

        if (request.method === 'GET' && url.pathname === '/api/csrf') {
          return sendJson(response, 200, { csrfToken });
        }
        if (request.method === 'GET' && url.pathname === '/api/session') {
          if (state.sessionFailureOnce) {
            state.sessionFailureOnce = false;
            return sendJson(response, 503, { error: { code: 'SESSION_UNAVAILABLE', message: 'Oturum şu anda doğrulanamıyor. Lütfen tekrar deneyin.' } });
          }
          return sendJson(response, 200, sessionPayload(state));
        }
        if (request.method === 'GET' && url.pathname === '/api/catalog') {
          if (!requireSelectedAccess(response)) return;
          return sendJson(response, 200, catalogPayload(state));
        }
        if (request.method === 'GET' && url.pathname === '/api/onboarding') {
          if (!requireSelectedAccess(response)) return;
          return sendJson(response, 200, onboardingPayload(state));
        }
        if (request.method === 'GET' && url.pathname === '/api/team') {
          if (!requireSelectedAccess(response)) return;
          if (state.teamReadFailureOnce) {
            state.teamReadFailureOnce = false;
            return sendJson(response, 503, { error: { code: 'TEAM_UNAVAILABLE', message: 'Ekip bilgileri şu anda yenilenemiyor. Mevcut erişiminizi koruyup tekrar deneyin.' } });
          }
          return sendJson(response, 200, { team: teamPayload(state) });
        }
        if (request.method === 'POST' && url.pathname === '/api/businesses/select') {
          if (!state.loggedIn) {
            return sendJson(response, 401, { error: { code: 'AUTH_REQUIRED', message: 'Önce giriş yapın.' } });
          }
          const next = membership(state, String(body.businessId ?? ''));
          if (!next?.active) {
            return sendJson(response, 403, { error: { code: 'TENANT_FORBIDDEN', message: 'Bu işletmeye erişiminiz yok.' } });
          }
          state.selected = next.businessId;
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/team/invitations') {
          const current = requireSelectedAccess(response);
          if (!current) {
            state.invitationWrites.push({ business: state.selected, status: response.statusCode });
            return;
          }
          if (current.role !== 'owner' && current.role !== 'manager') {
            state.invitationWrites.push({ business: state.selected, status: 403 });
            return denied(response);
          }
          if (state.failTeamReadAfterInvite) {
            state.failTeamReadAfterInvite = false;
            state.teamReadFailureOnce = true;
          }
          state.invitationWrites.push({ business: state.selected, status: 201 });
          return sendJson(response, 201, { inviteUrl: `${origin}/invite#${'I'.repeat(43)}` });
        }
        if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
          state.loggedIn = false;
          return sendJson(response, 200, { ok: true });
        }

        return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Acceptance fixture route bulunamadı.' } });
      } catch (error) {
        return sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: error instanceof Error ? error.message : String(error) } });
      }
    });
    server.headersTimeout = 8_000;
    server.requestTimeout = 8_000;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;

    const chromeBin = findChrome(options.chromeBin);
    chromeFd = openSync(chromeLog, 'w');
    chrome = spawn(chromeBin, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${path.join(work, 'profile')}`,
      'about:blank',
    ], { stdio: ['ignore', chromeFd, chromeFd] });
    chrome.once('error', (error) => { chromeStartError = error; });

    const activePort = path.join(work, 'profile', 'DevToolsActivePort');
    const port = await waitFor(() => {
      if (chromeStartError) throw chromeStartError;
      if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode} during startup`);
      try {
        const candidate = readFileSync(activePort, 'utf8').split(/\r?\n/)[0];
        return /^\d+$/.test(candidate) ? candidate : false;
      } catch {
        return false;
      }
    }, 'Chrome did not expose a debugging port', 10_000);
    const debugUrl = `http://127.0.0.1:${port}`;

    // A freshly created target can still be committing its initial
    // about:blank load; commands sent in that window fail with "Inspected
    // target navigated or closed". Only these idempotent setup and navigation
    // commands are retried -- never a click or a form submission.
    async function retryWhileTargetSettles(action) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await action();
        } catch (error) {
          if (attempt >= 5 || !/navigated or closed/i.test(String(error?.message ?? error))) throw error;
          await sleep(100);
        }
      }
    }

    async function openPage(pathname) {
      const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent('about:blank')}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(5_000),
      })).json();
      const page = await Cdp.connect(target.webSocketDebuggerUrl);
      pages.push(page);
      await retryWhileTargetSettles(() => page.send('Runtime.enable'));
      await retryWhileTargetSettles(() => page.send('Page.enable'));
      await navigate(page, pathname);
      return page;
    }

    async function navigate(page, pathname) {
      const url = `${origin}${pathname}`;
      await retryWhileTargetSettles(() => page.send('Page.navigate', { url }));
      await waitFor(async () => {
        const current = await page.evaluate('location.href');
        const ready = await page.evaluate('document.readyState === "complete" || document.readyState === "interactive"');
        return current === url && ready;
      }, `page did not navigate to ${pathname}`);
    }

    async function reload(page) {
      await page.send('Page.reload');
      await waitFor(() => page.evaluate('document.readyState === "complete"'), 'page did not reload');
    }

    async function bodyText(page) {
      return String(await page.evaluate('document.body?.innerText ?? ""'));
    }

    async function waitText(page, text, timeoutMs = 8_000) {
      return waitFor(async () => (await bodyText(page)).includes(text), `UI did not contain ${text}`, timeoutMs);
    }

    async function waitPath(page, pathname, timeoutMs = 8_000) {
      return waitFor(async () => (await page.evaluate('location.pathname')) === pathname, `UI did not reach ${pathname}`, timeoutMs);
    }

    async function buttonLabels(page) {
      return page.evaluate('[...document.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim())');
    }

    async function clickButtonContaining(page, text) {
      const clicked = await page.evaluate(`(() => {
        const target = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(${JSON.stringify(text)}));
        if (!target) return false;
        target.click();
        return true;
      })()`);
      assert.equal(clicked, true, `button containing ${text} was not found`);
    }

    async function clickAnchor(page, href) {
      const clicked = await page.evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(`a[href="${href}"]`)});
        if (!target) return false;
        target.click();
        return true;
      })()`);
      assert.equal(clicked, true, `anchor ${href} was not found`);
    }

    async function submitInvite(page, email) {
      const submitted = await page.evaluate(`(() => {
        const input = document.querySelector('input[aria-label="Davet e-postası"]');
        if (!(input instanceof HTMLInputElement)) return false;
        input.value = ${JSON.stringify(email)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (!(form instanceof HTMLFormElement)) return false;
        form.requestSubmit();
        return true;
      })()`);
      assert.equal(submitted, true, 'invite form was not available');
    }

    // A person returning to an already-open tab: the browser fronts it and
    // fires focus, visibilitychange and pageshow. Nothing is reloaded.
    async function returnToTab(page) {
      await page.send('Page.bringToFront');
      await page.evaluate(`(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      })()`);
    }

    function recordFailure(code, message, details = {}) {
      failures.push({ code, message, details });
    }

    async function assertSafeSurface(page, label) {
      const text = await bodyText(page);
      if (userSafeForbidden(text)) {
        recordFailure('TECHNICAL_COPY_LEAK', `${label} kullanıcı metninde tenant/RPC/faz dili gösterdi.`, { text: text.slice(0, 800) });
      }
      const buttons = await buttonLabels(page);
      if (unfinishedActionVisible(buttons)) {
        recordFailure('UNFINISHED_ACTION_VISIBLE', `${label} henüz teslim edilmemiş bir mali işlemi çalışır aksiyon gibi gösterdi.`, { buttons });
      }
    }

    const pageA = await openPage('/app/setup');
    const missingAssetStatus = await pageA.evaluate(`fetch('/missing-chunk.js', { cache: 'no-store' }).then((response) => response.status)`);
    assert.equal(missingAssetStatus, 404, 'missing emitted-asset request fell through to the app HTML');
    await waitText(pageA, 'Salon A');
    await waitText(pageA, 'Salon B');
    await waitText(pageA, 'İşletme sahibi');
    await assertSafeSurface(pageA, 'setup/A');

    await clickButtonContaining(pageA, 'Salon B');
    await waitFor(() => state.selected === ids.businessB, 'business switch did not select Salon B');
    await waitPath(pageA, '/app/calendar');
    await waitFor(
      () => pageA.evaluate(`(() => {
        const select = document.querySelector('select[aria-label="Aktif işletme"]');
        if (!(select instanceof HTMLSelectElement)) return false;
        return select.value === '${ids.businessB}'
          && select.selectedOptions[0]?.textContent?.trim() === 'Salon B';
      })()`),
      'workspace header did not verify Salon B after switch',
    );
    await navigate(pageA, '/app/setup');
    await waitPath(pageA, '/app/setup');
    await waitFor(async () => {
      const text = await bodyText(pageA);
      return text.includes('Salon B') && text.includes('Yönetici') && text.includes('Şu an seçili');
    }, 'setup did not render verified Salon B manager state');
    assert.equal(state.selected, ids.businessB);
    await assertSafeSurface(pageA, 'setup/B');

    await clickAnchor(pageA, '/app/team');
    await waitPath(pageA, '/app/team');
    await waitText(pageA, 'Yönetici');
    await waitText(pageA, 'Davet oluştur');
    await assertSafeSurface(pageA, 'team/B manager');

    await pageA.evaluate('history.back()');
    await waitPath(pageA, '/app/setup');
    await waitText(pageA, 'Yönetici');
    assert.equal(state.selected, ids.businessB, 'browser back changed selected business');
    const backText = await bodyText(pageA);
    assert.ok(backText.includes('Salon B'));
    assert.ok(!backText.includes('Salon A Hizmeti'), 'browser back exposed stale Salon A domain data');

    await pageA.evaluate('history.forward()');
    await waitPath(pageA, '/app/team');
    await waitText(pageA, 'Yönetici');
    await assertSafeSurface(pageA, 'team/B forward');

    const pageB = await openPage('/app/team');
    await waitText(pageB, 'Yönetici');
    await waitText(pageB, 'Davet oluştur');
    assert.notEqual(await pageA.evaluate('location.href'), 'about:blank');
    assert.notEqual(await pageB.evaluate('location.href'), 'about:blank');

    state.memberships[ids.businessB].role = 'staff';
    const deniedBefore = requestCount('/api/team/invitations', 'POST');
    await submitInvite(pageB, 'stale-role@example.test');
    await waitFor(() => requestCount('/api/team/invitations', 'POST') === deniedBefore + 1, 'stale privileged invite request was not sent');
    await waitText(pageB, 'artık yetkiniz yok');
    const staleRoleButtons = await buttonLabels(pageB);
    if (staleRoleButtons.some((label) => label.includes('Davet oluştur'))) {
      recordFailure(
        'STALE_ROLE_UI_AFTER_403',
        'Açık ekip sekmesi server-side manager→staff düşüşünden sonra 403 aldı fakat yönetici aksiyonlarını görünür bıraktı.',
        { selectedBusiness: state.selected, authoritativeRole: 'staff', visibleButtons: staleRoleButtons },
      );
    }

    await reload(pageB);
    await waitText(pageB, 'Çalışan');
    const staffButtons = await buttonLabels(pageB);
    assert.ok(!staffButtons.some((label) => label.includes('Davet oluştur')), 'fresh staff snapshot still exposed invitation mutation');
    await assertSafeSurface(pageB, 'team/B staff reload');

    state.memberships[ids.businessB].active = false;
    await reload(pageB);
    await waitText(pageB, 'Hangi işletmede çalışacağız?');
    const inactiveText = await bodyText(pageB);
    assert.ok(inactiveText.includes('Salon A'), 'workspace gate did not retain the remaining active membership');
    assert.ok(!inactiveText.includes('Davet oluştur'));
    assert.ok(!inactiveText.includes('Salon B Çalışanı'));
    assert.ok(!inactiveText.includes('Salon B'), 'inactive business remained selectable in the workspace gate');
    await assertSafeSurface(pageB, 'workspace/B inactive');

    state.memberships[ids.businessB].active = true;
    state.memberships[ids.businessB].role = 'manager';
    await reload(pageB);
    await waitText(pageB, 'Yönetici');
    await waitText(pageB, 'Davet oluştur');
    state.failTeamReadAfterInvite = true;
    const successBefore = requestCount('/api/team/invitations', 'POST');
    await submitInvite(pageB, 'provider-gap@example.test');
    await waitFor(() => requestCount('/api/team/invitations', 'POST') === successBefore + 1, 'manager invite request was not sent');
    // Settle on the retryable read notice, which both the defective and the
    // repaired UI render; waiting for the erase screen itself would time out on
    // a correct implementation.
    await waitText(pageB, 'Ekip bilgileri şu anda yenilenemiyor');
    const transientTeamText = await bodyText(pageB);
    if (transientTeamText.includes('Ekip alanı açılamadı') || !transientTeamText.includes('Salon B Çalışanı')) {
      recordFailure(
        'TRANSIENT_TEAM_READ_ERASES_AUTHORITY_VIEW',
        'Başarılı yönetim işlemi sonrası tek seferlik 503, açık ve doğrulanmış ekip görünümünü erişim kaybı ekranına çevirdi.',
        { authoritativeRole: 'manager', selectedBusiness: state.selected },
      );
    }

    const pageC = await openPage('/app');
    await waitText(pageC, 'Yönetici');
    await waitText(pageC, 'Çıkış yap');
    state.sessionFailureOnce = true;
    await reload(pageC);
    await waitText(pageC, 'Oturum şu anda doğrulanamıyor');
    const transientSessionText = await bodyText(pageC);
    if (transientSessionText.includes('Çalışma alanına girin')) {
      recordFailure(
        'TRANSIENT_SESSION_503_LOOKS_LOGGED_OUT',
        'Geçici /api/session 503 sonrası geçerli tarayıcı oturumu login formu gibi gösterildi.',
        { selectedBusiness: state.selected, loggedInFixture: state.loggedIn },
      );
    }
    await assertSafeSurface(pageC, 'root/session-503');

    await reload(pageC);
    await waitText(pageC, 'Yönetici');

    // Cross-tab tenant drift. Two tabs show Salon B; tab 1 switches the shared
    // selection to Salon A through the real UI; the person returns to tab 2
    // without reloading it and uses the invite form it is showing. A write that
    // lands on Salon A while tab 2 still presented Salon B is a silent
    // cross-tenant durable write.
    await reload(pageB);
    await waitText(pageB, 'Salon B Çalışanı');
    await waitText(pageB, 'Davet oluştur');
    await navigate(pageA, '/app/setup');
    await waitText(pageA, 'Salon A');
    await clickButtonContaining(pageA, 'Salon A');
    await waitFor(() => state.selected === ids.businessA, 'tab 1 did not switch the shared selection to Salon A');
    await returnToTab(pageB);
    await sleep(750);
    const driftShown = await bodyText(pageB);
    const driftWritesBefore = state.invitationWrites.length;
    const driftFormAvailable = await pageB.evaluate('Boolean(document.querySelector(\'input[aria-label="Davet e-postası"]\'))');
    if (driftFormAvailable) {
      await submitInvite(pageB, 'cross-tab-drift@example.test');
      await waitFor(() => state.invitationWrites.length > driftWritesBefore, 'stale-tab invite request was not answered', 3_000).catch(() => {});
      await sleep(250);
    }
    const driftWrites = state.invitationWrites.slice(driftWritesBefore);
    const tabShowedB = driftShown.includes('Salon B Çalışanı') && !driftShown.includes('Salon A Çalışanı');
    if (tabShowedB && driftWrites.some((write) => write.status === 201 && write.business === ids.businessA)) {
      recordFailure(
        'CROSS_TAB_TENANT_DRIFT_WRITE',
        'Salon B gösteren sekmeden gönderilen davet, başka sekmede seçilen Salon A işletmesine sessizce yazıldı.',
        { displayed: 'Salon B', writtenTo: 'Salon A', writes: driftWrites },
      );
    }
    const driftSettled = await bodyText(pageB);
    const crossTab = {
      driftShownBeforeWrite: tabShowedB ? 'Salon B' : (driftShown.includes('Salon A Çalışanı') ? 'Salon A' : 'neither'),
      driftFormAvailable,
      driftWrites,
      driftSettledOn: driftSettled.includes('Salon A Çalışanı') ? 'Salon A' : (driftSettled.includes('Salon B Çalışanı') ? 'Salon B' : 'neither'),
      logoutSurfaceClosed: null,
    };
    await assertSafeSurface(pageB, 'team/cross-tab drift');

    // The same drift with no return signal at all: the stale tab writes before
    // anything tells it the shared selection moved. The write path itself must
    // refuse rather than land on the business the tab is not showing.
    await reload(pageB);
    await waitText(pageB, 'Salon A Çalışanı');
    await waitText(pageB, 'Davet oluştur');
    await navigate(pageA, '/app/setup');
    await waitText(pageA, 'Salon B');
    await clickButtonContaining(pageA, 'Salon B');
    await waitFor(() => state.selected === ids.businessB, 'tab 1 did not switch the shared selection back to Salon B');
    const silentShown = await bodyText(pageB);
    const silentWritesBefore = state.invitationWrites.length;
    await submitInvite(pageB, 'cross-tab-silent@example.test');
    await waitFor(async () => {
      if (state.invitationWrites.length > silentWritesBefore) return true;
      const text = await bodyText(pageB);
      return text.includes('Salon B Çalışanı') && !text.includes('Salon A Çalışanı');
    }, 'silent cross-tab drift did not settle', 3_000).catch(() => {});
    const silentWrites = state.invitationWrites.slice(silentWritesBefore);
    crossTab.silentShownBeforeWrite = silentShown.includes('Salon A Çalışanı') && !silentShown.includes('Salon B Çalışanı') ? 'Salon A' : 'other';
    crossTab.silentWrites = silentWrites;
    if (silentWrites.some((write) => write.status === 201 && write.business === ids.businessB)) {
      recordFailure(
        'CROSS_TAB_TENANT_DRIFT_WRITE',
        'Salon A gösteren sekmeden, dönüş sinyali olmadan gönderilen davet başka sekmede seçilen Salon B işletmesine sessizce yazıldı.',
        { displayed: 'Salon A', writtenTo: 'Salon B', writes: silentWrites },
      );
    }
    await waitText(pageB, 'Salon B Çalışanı');
    await assertSafeSurface(pageB, 'team/cross-tab silent drift');

    // Cross-tab logout without reload: tab 2 is re-verified after the drift leg
    // so it shows a live management surface before tab 1 signs out.
    await reload(pageB);
    await waitText(pageB, 'Davet oluştur');

    const logoutClicked = await pageC.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('Çıkış yap'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(logoutClicked, true, 'logout button was not found');
    await waitText(pageC, 'Çalışma alanına girin');
    assert.equal(state.loggedIn, false, 'logout endpoint did not invalidate fixture session');

    await returnToTab(pageB);
    const logoutStale = await waitFor(async () => {
      const text = await bodyText(pageB);
      return !text.includes('Davet oluştur') && !text.includes('Çalışanı');
    }, 'stale authenticated surface', 3_000).then(() => false, () => true);
    crossTab.logoutSurfaceClosed = !logoutStale;
    if (logoutStale) {
      const buttons = await buttonLabels(pageB);
      recordFailure(
        'CROSS_TAB_LOGOUT_STALE_SURFACE',
        'Başka sekmede çıkış yapıldıktan sonra geri dönülen açık ekip sekmesi yeniden yüklenmeden yetkili yönetim yüzeyini göstermeye devam etti.',
        { visibleButtons: buttons },
      );
    }

    await navigate(pageA, '/app/setup');
    await waitText(pageA, 'Önce giriş yapın');
    const expiredSetupText = await bodyText(pageA);
    assert.ok(!expiredSetupText.includes('Salon B Hizmeti'));

    await reload(pageB);
    await waitText(pageB, 'Ekip alanı açılamadı');
    const expiredTeamText = await bodyText(pageB);
    assert.ok(!expiredTeamText.includes('Davet oluştur'));
    assert.ok(!expiredTeamText.includes('Salon B Çalışanı'));

    if (failures.length) {
      const summary = failures.map((item) => `${item.code}: ${item.message}`).join('\n- ');
      const error = new Error(`F10-06 management acceptance found ${failures.length} runtime blocker(s):\n- ${summary}`);
      error.acceptanceFailures = failures;
      throw error;
    }

    return {
      ok: true,
      selectedBusiness: state.selected,
      requestCount: state.requests.length,
      assetProof: {
        cssRequested,
        cssBytes: appCss.length,
        missingAssetStatus,
      },
      crossTab,
      scenarios: [
        'two-business switch',
        'browser back/forward',
        'second-tab role downgrade',
        'membership deactivation',
        'transient provider failure',
        'transient session failure',
        'logout/session expiry',
        'cross-tab tenant drift',
        'cross-tab logout without reload',
        'copy and unfinished-action scan',
      ],
    };
  } catch (error) {
    if (error && typeof error === 'object' && !('acceptanceFailures' in error) && failures.length) {
      error.acceptanceFailures = failures;
    }
    const diagnostics = pages.flatMap((page) => page.diagnostics ?? []);
    if (diagnostics.length && error instanceof Error) {
      error.message += `\nBrowser diagnostics:\n${diagnostics.join('\n')}`;
    }
    throw error;
  } finally {
    for (const page of pages) {
      try { page.close(); } catch { /* best effort */ }
    }
    if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
    if (chromeFd !== undefined) closeSync(chromeFd);
    if (server) {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
    // Chrome can still be flushing its profile right after SIGTERM; a single
    // attempt then throws ENOTEMPTY from finally and hides the real result.
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === modulePath;
}

if (isMain()) {
  try {
    const receipt = await runManagementAcceptance();
    console.log(`F10-06 management browser acceptance passed: ${receipt.scenarios.join(', ')}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error && typeof error === 'object' && Array.isArray(error.acceptanceFailures)) {
      for (const failure of error.acceptanceFailures) {
        console.error(`F10-06 BLOCKER ${failure.code}: ${failure.message}`);
        console.error(JSON.stringify(failure.details));
      }
    }
    process.exitCode = 1;
  }
}
