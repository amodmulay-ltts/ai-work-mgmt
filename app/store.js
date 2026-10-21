import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG } from './config-defaults.js';
import { PREFIX, ValidationError, kindOf, nowIso, validateRecord, withDefaultType, withSupportDefaults } from './models.js';
import { resolveTags } from './lib/tags.js';

/** Record kinds loaded from disk, in load order. */
const KINDS = ['customer', 'person', 'deal'];
const FOLDER = { deal: 'deals', customer: 'customers', person: 'people' };
/** Conflict copies written by GitSync: <record id>.<YYYYMMDD-HHMMSS>.theirs.json */
const CONFLICT_RE = /^((?:DL-\d{4}-\d{4})|(?:CU|PE)-\d{4})\.(\d{8}-\d{6})\.theirs\.json$/;

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
    this.conflicts = [];
  }

  recordPath(kind, id) {
    return path.join(this.dataDir, FOLDER[kind], `${id}.json`);
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
          let obj = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
          if (kind === 'deal') obj = withSupportDefaults(withDefaultType(obj));
          // Structural checks only: enum lists are checked when a record is saved.
          const errors = validateRecord(kind, obj, null);
          if (errors.length) problems.push(`${label}: ${errors.join(', ')}`);
          else records[kind].set(obj.id, obj);
        } catch (err) {
          problems.push(`${label}: ${err.message}`);
        }
      }
    }
    // Every tag on an opportunity is a known tag, even if config.json was edited by hand.
    const allTags = [...records.deal.values()].flatMap((d) => d.tags);
    cfg = { ...cfg, tags: [...cfg.tags, ...resolveTags(allTags, cfg.tags).added] };
    this.cfg = cfg;
    this.records = records;
    this.problems = problems;
    const conflictDir = path.join(this.dataDir, '_conflicts');
    this.conflicts = (await fs.readdir(conflictDir).catch(() => [])).filter((n) => CONFLICT_RE.test(n)).sort();
  }

  /**
   * Conflict copies waiting for a decision, each with the local and the other version.
   * @returns {Promise<Array<{ file: string, id: string, stamp: string, local: object | null, remote: object | null }>>}
   */
  async conflictEntries() {
    const dir = path.join(this.dataDir, '_conflicts');
    const entries = [];
    for (const file of this.conflicts) {
      const [, id, stamp] = file.match(CONFLICT_RE);
      const local = this.records[kindOf(id)].get(id) ?? null;
      let remote = null;
      try {
        remote = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
      } catch {
        // unreadable copy: shown as "could not be read"
      }
      entries.push({ file, id, stamp, local, remote });
    }
    return entries;
  }

  /**
   * Resolves one conflict copy. 'keep_mine' removes the copy. 'use_theirs' writes the copy
   * over the record first. Both are one commit.
   * @param {string} file the conflict file name
   * @param {'keep_mine' | 'use_theirs'} action
   */
  resolveConflict(file, action) {
    return this.mutex.run(async () => {
      const match = file.match(CONFLICT_RE);
      if (!match) throw new Error('Not a conflict file');
      if (action !== 'keep_mine' && action !== 'use_theirs') throw new Error('Unknown action');
      const [, id] = match;
      const kind = kindOf(id);
      const conflictPath = path.join(this.dataDir, '_conflicts', file);
      const paths = [conflictPath];
      if (action === 'use_theirs') {
        const remote = withSupportDefaults(withDefaultType(JSON.parse(await fs.readFile(conflictPath, 'utf8'))));
        const errors = validateRecord(kind, remote, this.cfg);
        if (errors.length) throw new ValidationError(errors);
        await writeJsonAtomic(this.recordPath(kind, id), remote);
        this.records[kind].set(id, remote);
        paths.push(this.recordPath(kind, id));
      }
      await fs.rm(conflictPath, { force: true });
      this.conflicts = this.conflicts.filter((f) => f !== file);
      const outcome = action === 'use_theirs' ? 'used the other version' : 'kept this version';
      return this.git.commitUnlocked(paths, `${id}: conflict resolved – ${outcome}`);
    });
  }

  config() {
    return this.cfg;
  }

  saveConfig(cfg, message = 'config: updated settings') {
    return this.save([], message, { config: cfg });
  }

  /**
   * Next free id for a kind. Opportunities are DL-<year>-NNNN with a counter per year.
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

  listDeals() {
    return [...this.records.deal.values()];
  }

  getDeal(id) {
    return this.records.deal.get(id) ?? null;
  }

  listCustomers() {
    return [...this.records.customer.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getCustomer(id) {
    return this.records.customer.get(id) ?? null;
  }

  findCustomerByName(name) {
    const key = name.trim().toLowerCase();
    return this.listCustomers().find((c) => c.name.trim().toLowerCase() === key) ?? null;
  }

  listPeople() {
    return [...this.records.person.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPerson(id) {
    return this.records.person.get(id) ?? null;
  }

  findPersonByName(name, role = null) {
    const key = name.trim().toLowerCase();
    return (
      this.listPeople().find(
        (p) => p.name.trim().toLowerCase() === key && (role === null || p.role === role),
      ) ?? null
    );
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
      // Validate against the config this save will write, so a new tag and the opportunity that uses it go together.
      const cfgNow = config ? { ...structuredClone(DEFAULT_CONFIG), ...config } : this.cfg;
      const errors = prepared.flatMap((r) =>
        validateRecord(kindOf(r.id), r, cfgNow).map((e) => `${r.id}: ${e}`),
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

  /**
   * Deletes one record and commits the removal. Customers that still have deals, and people
   * referenced by an opportunity or a customer, cannot be deleted (PLAN.md §7).
   * @param {{ id: string }} record
   * @param {string} message
   */
  delete(record, message) {
    return this.mutex.run(async () => {
      const kind = kindOf(record.id);
      if (kind === 'customer') {
        const count = this.listDeals().filter((d) => d.customer_id === record.id).length;
        if (count > 0) throw new Error(`Customer has ${count} ${count === 1 ? 'opportunity' : 'opportunities'}`);
      }
      if (kind === 'person' && this.personReferenced(record.id)) {
        throw new Error('This person is used on an opportunity or customer. Mark them inactive instead.');
      }
      const file = this.recordPath(kind, record.id);
      await fs.rm(file, { force: true });
      this.records[kind].delete(record.id);
      return this.git.commitUnlocked([file], message);
    });
  }

  personUsedByDeal(deal, personId) {
    return (
      deal.sales_owner_id === personId ||
      deal.presales_owner_id === personId ||
      deal.delivery_owner_id === personId ||
      deal.contact_ids.includes(personId)
    );
  }

  personReferenced(personId) {
    return (
      this.listDeals().some((d) => this.personUsedByDeal(d, personId)) ||
      this.listCustomers().some((c) => c.account_manager_id === personId)
    );
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
