import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { ensureRuntime, runtimeStatus, setupRuntime, uninstallRuntime } from '../src/runtime.mjs';

async function driverFixture(root,version='1.58.2') {
  const directory=path.join(root,'node_modules','playwright-core'); await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name:'playwright-core',version}));
}

async function fixture(t, mode) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'camofox-runtime-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const source = path.join(home, 'source'); await mkdir(source);
  await copyFile(new URL('./fixtures/runtime-child.mjs', import.meta.url), path.join(source, 'server.mjs'));
  await writeFile(path.join(source, 'package.json'), JSON.stringify({name:'@askjo/camofox-browser',version:'1.18.1'}));
  await driverFixture(source);
  return loadConfig({CAMOFOX_MCP_HOME:home,CAMOFOX_SERVER_ENTRY:path.join(source,'server.mjs'),CAMOFOX_MCP_STARTUP_TIMEOUT_MS:'1000',PROXY_CITY: mode || ''});
}

test('managed lifecycle starts once, uses private settings and stops its child', async t => {
  const config = await fixture(t);
  const [a,b] = await Promise.all([ensureRuntime(config),ensureRuntime(config)]);
  t.after(() => a.close());
  assert.equal(a,b); assert.equal(a.owned,true);
  const settings = await (await fetch(`${a.baseUrl}/env`)).json();
  assert.equal(settings.host,'127.0.0.1'); assert.equal(settings.telemetry,'false'); assert.equal(settings.auth,true);
  assert.ok(settings.profile.startsWith(config.home));
  await a.close(); await assert.rejects(fetch(`${a.baseUrl}/health`));
});

test('delayed readiness succeeds and foreign services fail startup', async t => {
  const delayed = await ensureRuntime(await fixture(t,'delay')); await delayed.close();
  await assert.rejects(ensureRuntime(await fixture(t,'foreign')), /readiness|engine/i);
});

test('startup failure is bounded and secrets are redacted', async t => {
  const config = await fixture(t,'exit'); config.accessKey = 'secret-do-not-report';
  await assert.rejects(ensureRuntime(config), error => /startup|exited/i.test(error.message) && !error.message.includes(config.accessKey));
});

test('connect borrows service without owning or stopping it', async () => {
  const config = loadConfig({CAMOFOX_BASE_URL:'http://127.0.0.1:9377'});
  const runtime = await ensureRuntime(config); assert.equal(runtime.owned,false); await runtime.close();
});

test('missing runtime fails with setup instructions; status does not install', async t => {
  const config = await fixture(t); delete config.serverEntry; config.discoverSystem = false;
  await assert.rejects(ensureRuntime(config), /setup/);
  const status = await runtimeStatus(config); assert.equal(status.installed,false);
});

test('setup writes a pinned installation then uninstall preserves profiles', async t => {
  const config = await fixture(t); delete config.serverEntry; config.discoverSystem = false;
  const calls = [];
  const runCommand = async (command,args,options) => {
    calls.push({command,args});
    if (args.includes('install')) {
      const root = path.join(options.cwd,'node_modules/@askjo/camofox-browser');
      await mkdir(path.join(root,'lib'),{recursive:true});
      await writeFile(path.join(root,'package.json'),JSON.stringify({name:'@askjo/camofox-browser',version:'1.18.1'}));
      await driverFixture(root);
      await copyFile(new URL('./fixtures/runtime-child.mjs',import.meta.url),path.join(root,'server.js'));
    }
  };
  await setupRuntime(config,{runCommand,verifyBrowser:false});
  assert.ok(calls.some(call=>call.args.includes('@askjo/camofox-browser@1.18.1')));
  assert.equal((await runtimeStatus(config)).installed,true);
  await mkdir(path.join(config.home,'profiles'),{recursive:true});
  await writeFile(path.join(config.home,'profiles','saved.json'),'login');
  await uninstallRuntime(config);
  assert.equal(await readFile(path.join(config.home,'profiles','saved.json'),'utf8'),'login');
  assert.equal((await runtimeStatus(config)).installed,false);
});

test('setup reuses compatible explicit source and retries component download after interruption', async t => {
  const config = await fixture(t); const calls = [];
  await setupRuntime(config,{runCommand:async(command,args)=>calls.push(args),verifyBrowser:false});
  assert.equal(calls.some(args=>args.includes('install')),false);
  assert.equal(calls.filter(args=>args[0].endsWith('camoufox-download.js')).length,1);
});

test('setup failure cleans staging and lock, preserves profile data and can retry', async t => {
  const config = await fixture(t); delete config.serverEntry; config.discoverSystem = false;
  await mkdir(path.join(config.home,'profiles')); await writeFile(path.join(config.home,'profiles','retained'),'session');
  await assert.rejects(setupRuntime(config,{runCommand:async()=>{throw new Error('network unavailable');},verifyBrowser:false}),/network unavailable/);
  await assert.rejects(access(path.join(config.home,'.runtime-lock')));
  assert.equal(await readFile(path.join(config.home,'profiles','retained'),'utf8'),'session');
});

