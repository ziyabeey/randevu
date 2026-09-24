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

export function createLedger({
  method = 'H19',
  version = 1,
  metadata = {},
} = {}) {
  return { version, method, metadata: structuredClone(metadata), experiments: [] };
}

export function upsertExperiment(ledger, record) {
  if (!record?.id || !STATUSES.has(record.status)) {
    throw new TypeError('experiment record requires id and a valid status');
  }
  const copy = structuredClone(ledger);
  const index = copy.experiments.findIndex((x) => x.id === record.id);
  if (index >= 0) copy.experiments[index] = structuredClone(record);
  else copy.experiments.push(structuredClone(record));
  return copy;
}

export function transitionExperiment(ledger, id, {
  status,
  patch = {},
} = {}) {
  if (!STATUSES.has(status)) throw new TypeError(`invalid experiment status: ${status}`);
  const current = ledger.experiments.find((x) => x.id === id);
  if (!current) throw new Error(`unknown experiment: ${id}`);
  return upsertExperiment(ledger, { ...current, ...structuredClone(patch), id, status });
}

export function validateLedger(ledger) {
  if (!Array.isArray(ledger?.experiments)) throw new Error('ledger.experiments must be an array');
  const ids = new Set();
  for (const row of ledger.experiments) {
    if (!row.id || !STATUSES.has(row.status)) throw new Error('invalid experiment row');
    if (ids.has(row.id)) throw new Error(`duplicate experiment id: ${row.id}`);
    ids.add(row.id);
  }
  return ledger;
}
