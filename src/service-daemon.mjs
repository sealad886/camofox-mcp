import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { ensureRuntime } from './runtime.mjs';
import { readServiceState, safeServiceHome, SERVICE_IDENTITY, SERVICE_VERSION, statePath } from './service.mjs';

const boot = JSON.parse(process.env.CAMOFOX_MCP_DAEMON_BOOT || 'null');
delete process.env.CAMOFOX_MCP_DAEMON_BOOT;
if (!boot?.config || !boot.startupId || !boot.nonce || !boot.token) throw new Error('Service daemon requires an authenticated launcher');
const {config,startupId,nonce,token} = boot;
let runtime; let runtimePromise; let server; let stopping;
async function shutdown() {
  if (stopping) return stopping;
  stopping = (async()=>{
    const owned = runtime || await runtimePromise?.catch(()=>null);
    await owned?.close();
    if (server?.listening) await new Promise(resolve=>server.close(resolve));
    const state = await readServiceState(config).catch(()=>null);
    if (state?.startupId === startupId && state.nonce === nonce) await rm(statePath(config));
  })();
  return stopping;
}
for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,()=>{shutdown().then(()=>process.exit(0),()=>process.exit(1));});
function equal(a,b) {
  if (typeof a !== 'string') return false;
  const actual = Buffer.from(a); const expected = Buffer.from(b);
  return actual.length === expected.length && timingSafeEqual(actual,expected);
}
for (const event of ['uncaughtException','unhandledRejection']) process.on(event,()=>{shutdown().finally(()=>process.exit(1));});
try {
  await safeServiceHome(config,true);
  runtimePromise = ensureRuntime(config);
  runtime = await runtimePromise;
  if (stopping) { await stopping; process.exit(0); }
  const payload = {identity:SERVICE_IDENTITY,version:SERVICE_VERSION,nonce,startupId,baseUrl:runtime.baseUrl};
  server = http.createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if (!equal(req.headers.authorization,`Bearer ${token}`) || !equal(req.headers['x-camofox-nonce'],nonce)) {res.writeHead(401);res.end('{}');return;}
    if (req.method === 'GET' && req.url === '/status') {res.end(JSON.stringify(payload));return;}
    if (req.method === 'POST' && req.url === '/stop') {
      res.end(JSON.stringify(payload));
      setImmediate(()=>shutdown().then(()=>process.exit(0),()=>process.exit(1)));return;
    }
    res.writeHead(404);res.end('{}');
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000; server.keepAliveTimeout = 100;
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const state = {...payload,controlPort:server.address().port,token,accessKey:runtime.accessKey,apiKey:runtime.apiKey,adminKey:runtime.adminKey};
  const file = await open(statePath(config),'wx',0o600);
  try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
} catch {
  await shutdown().catch(()=>{}); process.exitCode = 1;
}
