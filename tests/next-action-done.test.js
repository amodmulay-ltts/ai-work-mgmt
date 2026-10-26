import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { markNextActionDone } from '../app/lib/next-action.js';
import { withDealDefaults } from '../app/models.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const NOW = '2026-10-26T09:00:00+01:00';
const TODAY = '2026-10-26';

describe('next action done: pure model', () => {
  test('marking done moves the text and due date into done_actions and clears the live action', () => {
    const deal = { id: 'DL-2026-0001', next_action: 'Send estimate', next_action_due: '2026-10-30', done_actions: [] };
    const { deal: next, entry } = markNextActionDone(deal, { today: TODAY, at: NOW });
    assert.equal(next.next_action, null);
    assert.equal(next.next_action_due, null);
    assert.deepEqual(next.done_actions, [{ text: 'Send estimate', due: '2026-10-30', done_on: TODAY }]);
    assert.equal(entry.kind, 'field');
    assert.equal(entry.text, 'Next action done: Send estimate');
    assert.equal(deal.next_action, 'Send estimate', 'the original is not changed');
  });

  test('earlier done actions are kept, in order', () => {
    const deal = { next_action: 'Call', next_action_due: null, done_actions: [{ text: 'Old', due: null, done_on: '2026-10-01' }] };
    const { deal: next } = markNextActionDone(deal, { today: TODAY, at: NOW });
    assert.deepEqual(next.done_actions.map((a) => a.text), ['Old', 'Call']);
  });

  test('no next action means nothing to mark', () => {
    assert.equal(markNextActionDone({ next_action: null, done_actions: [] }, { today: TODAY, at: NOW }), null);
  });

  test('a file from before done actions existed gets an empty list', () => {
    const old = { id: 'DL-2026-0001', next_action: 'x' };
    assert.deepEqual(withDealDefaults(old).done_actions, []);
  });
});

// ---------------------------------------------------------------- over HTTP, on a real store

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    root,
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

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
};

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const YEAR = new Date().getFullYear();
const DEAL = `DL-${YEAR}-0001`;

describe('next action done: opportunity page', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', {
      title: 'ADAS validation services',
      type: 'Lead',
      customer: 'Bosch',
      sales_owner: 'Priya S',
      received_on: '2026-10-01',
      stage: 'Lead',
      probability: '5',
      currency: 'EUR',
      priority: 'Medium',
      go_no_go: 'Pending',
      next_action: 'Send the estimate',
      next_action_due: '2026-10-30',
    });
  });

  after(async () => {
    await app.close();
  });

  test('the page offers Mark done when there is a next action', async () => {
    const { html } = await get(app.base, `/opportunities/${DEAL}`);
    assert.match(html, new RegExp(`action="/opportunities/${DEAL}/next-action/done"`));
    assert.match(html, /Mark done/);
  });

  test('marking done saves one commit, keeps the text, and writes a timeline entry', async () => {
    const before = commits(app.root);
    const res = await post(app.base, `/opportunities/${DEAL}/next-action/done`, {});
    assert.equal(res.status, 303);
    assert.equal(commits(app.root), before + 1);
    const deal = app.store.getDeal(DEAL);
    assert.equal(deal.next_action, null);
    assert.equal(deal.next_action_due, null);
    assert.deepEqual(deal.done_actions.map((a) => a.text), ['Send the estimate']);
    assert.equal(deal.done_actions[0].due, '2026-10-30');
    assert.equal(deal.history.at(-1).text, 'Next action done: Send the estimate');
    const { html } = await get(app.base, `/opportunities/${DEAL}`);
    assert.match(html, /No next action yet\./);
    assert.match(html, /Done \(1\)/);
  });

  test('marking done again with no next action changes nothing', async () => {
    const before = commits(app.root);
    const res = await post(app.base, `/opportunities/${DEAL}/next-action/done`, {});
    assert.equal(res.status, 303);
    assert.equal(commits(app.root), before);
    assert.equal(app.store.getDeal(DEAL).done_actions.length, 1);
  });

  test('saving the opportunity form keeps the done actions', async () => {
    await post(app.base, `/opportunities/${DEAL}/next-action`, { next_action: 'Book the call', next_action_due: '' });
    await post(app.base, `/opportunities/${DEAL}/next-action/done`, {});
    await post(app.base, `/opportunities/${DEAL}`, {
      title: 'ADAS validation services (renamed)',
      type: 'Lead',
      customer: 'Bosch',
      sales_owner: 'Priya S',
      received_on: '2026-10-01',
      stage: 'Lead',
      probability: '5',
      currency: 'EUR',
      priority: 'Medium',
      go_no_go: 'Pending',
    });
    assert.deepEqual(app.store.getDeal(DEAL).done_actions.map((a) => a.text), ['Send the estimate', 'Book the call']);
  });
});
