import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url).href;

// Execute the real entry point. Only external I/O and the separately tested OTP
// transport module are replaced. No credentials, network or database are used.
function runScenario(scenario = {}) {
  const bootstrap = `
    import childProcess from 'node:child_process';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const scenario = ${JSON.stringify(scenario)};
    const trace = { events: [], sqlBounded: true, httpBounded: true, anonymousBearer: null, fixtureHex: '' };
    const secret = 'SYNTHETIC_PASSWORD_DO_NOT_LOG';
    process.on('exit', () => console.log('G16_TEST_TRACE=' + JSON.stringify(trace)));
    const realLog = console.log;
    console.log = (...args) => {
      if (String(args[0]).startsWith('G16 hosted private-media Storage smoke passed')) trace.events.push('storage_pass');
      realLog(...args);
    };
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('/worker/whatsapp-verify.ts')) return {
          url: new URL(specifier, context.parentURL).href, shortCircuit: true,
        };
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
      if (url.endsWith('/worker/whatsapp-verify.ts')) return {
        format: 'module', shortCircuit: true,
        source: \`export const normalizeWhatsappPhone = value => value;
          export const netgsmWhatsappConfigured = () => ({ usercode: '0000000000', password: 'fake' });
          export const sendWhatsappVerificationCode = async () => ({ status: 'sent', providerCode: '00' });\`,
      };
      return nextLoad(url, context);
    }});
    childProcess.execFileSync = (name, args, options) => {
      if (name !== 'psql') throw new Error('Unexpected subprocess');
      trace.sqlBounded &&= Number.isFinite(options.timeout) && options.timeout > 0 && options.timeout <= 30000
        && Number.isFinite(options.maxBuffer) && options.maxBuffer <= 131072;
      const sql = args.at(-1);
      const seed = sql.includes('insert into public.customers');
      const cleanup = sql.includes('delete from public.appointment_groups');
      if (seed) trace.events.push('seed');
      if (cleanup) trace.events.push('fixture_cleanup');
      if ((seed && scenario.seedFailure) || (cleanup && scenario.cleanupFailure)) {
        const error = new Error('psql postgresql://postgres:' + secret + '@database.invalid/db');
        error.status = 2;
        error.stdout = secret;
        error.stderr = secret;
        throw error;
      }
      if (sql.includes('storage.objects')) {
        trace.events.push('storage_metadata_readback');
        return scenario.metadataRemains ? '1' : '0';
      }
      return '';
    };
    syncBuiltinESMExports();
    let fixture = Buffer.alloc(0);
    let deleted = false;
    const id = 'f1600000-0000-4000-8000-000000000304';
    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json', ...headers },
    });
    const denied = (name) => {
      const override = scenario[name];
      return override
        ? (override.html ? new Response('not a Storage response', { status: override.status }) : json(override.body ?? { code: 'SlowDown' }, override.status))
        : json({ code: 'NoSuchKey', message: 'Object not found' }, 404);
    };
    globalThis.fetch = async (input, init = {}) => {
      trace.httpBounded &&= init.signal instanceof AbortSignal;
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const method = init.method ?? 'GET';
      const foreign = headers.get('cookie')?.includes('owner=b');
      if (url.hostname === 'app.invalid') {
        if (url.pathname === '/api/csrf') return json({ csrfToken: 'C'.repeat(43) }, 200, { 'set-cookie': 'yzt_csrf=' + 'C'.repeat(43) + '; Path=/' });
        if (url.pathname === '/api/auth/login') return json({ ok: true }, 200, { 'set-cookie': 'owner=' + (JSON.parse(init.body).email.startsWith('b@') ? 'b' : 'a') + '; Path=/' });
        if (url.pathname.endsWith('/photos') && method === 'POST') {
          trace.events.push('upload');
          fixture = Buffer.from(init.body);
          trace.fixtureHex = fixture.toString('hex');
          if (scenario.uploadLost) throw new Error('network detail ' + secret);
          return json({ photo: { id: scenario.invalidUploadId ? 'invalid' : id } }, 201);
        }
        if (url.pathname.endsWith('/content')) {
          if (foreign) return denied('workerDenied');
          const bytes = Buffer.from(fixture);
          if (scenario.workerCorrupt) bytes[bytes.length - 1] ^= 1;
          return new Response(bytes, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' } });
        }
        if (method === 'DELETE') {
          trace.events.push('media_delete');
          if (scenario.deleteFailure) return json({ error: 'DELETE_FAILED' }, 503);
          deleted = true;
          return json({ deleted: true });
        }
      }
      if (url.hostname === 'storage.invalid') {
        if (url.pathname === '/auth/v1/token') return json({ access_token: JSON.parse(init.body).email.startsWith('b@') ? 'owner-b' : 'owner-a' });
        if (url.pathname.startsWith('/storage/v1/object/appointment-private-media/')) {
          const auth = headers.get('authorization');
          if (deleted) return denied('afterDelete');
          if (auth === 'Bearer owner-b') return denied('storageDenied');
          if (auth !== 'Bearer owner-a') {
            trace.anonymousBearer = auth;
            trace.events.push('anonymous_read');
            return denied('anonDenied');
          }
          const bytes = Buffer.from(fixture);
          if (scenario.storageCorrupt) bytes[bytes.length - 1] ^= 1;
          return new Response(bytes, { headers: { 'content-type': 'image/webp' } });
        }
      }
      throw new Error('Unexpected network request blocked');
    };
    await import(${JSON.stringify(runner)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', bootstrap], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024,
    env: {
      PATH: process.env.PATH,
      STAGING_APP_ORIGIN: 'https://app.invalid',
      STAGING_DATABASE_URL: 'postgresql://postgres:SYNTHETIC_PASSWORD_DO_NOT_LOG@database.invalid/db',
      SUPABASE_URL: 'https://storage.invalid', SUPABASE_ANON_KEY: 'sb_publishable_synthetic',
      STAGING_OWNER_A_EMAIL: 'a@example.invalid', STAGING_OWNER_A_PASSWORD: 'synthetic-a',
      STAGING_OWNER_B_EMAIL: 'b@example.invalid', STAGING_OWNER_B_PASSWORD: 'synthetic-b',
      NETGSM_USERCODE: '0000000000', NETGSM_PASSWORD: 'synthetic-netgsm',
      NETGSM_ACCEPTANCE_PHONE: '+905000000000',
    },
  });
  assert.ifError(result.error);
  const traceLine = result.stdout.split('\n').find((line) => line.startsWith('G16_TEST_TRACE='));
  assert.ok(traceLine, result.stderr);
  const trace = JSON.parse(traceLine.slice('G16_TEST_TRACE='.length));
  assert.ok(trace.events.includes('seed'), 'Runner must reach the scenario, not fail during setup: ' + result.stderr);
  return { ...result, trace };
}

function assertFailure(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /G16 hosted (?:acceptance passed|private-media Storage smoke passed)/);
}

test('G16 actual acceptance runner succeeds for matching bytes and expected denials', () => {
  const result = runScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /G16 hosted acceptance passed/);
});
for (const fault of ['workerCorrupt', 'storageCorrupt']) {
  test(`G16 rejects same-length corruption: ${fault}`, () => {
    const result = runScenario({ [fault]: true });
    assertFailure(result);
    assert.match(result.stderr, fault === 'workerCorrupt' ? /Worker read failed/ : /owner RLS read failed/);
  });
}
for (const step of ['workerDenied', 'storageDenied', 'anonDenied', 'afterDelete']) {
  test(`G16 never treats throttling as isolation or deletion evidence: ${step}`, () => {
    const result = runScenario({ [step]: { status: 429 } });
    assertFailure(result);
    assert.match(result.stderr, /HTTP 429/);
  });
}
for (const [name, reply] of Object.entries({
  invalidJwt: { status: 401, body: { code: 'InvalidJWT' } },
  absentBucket: { status: 404, body: { code: 'NoSuchBucket' } },
  malformed: { status: 400, body: { code: 'InvalidRequest' } },
  html404: { status: 404, html: true },
})) {
  test(`G16 rejects unrelated Storage failures: ${name}`, () => {
    const result = runScenario({ storageDenied: reply });
    assertFailure(result);
    assert.match(result.stderr, /cross-tenant RLS denial/);
  });
}

test('G16 accepts the legacy object-not-found response without accepting arbitrary HTTP 400', () => {
  const reply = { status: 400, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } };
  const result = runScenario({ storageDenied: reply, anonDenied: reply, afterDelete: reply });
  assert.equal(result.status, 0, result.stderr);
});

test('G16 anonymous Storage probe has no bearer credentials', () => {
  const result = runScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.trace.events.includes('anonymous_read'));
  assert.equal(result.trace.anonymousBearer, null);
});

test('G16 uses a complete WebP fixture and emits PASS after fixture cleanup', () => {
  const { trace } = runScenario();
  const bytes = Buffer.from(trace.fixtureHex, 'hex');
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  assert.ok(trace.events.indexOf('storage_pass') > trace.events.indexOf('fixture_cleanup'));
});

test('G16 database and HTTP operations have explicit finite timeouts', () => {
  const { trace } = runScenario();
  assert.equal(trace.sqlBounded, true);
  assert.equal(trace.httpBounded, true);
});

test('G16 cleanup failure prevents PASS and never prints raw SQL credentials', () => {
  const result = runScenario({ cleanupFailure: true });
  assertFailure(result);
  assert.doesNotMatch(result.stderr + result.stdout, /SYNTHETIC_PASSWORD_DO_NOT_LOG|postgresql:\/\//);
});
for (const fault of ['uploadLost', 'invalidUploadId']) {
  test(`G16 retains fixture authorization after an ambiguous upload: ${fault}`, () => {
    const result = runScenario({ [fault]: true });
    assertFailure(result);
    assert.equal(result.trace.events.includes('fixture_cleanup'), false);
    assert.match(result.stderr, /recovery/);
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PASSWORD_DO_NOT_LOG/);
  });
}

test('G16 attempts exact-ID cleanup after a failed fixture seed', () => {
  const result = runScenario({ seedFailure: true });
  assertFailure(result);
  assert.ok(result.trace.events.includes('fixture_cleanup'));
  assert.doesNotMatch(result.stderr, /SYNTHETIC_PASSWORD_DO_NOT_LOG/);
});

test('G16 retains the primary failure when fixture cleanup also fails', () => {
  const result = runScenario({ workerCorrupt: true, cleanupFailure: true });
  assertFailure(result);
  assert.match(result.stderr, /Worker read failed/);
  assert.match(result.stderr, /cleanup failed/);
});

test('G16 refuses deletion evidence while the Storage metadata row remains', () => {
  const result = runScenario({ metadataRemains: true });
  assertFailure(result);
  assert.ok(result.trace.events.includes('storage_metadata_readback'));
});


test('G16 accepts explicit access-denied semantics for tenant and anonymous reads', () => {
  const reply = { status: 403, body: { code: 'AccessDenied' } };
  const result = runScenario({ storageDenied: reply, anonDenied: reply });
  assert.equal(result.status, 0, result.stderr);
});

test('G16 does not treat access denial as proof of post-delete object absence', () => {
  const result = runScenario({ afterDelete: { status: 403, body: { code: 'AccessDenied' } } });
  assertFailure(result);
  assert.match(result.stderr, /post-delete read/);
});

test('G16 preserves recovery context when media deletion fails', () => {
  const result = runScenario({ deleteFailure: true });
  assertFailure(result);
  assert.equal(result.trace.events.filter((event) => event === 'media_delete').length, 2);
  assert.equal(result.trace.events.includes('fixture_cleanup'), false);
  assert.match(result.stderr, /cleanup.*failed/);
  assert.match(result.stderr, /recovery required/);
});
