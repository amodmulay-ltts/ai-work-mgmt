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

const deal = (title, est_value, probability) => ({
  title,
  type: 'Lead',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  presales_owner: 'Meera T',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability,
  est_value,
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
});

describe('dashboard: pipeline card and search', () => {
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
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await cleanup(dir);
      },
    };
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', deal('Alpha', '1000', '50'));
    await post(app.base, '/opportunities', deal('Beta', '2000', '10'));
  });

  after(async () => {
    await app.close();
  });

  test('the Pipeline card sits between Open opportunities and Weighted pipeline, with the unweighted total', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    const open = html.indexOf('Open opportunities');
    const pipeline = html.indexOf('<div class="kpi-label">Pipeline</div>');
    const weighted = html.indexOf('Weighted pipeline');
    assert.ok(open > 0 && pipeline > open && weighted > pipeline, 'order: open, pipeline, weighted');
    assert.match(html.slice(pipeline, weighted), /EUR 3K/, "the unweighted total of 1000 + 2000");
  });

  test('the dashboard has a search box that goes to the opportunities list', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<form method="get" action="\/opportunities" class="dash-search" role="search">/);
    assert.match(html, /name="q"/);
  });
});
