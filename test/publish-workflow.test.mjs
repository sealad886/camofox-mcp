import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8'));
const publishStep = workflow.jobs.publish.steps.find(step => step.run?.includes('release-artifacts/pack.json') && step.run.includes('fetch('));
assert(publishStep, 'Workflow must contain registry-aware artifact publication');
const source = publishStep.run.match(/<<'JS'\n([\s\S]*?)\nJS(?:\n|$)/)?.[1];
assert(source, 'Publication step must provide executable JavaScript');
const executable = source.replace(/^import .+;\n/gm, '');

async function runPublication({ existing = false, integrity = 'sha512-fixture', registryStatus,
  visibilityStatuses = [200], publishedOverrides = {}, observe = {} } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'camofox-publish-test-'));
  const artifact = Buffer.from('exact approved artifact');
  const pack = { filename: 'sealad886-camofox-mcp-0.1.2.tgz', integrity: 'sha512-fixture' };
  const sha = 'a'.repeat(40);
  const calls = [];
  const delays = [];
  let published = existing;
  let checks = 0;
  let now = 0;
  Object.assign(observe, { calls, delays });
  mkdirSync(path.join(root, 'release-artifacts'));
  writeFileSync(path.join(root, 'release-artifacts/pack.json'), JSON.stringify([pack]));
  writeFileSync(path.join(root, 'release-artifacts', pack.filename), artifact);
  const context = {
    assert,
    AbortSignal,
    Date: { now: () => now },
    delay: async milliseconds => { assert(milliseconds > 0); delays.push(milliseconds); now += milliseconds; },
    process: { env: { RELEASE_VERSION: '0.1.2' } },
    console: { log() {} },
    fs: { readFileSync: (file, encoding) => readFileSync(path.resolve(root, file), encoding) },
    execFileSync(command, args) {
      if (command === 'git') return sha;
      assert.equal(command, 'npm');
      assert.equal(args[0], 'publish');
      assert(!existing && registryStatus === undefined, 'Only a missing registry version may invoke npm publish');
      calls.push(Array.from(args));
      assert.equal(calls.length, 1, 'Registry processing must never cause another npm publication');
      const spec = args[1];
      assert(path.isAbsolute(spec) || /^\.\.?[\\/]/.test(spec), 'npm must receive an explicit local artifact path, not a GitHub package spec');
      assert.deepEqual(readFileSync(path.resolve(root, spec)), artifact);
      assert(args.includes('--provenance'));
      assert(args.includes('--ignore-scripts'));
      published = true;
    },
    async fetch() {
      const status = registryStatus ?? (!published ? 404 : existing ? 200
        : visibilityStatuses[Math.min(checks++, visibilityStatuses.length - 1)]);
      assert(checks < 1000, 'Registry polling must remain bounded');
      return { ok: status === 200, status, json: async () => ({ name: '@sealad886/camofox-mcp', version: '0.1.2', gitHead: sha, dist: { integrity }, ...publishedOverrides }) };
    },
  };
  try {
    await vm.runInNewContext(`(async () => {\n${executable}\n})()`, context);
    return calls;
  } finally {
    observe.elapsed = now;
    rmSync(root, { recursive: true, force: true });
  }
}

test('npm publication resolves the approved artifact as a local file', async () => {
  const calls = await runPublication();
  assert.equal(calls.length, 1);
});

test('an already published matching commit and artifact never publish again', async () => {
  const observe = {};
  assert.deepEqual(await runPublication({ existing: true, observe }), []);
  assert.deepEqual(observe.delays, []);
});

test('npm processing waits through temporary 404 responses without republishing', async () => {
  const observe = {};
  const calls = await runPublication({ visibilityStatuses: [404, 404, 200], observe });
  assert.equal(calls.length, 1);
  assert(observe.delays.length > 0);
  assert(observe.elapsed <= 15 * 60_000);
});

test('registry visibility timeout remains bounded and never republishes', async () => {
  const observe = {};
  await assert.rejects(runPublication({ visibilityStatuses: [404], observe }), /visibility|readable|timed out|15 minutes/i);
  assert.equal(observe.calls.length, 1);
  assert(observe.delays.length > 0);
  assert(observe.elapsed <= 15 * 60_000);
});

test('postpublication registry errors fail without republishing', async () => {
  const observe = {};
  await assert.rejects(runPublication({ visibilityStatuses: [404, 503], observe }), /503/);
  assert.equal(observe.calls.length, 1);
});

for (const existing of [true, false]) {
  for (const [name, overrides] of [
    ['integrity', { dist: { integrity: 'sha512-different' } }],
    ['source', { gitHead: 'b'.repeat(40) }],
    ['package', { name: 'wrong-package' }],
    ['version', { version: '0.1.1' }],
  ]) {
    test(`${existing ? 'existing' : 'new'} publication with different ${name} fails verification`, async () => {
      const observe = {};
      await assert.rejects(runPublication({ existing, publishedOverrides: overrides, observe }));
      assert.equal(observe.calls.length, existing ? 0 : 1);
    });
  }
}

test('registry authorization failures never become missing versions', async () => {
  await assert.rejects(runPublication({ registryStatus: 403 }), /Registry returned 403/);
});
