#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'camofox-pack-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function run(command, args, options = {}) {
  return exec(command, args, { cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, ...options });
}
let transport;
let client;
try {
  const { stdout } = await run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary]);
  const [packed] = JSON.parse(stdout);
  const names = packed.files.map(file => file.path);
  for (const required of ['src/cli.mjs', 'plugin/plugin.json', 'plugin/.codex-plugin/plugin.json', 'plugin/.mcp.json', 'plugin/mcp.json', 'plugin/scripts/setup.mjs', 'plugin/scripts/launch.mjs', 'plugin/scripts/runtime-paths.mjs', 'plugin/skills/camofox/SKILL.md', 'docs/api/camofox-1.18.1.openapi.json', 'vendor/CAMOFOX-LICENSE', 'README.md', 'SECURITY.md', 'LICENSE']) assert(names.includes(required), `Packed artifact missing ${required}`);
  for (const name of names) assert(!/(^|\/)(?:\.git|\.agent-sync|\.claude|node_modules|\.env)(?:\/|$)|^skills\/|\.pem$|\.key$/.test(name), `Unexpected private/development artifact: ${name}`);
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const runtimeHome = path.join(temporary, 'runtime-home');
  const consumer = path.join(runtimeHome, 'client', rootPackage.version);
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  await run(npm, ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, packed.filename)]);
  const installed = path.join(consumer, 'node_modules', '@sealad886', 'camofox-mcp');
  const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@sealad886/camofox-mcp');
  const { stdout: help } = await run(process.execPath, [path.join(installed, 'src', 'cli.mjs'), '--help'], { cwd: consumer });
  for (const command of ['setup', 'serve', 'start', 'status', 'doctor', 'uninstall']) assert(help.includes(command), `CLI help missing ${command}`);
  const require = createRequire(path.join(installed, 'package.json'));
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  // Extracted plugin launch must discover tools without browser installation or a server.
  const standalone = path.join(temporary, 'standalone-plugin');
  await cp(path.join(installed, 'plugin'), standalone, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('CAMOFOX_')));
  env.CAMOFOX_MCP_HOME = path.join(temporary, 'missing-home');
  await assert.rejects(run(process.execPath, [path.join(standalone, 'scripts', 'launch.mjs')], { cwd: temporary, env, timeout: 5_000 }), error => error.code === 1 && /not installed.*setup[.]mjs/s.test(error.stderr));
  env.CAMOFOX_MCP_HOME = runtimeHome;
  transport = new StdioClientTransport({ command: process.execPath, args: [path.join(standalone, 'scripts', 'launch.mjs')], env, stderr: 'pipe' });
  client = new Client({ name: 'packed-consumer-smoke', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport, { timeout: 15_000 });
  const tools = await client.listTools({}, { timeout: 15_000 });
  assert(tools.tools.length > 0, 'Packed client returned no MCP tools');
  console.log(`Packed ${names.length} files; isolated npm install, CLI help, standalone plugin missing-setup behavior, MCP initialization, and ${tools.tools.length} tools passed without a browser.`);
} finally {
  await client?.close();
  await transport?.close();
  await rm(temporary, { recursive: true, force: true });
}
