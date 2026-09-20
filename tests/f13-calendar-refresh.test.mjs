import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALENDAR_REFRESH_INTERVAL_MS,
  CalendarRefreshScheduler,
  LatestCalendarRequest,
} from '../src/calendar-refresh.ts';

test('F13 calendar request gate aborts and rejects an older generation', () => {
  const gate = new LatestCalendarRequest();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);

  gate.complete(first);
  assert.equal(gate.isCurrent(second), true, 'an old completion cannot release the current request');
  gate.cancel();
  assert.equal(second.controller.signal.aborted, true);
  assert.equal(gate.isCurrent(second), false);
});

test('F13 calendar refresh polls visibly, pauses while hidden, and refreshes once on return', () => {
  let visible = true;
  let now = 0;
  let refreshes = 0;
  let nextHandle = 0;
  const timers = new Map();
  const scheduler = new CalendarRefreshScheduler({
    isVisible: () => visible,
    onRefresh: () => { refreshes += 1; },
    now: () => now,
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, CALENDAR_REFRESH_INTERVAL_MS);
      const handle = ++nextHandle;
      timers.set(handle, callback);
      return handle;
    },
    unschedule: (handle) => { timers.delete(handle); },
  });

  scheduler.start();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(refreshes, 1, 'visible interval refreshes the calendar');

  visible = false;
  scheduler.visibilityChanged();
  assert.equal(timers.size, 0, 'hidden tabs have no polling timer');

  visible = true;
  now = 10_000;
  scheduler.visibilityChanged();
  assert.equal(refreshes, 2, 'becoming visible refreshes immediately');
  assert.equal(timers.size, 1);

  now = 10_100;
  scheduler.focused();
  assert.equal(refreshes, 2, 'the matching focus event is coalesced');
  assert.equal(timers.size, 1, 'coalescing also leaves exactly one timer');

  now = 12_000;
  scheduler.focused();
  assert.equal(refreshes, 3, 'a later genuine focus return refreshes once');

  scheduler.dispose();
  assert.equal(timers.size, 0);
});
