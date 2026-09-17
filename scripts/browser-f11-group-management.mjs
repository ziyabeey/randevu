import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// F11-03 customer management acceptance in a real browser. The page is the one
// shipped at /m#token; only the API is a fixture. What it has to prove is the
// behaviour the group surface introduced: a native reservation is managed as
// one unit with an optimistic version, and a lost race is recovered from rather
// than retried into a loop -- which the page can only do because the group
// vocabulary now survives the public error envelope.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'randevu-f1103-browser-'));
const bundleDir = path.join(work, 'bundle');
const chromeLog = path.join(work, 'chrome.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(read, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(50);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

const GROUP_TOKEN = 'G'.repeat(43);
const LEGACY_TOKEN = 'L'.repeat(43);
const TZ = 'Europe/Istanbul';

function appointment(overrides = {}) {
  return {
    appointment_id: '80000000-0000-4000-8000-000000000001',
    business_name: 'F11-03 Salon',
    status: 'scheduled',
    starts_at: '2026-09-24T07:00:00.000Z',
    ends_at: '2026-09-24T08:30:00.000Z',
    timezone: TZ,
    service_name: 'Renk',
    staff_name: 'Uzman',
    price_minor: 20000,
    currency: 'TRY',
    can_reschedule: true,
    can_cancel: true,
    local_date: '2026-09-24',
    max_date: '2026-10-24',
    ...overrides,
  };
}

function line(ordinal, startsAt, endsAt, overrides = {}) {
  return {
    appointmentId: `80000000-0000-4000-8000-00000000000${ordinal}`,
    lineOrdinal: ordinal,
    serviceName: ordinal === 1 ? 'Renk' : 'Kesim',
    staffName: 'Uzman',
    startsAt,
    endsAt,
    status: 'scheduled',
    priceType: 'fixed',
    priceMinMinor: ordinal === 1 ? 20000 : 12000,
    priceMaxMinor: ordinal === 1 ? 20000 : 12000,
    priceMinor: ordinal === 1 ? 20000 : 12000,
    currency: 'TRY',
    ...overrides,
  };
}

function group(version, startsAt, overrides = {}) {
  const base = new Date(startsAt).getTime();
  return {
    groupId: '60000000-0000-4000-8000-000000000001',
    status: 'scheduled',
    version,
    startsAt,
    endsAt: new Date(base + 90 * 60_000).toISOString(),
    timezone: TZ,
    currency: 'TRY',
    estimateMinMinor: 32000,
    estimateMaxMinor: 32000,
    lineCount: 2,
    canRescheduleGroup: true,
    canCancelGroup: true,
    lines: [
      line(1, startsAt, new Date(base + 60 * 60_000).toISOString()),
      line(2, new Date(base + 60 * 60_000).toISOString(), new Date(base + 90 * 60_000).toISOString()),
    ],
    ...overrides,
  };
}

const fixture = {
  // The server is the authority on the version, exactly as PostgreSQL is.
  version: 4,
  startsAt: '2026-09-24T07:00:00.000Z',
  cancelled: false,
  rescheduleMode: 'success',
  cancelMode: 'success',
  requests: [],
};
const sockets = new Set();
let testJs;
let origin;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function record(request, url, body) {
  fixture.requests.push({
    method: request.method,
    path: url.pathname,
    body,
    idempotencyKey: request.headers['idempotency-key'] ?? null,
  });
}

function requestsTo(pathname) {
  return fixture.requests.filter((item) => item.path === pathname);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(testJs);
      return;
    }
    if (url.pathname === '/harness') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/test.js"></script>');
      return;
    }

    const body = request.method === 'POST' ? await readJson(request) : null;
    record(request, url, body);

    if (url.pathname === '/api/manage/view') {
      if (body?.token === LEGACY_TOKEN) {
        return sendJson(response, 200, { appointment: appointment() });
      }
      const current = group(fixture.version, fixture.startsAt);
      if (fixture.cancelled) {
        current.status = 'cancelled';
        current.canRescheduleGroup = false;
        current.canCancelGroup = false;
        current.lines = current.lines.map((item) => ({ ...item, status: 'cancelled' }));
      }
      return sendJson(response, 200, { appointment: appointment(), group: current });
    }

    if (url.pathname === '/api/manage/slots') {
      if (body?.group === true) {
        return sendJson(response, 200, { slots: [
          { starts_at: '2026-09-24T10:00:00.000Z', ends_at: '2026-09-24T11:30:00.000Z', timezone: TZ, total_duration_minutes: 90, lines: [{}, {}] },
          { starts_at: '2026-09-24T12:00:00.000Z', ends_at: '2026-09-24T13:30:00.000Z', timezone: TZ, total_duration_minutes: 90, lines: [{}, {}] },
        ] });
      }
      return sendJson(response, 200, { slots: [
        { staff_id: '70000000-0000-4000-8000-000000000001', staff_name: 'Uzman', starts_at: '2026-09-24T10:00:00.000Z', ends_at: '2026-09-24T10:30:00.000Z', timezone: TZ },
      ] });
    }

    if (url.pathname === '/api/manage/reschedule') {
      if (fixture.rescheduleMode === 'conflict') {
        // Someone else moved the reservation while this page was showing
        // version 4. The database says BOOKING_GROUP_VERSION_CONFLICT and the
        // Worker turns it into a 409; before the envelope repair this arrived
        // as a 503 telling the customer to retry the same stale version.
        fixture.version = 5;
        fixture.startsAt = '2026-09-24T14:00:00.000Z';
        return sendJson(response, 409, { error: {
          code: 'BOOKING_GROUP_VERSION_CONFLICT',
          message: 'Rezervasyon başka bir işlemle değişti. Güncel halini açıp tekrar deneyin.',
        } });
      }
      fixture.version += 1;
      fixture.startsAt = body.startsAt;
      return sendJson(response, 200, { group: group(fixture.version, fixture.startsAt) });
    }

    if (url.pathname === '/api/manage/cancel') {
      if (fixture.cancelMode === 'conflict') {
        fixture.version = 9;
        return sendJson(response, 409, { error: {
          code: 'BOOKING_GROUP_VERSION_CONFLICT',
          message: 'Rezervasyon başka bir işlemle değişti. Güncel halini açıp tekrar deneyin.',
        } });
      }
      fixture.version += 1;
      fixture.cancelled = true;
      return sendJson(response, 200, { group: group(fixture.version, fixture.startsAt, { status: 'cancelled' }) });
    }

    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'unmapped fixture route' } });
  } catch (error) {
    sendJson(response, 500, { error: { code: 'FIXTURE_ERROR', message: String(error) } });
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

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
    this.dialogs = [];
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        // The cancel control asks for confirmation. Record what it asked and
        // accept, otherwise the evaluate that clicked it never returns.
        if (message.method === 'Page.javascriptDialogOpening') {
          this.dialogs.push(String(message.params?.message ?? ''));
          void this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
          return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params?.exceptionDetails;
          this.diagnostics.push(String(details?.exception?.description ?? details?.text ?? 'Unknown browser exception').slice(0, 2_000));
          if (this.diagnostics.length > 8) this.diagnostics.shift();
        }
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMs = 5_000) {
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

  async evaluate(expression, timeoutMs = 5_000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  close() { this.ws.close(); }
}

let chrome;
let chromeFd;
let page;
let chromeStartError;

async function openPage(debugUrl, url) {
  const target = await (await fetch(`${debugUrl}/json/new?about%3Ablank`, { method: 'PUT', signal: AbortSignal.timeout(5_000) })).json();
  const client = await Cdp.connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  client.targetId = target.id;
  await navigate(client, url);
  return client;
}

async function navigate(client, url) {
  await client.evaluate('delete document.documentElement.dataset.f1103Ready');
  await client.send('Page.navigate', { url });
  await waitFor(
    () => client.evaluate(`${JSON.stringify(url)} === location.href && document.documentElement.dataset.f1103Ready === "true"`, 500),
    `page did not load ${url}`,
  );
}

async function call(client, method, ...args) {
  try {
    return await client.evaluate(`window.__f1103[${JSON.stringify(method)}](...${JSON.stringify(args)})`, 15_000);
  } catch (error) {
    throw new Error(`harness call ${method}(${JSON.stringify(args)}) failed: ${error.message}`);
  }
}

async function uiContains(client, text, timeoutMs = 5_000) {
  return waitFor(async () => (await call(client, 'text')).includes(text), `UI did not show "${text}"`, timeoutMs);
}

function passed(name) { console.log(`F11-03 browser passed: ${name}`); }

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
      lib: { entry: path.join(root, 'tests/browser/f11-group-management.tsx'), formats: ['es'] },
      rollupOptions: { output: { entryFileNames: 'test.js' } },
    },
  });
  testJs = readFileSync(path.join(bundleDir, 'test.js'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;

  const chromeBin = process.env.CHROME_BIN;
  assert.ok(chromeBin, 'CHROME_BIN must identify the CI Chrome executable');
  chromeFd = openSync(chromeLog, 'w');
  chrome = spawn(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${path.join(work, 'profile')}`,
    'about:blank',
  ], { stdio: ['ignore', chromeFd, chromeFd] });
  chrome.once('error', (error) => { chromeStartError = error; });
  const activePort = path.join(work, 'profile', 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (chromeStartError) throw chromeStartError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode} during startup`);
    const first = readFileSync(activePort, 'utf8').split(/\r?\n/)[0];
    return /^\d+$/.test(first) && first;
  }, 'Chrome did not expose a debugging port', 10_000);
  const debugUrl = `http://127.0.0.1:${port}`;

  // 1. A native reservation is presented as one unit, not as its anchor line.
  page = await openPage(debugUrl, `${origin}/harness?token=${GROUP_TOKEN}`);
  await uiContains(page, 'Rezervasyon bilgileri');
  const lines = await call(page, 'lines');
  assert.equal(lines.length, 2, 'the group projection did not render both lines');
  assert.ok(lines[0].includes('1. Renk') && lines[1].includes('2. Kesim'));
  assert.ok((await call(page, 'text')).includes('Aktif hizmetlerin tamamını iptal et'));
  passed('native reservation renders as one group with its lines');

  // 2. The slot search asks for group availability, not per-staff availability.
  assert.equal(await call(page, 'click', 'Saatleri göster'), true);
  await waitFor(async () => (await call(page, 'slots')).length === 2, 'group slots did not render');
  const slotRequest = requestsTo('/api/manage/slots').at(-1);
  assert.equal(slotRequest.body.group, true);
  assert.equal(slotRequest.body.token, GROUP_TOKEN);
  assert.ok((await call(page, 'slots'))[0].includes('2 hizmet'));
  passed('slot search uses the whole-group availability action');

  // 3. A lost race must reload the reservation and refresh the slots rather
  //    than leave the customer retrying a version the server already replaced.
  fixture.rescheduleMode = 'conflict';
  assert.equal(await call(page, 'pickSlot', 0), true);
  const viewsBeforeConflict = requestsTo('/api/manage/view').length;
  const slotsBeforeConflict = requestsTo('/api/manage/slots').length;
  assert.equal(await call(page, 'click', 'Seçilen saate taşı'), true);
  await uiContains(page, 'Rezervasyon başka bir işlemle değişti');
  const conflictRequest = requestsTo('/api/manage/reschedule').at(-1);
  assert.equal(conflictRequest.body.expectedVersion, 4, 'the page did not send the version it was showing');
  assert.ok(conflictRequest.idempotencyKey, 'the mutation carried no idempotency key');
  await waitFor(() => requestsTo('/api/manage/view').length > viewsBeforeConflict, 'the conflict did not reload the reservation');
  await waitFor(() => requestsTo('/api/manage/slots').length > slotsBeforeConflict, 'the conflict did not refresh the slots');
  assert.ok((await call(page, 'text')).includes('Rezervasyon başka bir işlemle değişti'), 'the conflict notice was lost on reload');
  assert.equal((await call(page, 'buttons')).some((button) => button.text.includes('Seçilen saate taşı')), false, 'the stale selection survived the conflict');
  passed('a lost race reloads the reservation, refreshes the slots and keeps the notice');

  // 4. The retry after a reload sends the version the server now reports.
  fixture.rescheduleMode = 'success';
  assert.equal(await call(page, 'click', 'Saatleri göster'), true);
  await waitFor(async () => (await call(page, 'slots')).length === 2, 'slots did not reload after the conflict');
  assert.equal(await call(page, 'pickSlot', 1), true);
  assert.equal(await call(page, 'click', 'Seçilen saate taşı'), true);
  await uiContains(page, 'tarihine taşındı');
  const retry = requestsTo('/api/manage/reschedule').at(-1);
  assert.equal(retry.body.expectedVersion, 5, 'the retry reused the stale version');
  assert.notEqual(retry.idempotencyKey, conflictRequest.idempotencyKey, 'a different mutation reused the earlier command key');
  passed('the retry carries the reloaded version under a new command key');

  // 5. Cancelling the group sends the version and lands on the terminal state.
  const cancelVersion = fixture.version;
  assert.equal(await call(page, 'setReason', 'Planım değişti'), true);
  page.dialogs.length = 0;
  assert.equal(await call(page, 'click', 'Aktif hizmetlerin tamamını iptal et'), true);
  assert.equal(page.dialogs.length, 1, 'the group cancel did not ask for confirmation');
  assert.ok(page.dialogs[0].includes('aktif hizmetlerin tamamını'), `the confirmation did not name the whole reservation: ${page.dialogs[0]}`);
  await uiContains(page, 'Rezervasyondaki aktif hizmetler iptal edildi');
  const cancelRequest = requestsTo('/api/manage/cancel').at(-1);
  assert.equal(cancelRequest.body.expectedVersion, cancelVersion);
  assert.equal(cancelRequest.body.reason, 'Planım değişti');
  await uiContains(page, 'Bu rezervasyon artık taşınamaz');
  assert.ok((await call(page, 'text')).includes('Bu rezervasyon artık iptal edilemez'));
  passed('group cancel carries the version and closes the surface');

  // 6. A legacy capability keeps the single-appointment page byte-for-byte:
  //    no group projection, no version on the wire.
  await navigate(page, `${origin}/harness?token=${LEGACY_TOKEN}`);
  await uiContains(page, 'Randevu bilgileri');
  assert.equal((await call(page, 'lines')).length, 0, 'a legacy link rendered a group projection');
  assert.equal(await call(page, 'click', 'Saatleri göster'), true);
  await waitFor(async () => (await call(page, 'slots')).length === 1, 'legacy slots did not render');
  const legacySlotRequest = requestsTo('/api/manage/slots').at(-1);
  assert.equal(legacySlotRequest.body.group, undefined);
  assert.equal(legacySlotRequest.body.staffId, 'any');
  assert.equal(await call(page, 'pickSlot', 0), true);
  assert.equal(await call(page, 'click', 'Seçilen saate taşı'), true);
  await uiContains(page, 'tarihine taşındı');
  const legacyReschedule = requestsTo('/api/manage/reschedule').at(-1);
  assert.equal(legacyReschedule.body.expectedVersion, undefined, 'the legacy path sent a group version');
  assert.ok(legacyReschedule.body.staffId, 'the legacy path dropped the staff choice');
  passed('a legacy capability keeps the single-appointment contract');

  console.log('F11-03 browser group management acceptance passed.');
} catch (error) {
  console.error(error);
  if (page?.diagnostics.length) console.error(`browser exceptions:\n${page.diagnostics.join('\n')}`);
  try { console.error(readFileSync(chromeLog, 'utf8').slice(-4_000)); } catch { /* Chrome may not have started. */ }
  process.exitCode = 1;
} finally {
  page?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(1_000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (chromeFd !== undefined) closeSync(chromeFd);
  rmSync(work, { recursive: true, force: true });
}
