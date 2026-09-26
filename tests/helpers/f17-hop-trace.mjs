// Test-only observer. It has no network transport and retains no request data.
const endpoints = new Map([
  ['GET /auth/v1/user', 'auth_user'],
  ['GET /rest/v1/memberships', 'memberships'],
  ['GET /rest/v1/businesses', 'business'],
  ['GET /rest/v1/staff_profiles', 'staff'],
  ['POST /rest/v1/rpc/get_calendar_appointments_v2', 'calendar_v2'],
]);

export function createHopTrace(respond) {
  if (typeof respond !== 'function') throw new TypeError('A synthetic responder is required');
  const records = [];
  let active = 0;
  let peak = 0;
  let wave = 0;
  let order = 0;
  let rejected = false;

  async function fetch(input, init = {}) {
    let endpoint;
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.origin === 'https://supabase.example.test' && !url.username && !url.password) {
        endpoint = endpoints.get(`${method} ${url.pathname}`);
      }
    } catch { /* Never reflect input, headers or credentials in an error. */ }
    if (!endpoint || records.length >= 64) {
      rejected = true;
      throw new Error('F17 hop trace refused an unexpected request or exceeded its call limit');
    }
    if (active === 0) wave += 1;
    active += 1;
    peak = Math.max(peak, active);
    const record = { endpoint, wave, start: ++order, end: null, status: null, outcome: 'pending' };
    records.push(record);
    try {
      const response = await respond(endpoint, input, init);
      if (!(response instanceof Response)) throw new TypeError('Synthetic responder must return Response');
      record.status = response.status;
      record.outcome = 'response';
      return response;
    } catch (error) {
      record.outcome = 'rejected';
      throw error;
    } finally {
      record.end = ++order;
      active -= 1;
    }
  }

  function snapshot() {
    if (active || rejected) throw new Error('F17 hop trace is incomplete or contains refused requests');
    return {
      upstreamCalls: records.length,
      peakInFlight: peak,
      overlapWaves: Array.from({ length: wave }, (_, index) =>
        records.filter((record) => record.wave === index + 1).map((record) => record.endpoint)),
      calls: records.map((record) => ({ ...record })),
    };
  }
  return { fetch, snapshot };
}
