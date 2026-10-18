import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { GitSync } from '../app/git-sync.js';
import { Mutex } from '../app/mutex.js';
import { Store } from '../app/store.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

/** A store on a local repo with no remote, so nothing is pushed. */
async function storeFor(folder) {
  const mutex = new Mutex();
  const sync = new GitSync({ root: folder, mutex, pushDelaySeconds: 3600 });
  const store = new Store({ root: folder, git: sync, mutex });
  await store.init();
  return store;
}

test('the first holder gets no warning and the lock file is committed', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const store = await storeFor(a);

    await store.acquireLock('alice@laptop-a');

    assert.equal(store.lockWarning, null);
    const lock = JSON.parse(await fs.readFile(path.join(a, 'data', '_lock.json'), 'utf8'));
    assert.equal(lock.holder, 'alice@laptop-a');
    assert.equal(git(a, 'log', '-1', '--format=%s'), 'session: opened on alice@laptop-a');
  } finally {
    await cleanup(dir);
  }
});

test('another holder gets a warning that names the first holder', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const store = await storeFor(a);
    await store.acquireLock('alice@laptop-a');

    await store.acquireLock('bob@laptop-b');

    assert.match(store.lockWarning, /^alice@laptop-a has this open since /);
    assert.match(store.lockWarning, /changes may conflict/);
  } finally {
    await cleanup(dir);
  }
});

test('the same holder again (after a crash) gets no warning', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const store = await storeFor(a);
    await store.acquireLock('alice@laptop-a');

    await store.acquireLock('alice@laptop-a');

    assert.equal(store.lockWarning, null);
  } finally {
    await cleanup(dir);
  }
});

test('release removes the lock file and commits the removal', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const store = await storeFor(a);
    await store.acquireLock('bob@laptop-b');

    await store.releaseLock();

    await assert.rejects(fs.access(path.join(a, 'data', '_lock.json')));
    assert.equal(git(a, 'log', '-1', '--format=%s'), 'session: closed on bob@laptop-b');
    assert.equal(git(a, 'status', '--porcelain', '--', 'data/_lock.json'), '');
  } finally {
    await cleanup(dir);
  }
});

test('lock changes on two computers merge without a conflict copy', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const syncA = new GitSync({ root: a, mutex: new Mutex(), pushDelaySeconds: 3600 });
    const storeA = new Store({ root: a, git: syncA, mutex: syncA.mutex });
    await storeA.init();
    await storeA.acquireLock('alice@a');
    await syncA.pushNow();

    // Computer B pulls first, as the app does on start, and then takes the lock locally.
    const b = await makeClone(dir, 'b', remote);
    const syncB = new GitSync({ root: b, mutex: new Mutex(), pushDelaySeconds: 3600 });
    await syncB.pull();
    const storeB = new Store({ root: b, git: syncB, mutex: syncB.mutex });
    await storeB.init();
    await storeB.acquireLock('bob@b');

    // Meanwhile computer A releases, takes the lock again and pushes.
    await storeA.releaseLock();
    await storeA.acquireLock('alice-again@a');
    await syncA.pushNow();

    const result = await syncB.pull();

    assert.equal(result.ok, true);
    assert.equal(result.conflicts.length, 0);
    await assert.rejects(fs.access(path.join(b, 'data', '_conflicts')));
    const lock = JSON.parse(await fs.readFile(path.join(b, 'data', '_lock.json'), 'utf8'));
    assert.equal(lock.holder, 'alice-again@a');
    assert.equal(git(b, 'status', '--porcelain'), '');
  } finally {
    await cleanup(dir);
  }
});

test('release does nothing when this session never took the lock', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const store = await storeFor(a);
    const before = git(a, 'rev-parse', 'HEAD');

    await store.releaseLock();

    assert.equal(git(a, 'rev-parse', 'HEAD'), before);
  } finally {
    await cleanup(dir);
  }
});
