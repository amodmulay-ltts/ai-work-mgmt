/**
 * Default settings, written to data/config.json on first run.
 * Keys missing from the file are filled in from here (see Store.loadAll).
 */
// Optional fields for the RFQ family. Lead shows none of them.
const RFQ_FIELDS = [
  'qa_due', 'submission_due', 'submitted_on', 'go_no_go', 'go_no_go_on', 'expected_decision_on',
  'effort_person_months', 'duration_months', 'pricing_model', 'incumbent', 'competitors',
];
const PROPOSAL_FIELDS = ['expected_start_on', 'expected_decision_on', 'pricing_model'];

export const DEFAULT_CONFIG = {
  schema_version: 1,
  me_person_id: null,
  stale_after_days: 14,
  connect_after_days: 30,
  push_delay_seconds: 30,
  stages: [
    { name: 'Lead', probability: 5, terminal: false, outcome: null },
    { name: 'Qualified', probability: 10, terminal: false, outcome: null },
    { name: 'RFI', probability: 15, terminal: false, outcome: null },
    { name: 'RFQ Received', probability: 25, terminal: false, outcome: null },
    { name: 'Solutioning', probability: 35, terminal: false, outcome: null },
    { name: 'Proposal Submitted', probability: 50, terminal: false, outcome: null },
    { name: 'Clarification / Negotiation', probability: 70, terminal: false, outcome: null },
    { name: 'Won', probability: 100, terminal: true, outcome: 'won' },
    { name: 'Lost', probability: 0, terminal: true, outcome: 'lost' },
    { name: 'Dropped', probability: 0, terminal: true, outcome: 'dropped' },
  ],
  // Tags on opportunities. Starts with the usual types; the user adds and removes tags freely.
  tags: ['RFQ', 'RFI', 'RFP', 'Proactive Proposal', 'Change Request', 'Renewal / Extension'],
  // Opportunity types. A type decides which optional fields are shown and which must be filled.
  // fields: the optional fields shown for this type. required: filled in before the save is accepted.
  // An optional field that already has a value is always shown, so nothing is hidden silently.
  opportunity_types: [
    { name: 'Lead', fields: [], required: [] },
    { name: 'RFI', fields: RFQ_FIELDS, required: ['submission_due'] },
    { name: 'RFQ', fields: RFQ_FIELDS, required: ['submission_due'] },
    { name: 'RFP', fields: RFQ_FIELDS, required: ['submission_due'] },
    { name: 'Proactive Proposal', fields: PROPOSAL_FIELDS, required: [] },
    { name: 'Change Request', fields: PROPOSAL_FIELDS, required: [] },
    { name: 'Renewal / Extension', fields: PROPOSAL_FIELDS, required: [] },
  ],
  sources: ['Customer RFQ', 'Sales lead', 'Account mining', 'Partner', 'Inbound / Website', 'Other'],
  business_units: ['Mobility', 'Sustainability', 'Hi-Tech'],
  regions: ['North America', 'Europe', 'UK', 'India', 'APAC', 'Japan', 'Middle East'],
  pricing_models: ['T&M', 'Fixed Price', 'Managed Capacity', 'ODC', 'Hybrid'],
  currencies: ['USD', 'EUR', 'GBP', 'INR', 'JPY'],
  outcome_reasons: [
    'Price',
    'Technical fit',
    'Relationship / incumbent',
    'Timeline',
    'Customer cancelled',
    'Scope changed',
    'No-Go decision',
    'Other',
  ],
};
