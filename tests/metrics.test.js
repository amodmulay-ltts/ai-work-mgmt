import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import {
  agingBucket, agingCounts, ageDays, daysBetween, daysInStage, daysToSubmission, health, isOpen, isStale,
  moneyTotals, pipelineByStage, status, weightedValue, winStats,
} from '../app/metrics.js';
import { moneyCompact, moneyTotalsText } from '../app/lib/format.js';

const cfg = { ...DEFAULT_CONFIG, stale_after_days: 14 };
const TODAY = '2026-10-18';

/** A minimal open deal. Tests override the fields they care about. */
function deal(overrides = {}) {
  return {
    id: 'DL-2026-0001',
    stage: 'Solutioning',
    on_hold: false,
    probability: 35,
    received_on: '2026-10-01',
    submission_due: null,
    submitted_on: null,
    closed_on: null,
    next_action: 'Call the customer',
    next_action_due: null,
    est_value: 1000,
    currency: 'EUR',
    created_at: '2026-10-01T09:00:00+00:00',
    updated_at: '2026-10-18T09:00:00+00:00',
    history: [],
    ...overrides,
  };
}

test('daysBetween counts whole days regardless of timezone', () => {
  assert.equal(daysBetween('2026-10-18', '2026-10-21'), 3);
  assert.equal(daysBetween('2026-10-21', '2026-10-18'), -3);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
});

test('status follows the stage: outcome, then on hold, then open', () => {
  assert.equal(status(deal({ stage: 'Won' }), cfg), 'Won');
  assert.equal(status(deal({ stage: 'Lost' }), cfg), 'Lost');
  assert.equal(status(deal({ stage: 'Dropped' }), cfg), 'Dropped');
  assert.equal(status(deal({ on_hold: true }), cfg), 'On Hold');
  assert.equal(status(deal(), cfg), 'Open');
});

test('on-hold deals still count as open', () => {
  assert.equal(isOpen(deal({ on_hold: true }), cfg), true);
  assert.equal(isOpen(deal({ stage: 'Won' }), cfg), false);
});

test('age runs to today while open and to the close date once closed', () => {
  assert.equal(ageDays(deal(), TODAY), 17);
  assert.equal(ageDays(deal({ stage: 'Won', closed_on: '2026-10-11' }), TODAY), 10);
});

test('days in stage uses the last stage change, else the creation date', () => {
  assert.equal(daysInStage(deal(), TODAY), 17);
  const withChange = deal({
    history: [{ at: '2026-10-10T12:00:00+00:00', kind: 'stage', text: '', from_value: null, to_value: null }],
  });
  assert.equal(daysInStage(withChange, TODAY), 8);
});

test('days to submission is negative when overdue and null once submitted', () => {
  assert.equal(daysToSubmission(deal({ submission_due: '2026-10-20' }), TODAY), 2);
  assert.equal(daysToSubmission(deal({ submission_due: '2026-10-15' }), TODAY), -3);
  assert.equal(daysToSubmission(deal({ submission_due: '2026-10-20', submitted_on: '2026-10-17' }), TODAY), null);
  assert.equal(daysToSubmission(deal(), TODAY), null);
});

test('stale means open, not on hold, and no update for more than the threshold', () => {
  const at = (days) => `2026-10-${String(18 - days).padStart(2, '0')}T09:00:00+00:00`;
  assert.equal(isStale(deal({ updated_at: at(14) }), cfg, TODAY), false, 'exactly 14 days is not stale');
  assert.equal(isStale(deal({ updated_at: at(15) }), cfg, TODAY), true, '15 days is stale');
  assert.equal(isStale(deal({ updated_at: at(15), on_hold: true }), cfg, TODAY), false, 'on hold is never stale');
  assert.equal(isStale(deal({ updated_at: at(15), stage: 'Won' }), cfg, TODAY), false, 'closed is never stale');
});

test('weighted value is value times probability, in the deal currency', () => {
  assert.equal(weightedValue(deal({ est_value: 1000, probability: 35 })), 350);
  assert.equal(weightedValue(deal({ est_value: null })), null);
});

test('aging buckets change at 30, 60 and 90 days', () => {
  const aged = (days) => deal({ received_on: daysAgo(days) });
  assert.equal(agingBucket(aged(30), TODAY), '0–30');
  assert.equal(agingBucket(aged(31), TODAY), '31–60');
  assert.equal(agingBucket(aged(60), TODAY), '31–60');
  assert.equal(agingBucket(aged(61), TODAY), '61–90');
  assert.equal(agingBucket(aged(90), TODAY), '61–90');
  assert.equal(agingBucket(aged(91), TODAY), '90+');
});

