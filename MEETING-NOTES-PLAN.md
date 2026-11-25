# Meeting notes — development plan

**This file is a temporary working plan, not a spec.** It is written for a
Haiku session doing the development. The permanent spec goes into `PLAN.md`
§23 in Phase M4. **Delete this file in Phase M6, after everything passes.**

---

## 0. How to use this plan

1. Work in phase order: M1 → M2 → M3 → M4 → (M5 optional) → M6. Do not start
   a phase before the previous one's checks pass.
2. One branch for the whole feature: `meeting-notes`, cut from `main`.
   Commit after each phase. Merge to `main` and delete the branch in M6.
3. After **every** phase run `npm test` from the repo root. It must print
   `# fail 0`. If it does not, fix it before moving on.
4. Obey `PLAN.md` §0: Node 20+, plain JavaScript ES modules, **no new
   dependencies**, no framework, no build step, no Python. All data access
   through `app/store.js`. All git through `app/git-sync.js`.
5. Never hand-edit anything in `data/`. Never `git add` `data/`.
6. If something in this plan contradicts `PLAN.md`, stop and ask the user.

### Starting state (verified 2026-11-25)

- Branch `main`, 370 tests pass (`npm test` → `# fail 0`).
- `CLAUDE.md` has uncommitted edits. **Leave them alone.** Do not stage
  `CLAUDE.md` in any commit in this plan.
- There is an unmerged branch `software-factory`. Ignore it.

### Create the branch first

```bash
git checkout main
git checkout -b meeting-notes
```

---

## 1. What we are building

A place to take notes **while a meeting is happening**, reachable from the
front page in one click.

### The core idea

Notes are **an append-only list of timestamped lines**, not one big text box.
During a meeting you type a line and press Add; that line is saved and
committed on its own. If the browser dies mid-meeting nothing typed earlier
is lost. This mirrors the `comments` list on a task and the `updates` list on
an activity, which already work this way.

### The record

A new record kind `meeting`, ids `MT-0001`, stored in `data/meetings/`.

| Field | Type | Rules |
|---|---|---|
| `schema_version` | number | always `1` |
| `id` | string | `MT-0001` |
| `title` | string | required, max 120 characters |
| `on` | string | date `YYYY-MM-DD`, required, defaults to today. **Any valid date is allowed — no past or future rule.** |
| `attendees` | string | optional, max 200 characters, free text |
| `customer_id` | string or null | optional; when set it must be an existing customer |
| `deal_id` | string or null | optional; when set it must be an existing opportunity |
| `summary` | string | optional, max 5000 characters |
| `notes` | array | the live notes, oldest first; each `{ id, at, text }` |
| `created_at` | string | ISO with offset, set once |
| `updated_at` | string | ISO with offset, set on every save |

A note line: `id` (8 hex characters), `at` (full ISO with offset, from
`nowIso()`), `text` (required, max 2000 characters).

**No `status` field.** A meeting is identified by its date. Do not add one.

**Why no future/past date rule:** the visits feature has one and it caused a
bug where a past meeting could not be edited. Meetings deliberately have no
such rule.

### Pages

| Method | Path | What it does |
|---|---|---|
| GET | `/meetings` | List. Today's meetings first, then newest date first. Filter `?when=today\|upcoming\|past` (default: all). |
| GET | `/meetings/new` | Start a meeting: title, date, attendees, customer, opportunity. |
| POST | `/meetings` | Creates it and redirects to its page. |
| GET | `/meetings/:id` | **The note-taking page.** Add-a-note box at the top, the running notes below, summary and links in the side. |
| GET | `/meetings/:id/edit` | Edit the header fields and the summary. |
| POST | `/meetings/:id` | Saves the edit. Does not change `notes`. |
| POST | `/meetings/:id/notes` | Appends one note line. Its own commit. |
| POST | `/meetings/:id/notes/:noteId` | Edits one note line's text. Its own commit. |
| POST | `/meetings/:id/notes/:noteId/delete` | Removes one note line. Its own commit. |
| POST | `/meetings/:id/delete` | Deletes the meeting. Type-to-confirm: the ID must be typed. |

