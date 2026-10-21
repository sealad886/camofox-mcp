import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, lstat, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { startService, stopService, serviceStatus, getServiceConnection, SERVICE_IDENTITY, SERVICE_VERSION } from '../src/service.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'camofox-service-'));
  const source = path.join(home,'source'); await mkdir(source);
  await copyFile(new URL('./fixtures/runtime-child.mjs',import.meta.url),path.join(source,'server.mjs'));
  await writeFile(path.join(source,'package.json'),JSON.stringify({name:'@askjo/camofox-browser',version:'1.18.1'}));
  await mkdir(path.join(source,'node_modules','playwright-core'),{recursive:true});
  await writeFile(path.join(source,'node_modules','playwright-core','package.json'),JSON.stringify({name:'playwright-core',version:'1.58.2'}));
  const config = loadConfig({CAMOFOX_MCP_HOME:home,CAMOFOX_SERVER_ENTRY:path.join(source,'server.mjs'),CAMOFOX_MCP_STARTUP_TIMEOUT_MS:'2000'});
  t.after(async()=>{ await stopService(config).catch(()=>{}); await rm(home,{recursive:true,force:true}); });
  return config;
}

test('supervisor starts, authenticates, reuses live service and stops owned browser', async t=>{
  const config = await fixture(t);
  assert.equal((await serviceStatus(config)).status,'stopped');
  const started = await startService(config);
  assert.equal(started.running,true); assert.equal(started.owned,true);
  assert.equal(JSON.stringify(started).includes('token'),false);
  const state = JSON.parse(await readFile(path.join(config.home,'service.json'),'utf8'));
  assert.equal((await lstat(path.join(config.home,'service.json'))).mode & 0o777,0o600);
  const unauth = await fetch(`http://127.0.0.1:${state.controlPort}/status`);
  assert.equal(unauth.status,401);
  assert.equal((await startService(config)).baseUrl,started.baseUrl);
  assert.equal((await serviceStatus(config)).status,'running');
  const connection = await getServiceConnection(config);
  assert.equal(connection.owned,false); assert.equal(connection.accessKey,state.accessKey);
  await connection.close();
  assert.equal((await serviceStatus(config)).running,true);
  assert.equal((await stopService(config)).running,false);
  assert.equal((await serviceStatus(config)).status,'stopped');
  await assert.rejects(fetch(`${started.baseUrl}/health`));
});

test('stale or malicious metadata never becomes remote control or PID termination', async t=>{
  const config = await fixture(t);
  await writeFile(path.join(config.home,'service.json'),JSON.stringify({identity:'other',controlPort:1234,pid:process.pid,baseUrl:'https://example.com',token:'x',nonce:'x',startupId:'x'}),{mode:0o600});
  assert.equal((await serviceStatus(config)).status,'stale');
  await assert.rejects(startService(config),/stale|unverified/i);
  await assert.rejects(stopService(config),/stale|unverified/i);
  assert.equal(JSON.parse(await readFile(path.join(config.home,'service.json'),'utf8')).pid,process.pid);
});

test('symlink metadata and duplicate-start lock are refused', async t=>{
  const config = await fixture(t); const target = path.join(config.home,'private-target');
  await writeFile(target,'{}'); await symlink(target,path.join(config.home,'service.json'));
  await assert.rejects(serviceStatus(config),/symlink/i);
  await rm(path.join(config.home,'service.json'));
  await mkdir(path.join(config.home,'.service-lock'));
  await assert.rejects(startService(config),/lock/i);
});

test('non-ASCII credentials cannot crash the supervisor', async t=>{
  const config = await fixture(t); await startService(config);
  const state = JSON.parse(await readFile(path.join(config.home,'service.json'),'utf8'));
  const response = await fetch(`http://127.0.0.1:${state.controlPort}/status`,{headers:{authorization:`Bearer ${'é'.repeat(64)}`,'x-camofox-nonce':state.nonce}});
  assert.equal(response.status,401); assert.equal((await serviceStatus(config)).running,true);
});

