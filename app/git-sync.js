import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from './models.js';

/** Wait before retrying a failed push: 30 s, 1 min, 2 min, 5 min, then 10 min. */
const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
/** The advisory session lock file (PLAN.md §3.4). */
const LOCK_PATH = 'data/_lock.json';

/**
 * Runs git with an argument array (never through a shell). Never rejects.
 * @param {string[]} args
 * @param {{ cwd?: string, interactive?: boolean, timeoutMs?: number }} [options]
 *   interactive: let git prompt for credentials on the terminal.
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string }>}
 */
export function runGit(args, { cwd, interactive = false, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (!interactive) env.GIT_TERMINAL_PROMPT = '0';
    execFile(
      'git',
      args,
      { cwd, env, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

const firstLine = (text) => (text || '').trim().split('\n')[0] || 'unknown error';
const toPosix = (p) => p.split(path.sep).join('/');
/** File-name-safe timestamp, e.g. 20261016-104300 */
const fileStamp = () => nowIso().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/**
 * Commits, pulls and pushes the data folder. Public methods take the shared lock;
 * methods named *Unlocked must only be called while the lock is already held.
 */
export class GitSync {
  /**
   * @param {{ root: string, enabled?: boolean, pushDelaySeconds?: number, mutex: import('./mutex.js').Mutex }} opts
   */
  constructor({ root, enabled = true, pushDelaySeconds = 30, mutex }) {
    this.root = root;
    this.enabled = enabled;
    this.pushDelayMs = pushDelaySeconds * 1000;
    this.mutex = mutex;
    this.timer = null;
    this.deadline = null;
    this.failures = 0;
    this.lastError = null;
    this.lastPushAt = null;
  }

  /** @returns {ReturnType<typeof runGit>} */
  git(args, options = {}) {
    return runGit(args, { cwd: this.root, ...options });
  }

  async hasRemote() {
    return (await this.git(['remote', 'get-url', 'origin'])).ok;
  }

  /** Current branch name, or null when HEAD is detached. Works before the first commit. */
  async branch() {
    const r = await this.git(['symbolic-ref', '--short', 'HEAD']);
    return r.ok ? r.stdout.trim() : null;
  }

  /**
   * Stages and commits only the given files under data/.
   * @param {string[]} paths absolute paths
   * @param {string} message
   * @returns {Promise<boolean>} true if a commit was made
   */
  commit(paths, message) {
    return this.mutex.run(() => this.commitUnlocked(paths, message));
  }

  /** Same as commit(), for callers that already hold the lock. */
  async commitUnlocked(paths, message) {
    const rel = paths.map((p) => toPosix(path.relative(this.root, p)));
    if (rel.some((p) => !p.startsWith('data/') || p.includes('..'))) {
      throw new Error('refusing to commit outside data/');
    }
    // Files that exist are staged. Files that are gone are removed from the index, and that is
    // a no-op for a file git never tracked. Only paths with staged changes are committed.
    const present = rel.filter((p) => existsSync(path.join(this.root, p)));
    const gone = rel.filter((p) => !present.includes(p));
    if (present.length) {
      const add = await this.git(['add', '--', ...present]);
      if (!add.ok) throw new Error(`git add failed: ${firstLine(add.stderr)}`);
    }
    if (gone.length) await this.git(['rm', '--cached', '--ignore-unmatch', '-q', '--', ...gone]);

    const staged = (await this.git(['diff', '--cached', '--name-only', '--', ...rel])).stdout.split('\n').filter(Boolean);
    if (staged.length === 0) return false;

    const commit = await this.git(['commit', '-m', message, '--', ...staged]);
    if (!commit.ok) throw new Error(`git commit failed: ${firstLine(commit.stderr)}`);
    this.schedulePush();
    return true;
  }

  /**
   * Fetches and merges origin/<branch>. Conflicting data files keep the local version;
   * the remote version is saved in data/_conflicts/.
   * @param {{ interactive?: boolean }} [options]
   * @returns {Promise<{ ok: boolean, changed: boolean, conflicts: string[], error: string | null }>}
   */
  pull(options = {}) {
    return this.mutex.run(() => this.pullUnlocked(options));
  }

  async pullUnlocked({ interactive = false } = {}) {
    const nothing = { ok: true, changed: false, conflicts: [], error: null };
    if (!this.enabled || !(await this.hasRemote())) return nothing;

    const branch = await this.branch();
    if (!branch) return this.pullFailed('Detached HEAD – checkout a branch');

    const fetch = await this.git(['fetch', 'origin'], { interactive, timeoutMs: 120_000 });
    if (!fetch.ok) return this.pullFailed(firstLine(fetch.stderr));

    const remoteRef = `origin/${branch}`;
    if (!(await this.git(['rev-parse', '--verify', '--quiet', remoteRef])).ok) return nothing;

    const before = await this.git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    const merge = await this.git(['merge', '--no-edit', '--autostash', remoteRef]);
    if (merge.ok) {
      const after = await this.git(['rev-parse', 'HEAD']);
      const changed = !before.ok || before.stdout.trim() !== after.stdout.trim();
      return { ok: true, changed, conflicts: [], error: null };
    }

    const unmerged = (await this.git(['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').filter(Boolean);
    if (unmerged.length === 0) {
      await this.git(['merge', '--abort']);
      return this.pullFailed(firstLine(merge.stderr));
    }

    const codeFiles = unmerged.filter((p) => !p.startsWith('data/'));
    if (codeFiles.length > 0) {
      await this.git(['merge', '--abort']);
      return this.pullFailed(`Code conflict in ${codeFiles.join(', ')} – resolve manually with git`);
    }

    // The session lock is advisory and rewritten on every start, so its conflicts are
    // resolved silently in favour of the remote copy (PLAN.md §3.4).
    const recordConflicts = unmerged.filter((p) => p !== LOCK_PATH);
    if (unmerged.includes(LOCK_PATH)) await this.takeRemoteLock();
    const saved = await this.resolveDataConflicts(recordConflicts);
    await this.git(['add', '--', 'data/_conflicts']);
    const note = recordConflicts.length ? ` (${recordConflicts.length} conflicts saved)` : '';
    const commit = await this.git(['commit', '-m', `sync: merge remote changes${note}`]);
    if (!commit.ok) return this.pullFailed(firstLine(commit.stderr));
    return { ok: true, changed: true, conflicts: saved, error: null };
  }

  /**
   * For each conflicted file: save the remote copy to data/_conflicts/, then keep
   * the local copy (or the remote copy if we had deleted the file).
   * @param {string[]} paths
   * @returns {Promise<string[]>} repo-relative paths of the saved remote copies
   */
  async resolveDataConflicts(paths) {
    const dir = path.join(this.root, 'data', '_conflicts');
    const saved = [];
    for (const p of paths) {
      const theirs = await this.git(['show', `:3:${p}`]);
      const oursExists = (await this.git(['cat-file', '-e', `:2:${p}`])).ok;
      if (theirs.ok) {
        await fs.mkdir(dir, { recursive: true });
        const dest = path.join(dir, `${path.basename(p, '.json')}.${fileStamp()}.theirs.json`);
        await fs.writeFile(dest, theirs.stdout, 'utf8');
        saved.push(toPosix(path.relative(this.root, dest)));
      }
      await this.git(['checkout', oursExists ? '--ours' : '--theirs', '--', p]);
      await this.git(['add', '--', p]);
    }
    return saved;
  }

  /** Keeps the remote copy of the lock file, or removes it when the other computer released it. */
  async takeRemoteLock() {
    const theirs = await this.git(['show', `:3:${LOCK_PATH}`]);
    if (theirs.ok) {
      await this.git(['checkout', '--theirs', '--', LOCK_PATH]);
      await this.git(['add', '--', LOCK_PATH]);
    } else {
      await this.git(['rm', '-q', '--', LOCK_PATH]);
    }
  }

  pullFailed(error) {
    this.lastError = error;
    return { ok: false, changed: false, conflicts: [], error };
  }

  /** Pushes the current branch. Takes the lock. Returns true on success. */
  pushNow() {
    return this.mutex.run(() => this.pushNowUnlocked());
  }

  async pushNowUnlocked() {
    if (!this.enabled || !(await this.hasRemote())) return false;

    let push = await this.git(['push', '-u', 'origin', 'HEAD'], { timeoutMs: 120_000 });
    if (!push.ok && /rejected|non-fast-forward|fetch first/.test(push.stderr)) {
      const pulled = await this.pullUnlocked();
      if (!pulled.ok) return this.pushFailed(pulled.error);
      push = await this.git(['push', '-u', 'origin', 'HEAD'], { timeoutMs: 120_000 });
    }
    if (!push.ok) return this.pushFailed(firstLine(push.stderr));

    this.failures = 0;
    this.lastError = null;
    this.lastPushAt = nowIso();
    return true;
  }

  pushFailed(message) {
    this.lastError = message;
    const wait = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
    this.failures += 1;
    this.arm(wait);
    return false;
  }

  /** Called after each commit: push once the changes have been quiet for the push delay. */
  schedulePush() {
    if (!this.enabled) return;
    this.arm(this.pushDelayMs);
  }

  arm(delayMs) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + delayMs;
    this.timer = setTimeout(() => this.onTimer(), delayMs);
    this.timer.unref();
  }

  onTimer() {
    this.timer = null;
    this.deadline = null;
    this.pushNow().catch(() => {});
  }

  /** Starts the background push loop. Pushes right away if commits were left unpushed. */
  async startWorker() {
    if (this.enabled && (await this.unpushedCount()) > 0) this.schedulePush();
  }

  /** Number of local commits not yet on origin/<branch>. */
  async unpushedCount() {
    const branch = await this.branch();
    if (!branch) return 0;
    const ahead = await this.git(['rev-list', '--count', `origin/${branch}..HEAD`]);
    if (ahead.ok) return Number(ahead.stdout.trim());
    const all = await this.git(['rev-list', '--count', 'HEAD']);
    return all.ok ? Number(all.stdout.trim()) : 0;
  }

  /**
   * Pushes anything pending before the process exits. Gives up after timeoutMs.
   * @param {number} [timeoutMs]
   */
  async flush(timeoutMs = 20_000) {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
    if ((await this.unpushedCount()) === 0) return;
    let timeout;
    const giveUp = new Promise((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([this.pushNow(), giveUp]);
    clearTimeout(timeout);
  }

  /**
   * State for the header badge.
   * @returns {Promise<{ state: 'synced'|'pending'|'error'|'local'|'offline', unpushed: number, lastError: string | null, lastPushAt: string | null }>}
   */
  async status() {
    const base = { lastError: this.lastError, lastPushAt: this.lastPushAt };
    if (!this.enabled) return { ...base, state: 'offline', unpushed: 0 };
    if (!(await this.hasRemote())) return { ...base, lastError: null, state: 'local', unpushed: 0 };
    const unpushed = await this.unpushedCount();
    const state = this.lastError ? 'error' : unpushed > 0 ? 'pending' : 'synced';
    return { ...base, state, unpushed };
  }
}
