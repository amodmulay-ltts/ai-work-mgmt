import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

describe('person page: their opportunities', () => {
  let app;

  before(async () => {
    const { dir } = await makeRemote();
    const root = await makeClone(dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = {
      base: `http://127.0.0.1:${server.address().port}`,
      store: created.store,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await cleanup(dir);
      },
    };
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    const rfq = (title, extra) => ({
      title, type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', presales_owner: 'Amod Mulay',
      received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
      ...extra,
    });
    await post(app.base, '/opportunities', rfq('Alpha, Priya sales'));
    await post(app.base, '/opportunities', rfq('Beta, Priya delivery only', { presales_owner: 'Meera T', delivery_owner: 'Priya S' }));
    await post(app.base, '/opportunities', rfq('Gamma, not Priya', { sales_owner: 'Ravi K', presales_owner: 'Meera T' }));
  });

  after(async () => {
    await app.close();
  });

  test('the person page lists every opportunity they are named on, with their role', async () => {
    const priya = app.store.listPeople().find((p) => p.name === 'Priya S');
    const res = await fetch(`${app.base}/people/${priya.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Alpha, Priya sales/);
    assert.match(html, /Beta, Priya delivery only/);
    assert.doesNotMatch(html, /Gamma, not Priya/);
    assert.match(html, /<td>Sales<\/td>/);
    assert.match(html, /<td>Sales, Delivery<\/td>/);
  });

  test('a supporter or contact is also listed', async () => {
    const amod = app.store.listPeople().find((p) => p.name === 'Amod Mulay');
    const html = await (await fetch(`${app.base}/people/${amod.id}`)).text();
    assert.match(html, /Alpha, Priya sales/);
    assert.match(html, /<td>Presales<\/td>/);
  });

  test('the people list links each name to its page, and the edit page is still reachable', async () => {
    const priya = app.store.listPeople().find((p) => p.name === 'Priya S');
    const list = await (await fetch(`${app.base}/people`)).text();
    assert.match(list, new RegExp(`href="/people/${priya.id}">Priya S</a>`));
    const edit = await fetch(`${app.base}/people/${priya.id}/edit`);
    assert.equal(edit.status, 200);
  });

  test('the new person form still works, and an unknown person is not found', async () => {
    const form = await fetch(`${app.base}/people/new`);
    assert.equal(form.status, 200);
    const missing = await fetch(`${app.base}/people/PE-9999`);
    assert.equal(missing.status, 404);
  });
});
