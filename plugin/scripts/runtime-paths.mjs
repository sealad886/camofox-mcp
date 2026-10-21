import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'));
export const packageName = '@sealad886/camofox-mcp';
export const home = path.resolve(process.env.CAMOFOX_MCP_HOME || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'camofox-mcp')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'camofox-mcp')));
export const clientRoot = path.join(home, 'client', manifest.version);
export const installedEntry = path.join(clientRoot, 'node_modules', '@sealad886', 'camofox-mcp', 'src', 'cli.mjs');

export async function sourceEntry() {
  const root = path.resolve(pluginRoot, '..');
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== packageName || pkg.version !== manifest.version) return null;
    await access(path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
    const entry = path.join(root, 'src', 'cli.mjs');
    await access(entry);
    return entry;
  } catch { return null; }
}

export async function installedClient() {
  try {
    const pkg = JSON.parse(await readFile(path.join(clientRoot, 'node_modules', '@sealad886', 'camofox-mcp', 'package.json'), 'utf8'));
    if (pkg.name !== packageName || pkg.version !== manifest.version) return null;
    await access(installedEntry);
    return installedEntry;
  } catch { return null; }
}

export function checkNode() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Camofox MCP requires Node.js 22 or newer.');
}
