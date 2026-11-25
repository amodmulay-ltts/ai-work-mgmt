/**
 * Meeting notes: notes taken while a meeting is happening (PLAN.md §23).
 * A meeting keeps an append-only list of timestamped note lines, so each line
 * is saved on its own and nothing typed earlier is lost.
 */
import { randomUUID } from 'node:crypto';

export const TITLE_MAX = 120;
export const ATTENDEES_MAX = 200;
export const SUMMARY_MAX = 5000;
export const NOTE_MAX = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the meeting form into fields. The id and dates of the record are set
 * by the caller. Any valid date is allowed: a meeting may be in the past or
 * planned for later.
 * @returns {{ typed: object | null, errors: Record<string, string> }}
 */
export function parseMeetingForm(values) {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();
  const title = text('title');
  if (!title) errors.title = 'Title is required';
  else if (title.length > TITLE_MAX) errors.title = `Title is longer than ${TITLE_MAX} characters`;
  const on = text('on');
  if (!on) errors.on = 'Pick the date of the meeting';
  else if (!DATE_RE.test(on)) errors.on = 'Enter a valid date';
  const attendees = text('attendees');
  if (attendees.length > ATTENDEES_MAX) errors.attendees = `Attendees is longer than ${ATTENDEES_MAX} characters`;
  const summary = text('summary');
  if (summary.length > SUMMARY_MAX) errors.summary = `Summary is longer than ${SUMMARY_MAX} characters`;
  if (Object.keys(errors).length) return { typed: null, errors };
  return {
    typed: {
      title,
      on,
      attendees,
      summary,
      customer_id: text('customer_id') || null,
      deal_id: text('deal_id') || null,
    },
    errors,
  };
}

/**
 * One note line from the add-a-note form. Returns an error message instead
 * when the text is not usable.
 * @returns {{ note: object | null, error: string | null }}
 */
export function newMeetingNote(input, { at }) {
  const text = String(input.text ?? '').trim();
  if (!text) return { note: null, error: 'Write the note first.' };
  if (text.length > NOTE_MAX) return { note: null, error: `The note is longer than ${NOTE_MAX} characters.` };
  return { note: { id: randomUUID().slice(0, 8), at, text }, error: null };
}

/**
 * Replaces one note line's text, keeping its id and time. Returns null when
 * the meeting has no note with that id, or the new text is not usable.
 * @returns {{ meeting: object } | { error: string } | null}
 */
export function editMeetingNote(meeting, noteId, text, { at }) {
  const found = (meeting.notes ?? []).find((n) => n.id === noteId);
  if (!found) return null;
  const clean = String(text ?? '').trim();
  if (!clean) return { error: 'Write the note first.' };
  if (clean.length > NOTE_MAX) return { error: `The note is longer than ${NOTE_MAX} characters.` };
  const notes = meeting.notes.map((n) => (n.id === noteId ? { ...n, text: clean } : n));
  return { meeting: { ...meeting, notes, updated_at: at } };
}

/**
 * Removes one note line. Returns null when the meeting has no note with that id.
 * @returns {{ meeting: object, removed: object } | null}
 */
export function removeMeetingNote(meeting, noteId, { at }) {
  const removed = (meeting.notes ?? []).find((n) => n.id === noteId);
  if (!removed) return null;
  return { meeting: { ...meeting, notes: meeting.notes.filter((n) => n.id !== noteId), updated_at: at }, removed };
}

/** Notes in the order the meeting ran: oldest first. */
export function notesInOrder(meeting) {
  return [...(meeting.notes ?? [])].sort((a, b) => a.at.localeCompare(b.at));
}

/** Checks the stored shape of a meeting. Returns error messages (empty when valid). */
export function meetingErrors(m) {
  const errors = [];
  if (!/^MT-\d{4}$/.test(m.id ?? '')) errors.push('id must look like MT-0001');
  if (!m.title || !String(m.title).trim()) errors.push('Title is required');
  if (!DATE_RE.test(m.on ?? '')) errors.push('Meeting date is not valid');
  for (const n of m.notes ?? []) {
    if (!n.at || !String(n.text ?? '').trim()) errors.push('A note needs a time and text');
  }
  return errors;
}
