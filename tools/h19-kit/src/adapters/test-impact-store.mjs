import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class TestImpactStore {
  constructor(file = '.h19/test-impact.v1.json') {
    this.file = file;
    this.data = { version: 1, units: {} };
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (parsed.version !== 1 || typeof parsed.units !== 'object') {
        throw new Error('unsupported test-impact store');
      }
      this.data = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return this;
  }

  record(unitDigest, {
    tests = [],
    provider = 'custom',
    sourceDigest = null,
    observedAt = null,
  } = {}) {
    if (!unitDigest) throw new TypeError('unitDigest is required');
    this.data.units[unitDigest] = {
      tests: [...new Set(tests)].sort(),
      provider,
      sourceDigest,
      observedAt,
    };
    return this.data.units[unitDigest];
  }

  get(unitDigest) {
    return this.data.units[unitDigest] ?? null;
  }

  impacted(unitDigests = []) {
    const tests = new Set();
    const unknownUnits = [];
    for (const digest of unitDigests) {
      const row = this.get(digest);
      if (!row) {
        unknownUnits.push(digest);
        continue;
      }
      for (const test of row.tests) tests.add(test);
    }
    return {
      impactedTests: [...tests].sort(),
      unknownUnits,
      known: unknownUnits.length === 0,
    };
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    await rename(tmp, this.file);
    return this.file;
  }
}