### Reachable from the front page (the headline requirement)

Three entry points, all added in Phase M4:

1. A **`+ Meeting notes`** primary button in the dashboard header, next to
   the other header buttons, linking to `/meetings/new`.
2. A **Meetings** card on the dashboard: today's meetings (with a direct
   link into each one's note page), then the three most recent, then
   `All meetings →`.
3. A **Meetings** link in the top navigation.

### Not in scope

Excel export, the weekly report, attachments, sharing, reminders, and
recurring meetings. Do not build these.

---

## 2. The template to copy

**The Backlog (tasks) feature has almost exactly this shape and already
works. Copy it.** Read these files before writing anything:

| Read | Why |
|---|---|
| `app/lib/tasks.js` | the pure module: parse, validate, list of constants |
| `app/forms.js`, function `saveTask` | how a record is built and saved |
| `app/routes.js` lines ~1778–1905 | the whole task route block |
| `app/views/tasks/list.ejs`, `form.ejs`, `detail.ejs` | the three views |
| `tests/backlog.test.js` | how to test a record kind over HTTP |
| `app/views/partials/delete-form.ejs` | the type-to-confirm box |

Meetings differ from tasks in only four ways: notes are timestamped and
oldest-first (task comments are newest-first), notes can be edited and
removed (task comments cannot), there is no status/action machinery, and
there are two optional record links (customer, opportunity).

---

## 3. Phase M1 — the data layer

### M1.1 Create `app/lib/meetings.js`

Write this file exactly:

```js
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
```

### M1.2 Wire the kind in (five edits, each one line)

Make these exact replacements. The left side is the current text; find it and
replace it with the right side.

**`app/models.js`**

1. After the line
   `import { taskErrors } from './lib/tasks.js';`
   add
   `import { meetingErrors } from './lib/meetings.js';`

2. `const PREFIX = { deal: 'DL', customer: 'CU', person: 'PE', activity: 'AC', task: 'TK' };`
   →
   `const PREFIX = { deal: 'DL', customer: 'CU', person: 'PE', activity: 'AC', task: 'TK', meeting: 'MT' };`

3. After the line `  if (kind === 'task') return taskErrors(obj);`
   add
   `  if (kind === 'meeting') return meetingErrors(obj);`

**`app/store.js`**

4. `const KINDS = ['customer', 'person', 'deal', 'activity', 'task'];`
   →
   `const KINDS = ['customer', 'person', 'deal', 'activity', 'task', 'meeting'];`

   and on the next line add `meeting: 'meetings'` to `FOLDER`:
   `const FOLDER = { deal: 'deals', customer: 'customers', person: 'people', activity: 'activities', task: 'tasks', meeting: 'meetings' };`

5. **Two** places have the records map. Change **both** (one in the
   constructor, one in `loadAll`):
   `{ deal: new Map(), customer: new Map(), person: new Map(), activity: new Map(), task: new Map() }`
   →
   `{ deal: new Map(), customer: new Map(), person: new Map(), activity: new Map(), task: new Map(), meeting: new Map() }`

Then add these two methods to the `Store` class, directly after `getTask`:

```js
  listMeetings() {
    return [...this.records.meeting.values()].sort((a, b) => b.on.localeCompare(a.on) || b.id.localeCompare(a.id));
  }

  getMeeting(id) {
    return this.records.meeting.get(id) ?? null;
  }
```

`data/meetings/` is created automatically from `FOLDER`. Do not create it by
hand and do not commit it.

### M1.3 Add `saveMeeting` to `app/forms.js`

Put this directly **before** `export async function saveTask`:

```js
/** Saves a meeting. Notes are kept from the existing record; the form does not change them. */
export async function saveMeeting(store, typed, { existing = null }) {
  const id = existing ? existing.id : await store.nextId('meeting');
  const now = nowIso();
  const meeting = {
    ...(existing ?? {}),
    schema_version: 1,
    id,
    ...typed,
    notes: existing ? existing.notes : [],
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  const errors = validateRecord('meeting', meeting, null);
  if (errors.length) throw new ValidationError(errors);
  await store.save([meeting], existing ? `${id}: updated` : `${id}: created – ${typed.title}`);
  return { meeting };
}
```

