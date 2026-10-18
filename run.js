#!/usr/bin/env node
// Bootstrap for Work Tracker: checks this machine, installs dependencies,
// prepares the git repo, then starts the server. Uses only Node built-ins
// until the dependencies are installed (PLAN.md §3.3).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === 'win32';
const REMOTE_URL = 'https://github.com/amodmulay-ltts/ai-work-mgmt.git';
const INSTALL_HINT =
  "Dependency install failed. If you are behind a proxy, set HTTPS_PROXY (or configure npm's proxy setting), then run again.";

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Runs git in the project folder. Returns trimmed stdout, or null if git fails. */
function gitOut(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function checkGit() {
  const version = gitOut(['--version']);
  if (version === null) fail('git is required but was not found. Install it from https://git-scm.com and run again.');
  const [, major, minor] = version.match(/(\d+)\.(\d+)/) ?? [];
  if (!major || Number(major) < 2 || (Number(major) === 2 && Number(minor) < 30)) {
    fail(`git 2.30 or newer is required, found: ${version}`);
  }
}

/** Installs node_modules with `npm ci` whenever package-lock.json changes. */
function ensureDependencies() {
  const lock = path.join(ROOT, 'package-lock.json');
  const hashFile = path.join(ROOT, 'node_modules', '.lock-hash');
  const npm = IS_WIN ? 'npm.cmd' : 'npm';
  const run = (args) => spawnSync(npm, args, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN }).status === 0;

  if (!existsSync(lock)) {
    console.log('Installing dependencies (no package-lock.json yet)...');
    if (!run(['install'])) fail(INSTALL_HINT);
    console.log('Commit package-lock.json so every machine installs the same versions.');
    return;
  }

  const hash = createHash('sha256').update(readFileSync(lock)).digest('hex');
  const installed = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : '';
  if (existsSync(path.join(ROOT, 'node_modules')) && installed === hash) return;

  console.log('Installing dependencies...');
  if (!run(['ci'])) fail(INSTALL_HINT);
  mkdirSync(path.dirname(hashFile), { recursive: true });
  writeFileSync(hashFile, hash);
}

/** Makes sure a git repo exists, warns about a missing remote, and asks for git identity once. */
async function ensureRepo() {
  if (!existsSync(path.join(ROOT, '.git'))) {
    gitOut(['init', '-b', 'main']);
    console.log('Created a new git repository in this folder.');
  }
  if (gitOut(['remote', 'get-url', 'origin']) === null) {
    console.log(
      `No git remote configured, so changes stay on this computer. To enable sync run:\n  git remote add origin ${REMOTE_URL}`,
    );
  }
  const missing = ['user.name', 'user.email'].filter((key) => !gitOut(['config', '--get', key]));
  if (missing.length === 0) return;

  if (!process.stdin.isTTY) {
    fail(`Git needs a name and email for commits. Set them, then run again:\n  git config user.name "Your Name"\n  git config user.email "you@example.com"`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const key of missing) {
      const label = key === 'user.name' ? 'your name' : 'your email';
      const value = (await rl.question(`Enter ${label} for git commits: `)).trim();
      if (!value) fail(`${key} is required for git commits.`);
      execFileSync('git', ['config', key, value], { cwd: ROOT });
    }
  } finally {
    rl.close();
  }
}

/** Resolves true if nothing is listening on the port on 127.0.0.1. */
function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** Opens the URL in the default browser. Failures are ignored. */
function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : IS_WIN ? ['explorer.exe', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) fail(`Node.js 20 or newer is required, found v${process.versions.node}.`);

  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8765' },
      'no-browser': { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid --port: ${values.port}`);

  checkGit();
  ensureDependencies();
  await ensureRepo();

  const { createApp } = await import('./app/server.js');
  const syncEnabled = !values.offline;
  const { app, git, store, startup } = await createApp({ root: ROOT, syncEnabled, startupPull: true });

  if (!syncEnabled) console.log('Offline mode: git sync is disabled.');
  else if (startup && !startup.ok) console.log(`Sync failed: ${startup.error} — continuing offline`);
  else if (startup) console.log(startup.changed ? 'Synced with remote (new changes pulled)' : 'Synced with remote');
  if (store.lockWarning) console.log(`Warning: ${store.lockWarning}`);

  let chosen = null;
  for (let p = port; p <= port + 10 && chosen === null; p += 1) {
    if (await canListen(p)) chosen = p;
  }
  if (chosen === null) fail(`No free port between ${port} and ${port + 10}. Use --port to choose another.`);

  const url = `http://127.0.0.1:${chosen}`;
  const server = app.listen(chosen, '127.0.0.1', () => {
    console.log(`Work Tracker running at ${url} — press Ctrl+C to stop`);
    if (!values['no-browser']) openBrowser(url);
  });
  server.on('error', (err) => fail(`Server error: ${err.message}`));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('Stopping — pushing any pending changes...');
    await store.releaseLock().catch((err) => console.error(`Could not release the session lock: ${err.message}`));
    await git.flush(20_000);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => fail(err.stack || String(err)));
