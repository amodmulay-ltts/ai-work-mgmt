import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BU_MAX, resolveBusinessUnit } from '../app/lib/business-units.js';
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

const YEAR = new Date().getFullYear();
const KNOWN = ['Mobility', 'Sustainability', 'Hi-Tech'];

const opportunity = (overrides = {}) => ({
  title: 'Brake controller',
  type: 'Lead',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
  ...overrides,
});

describe('resolveBusinessUnit', () => {
  test('a known BU keeps its spelling, whatever the case typed', () => {
    assert.deepEqual(resolveBusinessUnit('mobility', KNOWN), { bu: 'Mobility', added: null, errors: [] });
    assert.deepEqual(resolveBusinessUnit('  HI-TECH  ', KNOWN), { bu: 'Hi-Tech', added: null, errors: [] });
  });

  test('a new BU is stored trimmed and reported as added', () => {
    assert.deepEqual(resolveBusinessUnit('  Aerospace   Defence ', KNOWN), { bu: 'Aerospace Defence', added: 'Aerospace Defence', errors: [] });
  });

  test('an empty BU is no BU', () => {
    assert.deepEqual(resolveBusinessUnit('   ', KNOWN), { bu: null, added: null, errors: [] });
    assert.deepEqual(resolveBusinessUnit(undefined, KNOWN), { bu: null, added: null, errors: [] });
  });

  test('a BU longer than the limit is refused', () => {
    const long = 'x'.repeat(BU_MAX + 1);
    assert.equal(resolveBusinessUnit(long, KNOWN).errors.length, 1);
  });
});

describe('typing a new BU on the opportunity and customer forms', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  test('the form offers the BU list as suggestions in a text field', async () => {
    const html = await (await fetch(`${app.base}/opportunities/new`)).text();
    assert.doesNotMatch(html, /<select id="f-bu"/);
    assert.match(html, /<input[^>]*id="f-bu"[^>]*list="bu-options"/);
    assert.match(html, /<datalist id="bu-options"><option value="Mobility">/);
  });

  test('the customer form offers the BU list the same way', async () => {
    const html = await (await fetch(`${app.base}/customers/new`)).text();
    assert.doesNotMatch(html, /<select id="f-bu"/);
    assert.match(html, /<input[^>]*id="f-bu"[^>]*list="bu-options"/);
  });

  test('an opportunity with a new BU saves it, and the BU joins the list', async () => {
    const res = await post(app.base, '/opportunities', opportunity({ bu: 'Aerospace' }));
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(`DL-${YEAR}-0001`).bu, 'Aerospace');
    assert.ok(app.store.config().business_units.includes('Aerospace'));
    assert.ok(app.store.config().business_units.includes('Mobility'), 'the existing list is kept');
  });

  test('a BU typed in another case uses the list spelling, and the list gets no duplicate', async () => {
    const res = await post(app.base, '/opportunities', opportunity({ title: 'Second', bu: 'aerospace' }));
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(`DL-${YEAR}-0002`).bu, 'Aerospace');
    assert.equal(app.store.config().business_units.filter((b) => b === 'Aerospace').length, 1);
  });

  test('a customer with a new BU saves it, and the BU joins the list', async () => {
    const res = await post(app.base, '/customers', { name: 'Tata Motors', bu: 'Defence' });
    assert.equal(res.status, 303);
    const customer = app.store.listCustomers().find((c) => c.name === 'Tata Motors');
    assert.equal(customer.bu, 'Defence');
    assert.ok(app.store.config().business_units.includes('Defence'));
  });

  test('a refused opportunity does not add its new BU to the list', async () => {
    // An RFQ with no submission date fails validation, so nothing is written, including the config.
    const res = await post(app.base, '/opportunities', opportunity({ title: 'Refused', type: 'RFQ', bu: 'Shipping' }));
    assert.equal(res.status, 422);
    assert.ok(!app.store.config().business_units.includes('Shipping'));
  });
});
