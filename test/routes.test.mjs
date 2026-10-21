import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserClient } from '../src/client.mjs';

const upstream = JSON.parse(await readFile(new URL('../docs/api/camofox-1.18.1.openapi.json', import.meta.url)));
const supplement = JSON.parse(await readFile(new URL('../docs/api/supplemental.json', import.meta.url)));
const contract = await readFile(new URL('../docs/api/mcp-contract.md', import.meta.url), 'utf8');
const mapping = [...contract.matchAll(/^\| (GET|POST|DELETE) \| `([^`]+)` \| `([^`]+)` \|$/gm)]
  .map(([, method, route, tool]) => ({ method, route, tool }));
const userId = 'fixed-user';
const sessionKey = 'fixed-group';
const tabId = 'tab/encoded';
const url = 'https://example.test/path?q=one&x=two';
const cookies = [{ name: 'session', value: 'cookie value', domain: 'example.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }];
const schema = { type: 'object', properties: { title: { type: 'string', 'x-ref': 'e1' } }, required: ['title'] };
const scoped = { userId };
const tab = { tabId };
// Independent cases specify exact expected REST bodies/query. Production contracts are not imported.
const cases = {
  import_cookies: { args: { cookies }, body: { cookies }, auth: 'cookie' },
  health: { auth: 'none' }, metrics: {},
  cleanup: { args: { dryRun: true, minIdleMs: 900, maxTabsToClose: 2, minTabsPerSession: 1, closeEmptySessions: false }, body: { dryRun: true, minIdleMs: 900, maxTabsToClose: 2, minTabsPerSession: 1, closeEmptySessions: false } },
  create_tab: { args: { url, trace: true }, body: { userId, sessionKey, url, trace: true } },
  list_tabs: { query: scoped },
  navigate: { args: { ...tab, url, macro: '@google_search', query: 'some query' }, body: { userId, sessionKey, url, macro: '@google_search', query: 'some query' } },
  snapshot: { args: { ...tab, format: 'json', offset: 25, includeScreenshot: false }, query: { userId, format: 'json', offset: '25', includeScreenshot: 'false' } },
  wait: { args: { ...tab, timeout: 500, waitForNetwork: false, dismissConsent: true }, body: { userId, timeout: 500, waitForNetwork: false, dismissConsent: true } },
  click: { args: { ...tab, ref: 'e2', selector: '#submit' }, body: { userId, ref: 'e2', selector: '#submit' } },
  upload: { args: { ...tab, path: ['/service/uploads/one.txt', '/service/uploads/two.txt'], ref: 'e3', selector: 'input[type=file]', timeout: 1000 }, body: { userId, path: ['/service/uploads/one.txt', '/service/uploads/two.txt'], ref: 'e3', selector: 'input[type=file]', timeout: 1000 } },
  type: { args: { ...tab, ref: 'e4', selector: '#input', text: 'hello & goodbye', mode: 'keyboard', delay: 5, submit: true, pressEnter: false }, body: { userId, ref: 'e4', selector: '#input', text: 'hello & goodbye', mode: 'keyboard', delay: 5, submit: true, pressEnter: false } },
  select: { args: { ...tab, ref: 'e5', selector: '#select', option: 'option label' }, body: { userId, ref: 'e5', selector: '#select', option: 'option label' } },
  press: { args: { ...tab, key: 'Control+Enter' }, body: { userId, key: 'Control+Enter' } },
  scroll: { args: { ...tab, direction: 'left', amount: 250 }, body: { userId, direction: 'left', amount: 250 } },
  viewport: { args: { ...tab, width: 1200, height: 800 }, body: { userId, width: 1200, height: 800 } },
  back: { args: tab, body: scoped }, forward: { args: tab, body: scoped }, refresh: { args: tab, body: scoped },
  links: { args: { ...tab, offset: 5, limit: 10 }, query: { userId, offset: '5', limit: '10' } },
  fetch_current_resource: { args: tab, body: scoped },
  downloads: { args: { ...tab, includeData: true, consume: false, maxBytes: 1000 }, query: { userId, includeData: 'true', consume: 'false', maxBytes: '1000' } },
  images: { args: { ...tab, includeData: true, maxBytes: 1000, limit: 2 }, query: { userId, includeData: 'true', maxBytes: '1000', limit: '2' } },
  screenshot: { args: { ...tab, fullPage: true }, query: { userId, fullPage: 'true' } },
  stats: { args: tab, query: scoped },
  evaluate: { args: { ...tab, expression: 'document.title' }, body: { userId, expression: 'document.title' } },
  extract: { args: { ...tab, schema }, body: { userId, schema } },
  close_tab: { args: tab, query: scoped },
  close_group: { args: { listItemId: sessionKey }, query: scoped },
  list_traces: {}, get_trace: { args: { filename: 'trace with spaces.zip' } }, delete_trace: { args: { filename: 'trace with spaces.zip' } },
  close_session: {}, status: {},
  open_tab_compat: { args: { url }, body: { userId, url, listItemId: sessionKey } },
  start: { body: {} }, stop: { body: {}, admin: true },
  navigate_compat: { args: { targetId: 'compat/tab', url }, body: { userId, targetId: 'compat/tab', url } },
  snapshot_compat: { args: { targetId: 'compat/tab', format: 'text', offset: 8, includeScreenshot: true }, query: { userId, targetId: 'compat/tab', format: 'text', offset: '8', includeScreenshot: 'true' } },
  act: { args: { targetId: 'compat/tab', kind: 'type', text: 'input text', ref: 'e6', selector: '#compat', mode: 'keyboard', delay: 2, submit: false }, body: { userId, targetId: 'compat/tab', kind: 'type', text: 'input text', ref: 'e6', selector: '#compat', mode: 'keyboard', delay: 2, submit: false } },
  openapi: {}, docs: {}, vnc_status: {}, get_storage_state: {}, delete_storage_state: {},
  youtube_transcript: { args: { url: 'https://youtu.be/abcdefghijk', languages: ['fr', 'en'] }, body: { url: 'https://youtu.be/abcdefghijk', languages: ['fr', 'en'] } },
};

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'camofox-routes-'));
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = new URL(req.url, 'http://fixture');
    received.push({ method: req.method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: body ? JSON.parse(body) : undefined, authorization: req.headers.authorization, admin: req.headers['x-admin-key'] });
    if (parsed.pathname === '/docs') { res.writeHead(301, { location: '/docs/' }); return res.end(); }
    if (parsed.pathname === '/docs/') { res.setHeader('content-type', 'text/html'); return res.end('<html>API documentation</html>'); }
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const config = { userId, sessionKey, allowAdmin: true, requestTimeoutMs: 1000, maxResponseBytes: 4096, maxArtifactBytes: 4096, artifactDir: join(home, 'artifacts') };
  const runtime = { baseUrl: `http://127.0.0.1:${server.address().port}`, accessKey: 'access-key', apiKey: 'api-key', adminKey: 'admin-key', owned: true };
  return { client: new BrowserClient(config, runtime), received };
}

