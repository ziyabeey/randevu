import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  acquireDirectoryLease,
  releaseDirectoryLease,
} from '../scripts/qwen-coordinator/lease.mjs';

const execFileAsync = promisify(execFile);
const leaseModuleUrl = pathToFileURL(path.resolve('scripts/qwen-coordinator/lease.mjs')).href;

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

test('lease metadata is complete before the lock directory is atomically published', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-publish-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const lockDir = path.join(root, 'run.lock');
  assert.throws(() => acquireDirectoryLease(lockDir, {
    token: 'interrupted',
    beforePublish: (candidateDir) => {
      assert.equal(existsSync(lockDir), false);
      assert.equal(existsSync(path.join(candidateDir, 'owner.json')), true);
      throw new Error('simulated interruption');
    },
  }), /simulated interruption/);
  assert.equal(existsSync(lockDir), false);
  assert.equal(acquireDirectoryLease(lockDir, { token: 'next-owner' }), 'next-owner');
  assert.equal(releaseDirectoryLease(lockDir, 'next-owner'), true);
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

test('concurrent stale recovery grants exactly one replacement lease', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qwen-coordinator-stale-race-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const lockDir = path.join(root, 'run.lock');
  await mkdir(lockDir);
  await writeFile(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: 42, token: 'old' })}\n`);
  await utimes(lockDir, new Date(0), new Date(0));

  const contender = (token) => execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { acquireDirectoryLease } from ${JSON.stringify(leaseModuleUrl)};
     const value = acquireDirectoryLease(${JSON.stringify(lockDir)}, {
       now: 1000000, staleMs: 1, token: ${JSON.stringify(token)}, processAlive: () => false,
     });
     console.log(value ?? 'null');`,
  ]);
  const results = await Promise.all([contender('contender-a'), contender('contender-b')]);
  const winners = results.map((result) => result.stdout.trim()).filter((value) => value !== 'null');
  assert.equal(winners.length, 1);
  assert.equal(releaseDirectoryLease(lockDir, winners[0]), true);
});
