import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserClient } from '../src/client.mjs';

async function fixture(t, handler, overrides = {}) {
  const home = await mkdtemp(join(tmpdir(), 'camofox-client-'));
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(home, { recursive: true }); });
  const config = { userId: 'fixed', sessionKey: 'task', mode: 'connect', accessKey: 'access-secret', apiKey: 'cookie-secret', adminKey: 'admin-secret', allowAdmin: false, requestTimeoutMs: 1000, maxResponseBytes: 4096, maxArtifactBytes: 8192, artifactDir: join(home, 'artifacts'), ...overrides };
  return new BrowserClient(config, { ...config, baseUrl: `http://127.0.0.1:${server.address().port}`, owned: false });
}

test('transport selects dedicated auth, fixed user, and preserves JSON bodies', async t => {
  let received;
  const client = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  const result = await client.call('camofox_import_cookies', { cookies: [{ name: 's', value: 'v', domain: 'example.com' }] });
  assert(!result.isError);
  assert.equal(received.path, '/sessions/fixed/cookies');
  assert.equal(received.auth, 'Bearer cookie-secret');
  assert.equal(received.body.cookies[0].value, 'v');
});

test('borrowed server administration is denied before any request', async t => {
  let count = 0;
  const client = await fixture(t, (_req, res) => { count++; res.end('{}'); });
  const result = await client.call('camofox_stop', {});
  assert.equal(result.isError, true); assert.match(result.content[0].text, /administration/i); assert.equal(count, 0);
});

test('stop sends upstream X-Admin-Key when administration explicitly enabled', async t => {
  let admin;
  const client = await fixture(t, (req, res) => { admin = req.headers['x-admin-key']; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, { allowAdmin: true });
  assert(!(await client.call('camofox_stop', {})).isError); assert.equal(admin, 'admin-secret');
});

test('upstream errors redact credentials and preserve actionable HTTP status', async t => {
  const client = await fixture(t, (_req, res) => { res.writeHead(409, { 'content-type': 'application/json' }); res.end('{"error":"stale ref access-secret cookie-secret admin-secret"}'); });
  const result = await client.call('camofox_click', { tabId: 't', ref: 'e1' });
  assert(result.isError); assert.match(result.content[0].text, /409/); assert.doesNotMatch(result.content[0].text, /access-secret|cookie-secret|admin-secret/);
});

test('binary screenshots become native MCP images and readable local artifacts', async t => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const client = await fixture(t, (_req, res) => { res.setHeader('content-type', 'image/png'); res.end(png); });
  const result = await client.call('camofox_screenshot', { tabId: 't' });
  const image = result.content.find(c => c.type === 'image'); assert.equal(image.data, png.toString('base64'));
  const link = result.content.find(c => c.type === 'resource_link'); assert.deepEqual(await readFile(fileURLToPath(link.uri)), png);
});

test('inline downloads save artifacts without using upstream paths or filenames as paths', async t => {
  const client = await fixture(t, (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ downloads: [{ suggestedFilename: '../../secret.txt', dataBase64: Buffer.from('download').toString('base64'), mimeType: 'text/plain' }] })); });
  const result = await client.call('camofox_downloads', { tabId: 't', includeData: true });
  const link = result.content.find(c => c.type === 'resource_link'); assert(link); assert.equal(await readFile(fileURLToPath(link.uri), 'utf8'), 'download');
  assert(!fileURLToPath(link.uri).includes('../')); assert.doesNotMatch(result.content[0].text, /ZG93bmxvYWQ=/);
});

test('response size limits reject declared and streamed excess', async t => {
  const client = await fixture(t, (_req, res) => { res.setHeader('content-type', 'text/plain'); res.end('x'.repeat(5000)); });
  const result = await client.call('camofox_metrics', {}); assert(result.isError); assert.match(result.content[0].text, /limit/i);
});

test('timeouts and cancellation terminate slow requests', async t => {
  const client = await fixture(t, (_req, _res) => {}, { requestTimeoutMs: 30 });
  const result = await client.call('camofox_health', {}); assert(result.isError); assert.match(result.content[0].text, /timeout|abort/i);
});

test('cross-origin redirects never forward credentials', async t => {
  const client = await fixture(t, (_req, res) => { res.writeHead(302, { location: 'https://example.com/steal' }); res.end(); });
  const result = await client.call('camofox_health', {}); assert(result.isError); assert.match(result.content[0].text, /redirect/i);
});

test('sensitive trace requests accept API-only existing-server credentials', async t => {
  let auth;
  const client = await fixture(t, (req, res) => { auth = req.headers.authorization; res.setHeader('content-type', 'application/json'); res.end('{"traces":[]}'); }, { accessKey: '' });
  assert(!(await client.call('camofox_list_traces', {})).isError); assert.equal(auth, 'Bearer cookie-secret');
});

test('artifact registry stores metadata and enforces disk count limits', async t => {
  const client = await fixture(t, (_req, res) => { res.setHeader('content-type', 'image/png'); res.end('png'); }, { maxArtifacts: 1 });
  const first = await client.call('camofox_screenshot', { tabId: 't' });
  assert(!first.isError);
  assert(![...client.resources.values()][0].bytes, 'large binary content must not be retained in memory');
  const second = await client.call('camofox_screenshot', { tabId: 't' });
  assert(second.isError); assert.match(second.content[0].text, /storage|count|artifact/i);
});
