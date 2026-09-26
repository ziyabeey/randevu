const STATUSES = new Set([
  'planned',
  'preregistered',
  'measurement-ready',
  'running',
  'passed',
  'failed',
  'incomparable',
  'locked',
  'superseded',
]);

const TRANSITIONS = Object.freeze({
  planned: new Set(['preregistered', 'locked', 'superseded']),
  locked: new Set(['planned', 'preregistered', 'superseded']),
  preregistered: new Set(['measurement-ready', 'running', 'locked', 'superseded']),
  'measurement-ready': new Set(['running', 'passed', 'failed', 'incomparable', 'locked', 'superseded']),
  running: new Set(['passed', 'failed', 'incomparable', 'locked', 'superseded']),
  passed: new Set(['superseded']),
  failed: new Set(['superseded']),
  incomparable: new Set(['superseded']),
  superseded: new Set(),
});

export function createLedger({
  method = 'H19',
  version = 1,
  metadata = {},
} = {}) {
  return { version, method, metadata: structuredClone(metadata), experiments: [] };
}

function assertRecord(record) {
  if (!record?.id || !STATUSES.has(record.status)) {
    throw new TypeError('experiment record requires id and a valid status');
  }
}

function writeExperiment(ledger, record) {
  const copy = structuredClone(ledger);
  const index = copy.experiments.findIndex((x) => x.id === record.id);
  if (index >= 0) copy.experiments[index] = structuredClone(record);
  else copy.experiments.push(structuredClone(record));
  return copy;
}

export function upsertExperiment(ledger, record) {
  assertRecord(record);
  const current = ledger.experiments.find((x) => x.id === record.id);
  if (current && current.status !== record.status) {
    throw new Error(`status change for ${record.id} must use transitionExperiment(): ${current.status} → ${record.status}`);
  }
  return writeExperiment(ledger, record);
}

export function canTransition(from, to) {
  if (!STATUSES.has(from) || !STATUSES.has(to)) return false;
  return TRANSITIONS[from].has(to);
}

export function transitionExperiment(ledger, id, {
  status,
  patch = {},
} = {}) {
  if (!STATUSES.has(status)) throw new TypeError(`invalid experiment status: ${status}`);
  const current = ledger.experiments.find((x) => x.id === id);
  if (!current) throw new Error(`unknown experiment: ${id}`);
  if (status !== current.status && !canTransition(current.status, status)) {
    throw new Error(`invalid experiment transition: ${current.status} → ${status}`);
  }
  return writeExperiment(ledger, { ...current, ...structuredClone(patch), id, status });
}

export function validateLedger(ledger) {
  if (!Array.isArray(ledger?.experiments)) throw new Error('ledger.experiments must be an array');
  const ids = new Set();
  for (const row of ledger.experiments) {
    assertRecord(row);
    if (ids.has(row.id)) throw new Error(`duplicate experiment id: ${row.id}`);
    ids.add(row.id);
  }
  return ledger;
}
