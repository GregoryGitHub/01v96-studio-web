// Selected-channel editor: EQ (with response graph), dynamics, sends, routing.
import { h, fader, knob, toggle, select, bind, drag } from '../controls.js';
import * as F from '../format.js';
import * as S from '../store.js';
import { allStrips, stripById, strips, k, name } from '../model.js';

const card = (title, ...kids) => h('div', { class: 'card' }, h('h3', {}, title), ...kids);
const row = (...kids) => h('div', { class: 'row' }, ...kids);

export function channelView(ui) {
  const s = stripById(ui.strip) || strips.in[0];
  const idx = allStrips.indexOf(s);
  const nav = d => ui.go({ strip: allStrips[(idx + d + allStrips.length) % allStrips.length].id });
  if (s.kind === 'in' && ui.followSel) S.send({ t: 'select', c: s.c });

  const head = h('div', { class: 'chhead' },
    h('button', { class: 'ghost', onclick: () => nav(-1) }, '‹'),
    h('div', { class: 'chtitle' }, h('span', { class: 'stag ' + s.kind }, s.label), h('b', {}, name(s))),
    h('button', { class: 'ghost', onclick: () => nav(1) }, '›'),
    h('div', { class: 'grow' }),
    toggle(k.on(s), 'ON', { className: 'onbtn' }),
  );

  const side = h('div', { class: 'chside' },
    knob(k.pan(s), { min: -63, max: 63, home: 0, label: s.kind === 'in' ? 'PAN' : 'BAL', format: F.pan }),
    knob(k.att(s), { min: -960, max: 120, home: 0, label: 'ATT', format: v => F.tenths(v) }),
    fader(k.fader(s), { home: F.ZERO_DB, format: F.faderDb, className: s.kind }),
  );

  const cards = [eqCard(s)];
  if (s.kind === 'in') cards.push(gateCard(s));
  cards.push(compCard(s));
  if (s.kind === 'in') cards.push(sendsCard(s), routingCard(s));
  if (s.kind === 'bus') cards.push(busToStCard(s));
  cards.push(delayCard(s), miscCard(s));

  return h('section', { class: 'view channel' }, head, h('div', { class: 'chbody' }, side, h('div', { class: 'cards' }, cards)));
}

// --- EQ -------------------------------------------------------------------

const BANDS = [
  { name: 'LOW', q: 1, f: 2, g: 3, qmax: 41 },
  { name: 'L-MID', q: 5, f: 6, g: 7, qmax: 40 },
  { name: 'H-MID', q: 8, f: 9, g: 10, qmax: 40 },
  { name: 'HIGH', q: 11, f: 12, g: 13, qmax: 42 },
];

function eqCard(s) {
  const graph = eqGraph(s);
  const bands = BANDS.map((b, i) => h('div', { class: 'band' },
    h('div', { class: 'bname' }, b.name),
    knob(k.eq(s, b.g), { min: -180, max: 180, home: 0, label: 'GAIN', format: v => F.tenths(v) }),
    knob(k.eq(s, b.f), { min: 5, max: 124, home: [36, 72, 96, 112][i], label: 'FREQ', format: F.eqFreq }),
    knob(k.eq(s, b.q), { min: 0, max: b.qmax, home: 23, label: 'Q', format: F.eqQ }),
    i === 0 ? toggle(k.eq(s, 4), 'HPF') : i === 3 ? toggle(k.eq(s, 14), 'LPF') : null,
  ));
  return h('div', { class: 'card eq wide' },
    h('h3', {}, 'EQ', h('span', { class: 'grow' }), select(k.eq(s, 0), ['TYPE I', 'TYPE II']), toggle(k.eq(s, 15), 'EQ ON', { className: 'onbtn' })),
    graph, h('div', { class: 'bands' }, bands));
}

// Graph geometry shared by drawing and dragging (canvas pixel units).
const eqX = (W, f) => (Math.log10(f / 20) / Math.log10(1000)) * W;
const eqY = (H, d) => H / 2 - (d / 20) * (H / 2 - 8);

