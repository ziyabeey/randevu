import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureTeamInviteFromLocation,
  clearPendingTeamInvite,
  parseTeamInviteHash,
  readPendingTeamInvite,
} from '../src/teamInvite.ts';

const token = 'A'.repeat(43);

function browser(pathname = '/', hash = '') {
  const store = new Map();
  let replaced = null;
  globalThis.window = {
    location: { pathname, search: '?from=test', hash },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); },
      removeItem: (key) => { store.delete(key); },
    },
  };
  return { store, replaced: () => replaced };
}

test('F10 invite capability accepts only the bounded fragment token shape', () => {
  assert.equal(parseTeamInviteHash(`#invite=${token}`), token);
  assert.equal(parseTeamInviteHash('#invite=short'), null);
  assert.equal(parseTeamInviteHash(`#invite=${'A'.repeat(42)}!`), null);
  assert.equal(parseTeamInviteHash(`#other=${token}`), null);
});

test('F10 invite fragment is scrubbed before app requests and survives only in tab-scoped state', () => {
  const page = browser('/', `#invite=${token}`);
  assert.equal(captureTeamInviteFromLocation(), token);
  assert.equal(page.replaced(), '/?from=test');
  assert.equal(readPendingTeamInvite(), token);
  assert.equal([...page.store.values()].includes(token), true);

  clearPendingTeamInvite();
  assert.equal(readPendingTeamInvite(), null);
  assert.equal([...page.store.values()].includes(token), false);
  delete globalThis.window;
});

test('F10 management capability hash is never consumed as an invitation', () => {
  const page = browser('/m', `#invite=${token}`);
  assert.equal(captureTeamInviteFromLocation(), null);
  assert.equal(page.replaced(), null);
  assert.equal(readPendingTeamInvite(), null);
  delete globalThis.window;
});
