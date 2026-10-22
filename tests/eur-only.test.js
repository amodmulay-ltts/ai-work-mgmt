import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('every value is EUR, and older files keep their amounts', () => {
  let root;
  let store;
  let close;

  before(async () => {
    const remote = await makeRemote();
    root = await makeClone(remote.dir, 'app', null);
    // An older opportunity file that says USD, with an amount and a field this version does not know.
    await fs.mkdir(path.join(root, 'data', 'deals'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'deals', 'DL-2025-0001.json'), JSON.stringify({
      schema_version: 1, id: 'DL-2025-0001', title: 'Old USD deal', type: 'Lead', tags: [], source: null, description: '',
      customer_id: 'CU-0001', contact_ids: [], c4c_id: null, sales_owner_id: null, presales_owner_id: null, delivery_owner_id: null,
      support_ids: [], support_requests: [], support_seq: 0, bu: null, practice: null, region: null, stage: 'Lead',
      on_hold: false, probability: 20, priority: 'Medium', go_no_go: 'Pending', go_no_go_on: null, received_on: '2025-01-10',
      qa_due: null, submission_due: null, submitted_on: null, expected_decision_on: null, expected_start_on: null,
      closed_on: null, currency: 'USD', est_value: 12000, effort_person_months: null, duration_months: null,
      pricing_model: null, incumbent: null, competitors: [], outcome_reason: null, next_action: null, next_action_due: null,
      links: [], history: [], created_at: '2025-01-10T09:00:00+01:00', updated_at: '2025-01-10T09:00:00+01:00',
      legacy_note: 'keep me',
    }));
    await fs.mkdir(path.join(root, 'data', 'customers'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'customers', 'CU-0001.json'), JSON.stringify({
      schema_version: 1, id: 'CU-0001', name: 'Bosch', short_name: null, industry: null, region: null, country: null,
      bu: null, account_manager_id: null, c4c_account_id: null, website: null, tags: [], notes: '',
      created_at: '2025-01-01T09:00:00+01:00', updated_at: '2025-01-01T09:00:00+01:00',
    }));
    const created = await createApp({ root, syncEnabled: false });
    store = created.store;
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
  });

  after(async () => {
    await close();
  });

  test('the config has EUR as its only currency', () => {
    assert.deepEqual(DEFAULT_CONFIG.currencies, ['EUR']);
    assert.deepEqual(store.config().currencies, ['EUR']);
  });

  test('an old USD file loads as EUR, with its amount and unknown fields', () => {
    const deal = store.getDeal('DL-2025-0001');
    assert.equal(deal.currency, 'EUR');
    assert.equal(deal.est_value, 12000);
    assert.equal(deal.legacy_note, 'keep me');
  });

  test('saving it writes EUR and keeps the amount and the unknown field', async () => {
    const deal = store.getDeal('DL-2025-0001');
    await store.save([{ ...deal, est_value: 12500 }], 'DL-2025-0001: test');
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'data', 'deals', 'DL-2025-0001.json'), 'utf8'));
    assert.equal(onDisk.currency, 'EUR');
    assert.equal(onDisk.est_value, 12500);
    assert.equal(onDisk.legacy_note, 'keep me');
  });
});
