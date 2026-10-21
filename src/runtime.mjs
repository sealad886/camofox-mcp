import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { UPSTREAM_VERSION, PLAYWRIGHT_VERSION } from './config.mjs';

const pending = new WeakMap();
const execFileAsync = promisify(execFile);
const installationName = '@askjo/camofox-browser';
const runtimeDir = config => path.join(config.home, 'runtime');
const packageRoot = directory => path.join(directory, 'node_modules', '@askjo', 'camofox-browser');

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function resolvedDriverVersion(entry) {
  try {
    const manifestPath = createRequire(entry).resolve('playwright-core/package.json');
    return JSON.parse(await readFile(manifestPath,'utf8')).version;
  } catch { return undefined; }
}

async function compatible(entry) {
  try {
    const manifest = JSON.parse(await readFile(path.join(path.dirname(entry), 'package.json'), 'utf8'));
    return manifest.name === installationName && manifest.version === UPSTREAM_VERSION && await resolvedDriverVersion(entry) === PLAYWRIGHT_VERSION && await exists(entry);
  } catch { return false; }
}

async function resolveEntry(config) {
  if (config.serverEntry) {
    if (!await compatible(config.serverEntry)) throw new Error(`CAMOFOX_SERVER_ENTRY must reference ${installationName}@${UPSTREAM_VERSION} with playwright-core@${PLAYWRIGHT_VERSION}; unset this override and run camofox-mcp setup`);
    return config.serverEntry;
  }
  const managed = path.join(packageRoot(runtimeDir(config)), 'server.js');
  if (await compatible(managed)) return managed;
  if (config.discoverSystem !== false) {
    for (const prefix of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew']) {
      const entry = path.join(prefix, 'opt', 'camofox-browser', 'libexec', 'lib', 'node_modules', '@askjo', 'camofox-browser', 'server.js');
      if (await compatible(entry)) return entry;
    }
  }
  throw new Error('Camofox runtime is missing. Run camofox-mcp setup before starting MCP.');
}

async function privateDirectories(config) {
  for (const directory of [config.home, config.artifactDir, config.uploadsDir, config.cookiesDir, path.join(config.home, 'profiles'), path.join(config.home, 'traces'), path.join(config.home, 'browser-home')]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
}

function environment(config) {
  // Do not pass provider tokens, application secrets, Sentry or arbitrary NODE_OPTIONS to upstream.
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env, ...config.upstreamEnv,
    HOME: path.join(config.home, 'browser-home'),
    USERPROFILE: path.join(config.home, 'browser-home'),
    XDG_CACHE_HOME: path.join(config.home, 'browser-home', '.cache'),
    LOCALAPPDATA: path.join(config.home, 'browser-home', 'AppData', 'Local'),
    CAMOFOX_BIND_HOST: '127.0.0.1', CAMOFOX_CRASH_REPORT_ENABLED: 'false',
    CAMOFOX_INTERACTIVE: 'off', ENABLE_VNC: 'false', SENTRY_DSN: '',
    CAMOFOX_PROFILE_DIR: path.join(config.home, 'profiles'),
    CAMOFOX_TRACES_DIR: path.join(config.home, 'traces'),
    CAMOFOX_TRACES_MAX_BYTES: String(50 * 1024 * 1024), CAMOFOX_TRACES_TTL_HOURS: '24',
    CAMOFOX_UPLOADS_DIR: config.uploadsDir, CAMOFOX_COOKIES_DIR: config.cookiesDir,
    MAX_SESSIONS: String(config.maxSessions), MAX_TABS_PER_SESSION: String(config.maxTabsPerSession), MAX_TABS_GLOBAL: String(config.maxTabsGlobal),
  };
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function redact(text, secrets) {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

async function processRows() {
  const {stdout} = await execFileAsync('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=,comm='],{timeout:2000,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,LC_ALL:'C'}});
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(line);
    return match ? [{pid:+match[1],ppid:+match[2],pgid:+match[3],started:match[4].replace(/\s+/g,' '),command:match[5]}] : [];
  });
}

async function birthIdentity(record) {
  if (process.platform !== 'linux') return `${record.started} ${record.command}`;
  try {
    const stat = await readFile(`/proc/${record.pid}/stat`,'utf8');
    const startTime = stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
    return startTime ? `${startTime} ${record.command}` : null;
  } catch { return null; }
}

