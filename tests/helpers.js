import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Runs git in a folder and returns its trimmed stdout. Throws if git fails. */
export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Creates a temp folder holding a bare remote named remote.git. */
export async function makeRemote() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-'));
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '--bare', '-b', 'main', remote);
  return { dir, remote };
}

/** Creates an empty working repo named `name` inside dir, with origin set to remote. */
export async function makeClone(dir, name, remote) {
  const folder = path.join(dir, name);
  await fs.mkdir(folder);
  git(folder, 'init', '-b', 'main');
  git(folder, 'config', 'user.name', name);
  git(folder, 'config', 'user.email', `${name}@example.test`);
  if (remote) git(folder, 'remote', 'add', 'origin', remote);
  return folder;
}

/** Writes a file (creating folders as needed) and returns its absolute path. */
export async function writeFile(folder, rel, text) {
  const file = path.join(folder, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  return file;
}

export async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
