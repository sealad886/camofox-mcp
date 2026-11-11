#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The manual publisher owns this transition because Release Please skips releases.
const pendingLabel = 'autorelease: pending';
export async function finalizeRelease({ repository, version, sha, integrity, token }, request = fetch) {
  assert.equal(repository, 'sealad886/camofox-mcp', 'Unexpected release repository');
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Expected stable release version');
  assert(/^[a-f0-9]{40}$/.test(sha), 'Expected exact source commit');
  assert(typeof integrity === 'string' && integrity && token, 'Missing artifact integrity or GitHub token');
  const registry = await request(`https://registry.npmjs.org/@sealad886%2fcamofox-mcp/${version}`, { signal: AbortSignal.timeout(30_000) });
  assert(registry.ok, `Publication registry verification failed (${registry.status})`);
  const published = await registry.json();
  assert.equal(published.name, '@sealad886/camofox-mcp', 'Published package mismatch');
  assert.equal(published.version, version, 'Published version mismatch');
  assert.equal(published.gitHead, sha, 'Published source mismatch');
  assert.equal(published.dist?.integrity, integrity, 'Published artifact integrity mismatch');

  async function github(route, method = 'GET') {
    const response = await request(`https://api.github.com/repos/${repository}/${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `Release finalization GitHub request failed (${response.status})`);
    return response.json();
  }
  const associated = [];
  for (let page = 1; ; page++) {
    const pulls = await github(`commits/${sha}/pulls?per_page=100&page=${page}`);
    assert(Array.isArray(pulls), 'Expected associated pull requests');
    associated.push(...pulls);
    if (pulls.length < 100) break;
  }
  const targets = associated.filter(pull => pull.merged_at && pull.merge_commit_sha === sha
    && pull.user?.login === 'github-actions[bot]'
    && pull.head?.ref === 'release-please--branches--main--components--camofox-mcp'
    && pull.head?.repo?.full_name === repository
    && pull.base?.ref === 'main' && pull.base?.repo?.full_name === repository);
  assert.equal(targets.length, 1, 'Expected one unique merged release PR for the published source');
  const target = targets[0];
  assert(Number.isSafeInteger(target.number) && target.number > 0, 'Expected release PR number');
  const file = await github(`contents/.release-please-manifest.json?ref=${sha}`);
  assert.equal(file.encoding, 'base64', 'Expected release manifest content');
  const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  assert.equal(manifest['.'], version, 'Release manifest version mismatch');
  assert(Array.isArray(target.labels), 'Missing release PR label evidence');
  if (!target.labels.some(label => label.name === pendingLabel)) return { pullRequest: target.number, changed: false };
  // Delete only our lifecycle label, preserving unrelated labels and their updates.
  const labels = await github(`issues/${target.number}/labels/${encodeURIComponent(pendingLabel)}`, 'DELETE');
  assert(Array.isArray(labels) && !labels.some(label => label.name === pendingLabel), 'Pending release label was not cleared');
  return { pullRequest: target.number, changed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [pack] = JSON.parse(await readFile('release-artifacts/pack.json', 'utf8'));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const result = await finalizeRelease({ repository: process.env.GITHUB_REPOSITORY,
    version: process.env.RELEASE_VERSION, sha, integrity: pack.integrity, token: process.env.GH_TOKEN });
  console.log(`Verified publication finalized for release PR #${result.pullRequest}; pending label ${result.changed ? 'removed' : 'already absent'}.`);
}
