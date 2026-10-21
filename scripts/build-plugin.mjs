#!/usr/bin/env node
import { mkdir, readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(root, 'plugin');
const { version } = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
const output = path.resolve(process.argv[2] || path.join(root, 'dist', `camofox-mcp-plugin-${version}.tar.gz`));
if (output === plugin || output.startsWith(plugin + path.sep)) throw new Error('Write the archive outside plugin/.');
async function check(directory) {
  for (const entry of await readdir(directory)) {
    const full = path.join(directory, entry);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Plugin archive cannot contain symlinks: ${full}`);
    if (stat.isDirectory()) await check(full);
  }
}
await check(plugin);
await mkdir(path.dirname(output), { recursive: true });
await promisify(execFile)('tar', ['-czf', output, '-C', plugin, '.'], { timeout: 30_000 });
const { stdout } = await promisify(execFile)('tar', ['-tzf', output]);
for (const required of ['./plugin.json', './mcp.json', './.mcp.json', './.codex-plugin/plugin.json', './skills/camofox/SKILL.md', './scripts/launch.mjs', './scripts/setup.mjs', './scripts/runtime-paths.mjs']) {
  if (!stdout.split('\n').includes(required)) throw new Error(`Archive missing ${required}`);
}
console.log(output);
