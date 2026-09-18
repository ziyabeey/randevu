import assert from 'node:assert/strict';
import { existsSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
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
  const hanging = new Set();
  const pages = [];
  const failures = [];
  let server;
  let chrome;
  let chromeFd;
  let origin;
  let appJs;
  let chromeStartError;

  const state = {
    loggedIn: true,
    selected: ids.businessA,
    sessionFailureOnce: false,
    teamReadFailureOnce: false,
    failTeamReadAfterInvite: false,
    requests: [],
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

    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/app.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(appJs);
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
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
          if (!state.loggedIn) return denied(response, 'Oturumunuz sona erdi. Yeniden giriş yapın.');
          const next = membership(state, String(body.businessId ?? ''));
          if (!next?.active) return denied(response, 'Bu işletmeye erişiminiz yok.');
          state.selected = next.businessId;
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/team/invitations') {
          const current = requireSelectedAccess(response);
          if (!current) return;
          if (current.role !== 'owner' && current.role !== 'manager') return denied(response);
          if (state.failTeamReadAfterInvite) {
            state.failTeamReadAfterInvite = false;
            state.teamReadFailureOnce = true;
          }
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

    async function openPage(pathname) {
      const target = await (await fetch(`${debugUrl}/json/new?${encodeURIComponent('about:blank')}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(5_000),
      })).json();
      const page = await Cdp.connect(target.webSocketDebuggerUrl);
      pages.push(page);
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      await navigate(page, pathname);
      return page;
    }

    async function navigate(page, pathname) {
      const url = `${origin}${pathname}`;
      await page.send('Page.navigate', { url });
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

    const pageA = await openPage('/setup');
    await waitText(pageA, 'Salon A');
    await waitText(pageA, 'Salon B');
    await waitText(pageA, 'İşletme sahibi');
    await assertSafeSurface(pageA, 'setup/A');

    await clickButtonContaining(pageA, 'Salon B');
    await waitPath(pageA, '/setup');
    await waitFor(async () => {
      const text = await bodyText(pageA);
      return text.includes('Salon B') && text.includes('Yönetici') && text.includes('Şu an seçili');
    }, 'business switch did not settle on Salon B manager state');
    assert.equal(state.selected, ids.businessB);
    await assertSafeSurface(pageA, 'setup/B');

    await clickAnchor(pageA, '/team');
    await waitPath(pageA, '/team');
    await waitText(pageA, 'Yönetici');
    await waitText(pageA, 'Davet oluştur');
    await assertSafeSurface(pageA, 'team/B manager');

    await pageA.evaluate('history.back()');
    await waitPath(pageA, '/setup');
    await waitText(pageA, 'Yönetici');
    assert.equal(state.selected, ids.businessB, 'browser back changed selected business');
    const backText = await bodyText(pageA);
    assert.ok(backText.includes('Salon B'));
    assert.ok(!backText.includes('Salon A Hizmeti'), 'browser back exposed stale Salon A domain data');

    await pageA.evaluate('history.forward()');
    await waitPath(pageA, '/team');
    await waitText(pageA, 'Yönetici');
    await assertSafeSurface(pageA, 'team/B forward');

    const pageB = await openPage('/team');
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
    await waitText(pageB, 'Ekip alanı açılamadı');
    const inactiveText = await bodyText(pageB);
    assert.ok(!inactiveText.includes('Davet oluştur'));
    assert.ok(!inactiveText.includes('Salon B Çalışanı'));
    await assertSafeSurface(pageB, 'team/B inactive');

    state.memberships[ids.businessB].active = true;
    state.memberships[ids.businessB].role = 'manager';
    await reload(pageB);
    await waitText(pageB, 'Yönetici');
    await waitText(pageB, 'Davet oluştur');
    state.failTeamReadAfterInvite = true;
    const successBefore = requestCount('/api/team/invitations', 'POST');
    await submitInvite(pageB, 'provider-gap@example.test');
    await waitFor(() => requestCount('/api/team/invitations', 'POST') === successBefore + 1, 'manager invite request was not sent');
    await waitText(pageB, 'Ekip alanı açılamadı');
    const transientTeamText = await bodyText(pageB);
    if (transientTeamText.includes('Ekip alanı açılamadı')) {
      recordFailure(
        'TRANSIENT_TEAM_READ_ERASES_AUTHORITY_VIEW',
        'Başarılı yönetim işlemi sonrası tek seferlik 503, açık ve doğrulanmış ekip görünümünü erişim kaybı ekranına çevirdi.',
        { authoritativeRole: 'manager', selectedBusiness: state.selected },
      );
    }

    const pageC = await openPage('/');
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
    const logoutClicked = await pageC.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('Çıkış yap'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(logoutClicked, true, 'logout button was not found');
    await waitText(pageC, 'Çalışma alanına girin');
    assert.equal(state.loggedIn, false, 'logout endpoint did not invalidate fixture session');

    await reload(pageA);
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
      scenarios: [
        'two-business switch',
        'browser back/forward',
        'second-tab role downgrade',
        'membership deactivation',
        'transient provider failure',
        'transient session failure',
        'logout/session expiry',
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
    for (const response of hanging) response.destroy();
    for (const page of pages) {
      try { page.close(); } catch { /* best effort */ }
    }
    if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
    if (chromeFd !== undefined) closeSync(chromeFd);
    if (server) {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    }
    rmSync(work, { recursive: true, force: true });
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
