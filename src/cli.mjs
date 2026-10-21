#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { setupRuntime, ensureRuntime, runtimeStatus, uninstallRuntime } from './runtime.mjs';
import { BrowserClient } from './client.mjs';
import { serve } from './server.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const help = `camofox-mcp ${version}\n\nUsage: camofox-mcp <command>\n\n  setup              Install pinned Camofox components and verify a browser launch\n  serve              Run MCP over stdio (no implicit installation)\n  start              Start an owned headless service in background\n  start --foreground Run an owned service until Ctrl-C\n  stop               Stop only the verified service started by this CLI\n  status             Show runtime and service state without credentials\n  doctor [--browser] Check configuration; optionally verify a real browser tab\n  upgrade            Repair/setup the upstream version pinned by this package\n  uninstall          Remove the owned upstream installation; preserve user data\n  --version          Print package version\n\nConfigure CAMOFOX_MCP_HOME for private storage, CAMOFOX_BASE_URL for an\nexisting service, and CAMOFOX_USER_ID to explicitly reuse a login profile.\nSee README for authentication, uploads, proxies, and platform prerequisites.\n`;

async function main() {
  const [command = '--help', ...args] = process.argv.slice(2);
  if (['--help', '-h', 'help'].includes(command)) { process.stdout.write(help); return; }
  if (command === '--version') { process.stdout.write(`${version}\n`); return; }
  if (!['setup', 'serve', 'start', 'stop', 'status', 'doctor', 'upgrade', 'uninstall'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const allowed = command === 'start' ? ['--foreground'] : command === 'doctor' ? ['--browser'] : [];
  if (args.some(arg => !allowed.includes(arg)) || new Set(args).size !== args.length) throw new Error(`Unknown option for ${command}`);
  const config = loadConfig();
  const output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (command === 'serve') { await serve(config); return; }
  if (command === 'setup' || command === 'upgrade') {
    console.error('Preparing pinned Camofox runtime and browser components. Initial download can take several minutes.');
    const { serviceStatus } = await import('./service.mjs');
    if ((await serviceStatus(config)).running) throw new Error('Stop the owned background service before setup or upgrade');
    output(await setupRuntime(config)); return;
  }
  if (command === 'start' && args.includes('--foreground')) {
    if (config.mode === 'connect') throw new Error('Existing-server mode does not start or own the configured server');
    const runtime = await ensureRuntime(config);
    output({ running: true, owned: true, baseUrl: runtime.baseUrl });
    const stop = async () => { await runtime.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (['start', 'stop', 'status', 'doctor', 'uninstall'].includes(command)) {
    const { startService, stopService, serviceStatus } = await import('./service.mjs');
    if (command === 'start') { output(await startService(config)); return; }
    if (command === 'stop') { output(await stopService(config)); return; }
    if (command === 'uninstall') {
      const service = await serviceStatus(config);
      if (service.running) throw new Error('Run camofox-mcp stop before uninstalling the active managed service');
      output(await uninstallRuntime(config)); return;
    }
    const status = { ...await runtimeStatus(config), service: await serviceStatus(config) };
    if (command === 'doctor' && args.includes('--browser')) {
      const runtime = await ensureRuntime(config);
      const client = new BrowserClient(config, runtime);
      try {
        const tab = await client.call('camofox_create_tab', { url: `${runtime.baseUrl}/health` });
        if (tab.isError) throw new Error(tab.content[0].text);
        const payload = JSON.parse(tab.content[0].text);
        await client.call('camofox_close_tab', { tabId: payload.tabId || payload.id });
        status.browserLaunchVerified = true;
      } finally { await runtime.close(); }
    }
    output(status);
    if (command === 'doctor' && (config.mode === 'connect' ? !status.reachable : !status.installed)) process.exitCode = 1;
  }
}
main().catch(error => {
  let message = String(error.message || error);
  for (const key of ['CAMOFOX_ACCESS_KEY', 'CAMOFOX_API_KEY', 'CAMOFOX_ADMIN_KEY', 'PROXY_PASSWORD']) if (process.env[key]) message = message.split(process.env[key]).join('[redacted]');
  console.error(`camofox-mcp: ${message}`); process.exitCode = 1;
});
