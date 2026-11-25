import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { editMeetingNote, meetingErrors, newMeetingNote, notesInOrder, parseMeetingForm, removeMeetingNote } from '../app/lib/meetings.js';

const AT = '2026-11-25T09:00:00+01:00';
const meeting = (notes = []) => ({ id: 'MT-0001', title: 'Sync', on: '2026-11-25', notes });

describe('meetings: form rules', () => {
  test('the title is required', () => {
    assert.deepEqual(parseMeetingForm({ title: '  ', on: '2026-11-25' }).errors, { title: 'Title is required' });
  });

  test('the date is required', () => {
    assert.ok(parseMeetingForm({ title: 'Sync' }).errors.on);
  });

  test('a US-style date is rejected', () => {
    assert.equal(parseMeetingForm({ title: 'Sync', on: '11/11/2026' }).errors.on, 'Enter a valid date');
  });

  test('a date far in the past and one far in the future are both accepted', () => {
    assert.notEqual(parseMeetingForm({ title: 'Old', on: '2019-01-01' }).typed, null);
    assert.notEqual(parseMeetingForm({ title: 'Later', on: '2099-12-31' }).typed, null);
  });

  test('empty customer and opportunity ids become null', () => {
    const { typed } = parseMeetingForm({ title: 'Sync', on: '2026-11-25', customer_id: '', deal_id: '' });
    assert.equal(typed.customer_id, null);
    assert.equal(typed.deal_id, null);
  });

  test('a title over 120 characters is rejected', () => {
    assert.match(parseMeetingForm({ title: 'x'.repeat(121), on: '2026-11-25' }).errors.title, /120/);
  });
});

describe('meetings: note rules', () => {
  test('an empty or blank note is refused', () => {
    assert.equal(newMeetingNote({ text: '   ' }, { at: AT }).error, 'Write the note first.');
    assert.equal(newMeetingNote({}, { at: AT }).error, 'Write the note first.');
  });

  test('a note gets an 8-character id, the given time, and trimmed text', () => {
    const { note } = newMeetingNote({ text: '  Agreed the scope  ' }, { at: AT });
    assert.equal(note.id.length, 8);
    assert.equal(note.at, AT);
    assert.equal(note.text, 'Agreed the scope');
  });

  test('a note over 2000 characters is refused', () => {
    assert.match(newMeetingNote({ text: 'x'.repeat(2001) }, { at: AT }).error, /2000/);
  });

  test('editing an unknown note id returns null', () => {
    assert.equal(editMeetingNote(meeting([{ id: 'a1', at: AT, text: 'x' }]), 'nope', 'y', { at: AT }), null);
  });

  test('an edit keeps the id and time and changes only the text', () => {
    const original = { id: 'a1', at: AT, text: 'old' };
    const { meeting: next } = editMeetingNote(meeting([original]), 'a1', 'new', { at: '2026-11-25T10:00:00+01:00' });
    assert.deepEqual(next.notes[0], { id: 'a1', at: AT, text: 'new' });
  });

  test('an edit to blank text is refused', () => {
    assert.equal(editMeetingNote(meeting([{ id: 'a1', at: AT, text: 'x' }]), 'a1', '  ', { at: AT }).error, 'Write the note first.');
  });

  test('removing an unknown id returns null; removing a real one drops only that note', () => {
    const m = meeting([{ id: 'a1', at: AT, text: 'one' }, { id: 'b2', at: AT, text: 'two' }]);
    assert.equal(removeMeetingNote(m, 'nope', { at: AT }), null);
    const { meeting: next } = removeMeetingNote(m, 'a1', { at: AT });
    assert.deepEqual(next.notes.map((n) => n.id), ['b2']);
  });

  test('notes come back oldest first, whatever order they were stored in', () => {
    const notes = [
      { id: 'c', at: '2026-11-25T11:00:00+01:00', text: 'third' },
      { id: 'a', at: '2026-11-25T09:00:00+01:00', text: 'first' },
      { id: 'b', at: '2026-11-25T10:00:00+01:00', text: 'second' },
    ];
    assert.deepEqual(notesInOrder(meeting(notes)).map((n) => n.text), ['first', 'second', 'third']);
  });

  test('a meeting with no notes key sorts to an empty list (old files still load)', () => {
    assert.deepEqual(notesInOrder({ id: 'MT-0001' }), []);
  });

  test('meetingErrors is empty for a valid meeting and flags each problem', () => {
    assert.deepEqual(meetingErrors(meeting([{ id: 'a', at: AT, text: 'x' }])), []);
    assert.ok(meetingErrors({ ...meeting(), id: 'XX-1' }).length > 0);
    assert.ok(meetingErrors({ ...meeting(), title: '' }).length > 0);
    assert.ok(meetingErrors({ ...meeting(), on: '25/11/2026' }).length > 0);
    assert.ok(meetingErrors(meeting([{ id: 'a', at: AT, text: ' ' }])).length > 0);
  });
});