async function ownedProcessSnapshot(child) {
  if (process.platform === 'win32' || !Number.isInteger(child.pid)) return [];
  const rows = await processRows();
  if (child.exitCode !== null || child.signalCode !== null || !rows.some(row=>row.pid === child.pid)) return [];
  const ids = new Set([child.pid]);
  let added;
  do {
    added = false;
    for (const row of rows) if (!ids.has(row.pid) && ids.has(row.ppid)) {ids.add(row.pid);added=true;}
  } while (added);
  return Promise.all(rows.filter(row=>ids.has(row.pid)).map(async row=>({...row,identity:await birthIdentity(row)})));
}

async function terminate(child) {
  const running = child.exitCode === null && child.signalCode === null;
  // An exited ChildProcess no longer proves that its numeric PID still identifies our process.
  if (!running) return;
  // Browser engines create their own process groups. Capture descendants before their parent exits.
  let snapshot = []; let snapshotError;
  try { snapshot = await ownedProcessSnapshot(child); } catch (error) { snapshotError = error; }
  const stillRunning = child.exitCode === null && child.signalCode === null;
  const exited = stillRunning ? once(child, 'exit').catch(() => {}) : Promise.resolve();
  if (stillRunning) {
    // Upstream gets ten seconds to checkpoint profiles and close the browser.
    child.kill('SIGTERM');
    const timer = new AbortController();
    await Promise.race([exited, delay(12000, undefined, {signal: timer.signal}).catch(() => {})]);
    timer.abort();
  }
  if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
    if (snapshot.length) {
      const current = new Map((await processRows()).map(row=>[row.pid,row]));
      for (const observed of snapshot.reverse()) {
        const now = current.get(observed.pid);
        if (!now || observed.pid <= 1 || !observed.identity || observed.identity !== await birthIdentity(now)) continue;
        // Groups are targeted only when their verified descendant is still the group leader.
        const target = now.pgid === observed.pid && observed.pgid === observed.pid ? -observed.pid : observed.pid;
        try { process.kill(target,'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
  if (snapshotError) throw new Error('Camofox stopped, but detached browser cleanup could not verify process ownership. Inspect remaining browser processes before restarting.');
}

export async function ensureRuntime(config, options = {}) {
  if (config.mode === 'connect') return { baseUrl: config.baseUrl, accessKey: config.accessKey, apiKey: config.apiKey, adminKey: config.adminKey, owned: false, close: async () => {} };
  if (pending.has(config)) return pending.get(config);
  const operation = startManaged(config, options);
  pending.set(config, operation);
  try { return await operation; } catch (error) { pending.delete(config); throw error; }
}

async function acquireRuntimeLease(config, {_setupVerification = false} = {}) {
  const directory = path.join(config.home,'leases');
  await mkdir(directory,{recursive:true,mode:0o700});
  const lease = path.join(directory,randomUUID());
  await mkdir(lease,{mode:0o700});
  try {
    await writeFile(path.join(lease,'owner.json'),JSON.stringify({identity:'camofox-mcp',createdAt:new Date().toISOString()}),{mode:0o600});
    if (!_setupVerification && await exists(path.join(config.home,'.runtime-lock'))) throw new Error('Runtime setup/uninstall is active. Wait for the mutation lock to clear before starting a browser.');
    return () => rm(lease,{recursive:true,force:true});
  } catch (error) { await rm(lease,{recursive:true,force:true}); throw error; }
}

async function assertNoRuntimeLeases(config) {
  const directory = path.join(config.home,'leases');
  let leases;
  try { leases = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (leases.length) throw new Error(`Runtime lease blocks setup/uninstall (${leases.length} active or interrupted owner). Close the owning runtime. For crash recovery, verify no browser is active and preserve then move the stale lease directories from ${directory}; no PID-based recovery is attempted.`);
}

async function startManaged(config, options) {
  await privateDirectories(config);
  const release = await acquireRuntimeLease(config,options);
  try {
    const runtime = await launchManaged(config);
    const close = runtime.close;
    runtime.close = async () => { await close(); await release(); };
    return runtime;
  } catch (error) { await release(); throw error; }
}

async function launchManaged(config) {
  const entry = await resolveEntry(config);
  await privateDirectories(config);
  const accessKey = config.accessKey || randomBytes(32).toString('hex');
  const apiKey = config.apiKey || randomBytes(32).toString('hex');
  const adminKey = config.adminKey || randomBytes(32).toString('hex');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry), env: {...environment(config), CAMOFOX_PORT: String(port), CAMOFOX_ACCESS_KEY: accessKey, CAMOFOX_API_KEY: apiKey, CAMOFOX_ADMIN_KEY: adminKey},
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  let tail = ''; let spawnError;
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { tail = (tail + chunk.toString()).slice(-8192); });
  const secrets = [accessKey, apiKey, adminKey, config.upstreamEnv?.PROXY_PASSWORD, config.upstreamEnv?.PROXY_USERNAME];
  const deadline = Date.now() + config.startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Camofox startup exited${spawnError ? ': process could not start' : ''}: ${redact(tail, secrets)}`);
      }
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(Math.min(500, config.startupTimeoutMs)), redirect: 'error' });
        if (response.ok) {
          const health = await response.json();
          if (health.engine !== 'camoufox') throw new Error('Unexpected service engine at Camofox readiness endpoint');
          if (health.ok === true) {
            let closed;
            return { baseUrl, accessKey, apiKey, adminKey, owned: true, close() {
              if (!closed) closed = terminate(child).finally(() => pending.delete(config));
              return closed;
            } };
          }
        }
      } catch (error) {
        if (error.message.includes('Unexpected service engine')) throw error;
      }
      await delay(50);
    }
    throw new Error(`Camofox readiness timed out. Run camofox-mcp doctor. ${redact(tail, secrets)}`);
  } catch (error) {
    await terminate(child); throw error;
  }
}

async function runProcess(command, args, options) {
  const child = spawn(command, args, {...options, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true});
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Runtime setup command failed (${path.basename(command)}, exit ${code}). Check Node >=22, npm, network access and native build prerequisites; rerun setup.`);
}

async function mutationLock(config, operation) {
  await mkdir(config.home, {recursive: true, mode: 0o700});
  const lock = path.join(config.home, '.runtime-lock');
  try { await mkdir(lock, {mode: 0o700}); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Runtime setup/uninstall already locked. Wait for the other command; after an interrupted setup, verify no setup is running then remove .runtime-lock and retry.');
    throw error;
  }
  try { await assertNoRuntimeLeases(config); return await operation(); } finally { await rm(lock, {recursive: true, force: true}); }
}

async function verifyBrowser(config) {
  const runtime = await ensureRuntime(config,{_setupVerification:true});
  let tabId;
  try {
    const response = await fetch(`${runtime.baseUrl}/tabs`, {
      method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${runtime.accessKey}`},
      body: JSON.stringify({userId: config.userId, sessionKey: config.sessionKey, url: `${runtime.baseUrl}/health`}),
      signal: AbortSignal.timeout(config.requestTimeoutMs), redirect: 'error',
    });
    const body = await response.json().catch(()=>({error:'Runtime returned an invalid JSON response'}));
    if (!response.ok || !(body.tabId || body.id)) {
      const reason = redact(String(body.error || body.message || 'Runtime did not return a tab identifier').slice(0,2000),[runtime.accessKey,runtime.apiKey,runtime.adminKey,config.upstreamEnv?.PROXY_PASSWORD,config.upstreamEnv?.PROXY_USERNAME]);
      throw new Error(`Installed server could not launch browser (HTTP ${response.status}): ${reason}. Check system libraries and CAMOUFOX_EXECUTABLE; run doctor.`);
    }
    tabId = body.tabId || body.id;
  } finally {
    if (tabId) await fetch(`${runtime.baseUrl}/tabs/${encodeURIComponent(tabId)}?userId=${encodeURIComponent(config.userId)}`, {method: 'DELETE', headers: {authorization: `Bearer ${runtime.accessKey}`}, signal: AbortSignal.timeout(5000)}).catch(() => {});
    await runtime.close();
  }
}

export async function setupRuntime(config, {runCommand = runProcess, verifyBrowser: verify = true, onProgress} = {}) {
  const progress = onProgress || (message => { if (runCommand === runProcess) process.stderr.write(`[camofox-mcp setup] ${message}\n`); });
  if (config.mode === 'connect') throw new Error('Connect mode uses an existing server; unset CAMOFOX_BASE_URL to install a managed runtime.');
  if (process.platform === 'win32') throw new Error('Managed setup supports macOS and Linux. On Windows, use CAMOFOX_BASE_URL with an existing Camofox service.');
  await privateDirectories(config);
  return mutationLock(config, async () => {
    progress('Checking upstream server and tested browser driver');
    let entry;
    if (config.serverEntry) entry = await resolveEntry(config);
    else { try { entry = await resolveEntry(config); } catch {} }
    const prepare = async sourceEntry => {
      // Retrying setup repairs interrupted browser component downloads in private storage.
      if (config.upstreamEnv?.CAMOUFOX_EXECUTABLE) {
        progress('Checking explicitly configured browser executable');
        await access(config.upstreamEnv.CAMOUFOX_EXECUTABLE);
      } else {
        progress('Downloading tested browser, addons, and geographic data');
        await runCommand(process.execPath, [path.join(path.dirname(sourceEntry), 'lib', 'camoufox-download.js')], {cwd:path.dirname(sourceEntry), env:environment(config)});
      }
      if (verify) { progress('Verifying real browser launch'); await verifyBrowser({...config,serverEntry:sourceEntry}); }
    };
    if (!entry) {
      if (await exists(runtimeDir(config))) throw new Error('Existing runtime is incomplete or incompatible. Run camofox-mcp uninstall to remove the owned installation, then setup. Profiles are preserved.');
      const staging = path.join(config.home, `.runtime-stage-${randomUUID()}`);
      await mkdir(staging, {mode: 0o700});
      try {
        await writeFile(path.join(staging, 'package.json'), JSON.stringify({name:'camofox-managed-runtime',private:true,version:'1.0.0',overrides:{'playwright-core':PLAYWRIGHT_VERSION}}), {mode:0o600});
        const env = {...environment(config), CAMOFOX_SKIP_DOWNLOAD: '1', npm_config_audit:'false', npm_config_fund:'false'};
        progress(`Installing ${installationName}@${UPSTREAM_VERSION} and playwright-core@${PLAYWRIGHT_VERSION} (native modules may compile)`);
        await runCommand('npm', ['install', '--omit=dev', '--save-exact', `${installationName}@${UPSTREAM_VERSION}`], {cwd:staging, env});
        const candidate = path.join(packageRoot(staging), 'server.js');
        if (!await compatible(candidate)) throw new Error('Installed upstream package does not match pinned runtime contract');
        await prepare(candidate);
        await writeFile(path.join(staging, '.camofox-mcp-owned.json'), JSON.stringify({package:installationName,version:UPSTREAM_VERSION,driverVersion:PLAYWRIGHT_VERSION}), {mode:0o600});
        progress('Activating verified runtime');
        await rename(staging, runtimeDir(config));
      } finally { await rm(staging, {recursive:true,force:true}); }
    } else await prepare(entry);
    progress('Setup verified');
    return runtimeStatus(config);
  });
}

export async function runtimeStatus(config) {
  if (config.mode === 'connect') {
    try {
      const response = await fetch(`${config.baseUrl}/health`, {signal:AbortSignal.timeout(3000),redirect:'error'});
      const health = await response.json();
      return {mode:'connect',baseUrl:config.baseUrl,owned:false,reachable:response.ok && health.engine === 'camoufox' && health.ok === true,browserRunning:health.browserRunning === true};
    } catch { return {mode:'connect',baseUrl:config.baseUrl,owned:false,reachable:false}; }
  }
  let entry;
  try { entry = await resolveEntry(config); } catch {}
  return {mode:'managed',installed:Boolean(entry),upstreamVersion:UPSTREAM_VERSION,driverVersion:entry ? await resolvedDriverVersion(entry) : undefined,requiredDriverVersion:PLAYWRIGHT_VERSION,serverEntry:entry,home:config.home,active:pending.has(config),managedDirectory:runtimeDir(config)};
}

export async function uninstallRuntime(config) {
  if (pending.has(config)) throw new Error('Stop the active runtime before uninstalling.');
  return mutationLock(config, async () => {
    const directory = runtimeDir(config);
    if (!await exists(directory)) return {removed:false,profilesPreserved:true};
    let marker;
    try { marker = JSON.parse(await readFile(path.join(directory,'.camofox-mcp-owned.json'),'utf8')); } catch {}
    if (marker?.package !== installationName) throw new Error('Refusing to remove runtime without plugin ownership marker');
    await rm(directory,{recursive:true,force:true});
    return {removed:true,profilesPreserved:true};
  });
}
