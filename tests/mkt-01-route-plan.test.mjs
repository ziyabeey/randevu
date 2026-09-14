import assert from 'node:assert/strict';
import test from 'node:test';

const routePlan = await import('../src/marketing/routePlan.ts');

const {
  MARKETING_HOME_PATH,
  WORKSPACE_HOME_PATH,
  resolveMarketingRouteSurface,
} = routePlan;

test('MKT-01 production route plan preserves the pending invite flow at root', () => {
  assert.equal(MARKETING_HOME_PATH, '/');
  assert.equal(WORKSPACE_HOME_PATH, '/app');

  assert.equal(
    resolveMarketingRouteSurface({ path: '/', hasPendingTeamInvite: true }),
    'invite',
  );

  assert.equal(
    resolveMarketingRouteSurface({ path: '/', hasPendingTeamInvite: false }),
    'marketing',
  );
});

test('MKT-01 production route plan moves the existing workspace root to /app without stealing product routes', () => {
  assert.equal(
    resolveMarketingRouteSurface({ path: '/app', hasPendingTeamInvite: false }),
    'workspace',
  );
  assert.equal(
    resolveMarketingRouteSurface({ path: '/app/', hasPendingTeamInvite: false }),
    'workspace',
  );

  for (const path of ['/calendar', '/bookings', '/customers', '/availability', '/team', '/public-booking', '/r/demo']) {
    assert.equal(
      resolveMarketingRouteSurface({ path, hasPendingTeamInvite: false }),
      'other',
      `Marketing route plan must not claim ${path}`,
    );
  }
});
