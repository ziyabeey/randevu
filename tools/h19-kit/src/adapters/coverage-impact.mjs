function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function coveredLinesFromIstanbulFile(file) {
  const lines = new Set();
  const statements = file?.statementMap ?? {};
  const hits = file?.s ?? {};
  for (const [id, loc] of Object.entries(statements)) {
    if (!(Number(hits[id]) > 0)) continue;
    const start = Number(loc?.start?.line);
    const end = Number(loc?.end?.line ?? start);
    if (!Number.isFinite(start)) continue;
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

export function istanbulLines(report) {
  const out = new Map();
  for (const [path, file] of Object.entries(report ?? {})) {
    out.set(normalizePath(path), coveredLinesFromIstanbulFile(file));
  }
  return out;
}

export function coveragePyLines(report) {
  const out = new Map();
  for (const [path, file] of Object.entries(report?.files ?? {})) {
    const lines = new Set((file?.executed_lines ?? []).map(Number).filter(Number.isFinite));
    out.set(normalizePath(path), lines);
  }
  return out;
}

export function unitsCoveredByLines(units, coverageByFile) {
  const covered = [];
  for (const unit of units) {
    const lines = coverageByFile.get(normalizePath(unit.path));
    if (!lines?.size) continue;
    let hit = false;
    for (const line of lines) {
      if (line >= unit.startLine && line <= unit.endLine) {
        hit = true;
        break;
      }
    }
    if (hit) covered.push(unit);
  }
  return covered;
}

export function applyTestCoverage(store, {
  testId,
  units,
  coverageByFile,
  provider,
  sourceDigest = null,
  observedAt = null,
} = {}) {
  if (!testId) throw new TypeError('testId is required');
  const covered = unitsCoveredByLines(units, coverageByFile);
  for (const unit of covered) {
    if (!unit.digest) continue;
    store.addTests(unit.digest, {
      tests: [testId],
      provider,
      sourceDigest,
      observedAt,
    });
  }
  return covered.map((x) => x.id);
}
