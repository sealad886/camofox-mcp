import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBrowserServer } from '../src/server.mjs';

test('real MCP client discovers all tools without starting or installing runtime', async t => {
  let starts = 0;
  const app = createBrowserServer({ userId: 'task', sessionKey: 'default' }, { runtimeFactory: async () => { starts++; throw new Error('not set up'); } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await app.server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await app.close(); });
  assert.equal((await client.listTools()).tools.length, 46); assert.equal(starts, 0);
  const invalid = await client.callTool({ name: 'camofox_list_tabs', arguments: { userId: 'other' } });
  assert(invalid.isError); assert.equal(starts, 0);
  const result = await client.callTool({ name: 'camofox_health', arguments: {} });
  assert(result.isError); assert.match(result.content[0].text, /not set up/); assert.equal(starts, 1);
});

test('MCP closure cleans up owned runtime exactly once', async () => {
  let closed = 0;
  const app = createBrowserServer({ userId: 'task', sessionKey: 'default', requestTimeoutMs: 50 }, { runtimeFactory: async () => ({ baseUrl: 'http://127.0.0.1:1', owned: true, close: async () => { closed++; } }) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await app.server.connect(st); await client.connect(ct);
  await client.callTool({ name: 'camofox_health', arguments: {} });
  await client.close(); await app.close(); await app.close();
  assert.equal(closed, 1);
});
