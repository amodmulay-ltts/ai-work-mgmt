import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe('the app can be installed as a PWA', () => {
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
  });

  after(async () => {
    await close();
  });

  test('the manifest names the app, opens at the root, runs standalone, and has 192 and 512 icons', async () => {
    const res = await fetch(`${base}/static/manifest.webmanifest`);
    assert.equal(res.status, 200);
    const manifest = await res.json();
    assert.equal(manifest.name, 'Work Tracker');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    const sizes = manifest.icons.map((i) => i.sizes).sort();
    assert.deepEqual(sizes, ['192x192', '512x512']);
  });

  test('the icons are real PNG files of the sizes the manifest names', async () => {
    for (const size of [192, 512]) {
      const res = await fetch(`${base}/static/icon-${size}.png`);
      assert.equal(res.status, 200);
      const bytes = [...Buffer.from(await res.arrayBuffer()).subarray(0, 24)];
      assert.deepEqual(bytes.slice(0, 4), PNG_SIGNATURE);
      const width = bytes.slice(16, 20).reduce((n, b) => n * 256 + b, 0);
      assert.equal(width, size);
    }
  });

  test('the vector icon is served as an SVG, and the pages use it as the tab icon', async () => {
    const res = await fetch(`${base}/static/icon.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /svg/);
    assert.match(await res.text(), /<rect[^>]*rx="96"[^>]*fill="#1D4ED8"/);
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<link rel="icon" href="\/static\/icon\.svg" type="image\/svg\+xml">/);
    assert.match(html, /<a class="brand" href="\/"><img class="brand-icon" src="\/static\/icon\.svg" alt="" width="24" height="24">Work Tracker<\/a>/, 'the icon sits next to the name in the header');
  });

  test('the service worker is served from the root, so it controls every page', async () => {
    const res = await fetch(`${base}/sw.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const js = await res.text();
    assert.match(js, /addEventListener\('fetch'/);
    assert.match(js, /\/static\//, 'it caches only the static files');
  });

  test('the pages link the manifest and the icon, and the script registers the worker', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<link rel="manifest" href="\/static\/manifest\.webmanifest">/);
    assert.match(html, /<meta name="theme-color" content="#1D4ED8">/);
    const js = await fs.readFile(path.join(HERE, '..', 'app', 'public', 'app.js'), 'utf8');
    assert.match(js, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  });
});
