import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { isOptionalField, showField, typeProfile, validateRecord, withDefaultType } from '../app/models.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

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

const plainText = async (res) => (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const YEAR = new Date().getFullYear();
const DEAL = `DL-${YEAR}-0001`;

/** A form with the always-required fields filled in. Tests add the type-specific fields. */
const form = (overrides = {}) => ({
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

describe('which fields each type shows', () => {
  test('Lead shows none of the RFQ fields, and RFQ shows them all', () => {
    const lead = { type: 'Lead' };
    const rfq = { type: 'RFQ' };
    assert.equal(showField(DEFAULT_CONFIG, lead, 'submission_due'), false);
    assert.equal(showField(DEFAULT_CONFIG, rfq, 'submission_due'), true);
    assert.equal(showField(DEFAULT_CONFIG, lead, 'title'), true, 'always-shown fields are always shown');
  });

  test('a hidden field that already has a value is still shown', () => {
    assert.equal(showField(DEFAULT_CONFIG, { type: 'Lead', qa_due: '2026-10-20' }, 'qa_due'), true);
    assert.equal(showField(DEFAULT_CONFIG, { type: 'Lead', competitors: [] }, 'competitors'), false, 'an empty list is not a value');
  });

  test('the proposal types show expected start, not the submission dates', () => {
    const renewal = { type: 'Renewal / Extension' };
    assert.equal(showField(DEFAULT_CONFIG, renewal, 'expected_start_on'), true);
    assert.equal(showField(DEFAULT_CONFIG, renewal, 'submission_due'), false);
    assert.equal(isOptionalField(DEFAULT_CONFIG, 'title'), false);
    assert.deepEqual(typeProfile(DEFAULT_CONFIG, 'Lead').required, []);
  });

  test('the required fields depend on the type', () => {
    const base = {
      schema_version: 1, id: 'DL-2026-0001', title: 'x', customer_id: 'CU-0001', sales_owner_id: null,
      presales_owner_id: null, delivery_owner_id: null, support_ids: [], support_requests: [], support_seq: 0,
      contact_ids: [], source: null, description: '', c4c_id: null, bu: null, practice: null, region: null,
      stage: 'Lead', on_hold: false, probability: 5, priority: 'Medium', go_no_go: 'Pending', go_no_go_on: null,
      received_on: '2026-10-01', qa_due: null, submission_due: null, submitted_on: null,
      expected_decision_on: null, expected_start_on: null, closed_on: null, currency: 'EUR', est_value: null,
      effort_person_months: null, duration_months: null, pricing_model: null, incumbent: null, competitors: [],
      outcome_reason: null, next_action: null, next_action_due: null, tags: [], links: [], history: [],
      created_at: '2026-10-01T09:00:00+01:00', updated_at: '2026-10-01T09:00:00+01:00',
    };
    assert.deepEqual(validateRecord('deal', { ...base, type: 'Lead' }, DEFAULT_CONFIG), []);
    assert.deepEqual(
      validateRecord('deal', { ...base, type: 'RFQ' }, DEFAULT_CONFIG),
      ['Submission due is required for RFQ'],
    );
    assert.deepEqual(validateRecord('deal', { ...base, type: 'Mystery' }, DEFAULT_CONFIG), ["Type: unknown value 'Mystery'"]);
  });

  test('a deal file with no type is RFQ when tagged RFQ, otherwise Lead', () => {
    assert.equal(withDefaultType({ tags: ['RFQ'] }).type, 'RFQ');
    assert.equal(withDefaultType({ tags: [] }).type, 'Lead');
  });
});

describe('type rules when saving, over HTTP', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  test('a Lead saves without any RFQ dates', async () => {
    const res = await post(app.base, '/opportunities', form());
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(DEAL).type, 'Lead');
    assert.equal(app.store.getDeal(DEAL).submission_due, null);
  });

  test('an RFQ without a submission date is refused, and nothing is written', async () => {
    const before = commits(app.root);
    const res = await post(app.base, '/opportunities', form({ title: 'Needs a date', type: 'RFQ' }));
    assert.equal(res.status, 422);
    assert.match(await plainText(res), /Submission due is required for RFQ/);
    assert.equal(commits(app.root), before);
  });

  test('an RFQ with a submission date saves', async () => {
    const res = await post(app.base, '/opportunities', form({ title: 'Real RFQ', type: 'RFQ', submission_due: '2026-11-01' }));
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(`DL-${YEAR}-0002`).submission_due, '2026-11-01');
  });

  test('a type is required', async () => {
    const res = await post(app.base, '/opportunities', form({ title: 'No type', type: '' }));
    assert.equal(res.status, 422);
    assert.match(await plainText(res), /Type is required/);
  });

  test('changing a type keeps the values of the fields it hides', async () => {
    // DL-…-0002 is an RFQ. Changing it to Lead hides the submission date, but the value stays.
    const id = `DL-${YEAR}-0002`;
    const res = await post(app.base, `/opportunities/${id}`, form({ title: 'Real RFQ', type: 'Lead', submission_due: '2026-11-01' }));
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(id).type, 'Lead');
    assert.equal(app.store.getDeal(id).submission_due, '2026-11-01');
  });

  test('a Lead file stores the RFQ fields as empty, so the structure does not change', async () => {
    const file = JSON.parse(await fs.readFile(path.join(app.root, 'data', 'deals', `${DEAL}.json`), 'utf8'));
    assert.equal(file.qa_due, null);
    assert.equal(file.submission_due, null);
    assert.deepEqual(file.competitors, []);
    assert.ok('effort_person_months' in file);
  });
});
