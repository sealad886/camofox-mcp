import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeRelease } from '../scripts/finalize-release.mjs';

const sha = 'a'.repeat(40);
const version = '0.1.2';
const integrity = 'sha512-exact-artifact';
const repository = 'sealad886/camofox-mcp';
const pending = 'autorelease: pending';
const pull = () => ({
  number: 7, merged_at: '2026-11-11T01:00:00Z', merge_commit_sha: sha,
  user: { login: 'github-actions[bot]' },
  head: { ref: 'release-please--branches--main--components--camofox-mcp', repo: { full_name: repository } },
  base: { ref: 'main', repo: { full_name: repository } },
  labels: [{ name: pending }, { name: 'keep-me' }],
});

function fixture({ published = {}, pulls = [pull()], manifestVersion = version, registryStatus = 200 } = {}) {
  const writes = [];
  const reads = [];
  const request = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (options.method === 'DELETE') {
      writes.push({ path, method: options.method });
      return { ok: true, status: 200, json: async () => [{ name: 'keep-me' }] };
    }
    reads.push(path);
    if (url.startsWith('https://registry.npmjs.org/')) {
      return { ok: registryStatus === 200, status: registryStatus, json: async () => ({ name: '@sealad886/camofox-mcp', version, gitHead: sha, dist: { integrity }, ...published }) };
    }
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    if (path.endsWith('/pulls')) return { ok: true, status: 200, json: async () => pulls };
    if (path.endsWith('/contents/.release-please-manifest.json')) {
      assert.equal(new URL(url).searchParams.get('ref'), sha);
      return { ok: true, status: 200, json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify({ '.': manifestVersion })).toString('base64') }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return { writes, reads, run: () => finalizeRelease({ repository, version, sha, integrity, token: 'synthetic-token' }, request) };
}

test('verified publication clears only the exact merged release PR pending label', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { pullRequest: 7, changed: true });
  assert.deepEqual(f.writes, [{ method: 'DELETE', path: `/repos/${repository}/issues/7/labels/autorelease%3A%20pending` }]);
});

test('an already finalized matching release is a verified no-op', async () => {
  const target = pull(); target.labels = [{ name: 'keep-me' }];
  const f = fixture({ pulls: [target] });
  assert.deepEqual(await f.run(), { pullRequest: 7, changed: false });
  assert.deepEqual(f.writes, []);
});

for (const [name, patch] of [
  ['wrong source', { gitHead: 'b'.repeat(40) }],
  ['wrong integrity', { dist: { integrity: 'sha512-other' } }],
  ['wrong version', { version: '0.1.1' }],
  ['wrong package', { name: 'other' }],
]) {
  test(`publication with ${name} cannot change release state`, async () => {
    const f = fixture({ published: patch });
    await assert.rejects(f.run());
    assert.deepEqual(f.writes, []);
    assert.equal(f.reads.length, 1);
  });
}

test('unavailable registry cannot change release state', async () => {
  const f = fixture({ registryStatus: 404 });
  await assert.rejects(f.run(), /registry/i);
  assert.deepEqual(f.writes, []);
});

for (const [name, pulls] of [
  ['missing', []],
  ['ambiguous', [pull(), { ...pull(), number: 8 }]],
  ['unmerged', [{ ...pull(), merged_at: null }]],
  ['different source', [{ ...pull(), merge_commit_sha: 'b'.repeat(40) }]],
  ['ordinary branch', [{ ...pull(), head: { ...pull().head, ref: 'feature' } }]],
  ['other author', [{ ...pull(), user: { login: 'someone-else' } }]],
  ['fork branch', [{ ...pull(), head: { ...pull().head, repo: { full_name: 'someone/camofox-mcp' } } }]],
]) {
  test(`${name} release PR target cannot change release state`, async () => {
    const f = fixture({ pulls });
    await assert.rejects(f.run(), /unique merged release/i);
    assert.deepEqual(f.writes, []);
  });
}

test('different release manifest version cannot change release state', async () => {
  const f = fixture({ manifestVersion: '0.1.1' });
  await assert.rejects(f.run(), /manifest version/i);
  assert.deepEqual(f.writes, []);
});