### M1.4 Tests — create `tests/meetings.test.js`

Unit tests only in this phase, no HTTP. Import from
`../app/lib/meetings.js`. Write one test for each:

1. `parseMeetingForm` requires a title → `{ title: 'Title is required' }`.
2. `parseMeetingForm` requires a date → error on `on`.
3. `parseMeetingForm` rejects `11/11/2026` as a date.
4. `parseMeetingForm` accepts a date far in the past **and** one far in the
   future (assert `typed` is not null for both) — this is the no-date-rule
   guarantee.
5. `parseMeetingForm` turns empty `customer_id`/`deal_id` into `null`.
6. `parseMeetingForm` rejects a title over 120 characters.
7. `newMeetingNote` refuses empty and whitespace-only text.
8. `newMeetingNote` returns a note with an 8-character id, the given `at`,
   and the trimmed text.
9. `newMeetingNote` refuses text over 2000 characters.
10. `editMeetingNote` returns `null` for an unknown note id.
11. `editMeetingNote` keeps the note's `id` and `at` and changes only `text`.
12. `editMeetingNote` refuses empty text.
13. `removeMeetingNote` returns `null` for an unknown id, and otherwise drops
    exactly that note and leaves the others.
14. `notesInOrder` returns notes oldest first, given them out of order.
15. `meetingErrors` returns `[]` for a valid meeting and complains about a bad
    id, a missing title, a bad date, and a note with no text.

### M1.4 check

```bash
npm test
```

`# fail 0`, and about 15 more tests than 370. Commit:

```bash
git add app/lib/meetings.js app/models.js app/store.js app/forms.js tests/meetings.test.js
git commit -m "Meetings: the record kind and its rules"
```

---

## 4. Phase M2 — the pages

### M2.1 Routes

In `app/routes.js`:

1. Add to the imports, next to the `lib/tasks.js` import:

```js
import { notesInOrder, newMeetingNote, editMeetingNote, removeMeetingNote, parseMeetingForm } from './lib/meetings.js';
```

2. Add `saveMeeting` to the existing import from `./forms.js` (the line that
   already lists `saveActivity, saveCustomer, saveDeal, savePerson, saveTask`).

3. Add `meeting: /^MT-\d{4}$/` to the `ID_RE` object near the top.

4. Add the whole route block **directly before** the line
   `  // ------------------------------------------------ backlog: my tasks (lib/tasks.js)`.

Write the block like the task block, with these differences:

- `active: 'meetings'` on every page.
- The list route reads `?when=`; accept only `today`, `upcoming`, `past`;
  anything else means all. Filter against `todayIso()`: `today` is `on ===
  today`, `upcoming` is `on > today`, `past` is `on < today`. Rows come from
  `store.listMeetings()` (already newest-date-first), but put today's
  meetings at the top of the unfiltered list:
  `rows.sort((a, b) => (b.on === today) - (a.on === today) || ...)` — keep
  the store's order otherwise.
- The list view needs `customerName` and `dealTitle` per row, looked up with
  `store.getCustomer()` / `store.getDeal()`, falling back to `null`.
- `renderMeetingForm` passes `customers: store.listCustomers()` and
  `deals: store.listDeals().filter((d) => isOpen(d, store.config()))` so the
  two optional links are selects of real records. `isOpen` is already
  imported in this file.
- `POST /meetings` and `POST /meetings/:id` must reject a `customer_id` that
  is not a real customer (`errors.customer_id = 'Pick a customer from the
  list.'`) and a `deal_id` that is not a real opportunity
  (`errors.deal_id = 'Pick an opportunity from the list.'`). Check this
  **after** `parseMeetingForm` returns `typed`, and re-render with 422 on
  failure, exactly as the task routes do.
- `GET /meetings/:id` passes `meeting`, `notes: notesInOrder(meeting)`,
  `customer`, `deal` (the looked-up records or null), and `today`.
- Delete uses `typedRight(req, meeting.id)` and the same message shape as
  tasks, then `store.delete(meeting, `${meeting.id}: deleted`)` and
  redirects to `/meetings`.