test('uninstall rejects unowned installations', async t => {
  const config = await fixture(t);
  await mkdir(path.join(config.home,'runtime')); await writeFile(path.join(config.home,'runtime','user-data'),'keep');
  await assert.rejects(uninstallRuntime(config),/ownership marker/);
  assert.equal(await readFile(path.join(config.home,'runtime','user-data'),'utf8'),'keep');
});

test('failed component setup never activates a candidate runtime', async t => {
  const config = await fixture(t); delete config.serverEntry; config.discoverSystem = false;
  const runCommand = async (command,args,options) => {
    if (!args.includes('install')) throw new Error('component download interrupted');
    const root = path.join(options.cwd,'node_modules/@askjo/camofox-browser');
    await mkdir(root,{recursive:true});
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'@askjo/camofox-browser',version:'1.18.1'}));
    await driverFixture(root);
    await copyFile(new URL('./fixtures/runtime-child.mjs',import.meta.url),path.join(root,'server.js'));
  };
  await assert.rejects(setupRuntime(config,{runCommand,verifyBrowser:false}),/component download interrupted/);
  assert.equal((await runtimeStatus(config)).installed,false);
  await assert.rejects(access(path.join(config.home,'runtime')));
});

test('owned process-group cleanup stops descendants even when upstream leader exits first', async t => {
  const runtime = await ensureRuntime(await fixture(t,'descendant')); t.after(()=>runtime.close());
  const {descendantPort} = await (await fetch(`${runtime.baseUrl}/env`)).json();
  t.after(()=>fetch(`http://127.0.0.1:${descendantPort}/stop`).catch(()=>{}));
  assert.equal(await (await fetch(`http://127.0.0.1:${descendantPort}`)).text(),'alive');
  await runtime.close();
  await assert.rejects(fetch(`http://127.0.0.1:${descendantPort}`));
});

test('setup browser probe uses upstream-supported HTTP navigation', async t=>{
  const config = await fixture(t,'verify-setup');
  const result = await setupRuntime(config,{runCommand:async()=>{}});
  assert.equal(result.installed,true);
});

test('cross-process runtime leases prevent setup and uninstall until owner closes', async t=>{
  const config=await fixture(t); const runtime=await ensureRuntime(config); t.after(()=>runtime.close());
  const other={...config};
  await assert.rejects(uninstallRuntime(other),/active|lease/i);
  await assert.rejects(setupRuntime(other,{runCommand:async()=>{},verifyBrowser:false}),/active|lease/i);
  await runtime.close();
  assert.equal((await uninstallRuntime(other)).removed,false);
});

test('stale runtime leases remain blocking recovery evidence', async t=>{
  const config=await fixture(t); await mkdir(path.join(config.home,'leases','stale-owner'),{recursive:true});
  await assert.rejects(uninstallRuntime(config),/lease.*recover|recover.*lease/i);
  await assert.rejects(setupRuntime(config,{runCommand:async()=>{},verifyBrowser:false}),/lease.*recover|recover.*lease/i);
  await access(path.join(config.home,'leases','stale-owner'));
});

test('startup cannot race an active setup/uninstall mutation lock', async t=>{
  const config=await fixture(t); await mkdir(path.join(config.home,'.runtime-lock'));
  await assert.rejects(ensureRuntime(config),/lock|setup\/uninstall/i);
  const {readdir}=await import('node:fs/promises');
  assert.deepEqual(await readdir(path.join(config.home,'leases')),[]);
});

test('incompatible installed browser driver cannot be reused', async t=>{
  const config=await fixture(t); await driverFixture(path.dirname(config.serverEntry),'1.64.1');
  await assert.rejects(ensureRuntime(config),/playwright-core@1\.58\.2/);
  assert.equal((await runtimeStatus(config)).installed,false);
});

test('runtime status reports the tested resolved driver including deduped installs', async t=>{
  const config=await fixture(t); await rm(path.join(path.dirname(config.serverEntry),'node_modules'),{recursive:true});
  await driverFixture(config.home);
  assert.equal((await runtimeStatus(config)).driverVersion,'1.58.2');
});

test('setup pins the tested browser protocol driver in npm overrides', async t=>{
  const config=await fixture(t); delete config.serverEntry;config.discoverSystem=false;
  const runCommand=async(command,args,options)=>{
    if (!args.includes('install')) return;
    const manifest=JSON.parse(await readFile(path.join(options.cwd,'package.json'),'utf8'));
    assert.equal(manifest.overrides?.['playwright-core'],'1.58.2');
    const root=path.join(options.cwd,'node_modules/@askjo/camofox-browser'); await mkdir(root,{recursive:true});
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'@askjo/camofox-browser',version:'1.18.1'}));
    await driverFixture(options.cwd);
    await copyFile(new URL('./fixtures/runtime-child.mjs',import.meta.url),path.join(root,'server.js'));
  };
  await setupRuntime(config,{runCommand,verifyBrowser:false});
  assert.equal((await runtimeStatus(config)).driverVersion,'1.58.2');
});
