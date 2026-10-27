import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { REGION_MAX, resolveRegion } from '../app/lib/regions.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const KNOWN = ['EU - Nordics', 'DACH', 'PE & IP', 'Aero & Rail', 'UKFrBnx'];

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

describe('resolveRegion', () => {
  test('the five regions are the defaults for a new tracker', () => {
    assert.deepEqual(DEFAULT_CONFIG.regions, KNOWN);
  });

  test('a known region keeps its spelling, whatever the case typed', () => {
    assert.deepEqual(resolveRegion('dach', KNOWN), { region: 'DACH', added: null, errors: [] });
    assert.deepEqual(resolveRegion('  aero   & RAIL ', KNOWN), { region: 'Aero & Rail', added: null, errors: [] });
  });

  test('a new region is stored trimmed and reported as added', () => {
    assert.deepEqual(resolveRegion('  Benelux ', KNOWN), { region: 'Benelux', added: 'Benelux', errors: [] });
  });

  test('an empty region is no region', () => {
    assert.deepEqual(resolveRegion('  ', KNOWN), { region: null, added: null, errors: [] });
  });

  test('a region longer than the limit is refused', () => {
    const long = 'x'.repeat(REGION_MAX + 1);
    assert.equal(resolveRegion(long, KNOWN).errors.length, 1);
  });
});

describe('region on an opportunity form', () => {
  let app;
  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });
  after(async () => {
    await app.close();
  });

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

  test('a new region typed on the form is saved and added to the list', async () => {
    const res = await post(app.base, '/opportunities', opportunity({ title: 'Region test', region: 'Benelux' }));
    assert.equal(res.status, 303);
    const deal = app.store.listDeals().find((d) => d.title === 'Region test');
    assert.equal(deal.region, 'Benelux');
    assert.ok(app.store.config().regions.includes('Benelux'));
  });

  test('a known region is saved with its spelling', async () => {
    await post(app.base, '/opportunities', opportunity({ title: 'Known region', region: 'dach' }));
    const deal = app.store.listDeals().find((d) => d.title === 'Known region');
    assert.equal(deal.region, 'DACH');
    assert.equal(app.store.config().regions.filter((r) => r === 'DACH').length, 1, 'no duplicate');
  });
});
