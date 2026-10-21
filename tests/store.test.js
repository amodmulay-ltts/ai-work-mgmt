import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { GitSync } from '../app/git-sync.js';
import { Mutex } from '../app/mutex.js';
import { Store } from '../app/store.js';
import { ValidationError, nowIso } from '../app/models.js';
import { cleanup, git, makeClone, makeRemote, writeFile } from './helpers.js';

/** A store on a local repo with no remote, so nothing is pushed. */
async function setup() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'repo', null);
  const mutex = new Mutex();
  const sync = new GitSync({ root, mutex, pushDelaySeconds: 3600 });
  const store = new Store({ root, git: sync, mutex });
  await store.init();
  return { dir, root, store };
}

const person = (id, name, overrides = {}) => ({
  schema_version: 1,
  id,
  name,
  role: 'Sales',
  title: null,
  email: null,
  phone: null,
  customer_id: null,
  notes: '',
  active: true,
  created_at: nowIso(),
  updated_at: nowIso(),
  ...overrides,
});

const customer = (id, name) => ({
  schema_version: 1,
  id,
  name,
  short_name: null,
  industry: null,
  region: null,
  country: null,
  bu: null,
  account_manager_id: null,
  c4c_account_id: null,
  website: null,
  tags: [],
  notes: '',
  created_at: nowIso(),
  updated_at: nowIso(),
});

test('ids count up from the highest existing file', async () => {
  const { dir, store } = await setup();
  try {
    assert.equal(await store.nextId('person'), 'PE-0001');
    await store.save([person('PE-0001', 'Ravi K')], 'PE-0001: created – Ravi K');
    assert.equal(await store.nextId('person'), 'PE-0002');
    assert.match(await store.nextId('deal'), /^DL-\d{4}-0001$/);
  } finally {
    await cleanup(dir);
  }
});

test('a broken file is reported in problems and the rest still loads', async () => {
  const { dir, root, store } = await setup();
  try {
    await store.save([person('PE-0001', 'Good')], 'PE-0001: created – Good');
    await writeFile(root, 'data/people/PE-0002.json', '{ not json');
    await store.loadAll();
    assert.equal(store.getPerson('PE-0001').name, 'Good');
    assert.equal(store.problems.length, 1);
    assert.match(store.problems[0], /people\/PE-0002\.json/);
  } finally {
    await cleanup(dir);
  }
});

test('a record that fails validation writes nothing and leaves the commit history alone', async () => {
  const { dir, root, store } = await setup();
  try {
    const before = git(root, 'rev-list', '--count', 'HEAD');
    await assert.rejects(store.save([person('PE-0001', '')], 'bad'), ValidationError);
    await assert.rejects(fs.access(path.join(root, 'data', 'people', 'PE-0001.json')));
    assert.equal(git(root, 'rev-list', '--count', 'HEAD'), before);
  } finally {
    await cleanup(dir);
  }
});

test('several records saved together make exactly one commit', async () => {
  const { dir, root, store } = await setup();
  try {
    const before = Number(git(root, 'rev-list', '--count', 'HEAD'));
    await store.save(
      [customer('CU-0001', 'Bosch'), person('PE-0001', 'Priya S')],
      'CU-0001: created – Bosch',
    );
    assert.equal(Number(git(root, 'rev-list', '--count', 'HEAD')), before + 1);
    assert.match(git(root, 'show', '--stat', '--format=', 'HEAD'), /customers\/CU-0001\.json/);
    assert.match(git(root, 'show', '--stat', '--format=', 'HEAD'), /people\/PE-0001\.json/);
  } finally {
    await cleanup(dir);
  }
});

test('a customer with deals cannot be deleted', async () => {
  const { dir, store } = await setup();
  try {
    await store.save([customer('CU-0001', 'Bosch')], 'CU-0001: created – Bosch');
    store.records.deal.set('DL-2026-0001', { id: 'DL-2026-0001', customer_id: 'CU-0001' });
    await assert.rejects(store.delete(store.getCustomer('CU-0001'), 'x'), /Customer has 1 opportunity/);
  } finally {
    await cleanup(dir);
  }
});

test('a person used on a customer cannot be deleted, an unused one can', async () => {
  const { dir, store } = await setup();
  try {
    await store.save([customer('CU-0001', 'Bosch'), person('PE-0001', 'Used')], 'created');
    await store.save(
      [{ ...store.getCustomer('CU-0001'), account_manager_id: 'PE-0001' }],
      'CU-0001: updated',
    );
    await assert.rejects(store.delete(store.getPerson('PE-0001'), 'x'), /Mark them inactive/);

    await store.save([person('PE-0002', 'Unused')], 'created');
    await store.delete(store.getPerson('PE-0002'), 'PE-0002: deleted');
    assert.equal(store.getPerson('PE-0002'), null);
  } finally {
    await cleanup(dir);
  }
});
