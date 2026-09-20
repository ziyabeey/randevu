import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function createLease(lockDir, owner) {
  mkdirSync(lockDir);
  writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(owner)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return owner.token;
}

export function acquireDirectoryLease(lockDir, options = {}) {
  const now = options.now ?? Date.now();
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const staleMs = options.staleMs ?? 10 * 60 * 1000;
  const processAlive = options.processAlive ?? defaultProcessAlive;
  const owner = { schemaVersion: 1, pid, token, acquiredAt: new Date(now).toISOString() };

  try {
    return createLease(lockDir, owner);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let existing;
  try {
    if (now - statSync(lockDir).mtimeMs <= staleMs) return null;
    existing = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    // An unreadable owner cannot be proven dead, so recovery fails closed.
    return null;
  }
  if (!Number.isSafeInteger(existing?.pid) || existing.pid < 1 || processAlive(existing.pid)) return null;

  rmSync(lockDir, { recursive: true, force: true });
  try {
    return createLease(lockDir, owner);
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}

export function releaseDirectoryLease(lockDir, token) {
  if (!token) return false;
  let owner;
  try {
    owner = JSON.parse(readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return false;
  }
  if (owner?.token !== token) return false;
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}
