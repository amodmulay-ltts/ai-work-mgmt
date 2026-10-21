/**
 * Where a person is referenced, and how to move those references to another person (merge).
 * The same list answers "is this person in use?" for the delete guard, so the two cannot drift apart.
 */
import { noteEntry } from '../history.js';

/** Every person id a record points at. Deals, customers (account manager, connect owners) and activities. */
export function personRefs(record) {
  if (record.id.startsWith('DL-')) {
    return [
      record.sales_owner_id, record.presales_owner_id, record.delivery_owner_id,
      ...record.contact_ids, ...record.support_ids,
      ...record.support_requests.flatMap((a) => [a.assignee_id, a.requested_by_id]),
    ].filter(Boolean);
  }
  if (record.id.startsWith('CU-')) {
    return [record.account_manager_id, ...(record.connects ?? []).map((c) => c.who_id)].filter(Boolean);
  }
  if (record.id.startsWith('AC-')) return [record.owner_id].filter(Boolean);
  return [];
}

/**
 * The same record with every reference to `from` pointing at `to`. Returns the record unchanged
 * (the same object) when it does not refer to `from`. Opportunities get a history note.
 */
export function moveReferences(record, from, to, at) {
  if (!personRefs(record).includes(from)) return record;
  const swap = (id) => (id === from ? to : id);
  const unique = (ids) => [...new Set(ids)];
  if (record.id.startsWith('DL-')) {
    const deal = {
      ...record,
      sales_owner_id: swap(record.sales_owner_id),
      presales_owner_id: swap(record.presales_owner_id),
      delivery_owner_id: swap(record.delivery_owner_id),
      contact_ids: unique(record.contact_ids.map(swap)),
      support_ids: unique(record.support_ids.map(swap)),
      support_requests: record.support_requests.map((a) => ({
        ...a,
        assignee_id: swap(a.assignee_id),
        requested_by_id: swap(a.requested_by_id),
      })),
    };
    return { ...deal, history: [...record.history, noteEntry(`Person ${from} merged into ${to}`, at)] };
  }
  if (record.id.startsWith('CU-')) {
    return {
      ...record,
      account_manager_id: swap(record.account_manager_id),
      connects: (record.connects ?? []).map((c) => ({ ...c, who_id: swap(c.who_id) })),
    };
  }
  return { ...record, owner_id: swap(record.owner_id) };
}

/** How many records refer to a person, by kind. */
export function personUsage(records, personId) {
  const count = (list) => list.filter((r) => personRefs(r).includes(personId)).length;
  return {
    opportunities: count(records.deals),
    customers: count(records.customers),
    activities: count(records.activities),
  };
}