function nearestFreqIndex(hz) {
  let best = 5, err = Infinity;
  for (let i = 5; i <= 124; i++) { const e = Math.abs(Math.log(F.eqFreqHz(i) / hz)); if (e < err) { err = e; best = i; } }
  return best;
}

function eqGraph(s) {
  const cv = h('canvas', { class: 'eqgraph', width: 800, height: 220 });
  const keys = Array.from({ length: 16 }, (_, p) => k.eq(s, p));
  let selected = -1;
  const draw = () => drawEq(cv, keys.map(x => S.get(x)), selected);
  keys.forEach(x => bind(cv, x, () => requestAnimationFrame(draw)));
  new ResizeObserver(() => { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; draw(); }).observe(cv);

  // Drag a band point: horizontal = frequency, vertical = gain.
  const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  let px = 0, py = 0;
  drag(cv, {
    onStart: e => {
      const [x, y] = toCanvas(e);
      const v = keys.map(x => S.get(x));
      const reach = (e.pointerType === 'touch' ? 44 : 24) * devicePixelRatio;
      let best = -1, bd = Infinity;
      BANDS.forEach((b, i) => {
        const d = Math.hypot(eqX(cv.width, F.eqFreqHz(v[b.f])) - x, eqY(cv.height, Math.max(-20, Math.min(20, v[b.g] / 10))) - y);
        if (d < bd) { bd = d; best = i; }
      });
      selected = bd <= reach ? best : -1;
      [px, py] = [x, y];
      draw();
    },
    onMove: (dx, dy, e) => {
      if (selected < 0) return;
      const b = BANDS[selected];
      const [x, y] = toCanvas(e);
      px = Math.max(0, Math.min(cv.width, x)); py = Math.max(0, Math.min(cv.height, y));
      S.set(keys[b.f], nearestFreqIndex(20 * Math.pow(1000, px / cv.width)));
      const filterOn = (selected === 0 && S.get(keys[4])) || (selected === 3 && S.get(keys[14]));
      if (!filterOn) S.set(keys[b.g], Math.max(-180, Math.min(180, Math.round(((cv.height / 2 - py) / (cv.height / 2 - 8)) * 200))));
    },
    onEnd: () => { selected = -1; draw(); },
  });
  return h('div', { class: 'eqwrap' }, cv, h('div', { class: 'hint' }, 'Arraste os pontos coloridos: horizontal = frequência, vertical = ganho.'));
}