test('every documented REST operation forwards exact method, path, identity, auth and values', async t => {
  const known = new Set();
  for (const document of [upstream, supplement]) {
    for (const [route, verbs] of Object.entries(document.paths)) {
      for (const verb of Object.keys(verbs)) if (['get', 'post', 'delete', 'put', 'patch'].includes(verb)) known.add(`${verb.toUpperCase()} ${route}`);
    }
  }
  assert.equal(mapping.length, 46);
  assert.deepEqual(new Set(mapping.map(item => `${item.method} ${item.route}`)), known);
  assert.deepEqual(new Set(mapping.map(item => item.tool.replace(/^camofox_/, ''))), new Set(Object.keys(cases)));
  const { client, received } = await fixture(t);
  for (const { method, route, tool } of mapping) {
    await t.test(tool, async () => {
      const example = cases[tool.replace(/^camofox_/, '')];
      const args = example.args || {};
      const expectedPath = route.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(key === 'userId' ? userId : args[key]));
      const before = received.length;
      const result = await client.call(tool, args);
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const requests = received.slice(before);
      assert.equal(requests.length, tool === 'camofox_docs' ? 2 : 1);
      const expectedAuth = example.auth === 'none' ? undefined : example.auth === 'cookie' ? 'Bearer api-key' : 'Bearer access-key';
      for (const [index, request] of requests.entries()) {
        assert.deepEqual(request, { method, path: index ? '/docs/' : expectedPath, query: example.query || {}, body: example.body, authorization: expectedAuth, admin: example.admin ? 'admin-key' : undefined });
      }
    });
  }
});

test('API-only local service authenticates trace and storage operations', async t => {
  const { client, received } = await fixture(t);
  client.runtime.accessKey = '';
  for (const [tool, args] of [['camofox_list_traces', {}], ['camofox_get_trace', { filename: 'trace.zip' }], ['camofox_delete_trace', { filename: 'trace.zip' }], ['camofox_get_storage_state', {}], ['camofox_delete_storage_state', {}]]) {
    const result = await client.call(tool, args);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(received.at(-1).authorization, 'Bearer api-key');
  }
});