- Not-found uses `notFound(req, res, 'This meeting')`.

Leave the note routes (`/notes`, `/notes/:noteId`,
`/notes/:noteId/delete`) for Phase M3. Do not write them yet.

### M2.2 Views

Create `app/views/meetings/list.ejs`, `form.ejs`, `detail.ejs` by copying the
three task views and changing them.

**`list.ejs`** — mirror `tasks/list.ejs`:
- Heading `Meetings` with the count, and a `+ New meeting` primary button.
- Filter: `ui.selectControl({ name: 'when', value: filter, placeholder: 'All meetings', ariaLabel: 'When', options: [['today', 'Today'], ['upcoming', 'Upcoming'], ['past', 'Past']] })`.
- Columns: ID, Meeting (title, links to the meeting), Date, Customer,
  Opportunity, Notes (the count, `class="num"`).
- Today's rows get `class="clickable today-row"`; others just `clickable`.
  Add nothing to the CSS for `today-row` yet — M4 does that.
- Empty state: heading `No meetings here`, text
  `Start a meeting and take notes as it happens.`, and the same primary button.

**`form.ejs`** — mirror `tasks/form.ejs`:
- Fields in this order: `title` (required, span), `on` (type `date`,
  required), `attendees` (help: `Who was there. Free text.`),
  `customer_id` (select, placeholder `No customer`, options
  `customers.map((c) => [c.id, c.name])`), `deal_id` (select, placeholder
  `No opportunity`, options `deals.map((d) => [d.id, d.id + ' · ' + d.title])`),
  `summary` (textarea, span, 4 rows, help:
  `Written after the meeting. The notes themselves are added on the meeting's page.`).
- Cancel goes to `/meetings/<id>` when editing, `/meetings` when new.

**`detail.ejs`** — this one is new, not a copy. Phase M2 writes the frame
only; M3 fills in the notes:
- Header like `tasks/detail.ejs`: `<span class="mono">` with the id, `<h1>`
  with the title, and a `meta-line` reading the date (`fmtDate(meeting.on)`),
  then ` · ` and the attendees when set.
- Page actions: `Edit` (secondary, to `/meetings/<id>/edit`) and the
  delete partial:
  `include('../partials/delete-form', { action: `/meetings/${meeting.id}/delete`, expected: meeting.id, what: 'meeting', key: meeting.id })`.
- `detail-grid` with `detail-main` (an empty `Notes` card for now) and
  `detail-side` holding two cards: `Summary` (the text or
  `<p class="subtle">No summary yet.</p>`) and `Links` (a link to the
  customer and to the opportunity when set, else
  `<p class="subtle">Not linked to a customer or an opportunity.</p>`).

Escape every value with `<%= %>`. **Never use `<%- %>` for anything a user
typed** — that would be an HTML injection. `<%- %>` is only for the `ui.*`
helpers and `include`.

### M2.3 Navigation

In `app/views/layout.ejs`, after the Backlog link, add:

```html
        <a href="/meetings" class="<%= active === 'meetings' ? 'active' : '' %>">Meetings</a>
```

### M2.4 Tests — create `tests/meetings-pages.test.js`

Copy the HTTP setup from `tests/backlog.test.js` (the `describe('backlog:
over HTTP')` block): `makeRemote`, `makeClone`, `createApp`, listen on port
0, `post()` helper, `/setup` first. Then test:

1. Creating a meeting returns 303 to `/meetings/<id>`, the id matches
   `^MT-\d{4}$`, `on` is stored, `notes` is `[]`, and one commit was added.
2. The meeting page returns 200 and shows the title and the date.
3. The list shows the meeting; `?when=past` and `?when=upcoming` include or
   exclude it correctly (create one dated in the past and one dated later).
4. A meeting with no title is refused with 422 and nothing is saved.
5. A `customer_id` that is not a real customer is refused with 422.
6. A `deal_id` that is not a real opportunity is refused with 422.
7. A real `customer_id` is saved and the customer's name shows on the
   meeting page.
8. Editing changes the title and summary and keeps `created_at`.
9. Delete with the wrong confirm text leaves the meeting; with the exact id
   it removes it and redirects to `/meetings`.
