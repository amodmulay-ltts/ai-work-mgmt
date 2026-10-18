/**
 * Page rendering and flash messages shared by all routes.
 */
import { todayIso } from '../models.js';

/**
 * Renders a view inside layout.ejs. Always includes the current sync status.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} view view name, relative to app/views (e.g. 'dashboard')
 * @param {Record<string, any>} [data]
 * @param {number} [status]
 */
export async function renderPage(req, res, view, data = {}, status = 200) {
  const { git, store } = req.app.locals;
  const defaults = { title: '', active: '', me: null, values: {}, errors: {}, formErrors: [], message: '' };
  const locals = {
    ...defaults,
    sync: await git.status(),
    lockWarning: store.lockWarning,
    cfg: store.config(),
    today: todayIso(),
    ...data,
  };
  const body = await new Promise((resolve, reject) => {
    req.app.render(view, locals, (err, html) => (err ? reject(err) : resolve(html)));
  });
  res.status(status).render('layout', { ...locals, body });
}

/**
 * Stores a one-time message that the next page shows as a toast.
 * @param {import('express').Response} res
 * @param {'success' | 'warning' | 'error'} kind
 * @param {string} text
 */
export function flash(res, kind, text) {
  res.cookie('flash', JSON.stringify({ kind, text }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60_000,
  });
}