test('invalid JSON values remain stale recovery evidence', async t=>{
  const config = await fixture(t);
  await writeFile(path.join(config.home,'service.json'),'null',{mode:0o600});
  assert.equal((await serviceStatus(config)).status,'stale');
  await assert.rejects(getServiceConnection(config),/stale|unverified/i);
});

async function controlledSupervisor(t, config, backend) {
  const state = {
    identity:SERVICE_IDENTITY, version:SERVICE_VERSION, nonce:'a'.repeat(64), token:'b'.repeat(64),
    startupId:'test-supervisor', baseUrl:backend, accessKey:'browser-access', apiKey:'cookie-access', adminKey:'admin-access',
  };
  let stopRequests = 0;
  const server = http.createServer((req,res)=>{
    if (req.headers.authorization !== `Bearer ${state.token}` || req.headers['x-camofox-nonce'] !== state.nonce) {res.writeHead(401);res.end('{}');return;}
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(state));
    if (req.method === 'POST' && req.url === '/stop') {
      stopRequests++;
      void rm(path.join(config.home,'service.json')).then(()=>server.close());
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  state.controlPort = server.address().port;
  await writeFile(path.join(config.home,'service.json'),JSON.stringify(state),{mode:0o600});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {state,get stopRequests(){return stopRequests;}};
}

test('a verified supervisor with a dead browser is unhealthy, cannot be borrowed, and remains stoppable', async t=>{
  const config = await fixture(t);
  const backend = http.createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer browser-access');
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ok:true,engine:'camoufox'}));
  });
  backend.listen(0,'127.0.0.1'); await once(backend,'listening');
  t.after(()=>new Promise(resolve=>backend.close(resolve)));
  const baseUrl = `http://127.0.0.1:${backend.address().port}`;
  const supervisor = await controlledSupervisor(t,config,baseUrl);
  assert.equal((await serviceStatus(config)).status,'running');
  assert.equal((await getServiceConnection(config)).baseUrl,baseUrl);
  await new Promise(resolve=>backend.close(resolve));
  assert.deepEqual(await serviceStatus(config),{running:true,status:'unhealthy',owned:true,baseUrl});
  await assert.rejects(getServiceConnection(config),/unhealthy.*stop.*start/i);
  await assert.rejects(startService(config),/unhealthy.*stop.*start/i);
  assert.equal(supervisor.stopRequests,0);
  assert.equal((await stopService(config)).status,'stopped');
  assert.equal(supervisor.stopRequests,1);
});

test('supervisor backend health requires the expected engine, ok state, and bounded payload', async t=>{
  const config = await fixture(t);
  config.maxResponseBytes = 2 * 1024 * 1024;
  let health = {ok:true,engine:'other'};
  const backend = http.createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer browser-access');
    res.setHeader('content-type','application/json');
    // Streaming deliberately omits Content-Length so the byte bound must apply while reading.
    const text = JSON.stringify(health);
    res.write(text.slice(0,10)); res.end(text.slice(10));
  });
  backend.listen(0,'127.0.0.1'); await once(backend,'listening');
  t.after(()=>new Promise(resolve=>backend.close(resolve)));
  const baseUrl = `http://127.0.0.1:${backend.address().port}`;
  await controlledSupervisor(t,config,baseUrl);
  for (const payload of [{ok:true,engine:'other'},{ok:false,engine:'camoufox'},{ok:true,engine:'camoufox',padding:'x'.repeat(1024*1024)}]) {
    health = payload;
    assert.equal((await serviceStatus(config)).status,'unhealthy');
    await assert.rejects(getServiceConnection(config),/unhealthy.*stop.*start/i);
  }
  health = {ok:true,engine:'camoufox'};
  assert.equal((await serviceStatus(config)).status,'running');
  assert.equal((await getServiceConnection(config)).baseUrl,baseUrl);
  assert.equal((await stopService(config)).status,'stopped');
});