10. The navigation has a `Meetings` link.

### M2.4 check

```bash
npm test
./start.sh
```

The app opens a browser itself; the default port is 8765 (it prints the URL,
and steps up to 8775 if that one is taken). Go to Meetings, create one, open it, edit it. Then stop the app with
Ctrl+C. Commit:

```bash
git add app/routes.js app/views/meetings app/views/layout.ejs tests/meetings-pages.test.js
git commit -m "Meetings: list, new, edit and the meeting page"
```

---

## 5. Phase M3 — taking notes live

This is the heart of the feature.

### M3.1 Three routes

Add to the meeting route block in `app/routes.js`:

```js
  // Taking notes during the meeting: each line is appended and committed on its own,
  // so nothing typed earlier is lost if the browser closes mid-meeting.
  router.post('/meetings/:id/notes', async (req, res) => {
    const { store } = req.app.locals;
    const meeting = store.getMeeting(req.params.id);
    if (!meeting) return notFound(req, res, 'This meeting');
    const { note, error } = newMeetingNote(req.body, { at: nowIso() });
    if (error) {
      flash(res, 'error', error);
      return res.redirect(303, `/meetings/${meeting.id}`);
    }
    await store.save([{ ...meeting, notes: [...meeting.notes, note] }], `${meeting.id}: note added`);
    return res.redirect(303, `/meetings/${meeting.id}`);
  });

  router.post('/meetings/:id/notes/:noteId', async (req, res) => {
    const { store } = req.app.locals;
    const meeting = store.getMeeting(req.params.id);
    if (!meeting) return notFound(req, res, 'This meeting');
    const result = editMeetingNote(meeting, req.params.noteId, req.body.text, { at: nowIso() });
    if (!result) return notFound(req, res, 'This note');
    if (result.error) {
      flash(res, 'error', result.error);
      return res.redirect(303, `/meetings/${meeting.id}`);
    }
    await store.save([result.meeting], `${meeting.id}: note edited`);
    flash(res, 'success', 'Note updated.');
    return res.redirect(303, `/meetings/${meeting.id}`);
  });

  router.post('/meetings/:id/notes/:noteId/delete', async (req, res) => {
    const { store } = req.app.locals;
    const meeting = store.getMeeting(req.params.id);
    if (!meeting) return notFound(req, res, 'This meeting');
    const result = removeMeetingNote(meeting, req.params.noteId, { at: nowIso() });
    if (!result) return notFound(req, res, 'This note');
    await store.save([result.meeting], `${meeting.id}: note removed`);
    flash(res, 'success', 'Note removed.');
    return res.redirect(303, `/meetings/${meeting.id}`);
  });
```

**Note the deliberate difference:** adding a note shows **no** flash message.
During a meeting you add lines constantly and a toast on every one is noise.
Editing and removing do show one.

### M3.2 The notes card in `detail.ejs`

Replace the empty `Notes` card in `detail-main` with:

- An add form at the **top** of the card, so the cursor is always in the same
  place:

```html
      <form method="post" action="/meetings/<%= meeting.id %>/notes" class="ask-form">
        <div class="field field-wide">
          <label for="note-text">Add a note</label>
          <input type="text" id="note-text" name="text" maxlength="2000" autofocus required>
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Add note</button>
      </form>
```

- Then the running notes, **oldest first** (the route already sorted them),
  as an `<ol class="timeline">`. Each `<li>` holds the time
  (`<span class="tl-time"><%= fmtDatetime(n.at) %></span>`), the text, and
  two small buttons: `Edit` (a `data-reveal` button) and `Remove` (a form
  with `data-confirm="Remove this note?"`).

- The edit form uses the reveal pattern that already exists in
  `app/public/app.js` (`data-reveal="<id>"` toggles `hidden` on the element
  with that id). Use id `note-<%= n.id %>`:

