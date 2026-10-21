#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { checkNode, installedClient, sourceEntry } from './runtime-paths.mjs';

try {
  checkNode();
  const entry = await sourceEntry() || await installedClient();
  if (!entry) throw new Error('Camofox MCP client is not installed. Run node "<plugin-root>/scripts/setup.mjs", then reconnect this MCP server.');
  const child = spawn(process.execPath, [entry, 'serve', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(`Camofox MCP launch failed: ${error.message}`); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