// RBJ cookbook magnitude responses, evaluated at 48 kHz.
function biquadDb(type, f0, gainDb, Q, f) {
  const fs = 48000, A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
  else if (type === 'lowshelf' || type === 'highshelf') {
    const sq = 2 * Math.sqrt(A) * (sw / (2 * 0.707));
    const sgn = type === 'lowshelf' ? 1 : -1;
    b0 = A * ((A + 1) - sgn * (A - 1) * cw + sq); b1 = sgn * 2 * A * ((A - 1) - sgn * (A + 1) * cw); b2 = A * ((A + 1) - sgn * (A - 1) * cw - sq);
    a0 = (A + 1) + sgn * (A - 1) * cw + sq; a1 = -sgn * 2 * ((A - 1) + sgn * (A + 1) * cw); a2 = (A + 1) + sgn * (A - 1) * cw - sq;
  } else if (type === 'hpf') { const a = sw / (2 * 0.707); b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; }
  else { const a = sw / (2 * 0.707); b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; }
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

function drawEq(cv, v, selected = -1) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, css = getComputedStyle(cv);
  ctx.clearRect(0, 0, W, H);
  const fx = f => eqX(W, f);
  const gy = d => eqY(H, d);
  ctx.strokeStyle = css.getPropertyValue('--grid'); ctx.lineWidth = 1;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { ctx.beginPath(); ctx.moveTo(fx(f), 0); ctx.lineTo(fx(f), H); ctx.stroke(); }
  for (const d of [-12, -6, 0, 6, 12]) { ctx.beginPath(); ctx.moveTo(0, gy(d)); ctx.lineTo(W, gy(d)); ctx.stroke(); }
  const on = v[15] === 1;
  const filters = BANDS.map((b, i) => {
    const f0 = F.eqFreqHz(v[b.f]), g = v[b.g] / 10, qs = F.T.qMap[v[b.q]];
    if (i === 0 && v[4]) return ['hpf', f0, 0, 0.7];
    if (i === 3 && v[14]) return ['lpf', f0, 0, 0.7];
    if (qs === 'Lo') return ['lowshelf', f0, g, 0.7];
    if (qs === 'Hi') return ['highshelf', f0, g, 0.7];
    return ['peak', f0, g, F.eqQValue(v[b.q]) || 1];
  });
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.strokeStyle = on ? css.getPropertyValue('--accent') : css.getPropertyValue('--muted');
  ctx.fillStyle = on ? css.getPropertyValue('--accent-soft') : 'transparent';
  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const f = 20 * Math.pow(1000, x / W);
    const d = on ? filters.reduce((a, [t, f0, g, q]) => a + biquadDb(t, f0, g, q, f), 0) : 0;
    const y = gy(Math.max(-24, Math.min(24, d)));
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo(W, gy(0)); ctx.lineTo(0, gy(0)); ctx.closePath(); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
  BANDS.forEach((b, i) => {
    const x = fx(F.eqFreqHz(v[b.f])), y = gy(Math.max(-20, Math.min(20, v[b.g] / 10)));
    ctx.fillStyle = css.getPropertyValue(`--band${i}`);
    if (i === selected) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 18 * devicePixelRatio, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.beginPath(); ctx.arc(x, y, (i === selected ? 9 : 7) * devicePixelRatio, 0, 2 * Math.PI); ctx.fill();
  });
}

// --- Dynamics ----------------------------------------------------------------

function gateCard(s) {
  return card('GATE',
    row(toggle(k.gate(s, 0), 'ON', { className: 'onbtn' }), select(k.gate(s, 5), ['GATE', 'DUCKING'])),
    row(
      knob(k.gate(s, 10), { min: -540, max: 0, home: -260, label: 'THRESH', format: v => F.tenths(v) }),
      knob(k.gate(s, 7), { min: -70, max: 0, home: -56, label: 'RANGE', format: v => v + ' dB' }),
      knob(k.gate(s, 6), { min: 0, max: 120, home: 0, label: 'ATTACK', format: F.ms }),
      knob(k.gate(s, 8), { min: 0, max: 215, home: 60, label: 'HOLD', format: F.gateHold }),
      knob(k.gate(s, 9), { min: 0, max: 159, home: 44, label: 'DECAY', format: F.decay }),
    ));
}

function compCard(s) {
  return card('COMP',
    row(toggle(k.comp(s, 1), 'ON', { className: 'onbtn' }),
      select(k.comp(s, 3), ['COMP', 'EXPAND', 'COMP (H)', 'COMP (S)']),
      select(k.comp(s, 0), ['PRE EQ', 'PRE FADER', 'POST FADER'])),
    row(
      knob(k.comp(s, 9), { min: -540, max: 0, home: -80, label: 'THRESH', format: v => F.tenths(v) }),
      knob(k.comp(s, 6), { min: 0, max: 15, home: 6, label: 'RATIO', format: F.ratio }),
      knob(k.comp(s, 4), { min: 0, max: 120, home: 30, label: 'ATTACK', format: F.ms }),
      knob(k.comp(s, 5), { min: 0, max: 159, home: 37, label: 'RELEASE', format: F.decay }),
      knob(k.comp(s, 7), { min: 0, max: 180, home: 0, label: 'GAIN', format: v => F.tenths(v) }),
      knob(k.comp(s, 8), { min: 0, max: 5, home: 2, label: 'KNEE', format: F.knee }),
    ));
}

// --- Sends / routing -----------------------------------------------------------

