import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

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

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
};

/** The opening tag of the form field wrapper for one field, e.g. `<div class="field" data-types=…>`. */
const wrapperOf = (html, name) => {
  const match = html.match(new RegExp(`<div class="field[^"]*"([^>]*)>\\s*<label for="f-${name}"`));
  return match ? match[1] : null;
};

const base = {
  title: 'Brake controller',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
};

const YEAR = new Date().getFullYear();

describe('opportunity form and page show the fields for the type', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', { ...base, type: 'Lead' });
    await post(app.base, '/opportunities', { ...base, title: 'Real RFQ', type: 'RFQ', submission_due: '2026-11-01' });
    await post(app.base, '/opportunities', { ...base, title: 'Lead with a Q&A date', type: 'Lead', qa_due: '2026-10-20' });
  });

  after(async () => {
    await app.close();
  });

  test('the form has a Type select listing every type', async () => {
    const page = await get(app.base, '/opportunities/new');
    assert.match(page.html, /<select id="f-type" name="type"/);
    for (const name of ['Lead', 'RFI', 'RFQ', 'RFP', 'Proactive Proposal', 'Change Request', 'Renewal / Extension']) {
      assert.match(page.html, new RegExp(`<option value="${name}"`));
    }
  });

  test('a new form (type Lead) hides the RFQ fields, and says which types use them', async () => {
    const page = await get(app.base, '/opportunities/new');
    const wrapper = wrapperOf(page.html, 'submission_due');
    assert.match(wrapper, /data-types="RFI\|RFQ\|RFP"/);
    assert.match(wrapper, /data-filled="no"/);
    assert.match(wrapper, /hidden/);
    assert.doesNotMatch(wrapperOf(page.html, 'title') ?? '', /hidden/, 'always-shown fields are not hidden');
  });

  test('an RFQ form shows its submission date', async () => {
    const id = `DL-${YEAR}-0002`;
    const page = await get(app.base, `/opportunities/${id}/edit`);
    const wrapper = wrapperOf(page.html, 'submission_due');
    assert.doesNotMatch(wrapper, /hidden/);
    assert.match(wrapper, /data-filled="yes"/);
  });

  test('a Lead form still shows a Q&A date that has a value', async () => {
    const id = `DL-${YEAR}-0003`;
    const page = await get(app.base, `/opportunities/${id}/edit`);
    assert.doesNotMatch(wrapperOf(page.html, 'qa_due'), /hidden/);
    assert.match(wrapperOf(page.html, 'submission_due'), /hidden/, 'the empty submission date stays hidden');
  });

  test('the Lead page does not print the RFQ rows', async () => {
    const page = await get(app.base, `/opportunities/DL-${YEAR}-0001`);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.html, /Q&amp;A due/);
    assert.doesNotMatch(page.html, /<span>Submission<\/span>/);
    assert.doesNotMatch(page.html, /Competitors/);
  });

  test('the RFQ page prints them', async () => {
    const page = await get(app.base, `/opportunities/DL-${YEAR}-0002`);
    assert.match(page.html, /Submission due/);
    assert.match(page.html, /<span>Submission<\/span>/);
  });

  test('a Lead page that has a Q&A date shows that row', async () => {
    const page = await get(app.base, `/opportunities/DL-${YEAR}-0003`);
    assert.match(page.html, /Q&amp;A due/);
    assert.doesNotMatch(page.html, /Submission due/);
  });

  test('the script that switches the fields is served with the page', async () => {
    const js = await (await fetch(`${app.base}/static/app.js`)).text();
    assert.match(js, /select\[name="type"\]/);
    const css = await (await fetch(`${app.base}/static/app.css`)).text();
    assert.match(css, /\.field\[hidden\] \{ display: none; \}/);
  });
});
