import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { winsByYear } from '../app/metrics.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const deal = (stage, closed_on, extra = {}) => ({ stage, closed_on, currency: 'EUR', est_value: 100, ...extra });

describe('wins and losses by closing year', () => {
  test('counts won and lost per year, and leaves dropped ones out of the rate', () => {
    const deals = [
      deal('Won', '2024-03-01', { est_value: 1000 }),
      deal('Won', '2024-11-20', { est_value: 500, currency: 'USD' }),
      deal('Lost', '2024-06-01'),
      deal('Dropped', '2024-07-01'),
      deal('Won', '2026-02-02', { est_value: null }),
    ];
    const { years } = winsByYear(deals, DEFAULT_CONFIG, '2026-10-21');
    assert.deepEqual(years.map((y) => y.year), [2024, 2025, 2026], 'a year with no closes still shows');
    assert.deepEqual([years[0].won, years[0].lost], [2, 1]);
    assert.ok(Math.abs(years[0].rate - 2 / 3) < 1e-9);
    assert.deepEqual(years[0].wonTotals, { EUR: 1000, USD: 500 });
    assert.deepEqual([years[1].won, years[1].lost, years[1].rate], [0, 0, null]);
    assert.deepEqual(years[2].wonTotals, {}, 'a win with no value adds no money');
  });

  test('open opportunities and wins with no closing date are kept out of the years', () => {
    const deals = [
      deal('Lead', null),
      deal('Won', null),
      deal('Lost', null),
      deal('Won', '2025-05-05'),
    ];
    const result = winsByYear(deals, DEFAULT_CONFIG, '2026-10-21');
    assert.deepEqual(result.undated, { won: 1, lost: 1 });
    assert.deepEqual(result.years.map((y) => [y.year, y.won]), [[2025, 1], [2026, 0]]);
  });

  test('with no closed deals there are no years', () => {
    assert.deepEqual(winsByYear([deal('Lead', null)], DEFAULT_CONFIG, '2026-10-21'), {
      years: [],
      undated: { won: 0, lost: 0 },
    });
  });

  test('the years run up to this year even when the last close is older', () => {
    const { years } = winsByYear([deal('Won', '2023-01-10')], DEFAULT_CONFIG, '2026-10-21');
    assert.deepEqual(years.map((y) => y.year), [2023, 2024, 2025, 2026]);
  });
});

describe('wins by year has its own page, not the dashboard', () => {
  let app;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = { base: `http://127.0.0.1:${server.address().port}` };
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    const post = (url, fields) => fetch(app.base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', {
      title: 'Old win', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2025-01-10',
      stage: 'Won', closed_on: '2025-03-04', probability: '100', currency: 'EUR', est_value: '20000',
      priority: 'Medium', go_no_go: 'Go',
    });
  });

  after(async () => {
    await close();
  });

  test('the dashboard no longer has the wins card', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.doesNotMatch(html, /Wins by year/);
  });

  test('the wins page lists each year with its wins, losses and rate', async () => {
    const html = await (await fetch(`${app.base}/wins`)).text();
    assert.match(html, /<h1>Wins by year<\/h1>/);
    assert.match(html, /<td>2025<\/td>\s*<td class="num"><a [^>]*>1<\/a><\/td>\s*<td class="num"><a [^>]*>0<\/a><\/td>\s*<td class="num">100%<\/td>/);
  });
});