function sendsCard(s) {
  const rows = strips.aux.map((a, n) => h('div', { class: 'sendrow' },
    h('span', { class: 'sendname' }, name(a)),
    toggle(k.sendOn(s, n), 'ON', { className: 'onbtn sm' }),
    toggle(k.sendPre(s, n), 'PRE', { className: 'sm' }),
    hslider(k.send(s, n), { max: 1023, home: F.ZERO_DB, format: F.faderDb }),
    n % 2 === 0 ? knob(k.sendPan(s, n >> 1), { min: -63, max: 63, home: 0, label: '', format: F.pan, size: 'xs' }) : h('span'),
  ));
  return h('div', { class: 'card wide' }, h('h3', {}, 'AUX SENDS'), h('div', { class: 'sends' }, rows));
}

function hslider(key, { max, home, format }) {
  const input = h('input', { type: 'range', min: 0, max, step: 1 });
  const out = h('span', { class: 'hval' });
  bind(input, key, v => { input.value = v; out.textContent = format(v); });
  input.addEventListener('input', () => { S.set(key, +input.value); out.textContent = format(+input.value); });
  input.addEventListener('dblclick', () => { S.set(key, home); input.value = home; out.textContent = format(home); });
  return h('div', { class: 'hslider' }, input, out);
}

function routingCard(s) {
  return card('ROUTING',
    row(toggle(k.routing(s, 0), 'STEREO'), toggle(k.routing(s, 2), 'DIRECT'), toggle(k.routing(s, 1), 'PAN LINK')),
    row(...Array.from({ length: 8 }, (_, i) => toggle(k.routing(s, 3 + i), String(i + 1), { className: 'sq' }))),
    h('div', { class: 'hint' }, 'BUS 1–8'),
  );
}

function busToStCard(s) {
  return card('TO STEREO',
    row(toggle(k.busToSt(s, 0), 'ON', { className: 'onbtn' }),
      knob(k.busToSt(s, 2), { min: -63, max: 63, home: 0, label: 'PAN', format: F.pan })),
    hslider(k.busToSt(s, 1), { max: 1023, home: F.ZERO_DB, format: F.faderDb }));
}

function delayCard(s) {
  if (s.kind === 'in') return card('DELAY',
    row(toggle(k.delay(s, 0), 'ON', { className: 'onbtn' })),
    row(
      knob(k.delay(s, 3), { min: 0, max: 43400, home: 0, label: 'TIME', format: v => (v / 48).toFixed(1) + ' ms' }),
      knob(k.delay(s, 1), { min: 0, max: 100, home: 100, label: 'MIX', format: v => v + '%' }),
      knob(k.delay(s, 2), { min: -99, max: 99, home: 0, label: 'FB', format: v => v + '%' }),
    ));
  return card('DELAY',
    row(toggle(k.delay(s, 0), 'ON', { className: 'onbtn' }),
      knob(k.delay(s, 1), { min: 0, max: 43400, home: 0, label: 'TIME', format: v => (v / 48).toFixed(1) + ' ms' })));
}

function miscCard(s) {
  const kids = [];
  if (s.kind === 'in') kids.push(toggle(k.phase(s), 'Ø PHASE'));
  kids.push(toggle(k.insert(s), 'INSERT'));
  if (s.kind !== 'st') kids.push(toggle(k.pair(s), 'PAIR'));
  const groups = s.kind === 'in'
    ? [h('div', { class: 'hint' }, 'FADER GROUP'), row(...Array.from({ length: 8 }, (_, i) => toggle(k.group(s, i), 'ABCDEFGH'[i], { className: 'sq' }))),
       h('div', { class: 'hint' }, 'MUTE GROUP'), row(...Array.from({ length: 8 }, (_, i) => toggle(k.group(s, 8 + i), 'IJKLMNOP'[i], { className: 'sq' })))]
    : [h('div', { class: 'hint' }, 'FADER / MUTE GROUP'), row(...Array.from({ length: 4 }, (_, i) => toggle(k.group(s, i), 'QRST'[i], { className: 'sq' })), ...Array.from({ length: 4 }, (_, i) => toggle(k.group(s, 4 + i), 'UVWX'[i], { className: 'sq' })))];
  return card('CANAL', row(...kids), ...groups);
}
