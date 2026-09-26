import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { formatG16ProviderFailure } from '../scripts/staging-g16-provider-diagnostics.mjs';

const fixed = ['30', '60', '70', '80', '100', 'send_timeout', 'send_network_error', 'not_configured_or_invalid_phone'];
for (const code of fixed) {
  test(`G16 diagnostic retains the fixed failure category ${code}`, () => {
    const value = `netgsm_whatsapp_${code}`;
    assert.equal(formatG16ProviderFailure({ status: 'failed', errorClass: value }), value);
  });
}

for (const status of [100, 200, 301, 400, 401, 403, 429, 500, 503, 599]) {
  test(`G16 diagnostic retains the locally constructed HTTP ${status} category`, () => {
    const value = `netgsm_whatsapp_http_${status}`;
    assert.equal(formatG16ProviderFailure({ status: 'failed', errorClass: value }), value);
  });
}

for (const [label, value] of Object.entries({
  arbitrary: 'SYNTHETIC_PRIVATE_DETAIL',
  unknown: 'netgsm_whatsapp_999',
  success: 'netgsm_whatsapp_00',
  numeric: 30,
  absent: undefined,
  object: { code: 30 },
  appended: 'netgsm_whatsapp_30 SYNTHETIC_PRIVATE_DETAIL',
  newline: 'netgsm_whatsapp_http_403\n',
  prefix: ' netgsm_whatsapp_http_403',
  invalidStatus: 'netgsm_whatsapp_http_600',
  paddedStatus: 'netgsm_whatsapp_http_0403',
  unicodeDigit: 'netgsm_whatsapp_http_４０３',
})) {
  test(`G16 diagnostic rejects unsafe or unrecognized category: ${label}`, () => {
    const output = formatG16ProviderFailure({ status: 'failed', errorClass: value });
    assert.equal(output, 'provider_request_failed');
    assert.doesNotMatch(output, /SYNTHETIC_PRIVATE_DETAIL/);
  });
}

test('G16 diagnostic never reads or serializes unrelated provider fields', () => {
  const result = { status: 'failed', errorClass: 'netgsm_whatsapp_80' };
  for (const key of ['raw', 'description', 'message', 'phone', 'code', 'retryAfterSeconds', 'toJSON']) {
    Object.defineProperty(result, key, { get() { throw new Error('Unrelated field accessed'); } });
  }
  assert.equal(formatG16ProviderFailure(result), 'netgsm_whatsapp_80');
});

test('G16 diagnostic rejects unexpected result states without echoing codes', () => {
  for (const value of [null, undefined, {}, { status: 'sent', providerCode: 'SYNTHETIC_PRIVATE_DETAIL' }]) {
    assert.equal(formatG16ProviderFailure(value), 'unexpected_provider_code');
  }
});

// Run the actual entry point with only its provider module replaced. Network and
// subprocess calls are rejected, so a send failure must stop before Storage I/O.
function runFailure(result) {
  const runner = new URL('../scripts/staging-g16-acceptance.mjs', import.meta.url).href;
  const providerSource = `
    export const normalizeWhatsappPhone = () => '+905000000000';
    export const netgsmWhatsappConfigured = () => ({ usercode: 'synthetic', password: 'synthetic' });
    export const sendWhatsappVerificationCode = async () => {
      console.log('G16_TEST_SEND_ATTEMPT');
      return ${JSON.stringify(result)};
    };
  `;
  const bootstrap = `
    import cp from 'node:child_process';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    cp.execFileSync = () => { throw new Error('UNEXPECTED_EXTERNAL_IO'); };
    syncBuiltinESMExports();
    globalThis.fetch = async () => { throw new Error('UNEXPECTED_EXTERNAL_IO'); };
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier.endsWith('/worker/whatsapp-verify.ts')) return {
          url: new URL(specifier, context.parentURL).href, shortCircuit: true,
        };
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url.endsWith('/worker/whatsapp-verify.ts')) return {
          format: 'module', source: ${JSON.stringify(providerSource)}, shortCircuit: true,
        };
        return next(url, context);
      },
    });
    await import(${JSON.stringify(runner)});
  `;
  const output = spawnSync(process.execPath, ['--input-type=module', '--eval', bootstrap], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024,
    env: {
      PATH: process.env.PATH,
      STAGING_APP_ORIGIN: 'https://app.invalid',
      STAGING_DATABASE_URL: 'postgresql://database.invalid/test',
      SUPABASE_URL: 'https://storage.invalid', SUPABASE_ANON_KEY: 'synthetic',
      STAGING_OWNER_A_EMAIL: 'a@example.invalid', STAGING_OWNER_A_PASSWORD: 'synthetic',
      STAGING_OWNER_B_EMAIL: 'b@example.invalid', STAGING_OWNER_B_PASSWORD: 'synthetic',
      NETGSM_USERCODE: 'synthetic', NETGSM_PASSWORD: 'synthetic',
      NETGSM_ACCEPTANCE_PHONE: '+905000000000',
    },
  });
  assert.ifError(output.error);
  assert.equal(output.status, 1);
  assert.equal(output.stdout.match(/G16_TEST_SEND_ATTEMPT/g)?.length, 1);
  assert.doesNotMatch(output.stdout + output.stderr, /UNEXPECTED_EXTERNAL_IO|SYNTHETIC_PRIVATE_DETAIL/);
  assert.doesNotMatch(output.stdout, /accepted by provider|Storage smoke passed|G16 hosted acceptance passed/);
  return output.stderr;
}

for (const code of ['netgsm_whatsapp_30', 'netgsm_whatsapp_80', 'netgsm_whatsapp_http_403', 'netgsm_whatsapp_send_network_error']) {
  test(`G16 actual runner reports ${code} and stops before Storage`, () => {
    const error = runFailure({ status: 'failed', errorClass: code, description: 'SYNTHETIC_PRIVATE_DETAIL' });
    assert.ok(error.includes(`OTP send failed: ${code}`), 'Specific diagnostic class was lost');
  });
}

test('G16 actual runner withholds unknown failure details', () => {
  const error = runFailure({ status: 'failed', errorClass: 'SYNTHETIC_PRIVATE_DETAIL' });
  assert.match(error, /OTP send failed: provider_request_failed/);
});

test('G16 actual runner still rejects a non-00 send result without echoing it', () => {
  const error = runFailure({ status: 'sent', providerCode: 'SYNTHETIC_PRIVATE_DETAIL' });
  assert.match(error, /OTP send failed: unexpected_provider_code/);
});
