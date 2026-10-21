import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, UPSTREAM_VERSION } from '../src/config.mjs';

test('defaults to private managed runtime and isolated identities', () => {
  const a = loadConfig({}); const b = loadConfig({});
  assert.equal(a.mode, 'managed');
  assert.equal(UPSTREAM_VERSION, '1.18.1');
  assert.equal(a.persistent, false);
  assert.notEqual(a.userId, b.userId);
  assert.equal(a.requestTimeoutMs, 45000);
  assert.ok(a.artifactDir.startsWith(a.home));
});

test('connect validates endpoint transport, identity and secret boundaries', () => {
  assert.throws(() => loadConfig({ CAMOFOX_BASE_URL: 'http://remote.example' }), /HTTPS/);
  assert.throws(() => loadConfig({ CAMOFOX_BASE_URL: 'https://remote.example' }), /ACCESS_KEY/);
  for (const url of ['https://user:secret@remote.example', 'http://127.0.0.1/?key=x', 'file:///tmp/x']) {
    assert.throws(() => loadConfig({ CAMOFOX_BASE_URL: url, CAMOFOX_ACCESS_KEY: 'key' }));
  }
  const config = loadConfig({ CAMOFOX_BASE_URL: 'https://remote.example/', CAMOFOX_ACCESS_KEY: 'key', CAMOFOX_USER_ID: 'saved' });
  assert.equal(config.mode, 'connect'); assert.equal(config.baseUrl, 'https://remote.example');
  assert.equal(config.persistent, true); assert.equal(config.userId, 'saved');
});

test('resource limits reject malformed, zero, negative and excessive values', () => {
  for (const value of ['0', '-1', '1junk', '1.2', '9999999999999999']) {
    assert.throws(() => loadConfig({ CAMOFOX_MCP_REQUEST_TIMEOUT_MS: value }), /CAMOFOX_MCP_REQUEST_TIMEOUT_MS/);
  }
  assert.equal(loadConfig({ CAMOFOX_MCP_REQUEST_TIMEOUT_MS: '2000' }).requestTimeoutMs, 2000);
});
