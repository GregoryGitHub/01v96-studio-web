'use strict';
// Captures README screenshots from a running server with headless Edge/Chrome.
//   node tools/screenshots.js [outDir]   (server must be running on :8096)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const BROWSER = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(fs.existsSync);
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'img'));
const PORT = 9334;
const SHOTS = [
  { name: 'mixer', w: 1440, h: 860, ui: { view: 'mixer', layer: 'l1', sendsOnFader: null } },
  { name: 'channel', w: 1440, h: 1100, ui: { view: 'channel', strip: 'in0' } },
  { name: 'effects', w: 1440, h: 760, ui: { view: 'effects', fx: 0 } },
  { name: 'mobile', w: 390, h: 844, mobile: true, ui: { view: 'mixer', layer: 'l1', sendsOnFader: 0 } },
  { name: 'tablet', w: 1180, h: 820, mobile: true, ui: { view: 'channel', strip: 'in0', chTab: 'eq' } },
  { name: 'tablet-mixer', w: 1180, h: 820, mobile: true, ui: { view: 'mixer', layer: 'l1', sendsOnFader: null } },
  { name: 'scenes', w: 1180, h: 820, mobile: true, ui: { view: 'scenes' } },
];

const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), '01v96-shots-'));
  const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40 && !targets; i++) { try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); } catch { await sleep(250); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pending = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await cmd('Page.enable');
  for (const s of SHOTS) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.mobile ? 2 : 1, mobile: !!s.mobile });
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: !!s.mobile, maxTouchPoints: 5 });
    await cmd('Page.navigate', { url: 'http://localhost:8096/' });
    await sleep(800);
    await cmd('Runtime.evaluate', { expression: `localStorage.setItem('ui', JSON.stringify(${JSON.stringify({ meters: true, fx: 0, strip: 'in0', layer: 'l1', sendsOnFader: null, ...s.ui })})); location.reload();` });
    await sleep(4500); // let the state and a few meter frames arrive
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${s.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log('saved', s.name);
  }
  ws.close(); browser.kill();
  await sleep(1000); // the browser keeps the profile locked briefly after exit
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
})();
