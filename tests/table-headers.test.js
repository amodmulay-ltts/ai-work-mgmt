import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
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

describe('table headers and card layout', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S',
      received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    await post(app.base, `/opportunities/DL-${YEAR}-0001/asks`, { text: 'Effort estimate', assignee_id: '', due_on: '' });
  });

  after(async () => {
    await app.close();
  });

  test('the asks table header is not set in the monospace font', async () => {
    const html = await (await fetch(`${app.base}/opportunities/DL-${YEAR}-0001`)).text();
    assert.match(html, /<th scope="col">ID<\/th>/);
    assert.doesNotMatch(html, /<th scope="col" class="mono">/);
  });

  test('the Needs attention card uses the table card layout, like the other lists', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<section class="card table-card">\s*<h2 class="card-pad">Needs attention<\/h2>/);
  });

  test('the stylesheet does not make table headers sticky, and sets the header colour', async () => {
    const css = await fs.readFile(path.join(HERE, '..', 'app', 'public', 'app.css'), 'utf8');
    const rule = css.match(/\.table th \{[^}]*\}/)?.[0] ?? '';
    assert.ok(rule, 'the .table th rule exists');
    assert.doesNotMatch(rule, /position:\s*sticky/);
    assert.match(rule, /color:\s*var\(--text-header\)/);
  });
});
