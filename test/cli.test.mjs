import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const cli = new URL('../src/cli.mjs', import.meta.url);
test('CLI help/version work without browser setup', () => {
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /setup/); assert.match(help.stdout, /serve/);
  const version = spawnSync(process.execPath, [cli.pathname, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);
});
test('CLI rejects unknown commands and options without changing runtime', () => {
  for (const args of [['unknown'], ['setup', '--unknown']]) {
    const child = spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
    assert.equal(child.status, 1); assert.match(child.stderr, /Unknown/);
  }
});
