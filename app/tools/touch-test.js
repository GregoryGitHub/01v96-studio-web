'use strict';
// Touch regression test: emulates a phone/tablet in headless Edge/Chrome and
// drags controls with real touch events against a sandbox server
// (run one with: PORT=8097 MIDI_PORT=__none__ node server.js).
//   node tools/touch-test.js [baseUrl]
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const BASE = process.argv[2] || 'http://localhost:8097/';
const BROWSER = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(fs.existsSync);
const PORT = 9335;
const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), '01v96-touch-'));
  const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40 && !targets; i++) { try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); } catch { await sleep(250); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pending = new Map();
  ws.on('message', m => { const x = JSON.parse(m); if (pending.has(x.id)) { pending.get(x.id)(x.result); pending.delete(x.id); } });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async e => (await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  const touch = (type, x, y) => cmd('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] });
  async function drag(x, y, dx, dy, steps = 12) {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps); await sleep(16); }
    await touch('touchEnd');
    await sleep(150);
  }
  const center = sel => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  const text = sel => js(`document.querySelector(${JSON.stringify(sel)})?.textContent`);
  const results = [];
  const check = (name, before, after) => { const ok = before !== after; results.push({ name, ok, before, after }); };

  for (const dev of [{ name: 'phone', w: 390, h: 844 }, { name: 'tablet', w: 1024, h: 768 }]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: dev.w, height: dev.h, deviceScaleFactor: 2, mobile: true });
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cmd('Page.navigate', { url: BASE });
    await sleep(1000);
    await js(`localStorage.setItem('ui', JSON.stringify({ view: 'mixer', layer: 'l1', sendsOnFader: null, strip: 'in0', fx: 0, meters: false })); location.reload()`);
    await sleep(2000);

    // Fader: drag the thumb up.
    let c = await center('.strip .fader .thumb');
    let before = await text('.strip .fader .readout');
    await drag(c.x, c.y, 0, -c.h * 4);
    check(`${dev.name}: fader drag`, before, await text('.strip .fader .readout'));

    // Fader: a tap on the empty track must NOT jump the level on touch.
    const tr = await center('.strip .fader .track');
    before = await text('.strip .fader .readout');
    await touch('touchStart', tr.x, tr.y + tr.h / 2 - 6); await sleep(50); await touch('touchEnd'); await sleep(400);
    results.push({ name: `${dev.name}: track tap does not jump`, ok: before === (await text('.strip .fader .readout')), before });

    // Fader: double tap returns to 0 dB.
    c = await center('.strip .fader .thumb');
    for (let i = 0; i < 2; i++) { await touch('touchStart', c.x, c.y); await sleep(40); await touch('touchEnd'); await sleep(120); }
    await sleep(200);
    const home = await text('.strip .fader .readout');
    results.push({ name: `${dev.name}: double tap = 0 dB`, ok: home === '0.0' || home === '+0.0' || home === '0', after: home });

    const doubleTap = async p => { for (let i = 0; i < 2; i++) { await touch('touchStart', p.x, p.y); await sleep(40); await touch('touchEnd'); await sleep(120); } await sleep(200); };

    // Pan knob: double tap to centre, then vertical and horizontal drags.
    c = await center('.strip .knob svg');
    await drag(c.x, c.y, 0, 60);
    await doubleTap(c);
    before = await text('.strip .knob .kval');
    results.push({ name: `${dev.name}: knob double tap = C`, ok: before === 'C', after: before });
    await drag(c.x, c.y, 0, -60);
    const mid = await text('.strip .knob .kval');
    check(`${dev.name}: knob vertical drag`, before, mid);
    await drag(c.x, c.y, 80, 0);
    check(`${dev.name}: knob horizontal drag`, mid, await text('.strip .knob .kval'));

    // Channel editor: EQ gain knob and EQ graph point.
    await js(`localStorage.setItem('ui', JSON.stringify({ view: 'channel', strip: 'in0', meters: false })); location.reload()`);
    await sleep(2000);
    c = await center('.band .knob svg');
    await doubleTap(c);
    before = await text('.band .knob .kval');
    await drag(c.x, c.y, 0, -80);
    check(`${dev.name}: EQ gain knob`, before, await text('.band .knob .kval'));

    const g = await center('.eqgraph');
    const labels = () => js(`[...document.querySelectorAll('.band .kval')].map(e => e.textContent).join('|')`);
    before = await labels();
    // Grab the point of band 2 (L-MID) where it is drawn and pull it right.
    const pt = await js(`(() => { const k = document.querySelectorAll('.band')[1].querySelectorAll('.kval'); const f = k[1].textContent; return { hz: parseFloat(f) * (f.includes('k') ? 1000 : 1), db: parseFloat(k[0].textContent) }; })()`);
    const lx = Math.max(g.x - g.w / 2 + 4, g.x - g.w / 2 + g.w * (Math.log10(pt.hz / 20) / 3));
    const ly = g.y - (Math.max(-20, Math.min(20, pt.db)) / 20) * (g.h / 2 - 8);
    await drag(lx, ly, pt.hz > 2000 ? -60 : 60, 20);
    check(`${dev.name}: EQ graph drag`, before, await labels());
  }

  console.log(JSON.stringify(results, null, 1));
  console.log(results.every(r => r.ok) ? 'ALL OK' : 'FAILURES: ' + results.filter(r => !r.ok).map(r => r.name).join(', '));
  ws.close(); browser.kill();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  process.exit(0);
})();