```html
              <button type="button" class="btn btn-ghost btn-sm" data-reveal="note-<%= n.id %>" aria-expanded="false" aria-controls="note-<%= n.id %>">Edit</button>
              <form method="post" action="/meetings/<%= meeting.id %>/notes/<%= n.id %>/delete" class="inline" data-confirm="Remove this note?">
                <button class="btn btn-ghost btn-sm" type="submit">Remove</button>
              </form>
              <form method="post" action="/meetings/<%= meeting.id %>/notes/<%= n.id %>" class="reveal-form" id="note-<%= n.id %>" hidden>
                <input type="text" name="text" value="<%= n.text %>" maxlength="2000" aria-label="Note text" required>
                <button class="btn btn-primary btn-sm" type="submit">Save</button>
              </form>
```

- When there are no notes yet show
  `<p class="subtle">No notes yet. Type the first one above as the meeting starts.</p>`.

- Show the count in the card heading: `<h2>Notes <span class="count"><%= notes.length %></span></h2>`.

Add no new CSS unless the page is visibly broken. `timeline`, `tl-time`,
`reveal-form`, `ask-form`, `inline` and `count` all already exist in
`app/public/app.css`.

### M3.3 Tests — add to `tests/meetings-pages.test.js`

A new `describe` block, `meeting notes: taking them live`:

1. Adding a note appends it, stores `at` and the trimmed text, and makes one
   commit. The commit message ends `note added`.
2. Three notes added in order come back oldest first on the page.
3. An empty note is refused: no commit, no note added, and the response
   still redirects (303).
4. A note over 2000 characters is refused with no commit.
5. Editing a note changes its text and keeps its `id` and `at`.
6. Editing an unknown note id returns 404.
7. Removing a note drops that one and keeps the others.
8. Removing an unknown note id returns 404.
9. The meeting page shows each note's text and an Edit and a Remove control
   for it.
10. Note text containing `<script>alert(1)</script>` appears escaped in the
    page (assert the raw string is **not** present and `&lt;script&gt;` is).

### M3.3 check

```bash
npm test
./start.sh
```

In the browser: open a meeting, add three notes quickly one after another,
check the cursor is back in the box each time, edit one, remove one. Commit:

```bash
git add app/routes.js app/views/meetings/detail.ejs tests/meetings-pages.test.js
git commit -m "Meetings: add, edit and remove notes during the meeting"
```

---

## 6. Phase M4 — the front page, the spec and the session log

### M4.1 Dashboard data

In `app/routes.js`, inside `dashboardView`, add a `meetings` key next to the
existing `backlog` key:

```js
    // Meetings: today's first, so a meeting in progress is one click away, then the latest few.
    meetings: (() => {
      const all = store.listMeetings();
      return {
        today: all.filter((m) => m.on === today),
        recent: all.filter((m) => m.on !== today).slice(0, 3),
        total: all.length,
      };
    })(),
```

### M4.2 The header button

In `app/views/dashboard.ejs`, in the `page-actions` of the `dash-head`
header, add as the **first** button:

```html
    <a class="btn btn-primary" href="/meetings/new">+ Meeting notes</a>
```

It is `btn-primary` on purpose: starting a meeting is the one thing you do in
a hurry.

### M4.3 The dashboard card

Add a Meetings card. Put it in the `dash-grid` that currently holds the
Backlog card, as the **first** section in that grid, so the row reads
Meetings then Backlog. If that makes the row too crowded, give Meetings its
own `<div class="dash-grid dash-grid-one">` directly above that grid instead.

The card shows:
- `<h2>Meetings</h2>`.
- When `view.meetings.today.length` is non-zero: a `Today` label and each of
  today's meetings as an `action-list` item linking to `/meetings/<id>`, with
  its attendees underneath in `muted`, and a `btn-secondary btn-sm`
  `Take notes` button linking to the same page.
- Then the recent ones as plain links with their dates.
- When there are none at all:
  `<p class="subtle">No meetings yet. <a href="/meetings/new">Start one</a>.</p>`.
- Foot: `<p class="card-foot"><a href="/meetings">All meetings (<%= view.meetings.total %>) →</a></p>`.

Reuse `action-list`, `action`, `action-main`, `action-buttons`, `card-foot`,
`muted` and `subtle`. Add no new CSS classes.

### M4.4 Write the permanent spec into `PLAN.md`

