import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(namespace, input) {
  return createHash('sha256').update(`${namespace}\0${stableJson(input)}`).digest('hex');
}

export class FileCache {
  constructor(root = '.h19/cache') {
    this.root = root;
  }

  pathFor(namespace, key) {
    return path.join(this.root, namespace, `${key}.json`);
  }

  async get(namespace, key) {
    try {
      return JSON.parse(await readFile(this.pathFor(namespace, key), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(namespace, key, value) {
    const target = this.pathFor(namespace, key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tmp, target);
    return target;
  }
}
