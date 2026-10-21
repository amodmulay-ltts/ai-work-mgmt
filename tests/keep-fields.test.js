import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    root,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const readJson = async (root, rel) => JSON.parse(await fs.readFile(path.join(root, rel), 'utf8'));

describe('fields this version does not know about survive a save', () => {
  let app;
  const YEAR = new Date().getFullYear();
  const deal = `DL-${YEAR}-0001`;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', {
      title: 'Keep me', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    // Add a field from a newer version, and one that a person added by hand.
    for (const [rel, extra] of [
      [`data/deals/${deal}.json`, { future_field: { note: 'from a newer version' } }],
      ['data/customers/CU-0001.json', { future_field: 'customer note' }],
      ['data/people/PE-0001.json', { future_field: 'person note' }],
    ]) {
      const file = path.join(app.root, rel);
      const obj = JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.writeFile(file, JSON.stringify({ ...obj, ...extra }, null, 2) + '\n');
    }
    await app.store.loadAll();
  });

  after(async () => {
    await app.close();
  });

  test('saving an opportunity keeps the unknown field', async () => {
    await post(app.base, `/opportunities/${deal}`, {
      title: 'Keep me, edited', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    const saved = await readJson(app.root, `data/deals/${deal}.json`);
    assert.equal(saved.title, 'Keep me, edited');
    assert.deepEqual(saved.future_field, { note: 'from a newer version' });
  });

  test('saving a customer keeps the unknown field', async () => {
    await post(app.base, '/customers/CU-0001', { name: 'Bosch GmbH', tags: '' });
    const saved = await readJson(app.root, 'data/customers/CU-0001.json');
    assert.equal(saved.name, 'Bosch GmbH');
    assert.equal(saved.future_field, 'customer note');
  });

  test('saving a person keeps the unknown field', async () => {
    await post(app.base, '/people/PE-0001', { name: 'Priya Sharma', role: 'Sales', active: 'on' });
    const saved = await readJson(app.root, 'data/people/PE-0001.json');
    assert.equal(saved.name, 'Priya Sharma');
    assert.equal(saved.future_field, 'person note');
  });
});