function daysAgo(n) {
  const d = new Date(Date.UTC(2026, 9, 18 - n));
  return d.toISOString().slice(0, 10);
}

test('health is closed for terminal stages and hold for paused deals', () => {
  assert.deepEqual(health(deal({ stage: 'Won' }), cfg, TODAY), { level: 'closed', reasons: [] });
  assert.deepEqual(health(deal({ on_hold: true }), cfg, TODAY), { level: 'hold', reasons: ['On hold'] });
});

test('submission boundary: overdue is red, due in 0–3 days is amber, further out is fine', () => {
  const withSubmission = (due) => health(deal({ submission_due: due, next_action: 'x', updated_at: '2026-10-18T09:00:00+00:00' }), cfg, TODAY);
  assert.deepEqual(withSubmission('2026-10-17'), { level: 'red', reasons: ['Submission overdue by 1d'] });
  assert.deepEqual(withSubmission('2026-10-18'), { level: 'amber', reasons: ['Submission due today'] });
  assert.deepEqual(withSubmission('2026-10-21'), { level: 'amber', reasons: ['Submission due in 3d'] });
  assert.deepEqual(withSubmission('2026-10-22'), { level: 'green', reasons: [] });
});

test('next action boundary: due up to 3 days ago is amber, more than 3 days late is red', () => {
  const withNextAction = (due) => health(deal({ next_action_due: due, next_action: 'x', updated_at: '2026-10-18T09:00:00+00:00' }), cfg, TODAY);
  assert.deepEqual(withNextAction('2026-10-15'), { level: 'amber', reasons: ['Next action due'] });
  assert.deepEqual(withNextAction('2026-10-14'), { level: 'red', reasons: ['Next action overdue by 4d'] });
});

test('health lists every reason and the most severe level wins', () => {
  const h = health(
    deal({ submission_due: '2026-10-15', next_action: null, updated_at: '2026-09-01T09:00:00+00:00' }),
    cfg,
    TODAY,
  );
  assert.equal(h.level, 'red');
  assert.ok(h.reasons.includes('Submission overdue by 3d'));
  assert.ok(h.reasons.includes('No next action'));
  assert.ok(h.reasons.some((r) => r.startsWith('No activity for')));
});

test('money totals are kept per currency, never converted', () => {
  const totals = moneyTotals([['EUR', 1000], ['USD', 500], ['EUR', 250], ['EUR', null]], cfg);
  assert.deepEqual(totals, { EUR: 1250, USD: 500 });
});

test('money totals order follows the config list, unknown currencies last', () => {
  const totals = moneyTotals([['ZAR', 1], ['JPY', 2], ['USD', 3], ['AUD', 4]], cfg);
  assert.deepEqual(Object.keys(totals), ['USD', 'JPY', 'AUD', 'ZAR']);
});

test('compact money and totals text', () => {
  assert.equal(moneyCompact(1250000, 'EUR'), 'EUR 1.25M');
  assert.equal(moneyCompact(850000, 'USD'), 'USD 850K');
  assert.equal(moneyCompact(4500000, 'INR'), 'INR 4.5M');
  assert.equal(moneyTotalsText({}), '—');
  assert.equal(moneyTotalsText({ EUR: 1200000, USD: 300000 }), 'EUR 1.2M · USD 300K');
});

test('pipeline by stage counts open stages only', () => {
  const deals = [deal({ stage: 'Lead', est_value: 100, currency: 'EUR' }), deal({ stage: 'Lead', est_value: null }), deal({ stage: 'Won' })];
  const pipeline = pipelineByStage(deals, cfg);
  assert.equal(pipeline.some((s) => s.stage === 'Won'), false);
  const lead = pipeline.find((s) => s.stage === 'Lead');
  assert.equal(lead.count, 2);
  assert.deepEqual(lead.totals, { EUR: 100 });
});

test('aging counts and win statistics', () => {
  const deals = [
    deal({ received_on: daysAgo(5) }),
    deal({ received_on: daysAgo(40) }),
    deal({ stage: 'Won', closed_on: '2026-10-01' }),
    deal({ stage: 'Lost', closed_on: '2026-10-02' }),
    deal({ stage: 'Lost', closed_on: '2026-01-01' }),
  ];
  assert.deepEqual(agingCounts(deals, cfg, TODAY), { '0–30': 1, '31–60': 1, '61–90': 0, '90+': 0 }, 'closed deals are not aged');
  assert.deepEqual(winStats(deals, cfg, TODAY), { won: 1, lost: 1, rate: 0.5 });
  assert.deepEqual(winStats([], cfg, TODAY), { won: 0, lost: 0, rate: null });
});
