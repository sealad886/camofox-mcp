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

async function runPublication({ existing = false, integrity = 'sha512-fixture', registryStatus } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'camofox-publish-test-'));
  const artifact = Buffer.from('exact approved artifact');
  const pack = { filename: 'sealad886-camofox-mcp-0.1.1.tgz', integrity: 'sha512-fixture' };
  const sha = 'a'.repeat(40);
  const calls = [];
  let published = existing;
  mkdirSync(path.join(root, 'release-artifacts'));
  writeFileSync(path.join(root, 'release-artifacts/pack.json'), JSON.stringify([pack]));
  writeFileSync(path.join(root, 'release-artifacts', pack.filename), artifact);
  const context = {
    assert,
    AbortSignal,
    process: { env: { RELEASE_VERSION: '0.1.1' } },
    console: { log() {} },
    fs: { readFileSync: (file, encoding) => readFileSync(path.resolve(root, file), encoding) },
    execFileSync(command, args) {
      if (command === 'git') return sha;
      assert.equal(command, 'npm');
      assert.equal(args[0], 'publish');
      assert(!existing && registryStatus === undefined, 'Only a missing registry version may invoke npm publish');
      calls.push(Array.from(args));
      const spec = args[1];
      assert(path.isAbsolute(spec) || /^\.\.?[\\/]/.test(spec), 'npm must receive an explicit local artifact path, not a GitHub package spec');
      assert.deepEqual(readFileSync(path.resolve(root, spec)), artifact);
      assert(args.includes('--provenance'));
      assert(args.includes('--ignore-scripts'));
      published = true;
    },
    async fetch() {
      const status = registryStatus ?? (published ? 200 : 404);
      return { ok: status === 200, status, json: async () => ({ name: '@sealad886/camofox-mcp', version: '0.1.1', gitHead: sha, dist: { integrity } }) };
    },
  };
  try {
    await vm.runInNewContext(`(async () => {\n${executable}\n})()`, context);
    return calls;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('npm publication resolves the approved artifact as a local file', async () => {
  const calls = await runPublication();
  assert.equal(calls.length, 1);
});

test('an already published matching commit and artifact never publish again', async () => {
  assert.deepEqual(await runPublication({ existing: true }), []);
});

test('an existing version with different artifact integrity stops publication', async () => {
  await assert.rejects(runPublication({ existing: true, integrity: 'sha512-different' }), /different artifact/);
});

test('registry authorization failures never become missing versions', async () => {
  await assert.rejects(runPublication({ registryStatus: 403 }), /Registry returned 403/);
});
