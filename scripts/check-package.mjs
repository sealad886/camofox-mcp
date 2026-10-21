#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { parseDocument } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const pkg = await readJson('package.json');
const manifest = await readJson('plugin/plugin.json');
const overlay = await readJson('plugin/.codex-plugin/plugin.json');
const portableMcp = await readJson('plugin/mcp.json');
const codexMcp = await readJson('plugin/.mcp.json');
const releaseConfig = await readJson('release-please-config.json');
const releaseManifest = await readJson('.release-please-manifest.json');
const ajv = new Ajv({ strict: true, allErrors: true });
const validateManifest = ajv.compile({ type: 'object', required: ['$schema', 'name', 'version', 'description', 'extensions'], properties: {
  $schema: { const: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' },
  name: { type: 'string', pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$', maxLength: 64 },
  version: { type: 'string', pattern: '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:[+][0-9A-Za-z.-]+)?$' },
  description: { type: 'string', minLength: 1 },
  extensions: { type: 'object', required: ['com.openai'], properties: { 'com.openai': { type: 'object', required: ['interface'], properties: { interface: { type: 'object', required: ['displayName','shortDescription','category','capabilities'], properties: {
    displayName: { type: 'string', minLength: 1 }, shortDescription: { type: 'string', minLength: 1, maxLength: 30 }, category: { const: 'Productivity' }, capabilities: { type: 'array', items: { type: 'string', minLength: 1 } }
  } } } } } }
} });
assert(validateManifest(manifest), ajv.errorsText(validateManifest.errors));
for (const key of ['name', 'version', 'description', 'repository', 'license']) assert.deepEqual(overlay[key], manifest[key], `Plugin overlay drift: ${key}`);
assert.equal(manifest.version, pkg.version, 'npm/plugin version drift');
assert.deepEqual(overlay.interface, manifest.extensions['com.openai'].interface, 'Plugin presentation drift');
assert.equal(releaseManifest['.'], pkg.version, 'Release manifest drift');
const extras = releaseConfig.packages['.']['extra-files'];
for (const filename of ['plugin/plugin.json', 'plugin/.codex-plugin/plugin.json']) assert(extras.some(extra => extra.type === 'json' && extra.path === filename && extra.jsonpath === '$.version'), `Release Please must mirror ${filename}`);
assert.equal(portableMcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
assert.deepEqual(Object.keys(portableMcp.mcpServers), ['camofox']);
assert.equal(portableMcp.mcpServers.camofox.type, 'stdio');
assert.equal(portableMcp.mcpServers.camofox.command, 'node');
assert.deepEqual(portableMcp.mcpServers.camofox.args, ['${PLUGIN_ROOT}/scripts/launch.mjs']);
assert.equal(portableMcp.mcpServers.camofox.cwd, '${PLUGIN_ROOT}');
assert.equal(codexMcp.mcpServers.camofox.command, 'node');
assert.deepEqual(codexMcp.mcpServers.camofox.args, ['./scripts/launch.mjs']);
assert.equal(codexMcp.mcpServers.camofox.cwd, '.');

async function contained(relative) {
  assert(relative.startsWith('./'), `Expected contained relative path: ${relative}`);
  const resolved = path.resolve(root, 'plugin', relative);
  assert(resolved.startsWith(path.join(root, 'plugin') + path.sep), `Path escapes plugin: ${relative}`);
  await access(resolved);
}
for (const key of ['composerIcon', 'logo']) await contained(manifest.extensions['com.openai'].interface[key]);
await contained(overlay.skills);
await contained(overlay.mcpServers);

function yaml(text, label) {
  const document = parseDocument(text, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${label}: ${document.errors.map(error => error.message).join('; ')}`);
  const value = document.toJS();
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a YAML object`);
  return value;
}
const skillText = await readFile(path.join(root, 'plugin/skills/camofox/SKILL.md'), 'utf8');
const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
assert(frontmatter, 'SKILL.md needs YAML frontmatter');
const skill = yaml(frontmatter[1], 'SKILL.md');
assert.equal(skill.name, 'camofox');
assert.equal(typeof skill.description, 'string');
assert(skill.description.trim());
const agent = yaml(await readFile(path.join(root, 'plugin/skills/camofox/agents/openai.yaml'), 'utf8'), 'openai.yaml');
assert.equal(typeof agent.interface.display_name, 'string');
assert.equal(typeof agent.interface.short_description, 'string');
assert.equal(typeof agent.interface.default_prompt, 'string');
assert.equal(typeof agent.policy.allow_implicit_invocation, 'boolean');

async function walk(relative) {
  const names = [];
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    assert(!(await lstat(path.join(root, name))).isSymbolicLink(), `Symlinks are not packaged: ${name}`);
    if (item.isDirectory()) names.push(...await walk(name)); else names.push(name);
  }
  return names;
}
const files = [...await walk('src'), ...await walk('plugin'), ...await walk('scripts')];
let syntaxCount = 0;
for (const filename of files.filter(name => name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, filename)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${filename}: ${result.stderr}`);
  syntaxCount++;
}
console.log(`Package contracts valid; checked ${syntaxCount} JavaScript files, portable/Codex manifests, skill YAML, versions, and contained paths.`);
