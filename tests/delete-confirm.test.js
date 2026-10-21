import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const YEAR = new Date().getFullYear();
const DEAL = `DL-${YEAR}-0001`;

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const flashText = (res) => decodeURIComponent((res.headers.get('set-cookie') ?? '').match(/flash=([^;]*)/)?.[1] ?? '');

describe('deleting a record asks for its name or ID first', () => {
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
    await post(app.base, '/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    await post(app.base, '/customers', { name: 'Tata Motors' });
    await post(app.base, '/people', { name: 'Temp Person', role: 'Sales' });
  });

  after(async () => {
    await app.close();
  });

  test('the opportunity page offers the challenge, with the ID to type', async () => {
    const html = await (await fetch(`${app.base}/opportunities/${DEAL}`)).text();
    assert.match(html, /<details class="delete-box">/);
    assert.match(html, new RegExp(`data-type-to-confirm="${DEAL}"`));
    assert.match(html, /name="confirm"/);
  });

  test('an opportunity is not deleted without the typed ID, and the reason is shown', async () => {
    const res = await post(app.base, `/opportunities/${DEAL}/delete`, {});
    assert.equal(res.status, 303);
    assert.ok(app.store.getDeal(DEAL), 'still there');
    assert.match(flashText(res), /Nothing was deleted/);
  });

  test('a wrong ID does not delete either', async () => {
    await post(app.base, `/opportunities/${DEAL}/delete`, { confirm: 'DL-1999-0009' });
    assert.ok(app.store.getDeal(DEAL), 'still there');
  });

  test('the typed ID deletes the opportunity, and spaces around it are ignored', async () => {
    await post(app.base, `/opportunities/${DEAL}/delete`, { confirm: `  ${DEAL} ` });
    assert.ok(!app.store.getDeal(DEAL), "gone");
  });

  test('a customer needs its exact name typed; the case must match', async () => {
    const customer = app.store.findCustomerByName('Tata Motors');
    await post(app.base, `/customers/${customer.id}/delete`, { confirm: 'tata motors' });
    assert.ok(app.store.getCustomer(customer.id), 'a different case is not a match');
    await post(app.base, `/customers/${customer.id}/delete`, { confirm: 'Tata Motors' });
    assert.ok(!app.store.getCustomer(customer.id), "gone");
  });

  test('a person needs the exact name typed, and the people page offers the challenge', async () => {
    const page = await (await fetch(`${app.base}/people`)).text();
    assert.match(page, /data-type-to-confirm="Temp Person"/);
    const person = app.store.findPersonByName('Temp Person');
    await post(app.base, `/people/${person.id}/delete`, {});
    assert.ok(app.store.getPerson(person.id), 'not deleted without the name');
    await post(app.base, `/people/${person.id}/delete`, { confirm: 'Temp Person' });
    assert.ok(!app.store.getPerson(person.id), "gone");
  });
});
