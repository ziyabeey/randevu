import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertSafeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return segments;
}

/**
 * Recursively finds files below `dir`, returning sorted POSIX-style paths
 * relative to `root`. Any symlink or path escape makes discovery fail closed.
 */
export async function discoverFiles(root, dir, suffix) {
  if (typeof suffix !== 'string' || suffix.length === 0 || suffix.includes('\0')) {
    throw new Error('suffix must be a non-empty string');
  }

  const rootPath = path.resolve(root);
  const rootStat = await lstat(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('root must be a real directory');
  }

  const dirSegments = assertSafeRelativePath(dir, 'directory');
  let start = rootPath;
  for (const segment of dirSegments) {
    start = path.join(start, segment);
    const stat = await lstat(start);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${dir} must contain only real directories`);
    }
  }
  if (!inside(rootPath, start)) throw new Error('directory must stay inside the repository');

  const found = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      const candidate = path.resolve(directory, entry.name);
      if (!inside(start, candidate) || !inside(rootPath, candidate)) {
        throw new Error(`discovered path escapes the repository: ${entry.name}`);
      }

      const stat = await lstat(candidate);
      const relative = path.relative(rootPath, candidate).split(path.sep).join('/');
      if (stat.isSymbolicLink()) throw new Error(`symlinks are not allowed: ${relative}`);
      if (stat.isDirectory()) {
        await walk(candidate);
      } else if (stat.isFile()) {
        if (entry.name.endsWith(suffix)) found.push(relative);
      } else {
        throw new Error(`unsupported filesystem entry: ${relative}`);
      }
    }
  }

  await walk(start);
  return found.sort((left, right) => left.localeCompare(right, 'en'));
}
