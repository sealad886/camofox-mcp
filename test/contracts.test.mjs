import test from 'node:test';
import assert from 'node:assert/strict';
import { operations, buildRequest } from '../src/contracts.mjs';

test('catalog maps every pinned REST operation exactly once', () => {
  assert.equal(operations.length, 46);
  assert.equal(new Set(operations.map(o => `${o.method} ${o.path}`)).size, 46);
  assert.equal(new Set(operations.map(o => o.name)).size, 46);
  assert(operations.some(o => o.name === 'camofox_upload'));
});

test('requests inject fixed identity and preserve query, body and route semantics', () => {
  const identity = { userId: 'isolated-user', sessionKey: 'task' };
  const create = buildRequest('camofox_create_tab', { url: 'https://example.com' }, identity);
  assert.deepEqual(create.body, { url: 'https://example.com', userId: 'isolated-user', sessionKey: 'task' });
  const download = buildRequest('camofox_downloads', { tabId: 'tab/1', includeData: true, maxBytes: 100 }, identity);
  assert.equal(download.path, '/tabs/tab%2F1/downloads');
  assert.deepEqual(download.query, { userId: 'isolated-user', includeData: true, maxBytes: 100 });
  const cookie = buildRequest('camofox_import_cookies', { cookies: [] }, identity);
  assert.equal(cookie.auth, 'cookie');
  assert.equal(cookie.path, '/sessions/isolated-user/cookies');
});

test('invalid arguments cannot override identity or submit arbitrary operations', () => {
  const identity = { userId: 'isolated-user', sessionKey: 'task' };
  assert.throws(() => buildRequest('camofox_list_tabs', { userId: 'other' }, identity), /Invalid arguments/);
  assert.throws(() => buildRequest('camofox_viewport', { tabId: 't', width: 10, height: 700 }, identity), /Invalid arguments/);
  assert.throws(() => buildRequest('camofox_wait', { tabId: 't', selector: '#ignored' }, identity), /Invalid arguments/);
  assert.throws(() => buildRequest('arbitrary', {}, identity), /Unknown tool/);
});


test('source-only operations retain body requirements and fixed session paths', () => {
  const identity = { userId: 'isolated-user', sessionKey: 'task' };
  assert.throws(() => buildRequest('camofox_youtube_transcript', {}, identity), /Invalid arguments/);
  const transcript = buildRequest('camofox_youtube_transcript', { url: 'https://youtu.be/abcdefghijk', languages: ['fr'] }, identity);
  assert.deepEqual(transcript.body, { url: 'https://youtu.be/abcdefghijk', languages: ['fr'] });
  assert.equal(buildRequest('camofox_get_storage_state', {}, identity).path, '/sessions/isolated-user/storage_state');
});

test('source overlays preserve original required inputs while correcting ignored fields', () => {
  const identity = { userId: 'isolated-user', sessionKey: 'task' };
  assert.throws(() => buildRequest('camofox_type', { tabId: 't', mode: 'keyboard' }, identity), /Invalid arguments/);
  assert.throws(() => buildRequest('camofox_type', { tabId: 't', text: 'hello', clear: true }, identity), /Invalid arguments/);
  const type = buildRequest('camofox_type', { tabId: 't', text: 'hello', mode: 'keyboard', delay: 5 }, identity);
  assert.deepEqual(type.body, { userId: 'isolated-user', text: 'hello', mode: 'keyboard', delay: 5 });
  const wait = buildRequest('camofox_wait', { tabId: 't', waitForNetwork: false, dismissConsent: true }, identity);
  assert.deepEqual(wait.body, { userId: 'isolated-user', waitForNetwork: false, dismissConsent: true });
});

test('alternate open routes inject task group and group close cannot target a different task', () => {
  const identity = { userId: 'fixed', sessionKey: 'task' };
  assert.equal(buildRequest('camofox_open_tab_compat', { url: 'https://example.com' }, identity).body.listItemId, 'task');
  assert.throws(() => buildRequest('camofox_close_group', { listItemId: 'other' }, identity), /configured task group/);
});


test('canonical grouped requests inject sessionKey without duplicating legacy alias', () => {
  const identity = { userId: 'fixed', sessionKey: 'isolated-group' };
  const create = buildRequest('camofox_create_tab', { url: 'https://example.com' }, identity);
  assert.equal(create.body.sessionKey, 'isolated-group');
  assert.equal(Object.hasOwn(create.body, 'listItemId'), false);
  const navigate = buildRequest('camofox_navigate', { tabId: 't', url: 'https://example.com' }, identity);
  assert.equal(navigate.body.sessionKey, 'isolated-group');
  assert.equal(Object.hasOwn(navigate.body, 'listItemId'), false);
});
