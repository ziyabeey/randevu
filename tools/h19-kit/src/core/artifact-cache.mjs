import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ArtifactCache {
  constructor(root = '.h19/artifacts') {
    this.root = path.resolve(root);
  }

  dirFor(namespace, key) {
    return path.join(this.root, namespace, key);
  }

  fileFor(namespace, key, name) {
    return path.join(this.dirFor(namespace, key), name);
  }

  async has(namespace, key, name) {
    try {
      await access(this.fileFor(namespace, key, name));
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async metadata(namespace, key) {
    try {
      return JSON.parse(await readFile(this.fileFor(namespace, key, 'manifest.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async putFile(namespace, key, name, sourceFile, metadata = null) {
    const dir = this.dirFor(namespace, key);
    await mkdir(dir, { recursive: true });
    const target = this.fileFor(namespace, key, name);
    const tmp = `${target}.tmp-${process.pid}`;
    await copyFile(sourceFile, tmp);
    await rename(tmp, target);

    if (metadata) {
      const manifest = this.fileFor(namespace, key, 'manifest.json');
      const manifestTmp = `${manifest}.tmp-${process.pid}`;
      await writeFile(manifestTmp, `${JSON.stringify(metadata, null, 2)}\n`);
      await rename(manifestTmp, manifest);
    }

    return target;
  }
}
