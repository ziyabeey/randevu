import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireDirectoryLease,
  releaseDirectoryLease,
} from '../scripts/qwen-coordinator/lease.mjs';

test('directory lease can only be released by its owner', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-lease-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const lockDir = path.join(root, 'run.lock');
  const token = acquireDirectoryLease(lockDir, { token: 'owner-a' });
  assert.equal(token, 'owner-a');
  assert.equal(acquireDirectoryLease(lockDir, { token: 'owner-b' }), null);
  assert.equal(releaseDirectoryLease(lockDir, 'owner-b'), false);
  assert.equal(releaseDirectoryLease(lockDir, 'owner-a'), true);
});

test('stale lease recovery requires proof that the owner process is gone', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-stale-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const lockDir = path.join(root, 'run.lock');
  await mkdir(lockDir);
  await writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: 42, token: 'old' })}\n`);
  await utimes(lockDir, new Date(0), new Date(0));

  assert.equal(acquireDirectoryLease(lockDir, {
    now: 1_000_000,
    staleMs: 1,
    token: 'new',
    processAlive: () => true,
  }), null);
  assert.equal(acquireDirectoryLease(lockDir, {
    now: 1_000_000,
    staleMs: 1,
    token: 'new',
    processAlive: () => false,
  }), 'new');
  assert.equal(releaseDirectoryLease(lockDir, 'old'), false);
  assert.equal(releaseDirectoryLease(lockDir, 'new'), true);
});
