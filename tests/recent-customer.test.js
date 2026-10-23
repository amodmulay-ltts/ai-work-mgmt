import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('Recently updated shows the customer name', () => {
  let base;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    const post = (url, fields) => fetch(base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
  });

  after(async () => {
    await close();
  });

  test('the table has a Customer column after Title, and each row names its customer', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<th scope="col">Title<\/th>\s*<th scope="col">Customer<\/th>/);
    assert.match(html, /<td class="ellipsis">Bosch<\/td>/);
  });

  test('the customer page does not repeat the customer column', async () => {
    const html = await (await fetch(`${base}/customers/CU-0001`)).text();
    assert.match(html, /<h2>Open opportunities<\/h2>/);
    assert.doesNotMatch(html, /<th scope="col">Customer<\/th>/);
  });
});
