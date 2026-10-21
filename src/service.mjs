import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const SERVICE_IDENTITY = 'camofox-mcp';
export const SERVICE_VERSION = 1;
export const statePath = config => path.join(config.home,'service.json');

export async function safeServiceHome(config, create = false) {
  if (create) await mkdir(config.home,{recursive:true,mode:0o700});
  try {
    const stat = await lstat(config.home);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Service home cannot be a symlink or non-directory');
    if (process.getuid && stat.uid !== process.getuid()) throw new Error('Service home must belong to the current user');
    if (create) await chmod(config.home,0o700);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function readServiceState(config) {
  if (!await safeServiceHome(config)) return null;
  let file;
  try {
    const stat = await lstat(statePath(config));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Service state cannot be a symlink or non-file');
    if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Service state must be private (0600) and owned by the current user');
    file = await open(statePath(config),constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (stat.size > 16384) return {invalid:true};
    const state = JSON.parse(await file.readFile('utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) return {invalid:true};
    const browserPort = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(state.baseUrl || '');
    if (state.identity !== SERVICE_IDENTITY || state.version !== SERVICE_VERSION || !Number.isInteger(state.controlPort) || state.controlPort < 1 || state.controlPort > 65535 || !/^[a-f0-9]{64}$/.test(state.token || '') || !/^[a-f0-9]{64}$/.test(state.nonce || '') || typeof state.startupId !== 'string' || !browserPort || +browserPort[1] < 1 || +browserPort[1] > 65535) return {invalid:true};
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return {invalid:true};
    throw error;
  } finally { await file?.close(); }
}

async function boundedJson(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel(); throw new Error('Service response exceeds its byte limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Service response is empty');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {await reader.cancel();throw new Error('Service response exceeds its byte limit');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
}

async function backendHealthy(config,state) {
  if (typeof state.accessKey !== 'string' || !state.accessKey || state.accessKey.length > 4096) return false;
  try {
    const response = await fetch(`${state.baseUrl}/health`, {
      headers:{authorization:`Bearer ${state.accessKey}`}, redirect:'error',
      signal:AbortSignal.timeout(Math.min(config.requestTimeoutMs || 1000,1000)),
    });
    if (!response.ok) {await response.body?.cancel();return false;}
    const body = await boundedJson(response,Math.min(config.maxResponseBytes || 1048576,1048576));
    return body?.engine === 'camoufox' && body.ok === true;
  } catch {return false;}
}

async function control(state, method = 'GET', route = '/status') {
  const response = await fetch(`http://127.0.0.1:${state.controlPort}${route}`, {
    method,headers:{authorization:`Bearer ${state.token}`,'x-camofox-nonce':state.nonce},
    redirect:'error',signal:AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error('Control authentication failed');
  const body = await boundedJson(response,16384);
  if (body.identity !== SERVICE_IDENTITY || body.version !== SERVICE_VERSION || body.nonce !== state.nonce || body.startupId !== state.startupId || body.baseUrl !== state.baseUrl) throw new Error('Control identity challenge failed');
  return body;
}

export async function serviceStatus(config) {
  const state = await readServiceState(config);
  if (!state) return {running:false,status:'stopped',owned:false};
  if (state.invalid) return {running:false,status:'stale',owned:false};
  try { await control(state); }
  catch { return {running:false,status:'stale',owned:false}; }
  return {running:true,status:await backendHealthy(config,state) ? 'running' : 'unhealthy',owned:true,baseUrl:state.baseUrl};
}

const unhealthyError = () => new Error('Owned service backend is unhealthy. Run camofox-mcp stop, then camofox-mcp start to recover.');

const staleError = () => new Error('Stale or unverified service metadata. No process was stopped. Verify the previous service manually, preserve service.json as recovery evidence, then move it aside before restarting.');

export async function startService(config) {
  if (config.mode !== 'managed') throw new Error('Service start requires managed mode; unset CAMOFOX_BASE_URL.');
  await safeServiceHome(config,true);
  const lock = path.join(config.home,'.service-lock');
  try { await mkdir(lock,{mode:0o700}); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Service startup lock exists. Wait for the active start; after an interruption, verify no startup is active before removing .service-lock.'); throw error; }
  try {
    const previous = await serviceStatus(config);
    if (previous.status === 'unhealthy') throw unhealthyError();
    if (previous.running) return previous;
    if (previous.status === 'stale') throw staleError();
    const startupId = randomUUID(); const nonce = randomBytes(32).toString('hex'); const token = randomBytes(32).toString('hex');
    const env = {};
    for (const key of ['PATH','SystemRoot','TMP','TEMP','TMPDIR','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR']) if (process.env[key]) env[key] = process.env[key];
    env.CAMOFOX_MCP_DAEMON_BOOT = JSON.stringify({config,startupId,nonce,token});
    const child = spawn(process.execPath,[fileURLToPath(new URL('./service-daemon.mjs',import.meta.url))],{env,detached:true,stdio:['ignore','ignore','ignore'],windowsHide:true});
    let spawnError; child.on('error',error=>{spawnError=error;}); child.unref();
    const deadline = Date.now() + config.startupTimeoutMs + 3000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('Service startup failed; run camofox-mcp doctor and check the configured upstream runtime.');
      const state = await readServiceState(config);
      if (state?.startupId === startupId) {
        const status = await serviceStatus(config);
        if (status.status === 'unhealthy') throw unhealthyError();
        if (status.running) return status;
      }
      await delay(50);
    }
    // This ChildProcess is the exact daemon spawned above, never a PID read from disk.
    child.kill('SIGTERM');
    throw new Error('Service startup timed out. Run doctor; inspect preserved metadata before retrying.');
  } finally { await rm(lock,{recursive:true,force:true}); }
}

export async function stopService(config) {
  const state = await readServiceState(config);
  if (!state) return {running:false,status:'stopped',owned:false};
  if (state.invalid) throw staleError();
  try { await control(state); await control(state,'POST','/stop'); }
  catch { throw staleError(); }
  const deadline = Date.now()+16000;
  while (Date.now()<deadline) {
    const current = await readServiceState(config);
    if (!current) return {running:false,status:'stopped',owned:true};
    if (current.startupId !== state.startupId || current.nonce !== state.nonce) throw new Error('Service instance changed during shutdown; replacement was left running.');
    await delay(50);
  }
  throw new Error('Owned service shutdown timed out; inspect service metadata and retry. No PID-based termination was attempted.');
}

/** Return credentials only to internal callers after verifying the owning supervisor. */
export async function getServiceConnection(config) {
  const state = await readServiceState(config);
  if (!state) return null;
  if (state.invalid) throw staleError();
  try { await control(state); } catch { throw staleError(); }
  if (![state.accessKey,state.apiKey,state.adminKey].every(value=>typeof value === 'string' && value.length > 0 && value.length <= 4096)) throw staleError();
  if (!await backendHealthy(config,state)) throw unhealthyError();
  return {baseUrl:state.baseUrl,accessKey:state.accessKey,apiKey:state.apiKey,adminKey:state.adminKey,owned:false,close:async()=>{}};
}
