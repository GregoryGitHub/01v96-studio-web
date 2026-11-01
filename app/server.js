'use strict';
// Local web server: serves the UI and bridges WebSocket clients to the 01V96.
//   PORT (default 8096), MIDI_PORT (regex, default "01V96(i)?-1")
//   NO_SUPERVISOR=1 runs the server in this process without auto-restart.

// Supervisor: the MIDI driver can take the process down from native code (e.g.
// a WinMM failure while the USB link hiccups), so the real server runs as a
// child that is restarted automatically. Exit code 2 = do not restart.
if (!process.env.MIXER_WORKER && !process.env.NO_SUPERVISOR) {
  const { fork } = require('child_process');
  let child = null, quick = 0, stopping = false;
  const start = () => {
    const t0 = Date.now();
    child = fork(__filename, process.argv.slice(2), { env: { ...process.env, MIXER_WORKER: '1' } });
    child.on('exit', (code, signal) => {
      if (stopping || code === 2) process.exit(code || 0);
      quick = Date.now() - t0 < 10000 ? quick + 1 : 0;
      const delay = Math.min(10000, 1000 * 2 ** Math.min(quick, 3));
      console.error(`[supervisor] servidor saiu (code ${code}, signal ${signal}); reiniciando em ${delay / 1000}s`);
      setTimeout(start, delay);
    });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; child?.kill(sig); });
  start();
  return;
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Console01V96 } = require('./lib/console');

const PORT = +process.env.PORT || 8096;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

const mixer = new Console01V96({ portMatch: process.env.MIDI_PORT ? new RegExp(process.env.MIDI_PORT, 'i') : undefined });

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Liveness probe for the desktop launcher and the PWA.
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ app: '01v96-web-mixer', ...mixer.status() }));
    return;
  }
  const base = url.startsWith('/data/') ? DATA : PUBLIC;
  const rel = url.startsWith('/data/') ? url.slice(6) : (url === '/' ? 'index.html' : url.slice(1));
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c !== except && c.readyState === 1) c.send(s);
}

// Coalesce parameter updates into one frame per ~16 ms.
let pending = new Map();
let flushTimer = null;
mixer.on('param', (k, v, source) => {
  pending.set(k, [v, source]);
  if (!flushTimer) flushTimer = setTimeout(flush, 16);
});
function flush() {
  flushTimer = null;
  const batch = pending; pending = new Map();
  for (const c of clients) {
    if (c.readyState !== 1) continue;
    const a = [];
    for (const [k, [v, src]] of batch) if (src !== c) a.push([k, v]);
    if (a.length) c.send(JSON.stringify({ t: 'p', a }));
  }
}
mixer.on('meter', (type, levels) => broadcast({ t: 'm', type, levels }));
mixer.on('status', s => broadcast({ t: 'status', ...s }));
mixer.on('scene', (n, title) => broadcast({ t: 'scene', n, title }));
mixer.on('error', err => console.error('[midi]', err.message));
setInterval(() => { if (mixer.sync.running) broadcast({ t: 'status', ...mixer.status() }); }, 1000);
// Heartbeat so clients can tell a dead connection from a quiet one.
setInterval(() => broadcast({ t: 'ping' }), 3000);

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ t: 'hello', state: Object.fromEntries(mixer.state), ...mixer.status() }));
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'set':
        if (Array.isArray(m.a) && m.a.length === 4 && m.a.every(Number.isInteger)) mixer.set(m.a, m.v, ws);
        break;
      case 'get':
        for (const a of m.a || []) if (Array.isArray(a) && a.length === 4) mixer.request(a);
        break;
      case 'meters': mixer.meters(!!m.on); break;
      case 'resync': mixer.resync(); break;
      case 'scenes': mixer.requestSceneTitles(); break;
      case 'recall': if (Number.isInteger(m.n)) mixer.recallScene(m.n); break;
      case 'store': if (Number.isInteger(m.n)) mixer.storeScene(m.n, m.title); break;
      case 'sceneTitle': if (Number.isInteger(m.n)) mixer.setSceneTitle(m.n, m.title || ''); break;
      case 'select': if (Number.isInteger(m.c)) mixer.selectChannel(m.c); break;
    }
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`01V96 Web Mixer em http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  rede local: http://${ip}:${PORT}`);
});

server.on('error', err => {
  mixer.close();
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso (o servidor provavelmente já está rodando).`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

process.on('SIGINT', () => { mixer.close(); process.exit(0); });
