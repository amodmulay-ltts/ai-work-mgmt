import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { GitSync } from './git-sync.js';
import { syncLabel } from './lib/format.js';
import { renderPage } from './lib/render.js';
import { Mutex } from './mutex.js';
import { createRouter } from './routes.js';
import { Store } from './store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express app together with the shared GitSync and Store objects.
 * @param {{ root: string, syncEnabled?: boolean, startupPull?: boolean }} options
 *   startupPull: pull from the remote before loading data (run.js uses this).
 * @returns {Promise<{ app: import('express').Express, store: Store, git: GitSync,
 *   startup: Awaited<ReturnType<GitSync['pull']>> | null }>}
 */
export async function createApp({ root, syncEnabled = true, startupPull = false }) {
  const mutex = new Mutex();
  const git = new GitSync({ root, enabled: syncEnabled, mutex });
  const store = new Store({ root, git, mutex });

  // Pull before init: init creates config.json if it is missing, and a local
  // default would conflict with the copy already on the remote.
  let startup = null;
  if (startupPull && syncEnabled && (await git.hasRemote())) {
    startup = await git.pull({ interactive: true });
  }
  await store.init();
  git.pushDelayMs = (store.config().push_delay_seconds ?? 30) * 1000;

  // Advisory session lock: warn if another computer has the app open, then push the
  // lock straight away so the other computer sees it (PLAN.md §3.4).
  // WORK_TRACKER_HOLDER overrides the name; it lets two copies on one machine be told apart in tests.
  const holder = process.env.WORK_TRACKER_HOLDER || `${os.userInfo().username}@${os.hostname()}`;
  await store.acquireLock(holder);
  if (syncEnabled) await git.pushNow();
  await git.startWorker();

  const app = express();
  app.locals.git = git;
  app.locals.store = store;
  app.locals.syncLabel = syncLabel;
  app.set('view engine', 'ejs');
  app.set('views', path.join(HERE, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use('/static', express.static(path.join(HERE, 'public')));

  // Reads the flash cookie for page requests only. Static files were answered above.
  app.use((req, res, next) => {
    res.locals.flash = null;
    const raw = req.cookies?.flash;
    if (raw) {
      try {
        res.locals.flash = JSON.parse(raw);
      } catch {
        // malformed cookie: ignore it
      }
      res.clearCookie('flash', { path: '/' });
    }
    next();
  });

  app.use(createRouter());

  app.use(async (req, res) => {
    await renderPage(req, res, 'error', { title: 'Not found', message: 'That page does not exist.' }, 404);
  });

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    await renderPage(
      req,
      res,
      'error',
      { title: 'Something went wrong', message: 'The error was written to the terminal.' },
      500,
    );
  });

  return { app, store, git, startup };
}