**This step matters: this plan file is deleted in M6, so the spec has to live
in `PLAN.md`.** Append a new section `## 23. Meeting notes` at the end of
`PLAN.md`, in the same shape and voice as `## 22. Backlog (my tasks)`:
**Purpose**, **Data**, **Notes**, **Pages**, **Front page**, **Not in scope
yet**. Keep it to the length of §22 — it is a summary, not this plan.
State in **Data** that any meeting date is allowed, with the reason.

### M4.5 Update `SESSION.md`

- Add a row to the status table in §1.
- Add a progress entry to §4 dated the day you finish, naming the branch, the
  test count, and anything left open.
- If `SESSION.md` is over 5,000 words, move the oldest finished entries to
  `NOTES.md` as `CLAUDE.md` requires.

Also add a line to `NOTES.md` §2 recording the two design decisions: notes
are an append-only timestamped list (so nothing is lost mid-meeting), and
meeting dates have no past/future rule (unlike visits).

### M4.6 Tests — add to `tests/meetings-pages.test.js`

A `describe` block, `meetings: on the dashboard`:

1. The dashboard has the `+ Meeting notes` button linking to `/meetings/new`.
2. A meeting dated today appears in the Meetings card with a `Take notes`
   link to its page.
3. A meeting dated earlier appears under the recent list, not under Today.
4. With no meetings the card shows the empty state and the `Start one` link.

### M4.6 check

```bash
npm test
./start.sh
```

Open the dashboard. Confirm: the `+ Meeting notes` button is there and goes
to the new-meeting form; the Meetings card shows today's meeting; clicking
`Take notes` lands on the note page with the cursor in the box. Check the
page has no horizontal scrollbar. Commit:

```bash
git add app/routes.js app/views/dashboard.ejs PLAN.md SESSION.md NOTES.md tests/meetings-pages.test.js
git commit -m "Meetings: front-page button and dashboard card"
```

---

## 7. Phase M5 — optional: turn a note into a backlog task

**Optional. The feature is complete without it.** Skip it unless the user
asks, and if you skip it say so in the SESSION.md entry.

A `Make a task` button on each note line POSTs to
`/meetings/:id/notes/:noteId/task`, which calls `saveTask` with
`{ title: <the note text, cut to 120 characters>, description: 'From <MT-id>: <title>', due_on: null }`
and flashes `Added <TK-id> to the backlog.` One commit. Add two tests: the
task is created with the note's text as its title, and an unknown note id
returns 404.

---

## 8. Definition of done

Every one of these must be true before M6:

- [ ] `npm test` prints `# fail 0`. Expect roughly 410–420 tests.
- [ ] If `factory/checks.sh` exists in your checkout, `bash factory/checks.sh`
      exits 0. It is not on `main` yet (it lives on the unmerged
      `software-factory` branch), so skip this when the file is absent.
- [ ] `/meetings`, `/meetings/new`, a meeting page and its edit page all
      render, and the whole round trip works in a real browser.
- [ ] Notes can be added, edited and removed during a meeting, and each is
      its own commit.
- [ ] Note text is escaped on the page (the `<script>` test passes).
- [ ] The dashboard has the `+ Meeting notes` button and the Meetings card.
- [ ] `Meetings` is in the top navigation.
- [ ] Deleting a meeting needs its ID typed exactly.
- [ ] A meeting file written before this change still loads: a record with no
      `notes` key must not crash any page. **Test this** by saving a meeting,
      then checking `notesInOrder({})` returns `[]`.
- [ ] No new dependency in `package.json`.
- [ ] `PLAN.md` §23 is written.
- [ ] `SESSION.md` §1 and §4 and `NOTES.md` §2 are updated.
- [ ] `git status` shows nothing staged except the files this plan names, and
      `CLAUDE.md` is still unstaged with the user's own edits.

---

## 9. Phase M6 — finish and delete this plan

```bash
npm test
git rm MEETING-NOTES-PLAN.md
git commit -m "Meeting notes: remove the development plan, spec is PLAN.md section 23"
git checkout main
git merge --ff-only meeting-notes
git branch -d meeting-notes
```

Do **not** push. Tell the user it is merged to `main` and waiting for their
push, and report the test count.
