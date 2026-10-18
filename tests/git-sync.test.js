import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { GitSync } from '../app/git-sync.js';
import { Mutex } from '../app/mutex.js';
import { cleanup, git, makeClone, makeRemote, writeFile } from './helpers.js';

/** Long push delay so the background timer never fires during a test. */
const syncFor = (folder) => new GitSync({ root: folder, mutex: new Mutex(), pushDelaySeconds: 3600 });
const DEAL = 'data/deals/DL-2026-0001.json';
const deal = (text) => `${JSON.stringify({ id: 'DL-2026-0001', title: text }, null, 2)}\n`;

test('commit then push delivers the change to the remote', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const sync = syncFor(a);
    const file = await writeFile(a, 'data/people/PE-0001.json', '{"id":"PE-0001"}\n');

    assert.equal(await sync.commit([file], 'PE-0001: created – Test'), true);
    assert.equal((await sync.status()).state, 'pending');
    assert.equal(await sync.pushNow(), true);
    assert.equal(git(remote, 'log', '-1', '--format=%s', 'main'), 'PE-0001: created – Test');
    assert.equal((await sync.status()).state, 'synced');
  } finally {
    await cleanup(dir);
  }
});

test('commit refuses paths outside data/', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const file = await writeFile(a, 'PLAN.md', 'nope\n');
    await assert.rejects(syncFor(a).commit([file], 'bad'), /outside data\//);
  } finally {
    await cleanup(dir);
  }
});

test('commit returns false when nothing changed', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const sync = syncFor(a);
    const file = await writeFile(a, DEAL, deal('same'));
    assert.equal(await sync.commit([file], 'first'), true);
    assert.equal(await sync.commit([file], 'second'), false);
  } finally {
    await cleanup(dir);
  }
});

test('pull in a fresh clone brings in the remote data', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const syncA = syncFor(a);
    await syncA.commit([await writeFile(a, DEAL, deal('from a'))], 'created');
    assert.equal(await syncA.pushNow(), true);

    const b = await makeClone(dir, 'b', remote);
    const result = await syncFor(b).pull();
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(await fs.readFile(path.join(b, DEAL), 'utf8'), deal('from a'));
  } finally {
    await cleanup(dir);
  }
});

test('conflict on the same deal keeps the local version and saves the remote one', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const syncA = syncFor(a);
    await syncA.commit([await writeFile(a, DEAL, deal('v1'))], 'created');
    await syncA.pushNow();

    const b = await makeClone(dir, 'b', remote);
    const syncB = syncFor(b);
    await syncB.pull();

    await syncA.commit([await writeFile(a, DEAL, deal('remote edit'))], 'a edit');
    await syncA.pushNow();

    await syncB.commit([await writeFile(b, DEAL, deal('local edit'))], 'b edit');
    const result = await syncB.pull();

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.conflicts.length, 1);
    assert.equal(await fs.readFile(path.join(b, DEAL), 'utf8'), deal('local edit'));
    const saved = await fs.readFile(path.join(b, result.conflicts[0]), 'utf8');
    assert.equal(saved, deal('remote edit'));
    assert.match(git(b, 'log', '-1', '--format=%s'), /^sync: merge remote changes \(1 conflicts saved\)$/);
  } finally {
    await cleanup(dir);
  }
});

test('deleted locally but edited remotely keeps the remote edit', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const syncA = syncFor(a);
    await syncA.commit([await writeFile(a, DEAL, deal('v1'))], 'created');
    await syncA.pushNow();

    const b = await makeClone(dir, 'b', remote);
    const syncB = syncFor(b);
    await syncB.pull();

    await syncA.commit([await writeFile(a, DEAL, deal('remote edit'))], 'a edit');
    await syncA.pushNow();

    await fs.rm(path.join(b, DEAL));
    await syncB.commit([path.join(b, DEAL)], 'b deleted');
    const result = await syncB.pull();

    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(b, DEAL), 'utf8'), deal('remote edit'));
  } finally {
    await cleanup(dir);
  }
});

test('a push rejected by a newer remote commit pulls and then succeeds', async () => {
  const { dir, remote } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', remote);
    const syncA = syncFor(a);
    await syncA.commit([await writeFile(a, 'data/people/PE-0001.json', '{}\n')], 'a1');
    await syncA.pushNow();

    const b = await makeClone(dir, 'b', remote);
    const syncB = syncFor(b);
    await syncB.pull();
    await syncB.commit([await writeFile(b, 'data/people/PE-0002.json', '{}\n')], 'b1');

    await syncA.commit([await writeFile(a, 'data/people/PE-0003.json', '{}\n')], 'a2');
    await syncA.pushNow();

    assert.equal(await syncB.pushNow(), true);
    const files = git(remote, 'ls-tree', '--name-only', '-r', 'main');
    assert.match(files, /PE-0002\.json/);
    assert.match(files, /PE-0003\.json/);
  } finally {
    await cleanup(dir);
  }
});

test('without a remote the status is local and commits still work', async () => {
  const { dir } = await makeRemote();
  try {
    const a = await makeClone(dir, 'a', null);
    const sync = syncFor(a);
    assert.equal((await sync.status()).state, 'local');
    assert.equal(await sync.commit([await writeFile(a, 'data/people/PE-0001.json', '{}\n')], 'local'), true);
    assert.equal((await sync.status()).state, 'local');
  } finally {
    await cleanup(dir);
  }
});
