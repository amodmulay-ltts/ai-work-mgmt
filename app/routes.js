import { Router } from 'express';
import { nowIso } from './models.js';
import { flash, renderPage } from './lib/render.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

/** Trimmed string from a form field, or '' when missing. */
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** Dashboard data, including the current user when it is set. */
function dashboardData(store, extra = {}) {
  const meId = store.config().me_person_id;
  return { title: 'Dashboard', active: 'dashboard', me: meId ? store.getPerson(meId) : null, ...extra };
}

/** Local path from the Referer header, so redirects cannot leave this site. */
function safeBackPath(req) {
  try {
    const url = new URL(req.get('referer') ?? '');
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch {
    // no usable Referer: fall through to the dashboard
  }
  return '/';
}

export function createRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const { store } = req.app.locals;
    await renderPage(req, res, 'dashboard', dashboardData(store));
  });

  // First-run form: who is using this tracker. Creates a Presales person and sets me_person_id.
  router.post('/setup', async (req, res) => {
    const { store } = req.app.locals;
    const values = { name: clean(req.body.name), email: clean(req.body.email) };
    const errors = {};
    if (!values.name) errors.name = 'Enter your name.';
    if (values.email && !EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) {
      return renderPage(req, res, 'dashboard', dashboardData(store, { values, errors }), 422);
    }

    const id = await store.nextId('person');
    const now = nowIso();
    const person = {
      schema_version: 1,
      id,
      name: values.name,
      role: 'Presales',
      title: null,
      email: values.email || null,
      phone: null,
      customer_id: null,
      notes: '',
      active: true,
      created_at: now,
      updated_at: now,
    };
    const config = { ...store.config(), me_person_id: id };
    await store.save([person], `${id}: created – ${values.name}`, { config });
    flash(res, 'success', `Saved. Welcome, ${values.name}.`);
    res.redirect(303, '/');
  });

  router.get('/api/sync/status', async (req, res) => {
    const { git } = req.app.locals;
    res.json(await git.status());
  });

  // Pull, reload if anything changed, then push. Returns to the page the user came from.
  router.post('/sync', async (req, res) => {
    const { git, store } = req.app.locals;
    const pull = await git.pull();
    if (pull.changed) await store.loadAll();

    const pushed = pull.ok && (await git.pushNow());
    if (!pull.ok) {
      flash(res, 'error', `Sync failed: ${pull.error}`);
    } else if (pushed) {
      flash(res, 'success', 'Synced with remote.');
    } else {
      const status = await git.status();
      if (status.state === 'local') {
        flash(res, 'warning', 'No git remote is configured, so changes stay on this computer.');
      } else {
        flash(res, 'error', `Not pushed: ${status.lastError ?? 'nothing to push'}`);
      }
    }
    res.redirect(303, safeBackPath(req));
  });

  return router;
}
