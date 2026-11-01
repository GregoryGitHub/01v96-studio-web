// Drives a headless Edge over CDP to check SW registration, installability and
// the offline overlay. usage: node pwa-check.js <phase: online|offline>
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('../node_modules/ws');

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const profile = path.join(os.tmpdir(), '01v96-pwa-check');
const phase = process.argv[2] || 'online';
const port = 9333;

const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await getJson(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(250); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pending = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await cmd('Page.enable');
  await cmd('Page.navigate', { url: 'http://localhost:8096/' });
  await sleep(4000);
  const out = { phase };
  out.page = await evalJs(`({ title: document.title, offline: document.body.classList.contains('is-offline'), status: document.querySelector('.status')?.textContent, strips: document.querySelectorAll('.strip').length })`);
  out.sw = await evalJs(`(async () => { const r = await navigator.serviceWorker.getRegistration(); return { state: r?.active?.state || null, controlled: !!navigator.serviceWorker.controller, caches: (await caches.keys()), cached: (await caches.keys()).length ? (await (await caches.open((await caches.keys())[0])).keys()).length : 0 }; })()`);
  if (phase === 'online') {
    const inst = await cmd('Page.getInstallabilityErrors');
    out.installabilityErrors = inst.result?.installabilityErrors;
    const man = await cmd('Page.getAppManifest');
    out.manifestErrors = man.result?.errors;
  }
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const shot = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(os.tmpdir(), `01v96-${phase}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(JSON.stringify(out, null, 1));
  ws.close(); edge.kill();
  process.exit(0);
})();
