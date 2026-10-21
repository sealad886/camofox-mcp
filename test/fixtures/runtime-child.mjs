import http from 'node:http';
import { spawn } from 'node:child_process';
const mode = process.env.PROXY_CITY;
if (mode === 'exit') { console.error(`startup failed ${process.env.CAMOFOX_ACCESS_KEY}`); process.exit(12); }
let descendantPort;
if (mode === 'descendant') {
  const child = spawn(process.execPath,['-e',"const server=require('http').createServer((req,res)=>{res.end('alive');if(req.url==='/stop')server.close(()=>process.exit(0));}).listen(0,'127.0.0.1',function(){process.send(this.address().port)})"],{stdio:['ignore','ignore','ignore','ipc'],detached:true});
  descendantPort = await new Promise(resolve=>child.once('message',resolve));
}
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') return res.end(JSON.stringify({ ok: true, engine: mode === 'foreign' ? 'other' : 'camoufox', browserRunning: false }));
  if (req.url === '/tabs' && req.method === 'POST' && mode === 'verify-setup') {
    let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',()=>{
      if (!JSON.parse(body).url.startsWith('http://127.0.0.1:')) {res.statusCode=400;res.end(JSON.stringify({error:'Blocked URL scheme: only http/https allowed'}));}
      else res.end(JSON.stringify({tabId:'verified-tab'}));
    }); return;
  }
  if (req.url === '/env') return res.end(JSON.stringify({host: process.env.CAMOFOX_BIND_HOST, telemetry: process.env.CAMOFOX_CRASH_REPORT_ENABLED, profile: process.env.CAMOFOX_PROFILE_DIR, auth: Boolean(process.env.CAMOFOX_ACCESS_KEY), descendantPort}));
  res.end('{}');
});
setTimeout(() => server.listen(Number(process.env.CAMOFOX_PORT), process.env.CAMOFOX_BIND_HOST), mode === 'delay' ? 200 : 0);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
