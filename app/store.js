import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG } from './config-defaults.js';
import { PREFIX, ValidationError, kindOf, nowIso, validateRecord } from './models.js';

/** Record kinds loaded from disk. Phase 1 adds 'customer' and 'deal'. */
const KINDS = ['person'];
const FOLDER = { deal: 'deals', customer: 'customers', person: 'people' };

/**
 * The only module that reads or writes data files (PLAN.md §7).
 * Writes take the shared lock and commit through GitSync.commitUnlocked.
 */
export class Store {
  /**
   * @param {{ root: string, git: import('./git-sync.js').GitSync, mutex: import('./mutex.js').Mutex }} opts
   */
  constructor({ root, git, mutex }) {
    this.dataDir = path.join(root, 'data');
    this.configPath = path.join(this.dataDir, 'config.json');
    this.git = git;
    this.mutex = mutex;
    this.problems = [];
    this.cfg = structuredClone(DEFAULT_CONFIG);
    this.records = { deal: new Map(), customer: new Map(), person: new Map() };
    this.lockPath = path.join(this.dataDir, '_lock.json');
    this.holder = null;
    this.lockWarning = null;
  }

  recordPath(kind, id) {
    return path.join(this.dataDir, FOLDER[kind], `${id}.json`);
  }

  /**
   * Takes the advisory session lock (PLAN.md §3.4). It only warns; it never blocks.
   * Commits the lock file. The caller pushes.
   * @param {string} holder e.g. 'amod@LAPTOP-1'
   */
  acquireLock(holder) {
    return this.mutex.run(async () => {
      const previous = await this.readLockFile();
      this.holder = holder;
      this.lockWarning =
        previous && previous.holder !== holder
          ? `${previous.holder} has this open since ${previous.started_at}. Make sure it is closed before you edit, or changes may conflict.`
          : null;
      await writeJsonAtomic(this.lockPath, { holder, started_at: nowIso() });
      await this.git.commitUnlocked([this.lockPath], `session: opened on ${holder}`);
    });
  }

  /** Removes the lock on a clean shutdown and commits the removal. */
  releaseLock() {
    return this.mutex.run(async () => {
      if (!this.holder) return;
      await fs.rm(this.lockPath, { force: true });
      await this.git.commitUnlocked([this.lockPath], `session: closed on ${this.holder}`);
    });
  }

  /** The lock file contents, or null when there is none or it cannot be read. */
  async readLockFile() {
    try {
      return JSON.parse(await fs.readFile(this.lockPath, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Creates the data folders and default config (committed) on first run, then loads everything. */
  async init() {
    await this.mutex.run(async () => {
      for (const folder of ['', ...Object.values(FOLDER)]) {
        await fs.mkdir(path.join(this.dataDir, folder), { recursive: true });
      }
      if (!(await exists(this.configPath))) {
        await writeJsonAtomic(this.configPath, DEFAULT_CONFIG);
        await this.git.commitUnlocked([this.configPath], 'config: initial defaults');
      }
    });
    await this.loadAll();
  }

  /** Reads every record file into memory. Files that fail to parse or validate go to `problems`. */
  async loadAll() {
    const problems = [];
    const records = { deal: new Map(), customer: new Map(), person: new Map() };
    let cfg = structuredClone(DEFAULT_CONFIG);
    try {
      cfg = { ...cfg, ...JSON.parse(await fs.readFile(this.configPath, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') problems.push(`config.json: ${err.message}`);
    }

    for (const kind of KINDS) {
      const dir = path.join(this.dataDir, FOLDER[kind]);
      const names = await fs.readdir(dir).catch(() => []);
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const label = `${FOLDER[kind]}/${name}`;
        try {
          const obj = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
          const errors = validateRecord(kind, obj, cfg);
          if (errors.length) problems.push(`${label}: ${errors.join(', ')}`);
          else records[kind].set(obj.id, obj);
        } catch (err) {
          problems.push(`${label}: ${err.message}`);
        }
      }
    }
    this.cfg = cfg;
    this.records = records;
    this.problems = problems;
  }

  config() {
    return this.cfg;
  }

  saveConfig(cfg, message = 'config: updated settings') {
    return this.save([], message, { config: cfg });
  }

  /**
   * Next free id for a kind. Deals are DL-<year>-NNNN with a counter per year.
   * @param {'deal' | 'customer' | 'person'} kind
   */
  async nextId(kind) {
    const names = await fs.readdir(path.join(this.dataDir, FOLDER[kind])).catch(() => []);
    const prefix = kind === 'deal' ? `DL-${new Date().getFullYear()}-` : `${PREFIX[kind]}-`;
    let max = 0;
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
      const n = Number(name.slice(prefix.length, -'.json'.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  listPeople() {
    return [...this.records.person.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPerson(id) {
    return this.records.person.get(id) ?? null;
  }

  findPersonByName(name) {
    const key = name.trim().toLowerCase();
    return this.listPeople().find((p) => p.name.trim().toLowerCase() === key) ?? null;
  }

  /**
   * Validates and writes all records and (optionally) the config, then makes ONE commit.
   * Nothing is written if validation fails.
   * @param {Array<{ id: string } & Record<string, any>>} records
   * @param {string} message
   * @param {{ config?: Record<string, any> }} [options]
   * @returns {Promise<boolean>} true if a commit was made
   */
  save(records, message, { config } = {}) {
    return this.mutex.run(async () => {
      const now = nowIso();
      const prepared = records.map((r) => ({ ...r, updated_at: now }));
      const errors = prepared.flatMap((r) =>
        validateRecord(kindOf(r.id), r, this.cfg).map((e) => `${r.id}: ${e}`),
      );
      if (errors.length) throw new ValidationError(errors);

      const paths = [];
      for (const r of prepared) {
        const kind = kindOf(r.id);
        const file = this.recordPath(kind, r.id);
        await writeJsonAtomic(file, r);
        this.records[kind].set(r.id, r);
        paths.push(file);
      }
      if (config) {
        await writeJsonAtomic(this.configPath, config);
        this.cfg = { ...structuredClone(DEFAULT_CONFIG), ...config };
        paths.push(this.configPath);
      }
      return this.git.commitUnlocked(paths, message);
    });
  }
}

/** Writes JSON with a temp file and a rename, so a crash never leaves half a file. */
async function writeJsonAtomic(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
