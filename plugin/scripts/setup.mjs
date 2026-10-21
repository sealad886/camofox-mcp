#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { checkNode, clientRoot, installedClient, installedEntry, manifest, packageName, sourceEntry } from './runtime-paths.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env, shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || code}).`)));
  });
}

let staging;
let ownedLock;
try {
  checkNode();
  let entry = await sourceEntry() || await installedClient();
  if (!entry) {
    const clients = path.dirname(clientRoot);
    await mkdir(clients, { recursive: true, mode: 0o700 });

    const lock = `${clientRoot}.install-lock`;
    try { await mkdir(lock, { mode: 0o700 }); ownedLock = lock; }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Setup already running, or interrupted setup left ${lock}. Check for an active setup process before removing that empty lock directory.`);
      throw error;
    }
    // Recheck after acquiring the lock, in case another setup just finished.
    entry = await installedClient();
    if (!entry) {
      staging = await mkdtemp(path.join(clients, '.install-'));
      await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', staging, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${packageName}@${manifest.version}`]);
      await rename(staging, clientRoot);
      staging = undefined;
      entry = await installedClient();
      if (!entry) throw new Error(`Installed package did not contain the expected client: ${installedEntry}`);
    }
  }
  await run(process.execPath, [entry, 'setup', ...process.argv.slice(2)]);
} catch (error) {
  console.error(`Camofox setup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
  if (ownedLock) await rm(ownedLock, { recursive: true, force: true });
}
