import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KEY_NAMES, pinBindings } from '../scripts/staging-deployment.mjs';

// Executes the pinned real Wrangler against a local fake Cloudflare boundary.
// Captures the actual multipart upload metadata, without any live credentials.
test('S05 real pinned Wrangler uploads explicit active-version inheritance for every preserved critical secret', { timeout: 30000 }, async () => {
  const previous = '50500000-0000-4000-8000-000000000001';
  const fixture = await mkdtemp(path.join(tmpdir(), 'randevu-s05-wrangler-'));
  const seen = [];
  let captured;
  let complete;
  const capturedPromise = new Promise((resolve) => { complete = resolve; });
  const server = createServer(async (req, res) => {
    try {
      seen.push(`${req.method} ${req.url}`);
      const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, errors: [], messages: [], result })); };
      if (req.method === 'POST' && req.url.includes('/versions')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
        captured = JSON.parse(String(form.get('metadata')));
        reply({ id: '50500000-0000-4000-8000-000000000002', resources: { script: { etag: 'fixture' } }, startup_time_ms: 1 });
        complete();
        return;
      }
      if (req.url.includes('/services/')) return reply({ default_environment: { environment: 'production', script: { last_deployed_from: 'wrangler', compatibility_date: '2026-09-10' } }, environments: [{ environment: 'production' }] });
      if (req.url.endsWith('/subdomain')) return reply({ subdomain: 'fixture', enabled: true, previews_enabled: false });
      if (req.url.endsWith('/deployments')) return reply({ deployments: [{ versions: [{ version_id: previous, percentage: 100 }] }] });
      if (req.url.endsWith('/versions')) return reply({ items: [{ id: previous }] });
      if (req.url.includes('/versions/')) return reply({ id: previous, resources: { bindings: KEY_NAMES.map((name) => ({ name, type: 'secret_text' })) } });
      if (req.url.endsWith('/settings') || req.url.endsWith('/script-settings')) return reply({ bindings: [], tags: [] });
      reply([]);
    } catch (error) { res.writeHead(500); res.end('fixture error'); complete(error); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let child;
  try {
    await writeFile(path.join(fixture, 'worker.js'), 'export default { fetch() { return new Response("fixture"); } };');
    await writeFile(path.join(fixture, 'wrangler.json'), JSON.stringify(pinBindings({ name: 's05-fixture', main: 'worker.js', compatibility_date: '2026-09-10', secrets: { required: KEY_NAMES } }, previous, {})));
    await writeFile(path.join(fixture, 'secrets.json'), '{}', { mode: 0o600 });
    const childEnv = { ...process.env, CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      CLOUDFLARE_API_TOKEN: 'fake-fixture-token', WRANGLER_SEND_METRICS: 'false', CI: 'true' };
    for (const key of Object.keys(childEnv)) if (/proxy/i.test(key)) delete childEnv[key];
    child = spawn(process.execPath, [path.resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', path.join(fixture, 'wrangler.json'), '--secrets-file', path.join(fixture, 'secrets.json')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    await Promise.race([capturedPromise, new Promise((resolve) => child.once('exit', resolve))]);
    assert.ok(captured, `Wrangler did not upload metadata. Requests: ${seen.join(', ')}. Output: ${output.slice(-2500)}`);
    for (const name of KEY_NAMES) {
      const matches = captured.bindings.filter((binding) => binding.name === name);
      assert.deepEqual(matches, [{ name, type: 'inherit', version_id: previous }]);
    }
  } finally {
    child?.kill('SIGTERM');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(fixture, { recursive: true, force: true });
  }
});
