import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../src/config.mjs';
import { setupRuntime } from '../src/runtime.mjs';
import { startService, stopService, getServiceConnection } from '../src/service.mjs';
import { BrowserClient } from '../src/client.mjs';

// This local-fixture test requires a real configured Camoufox installation. It never signs in to third-party sites.
test('real Camofox MCP browses, interacts, transfers files, isolates sessions and restores state', { timeout: 180000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'camofox-live-'));
  const fixture = http.createServer((req, res) => {
    if (req.url === '/download') { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename=fixture.txt' }); res.end('browser-download-proof'); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><head><title>Camofox local fixture</title></head><body><h1>Browser acceptance fixture</h1><label>Name<input id="name"></label><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select><button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Save</button><p id="result"></p><input type="file" id="upload"><a id="download" href="/download" download="fixture.txt">Download fixture</a><a href="/next">Next</a></body></html>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  let transport, client, config;
  t.after(async () => { await client?.close(); await transport?.close(); if (config) await stopService(config).catch(() => {}); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const env = { ...process.env, CAMOFOX_MCP_HOME: home, CAMOFOX_USER_ID: 'live-persistent', CAMOFOX_SESSION_KEY: 'acceptance' };
  delete env.CAMOFOX_BASE_URL;
  config = loadConfig(env);
  await setupRuntime(config);
  await mkdir(config.uploadsDir, { recursive: true });
  const upload = join(config.uploadsDir, 'fixture-upload.txt'); await writeFile(upload, 'browser-upload-proof');
  async function connect() {
    transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'serve'], env, stderr: 'pipe' });
    // Drain diagnostic output without saving credentials, logs, or debug dumps.
    transport.stderr?.on('data', () => {});
    client = new Client({ name: 'live-acceptance', version: '1' }); await client.connect(transport);
  }
  async function tool(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    assert(!result.isError, `${name}: ${result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n')}`);
    return result;
  }
  function json(result) { return JSON.parse(result.content.find(x => x.type === 'text').text); }
  await startService(config);
  await connect(); assert.equal((await client.listTools()).tools.length, 46);
  const created = json(await tool('camofox_create_tab', { url: base, trace: true }));
  const tabId = created.tabId || created.id; assert(tabId);
  await tool('camofox_wait', { tabId, timeout: 5000 });
  const snapshot = json(await tool('camofox_snapshot', { tabId })); assert.match(snapshot.snapshot, /Browser acceptance fixture/);
  await tool('camofox_type', { tabId, selector: '#name', text: 'Camofox verified' });
  await tool('camofox_select', { tabId, selector: '#choice', option: 'Beta' });
  await tool('camofox_click', { tabId, selector: '#save' });
  const form = json(await tool('camofox_evaluate', { tabId, expression: '({ name:document.querySelector("#result").textContent, choice:document.querySelector("#choice").value })' }));
  assert.deepEqual(form.result, { name: 'Camofox verified', choice: 'b' });
  await tool('camofox_upload', { tabId, selector: '#upload', path: upload });
  const uploaded = json(await tool('camofox_evaluate', { tabId, expression: 'document.querySelector("#upload").files[0].name' })); assert.equal(uploaded.result, 'fixture-upload.txt');
  const screenshot = await tool('camofox_screenshot', { tabId }); assert(screenshot.content.some(x => x.type === 'image' && x.mimeType === 'image/png'));
  await tool('camofox_click', { tabId, selector: '#download' });
  let downloads;
  for (let i = 0; i < 30; i++) {
    downloads = await tool('camofox_downloads', { tabId, includeData: true, consume: false, maxBytes: 1024 });
    if (downloads.content.some(x => x.type === 'resource_link')) break;
    await delay(100);
  }
  const artifact = downloads.content.find(x => x.type === 'resource_link'); assert(artifact);
  assert.equal(await readFile(fileURLToPath(artifact.uri), 'utf8'), 'browser-download-proof');
  const readArtifact = await client.readResource({ uri: artifact.uri }); assert.equal(Buffer.from(readArtifact.contents[0].blob, 'base64').toString(), 'browser-download-proof');
  await tool('camofox_evaluate', { tabId, expression: 'localStorage.setItem("acceptance", "restored"); document.cookie="fixture_session=retained; path=/"; true' });
  const isolatedConfig = { ...config, userId: 'separate-user', persistent: false };
  const isolatedRuntime = await getServiceConnection(config);
  assert(isolatedRuntime && !isolatedRuntime.owned);
  const isolated = new BrowserClient(isolatedConfig, isolatedRuntime);
  try {
    const result = await isolated.call('camofox_list_tabs', {}); assert(!result.isError); assert(!result.content[0].text.includes(tabId));
    const second = await isolated.call('camofox_create_tab', { url: base }); assert(!second.isError);
    const secondTab = JSON.parse(second.content[0].text);
    const separate = await isolated.call('camofox_evaluate', { tabId: secondTab.tabId || secondTab.id, expression: '({storage:localStorage.getItem("acceptance"),cookie:document.cookie})' });
    assert.deepEqual(JSON.parse(separate.content[0].text).result, {storage:null,cookie:''});
    await isolated.call('camofox_close_session', {});
  } finally { await isolatedRuntime.close(); }
  await tool('camofox_close_session');
  const traces = json(await tool('camofox_list_traces')); assert(traces.traces.length > 0);
  const trace = await tool('camofox_get_trace', { filename: traces.traces[0].filename }); assert(trace.content.some(x => x.type === 'resource_link'));
  await client.close(); await transport.close();
  await stopService(config); await startService(config);
  await connect();
  const restoredTab = json(await tool('camofox_create_tab', { url: base }));
  const restored = json(await tool('camofox_evaluate', { tabId: restoredTab.tabId || restoredTab.id, expression: '({storage:localStorage.getItem("acceptance"),cookie:document.cookie})' }));
  assert.equal(restored.result.storage, 'restored'); assert.match(restored.result.cookie, /fixture_session=retained/);
});
