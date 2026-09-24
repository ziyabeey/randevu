import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheKey } from '../core/cache.mjs';

export class MutationHistory {
  constructor(file = '.h19/mutation-history.v1.json') {
    this.file = file;
    this.data = { version: 1, entries: {} };
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
        throw new Error('unsupported mutation history');
      }
      this.data = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return this;
  }

  key({ sourceDigest, mutatorId, mutatorVersion, contextDigest = null }) {
    return cacheKey('mutation-v1', { sourceDigest, mutatorId, mutatorVersion, contextDigest });
  }

  has(spec) {
    return Boolean(this.data.entries[this.key(spec)]);
  }

  get(spec) {
    return this.data.entries[this.key(spec)] ?? null;
  }

  record(spec, result) {
    const key = this.key(spec);
    this.data.entries[key] = {
      ...structuredClone(spec),
      result: structuredClone(result),
    };
    return key;
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    await rename(tmp, this.file);
    return this.file;
  }
}
