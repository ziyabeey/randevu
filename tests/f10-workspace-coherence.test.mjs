import assert from 'node:assert/strict';
import test from 'node:test';
import { api, ApiRequestError, clearCsrfToken, seedCsrfToken, setWorkspaceGuard } from '../src/api.ts';
import {
  installWorkspaceCoherence,
  noteWorkspaceResponse,
  resetWorkspaceCoherenceForTests,
  workspaceGuard,
  workspaceWriteAllowed,
} from '../src/workspace-coherence.ts';

// F10-06 cross-tab coherence. The origin-wide session/business cookie can move
// in another tab; a tab must never write to, or keep presenting, a context it
// is not showing. These cases pin the guard itself; the real-Chrome
// choreography lives in the F10-06 management acceptance.

const userId = 'fa000000-0000-4000-8000-000000000001';
const businessA = 'fa100000-0000-4000-8000-000000000001';
const businessB = 'fa100000-0000-4000-8000-000000000002';

function session(businessId, user = userId) {
  return { user: user ? { id: user } : null, activeBusinessId: user ? businessId : null, memberships: [] };
}

function harness({ server = () => ({ status: 200, body: session(businessA) }) } = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const calls = [];
  let reloads = 0;
  const add = (map) => (type, fn) => { map.set(type, [...(map.get(type) ?? []), fn]); };
  const remove = (map) => (type, fn) => { map.set(type, (map.get(type) ?? []).filter((item) => item !== fn)); };
  globalThis.window = {
    addEventListener: add(listeners.window),
    removeEventListener: remove(listeners.window),
    location: { reload: () => { reloads += 1; } },
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: add(listeners.document),
    removeEventListener: remove(listeners.document),
  };
  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    calls.push({ path, method: (init.method ?? 'GET').toUpperCase() });
    if (path === '/api/session') {
      const answer = server();
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  return {
    calls,
    reloads: () => reloads,
    fire(target, type, event = {}) {
      for (const fn of listeners[target].get(type) ?? []) fn(event);
    },
  };
}

function reset() {
  resetWorkspaceCoherenceForTests();
  setWorkspaceGuard(null);
  clearCsrfToken();
}

test.afterEach(reset);

await test('an uninstalled page (public or customer management) is never gated', async () => {
  const env = harness({ server: () => ({ status: 200, body: session(businessB) }) });
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), true);
  assert.equal(env.calls.length, 0);
});

await test('a write is refused and the page reloads when another tab moved the shared business', async () => {
  let current = businessA;
  const env = harness({ server: () => ({ status: 200, body: session(current) }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  current = businessB;
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), false);
  assert.equal(env.reloads(), 1);
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), false, 'a reloading page kept writing');
  assert.equal(env.reloads(), 1, 'reload was requested twice');
});

await test('a sign-out in another tab refuses the write instead of letting it fail later', async () => {
  let signedIn = true;
  const env = harness({ server: () => ({ status: 200, body: session(businessA, signedIn ? userId : null) }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  signedIn = false;
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), false);
  assert.equal(env.reloads(), 1);
});

await test("the tab's own business switch moves its binding instead of tripping the guard", async () => {
  let current = businessA;
  const env = harness({ server: () => ({ status: 200, body: session(current) }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  assert.equal(await workspaceWriteAllowed('/api/businesses/select'), true, 'the switch itself was gated');
  current = businessB;
  noteWorkspaceResponse('/api/businesses/select', 'POST', JSON.stringify({ businessId: businessB }), { ok: true });
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), true);
  assert.equal(env.reloads(), 0);
});

await test('sign-in and sign-out requests are never gated and re-establish the binding', async () => {
  let current = session(businessA);
  const env = harness({ server: () => ({ status: 200, body: current }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  const before = env.calls.length;
  assert.equal(await workspaceWriteAllowed('/api/auth/logout'), true);
  assert.equal(env.calls.length, before, 'sign-out consulted the session first');
  noteWorkspaceResponse('/api/auth/logout', 'POST', '{}', { ok: true });
  current = session(null, null);
  noteWorkspaceResponse('/api/session', 'GET', undefined, current);
  assert.equal(await workspaceWriteAllowed('/api/auth/login'), true);
  assert.equal(env.reloads(), 0);
});

await test('an unverifiable session (transient 503) is never treated as a context change', async () => {
  const env = harness({ server: () => ({ status: 503, body: { error: { code: 'SESSION_UNAVAILABLE' } } }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), true);
  assert.equal(env.reloads(), 0);
});

await test('returning to a tab re-verifies it; a normal load does not add a racing session read', async () => {
  let current = businessA;
  const env = harness({ server: () => ({ status: 200, body: session(current) }) });
  installWorkspaceCoherence({ readsSessionItself: true });

  env.fire('window', 'pageshow', { persisted: false });
  env.fire('window', 'focus');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.calls.length, 0, 'the guard read the session before the page established its context');

  noteWorkspaceResponse('/api/session', 'GET', undefined, session(businessA));
  current = businessB;
  env.fire('window', 'focus');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(env.reloads(), 1, 'returning to a drifted tab did not reload it');
});

await test('a page that does not read the session itself captures its binding once at start', async () => {
  let current = businessA;
  const env = harness({ server: () => ({ status: 200, body: session(current) }) });
  installWorkspaceCoherence({ readsSessionItself: false });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(env.calls.filter((call) => call.path === '/api/session').length, 1);
  current = businessB;
  assert.equal(await workspaceWriteAllowed('/api/team/invitations'), false);
});

await test('the API client never sends a drifted write and reports a typed conflict', async () => {
  let current = businessA;
  const env = harness({ server: () => ({ status: 200, body: session(current) }) });
  installWorkspaceCoherence({ readsSessionItself: true });
  setWorkspaceGuard(workspaceGuard);
  seedCsrfToken('C'.repeat(43));
  await api('/api/session');
  current = businessB;
  await assert.rejects(
    api('/api/team/invitations', { method: 'POST', body: JSON.stringify({ email: 'x@example.test' }) }),
    (error) => error instanceof ApiRequestError && error.status === 409 && error.code === 'WORKSPACE_CONTEXT_CHANGED',
  );
  assert.equal(env.calls.filter((call) => call.path === '/api/team/invitations').length, 0, 'the drifted write reached the server');
});
