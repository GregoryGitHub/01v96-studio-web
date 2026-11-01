// Selected-channel editor, tablet first: the channel strip stays on the left and
// the processing lives in tabs (EQ, dynamics, sends, routing, more).
import { h, fader, knob, toggle, select, bind, drag, sheet } from '../controls.js';
import * as F from '../format.js';
import * as S from '../store.js';
import * as E from '../eq.js';
import { allStrips, stripById, strips, k, name, setName } from '../model.js';

const card = (title, ...kids) => h('div', { class: 'card' }, h('h3', {}, title), ...kids);
const row = (...kids) => h('div', { class: 'row' }, ...kids);

export function channelView(ui) {
  const s = stripById(ui.strip) || strips.in[0];
  const idx = allStrips.indexOf(s);
  const nav = d => ui.go({ strip: allStrips[(idx + d + allStrips.length) % allStrips.length].id });
  if (s.kind === 'in' && ui.followSel) S.send({ t: 'select', c: s.c });

  const title = h('button', { class: 'chname', title: 'Renomear' }, name(s));
  title.addEventListener('click', async () => {
    const r = await sheet({ title: `Nome de ${s.label}`, text: 'Até 4 caracteres (o visor da mesa só mostra 4).', input: { value: name(s), max: 4 },
      actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', value: true, className: 'primary' }] });
    if (r && r.value) { setName(s, r.text); title.textContent = name(s); }
  });

  const head = h('div', { class: 'chhead' },
    h('button', { class: 'navbtn', 'aria-label': 'Canal anterior', onclick: () => nav(-1) }, '‹'),
    h('div', { class: 'chtitle' }, h('span', { class: 'stag ' + s.kind }, s.label), title),
    h('button', { class: 'navbtn', 'aria-label': 'Próximo canal', onclick: () => nav(1) }, '›'),
    h('div', { class: 'grow' }),
    toggle(k.on(s), 'ON', { className: 'onbtn big' }),
  );

  const side = h('div', { class: 'chside' },
    knob(k.pan(s), { min: -63, max: 63, home: 0, label: s.kind === 'in' ? 'PAN' : 'BAL', format: F.pan }),
    knob(k.att(s), { min: -960, max: 120, home: 0, label: 'ATT', format: v => F.tenths(v) }),
    fader(k.fader(s), { home: F.ZERO_DB, format: F.faderDb, className: s.kind }),
  );

  const tabs = [['eq', 'EQ', () => eqPanel(s, ui)], ['dyn', 'Dinâmica', () => dynPanel(s)]];
  if (s.kind === 'in') tabs.push(['sends', 'Envios', () => sendsCard(s)], ['route', 'Rotas', () => routingCard(s)]);
  if (s.kind === 'bus') tabs.push(['route', 'Stereo', () => busToStCard(s)]);
  tabs.push(['more', 'Mais', () => h('div', { class: 'cards' }, delayCard(s), miscCard(s))]);
  const tab = tabs.find(t => t[0] === ui.chTab) || tabs[0];

  const tabBar = h('div', { class: 'seg tabs' }, tabs.map(([id, label]) =>
    h('button', { class: id === tab[0] ? 'on' : '', onclick: () => ui.go({ chTab: id }) }, label)));

  return h('section', { class: 'view channel' }, head,
    h('div', { class: 'chbody' }, side, h('div', { class: 'chmain' }, tabBar, h('div', { class: 'tabpanel' }, tab[2]()))));
}

// --- EQ ------------------------------------------------------------------------

const eqKeys = s => Array.from({ length: 16 }, (_, p) => k.eq(s, p));
const eqValues = s => eqKeys(s).map(x => S.get(x));

function eqPanel(s, ui) {
  const mode = S.getMeta('eqmode:' + s.id, 'param');
  const modeBar = h('div', { class: 'seg' },
    h('button', { class: mode === 'graphic' ? 'on' : '', onclick: () => setMode('graphic') }, 'Gráfico'),
    h('button', { class: mode === 'param' ? 'on' : '', onclick: () => setMode('param') }, 'Paramétrico'));
  async function setMode(m) {
    if (m === mode) return;
    if (m === 'graphic') {
      // Start the bars from the current curve so nothing jumps.
      const fl = E.filters(eqValues(s));
      S.setMeta('geq:' + s.id, E.GEQ_FREQS.map(f => Math.round(Math.max(-E.GEQ_RANGE, Math.min(E.GEQ_RANGE, E.response(fl, f))) * 2) / 2));
    }
    S.setMeta('eqmode:' + s.id, m);
    ui.go({});
  }

  const graph = eqGraph(s, mode);
  const body = mode === 'graphic' ? graphicEq(s, graph) : paramBands(s);
  return h('div', { class: 'card wide eq' },
    h('h3', {}, modeBar, h('span', { class: 'grow' }), select(k.eq(s, E.EQ_MODE), ['TYPE I', 'TYPE II']), toggle(k.eq(s, E.EQ_ON), 'EQ ON', { className: 'onbtn' })),
    graph, body);
}

function paramBands(s) {
  const keys = eqKeys(s);
  const lastPeak = JSON.parse(localStorage.getItem('lastPeakQ') || '{}');
  return h('div', { class: 'bands' }, E.BANDS.map((b, i) => {
    const typeSeg = b.flag ? h('div', { class: 'seg mini bandtype' }, ['peak', 'shelf', 'filter'].map(t => {
      const btn = h('button', { onclick: () => {
        for (const [p, v] of E.typeWrites(b, t, eqValues(s), lastPeak[s.id + b.id] ?? 23)) S.set(keys[p], v);
      } }, t === 'peak' ? 'PEAK' : t === 'shelf' ? 'SHELF' : b.filter);
      return btn;
    })) : h('div', { class: 'bandtype-ph' }, 'PEAK');
    const gain = knob(keys[b.g], { min: -E.G_MAX, max: E.G_MAX, home: 0, label: 'GAIN', format: v => F.tenths(v) });
    const freq = knob(keys[b.f], { min: E.F_MIN, max: E.F_MAX, home: [36, 72, 96, 112][i], label: 'FREQ', format: F.eqFreq });
    const q = knob(keys[b.q], { min: 0, max: E.Q_PEAK_MAX, home: 23, label: 'Q', format: v => (v > E.Q_PEAK_MAX ? '—' : F.eqQ(v)) });
    const col = h('div', { class: 'band' }, h('div', { class: 'bname' }, b.name), typeSeg, gain, freq, q);
    const refresh = () => {
      const v = eqValues(s), t = E.bandType(b, v);
      if (t === 'peak') { lastPeak[s.id + b.id] = v[b.q]; localStorage.setItem('lastPeakQ', JSON.stringify(lastPeak)); }
      typeSeg.querySelectorAll?.('button').forEach((btn, j) => btn.classList.toggle('on', ['peak', 'shelf', 'filter'][j] === t));
      q.classList.toggle('disabled', t !== 'peak');
      gain.classList.toggle('disabled', t === 'filter');
    };
    [b.q, b.g, b.flag].filter(p => p != null).forEach(p => bind(col, keys[p], refresh));
    return col;
  }));
}

function graphicEq(s, graph) {
  const metaKey = 'geq:' + s.id;
  const keys = eqKeys(s);
  let bars = (S.getMeta(metaKey) || E.GEQ_FREQS.map(() => 0)).slice();
  const info = h('span', { class: 'hint' });
  let fitTimer = null, saveTimer = null;
  const apply = () => {
    graph.setTarget(bars);
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const { values, rms } = E.fitGraphic(bars, eqValues(s));
      for (let p = 1; p <= 14; p++) if (values[p] !== S.get(keys[p])) S.set(keys[p], values[p]);
      if (!S.get(keys[E.EQ_ON])) S.set(keys[E.EQ_ON], 1);
      info.textContent = `Aproximação com as 4 bandas da mesa: ±${rms.toFixed(1)} dB`;
    }, 40);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => S.setMeta(metaKey, bars), 400);
  };
  const cols = E.GEQ_FREQS.map((f, i) => geqBar(i, () => bars[i], v => { bars[i] = v; apply(); }));
  graph.setTarget(bars);
  const reset = h('button', { class: 'tog', onclick: () => { bars = bars.map(() => 0); cols.forEach(c => c.refresh()); apply(); } }, 'Zerar');
  return h('div', { class: 'geq' }, h('div', { class: 'geqbars' }, cols),
    h('div', { class: 'row' }, reset, info, h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, 'Arraste as barras. Toque duplo zera a barra. O app converte para as 4 bandas paramétricas da mesa.')));
}

// One vertical bar slider, ±GEQ_RANGE dB in 0.5 dB steps.
function geqBar(i, get, set) {
  const fill = h('div', { class: 'gfill' });
  const knobEl = h('div', { class: 'gknob' });
  const track = h('div', { class: 'gtrack' }, h('div', { class: 'gzero' }), fill, knobEl);
  const val = h('div', { class: 'gval' });
  const el = h('div', { class: 'gbar' }, val, track, h('div', { class: 'glabel' }, E.GEQ_LABELS[i]));
  const R = E.GEQ_RANGE;
  const render = () => {
    const v = get(), t = (v + R) / (2 * R);
    knobEl.style.bottom = `calc(${t * 100}% - 10px)`;
    fill.style.bottom = (Math.min(t, 0.5) * 100) + '%';
    fill.style.height = (Math.abs(t - 0.5) * 100) + '%';
    fill.classList.toggle('neg', v < 0);
    val.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
  };
  el.refresh = render;
  let acc = 0;
  drag(track, {
    onStart: e => {
      const r = track.getBoundingClientRect();
      // Bars are cheap to set: a touch jumps straight to the finger.
      acc = Math.max(-R, Math.min(R, ((r.bottom - e.clientY) / r.height) * 2 * R - R));
      set(Math.round(acc * 2) / 2); render();
    },
    onMove: (dx, dy) => {
      const r = track.getBoundingClientRect();
      acc = Math.max(-R, Math.min(R, acc + (dy / r.height) * 2 * R));
      const v = Math.round(acc * 2) / 2;
      if (v !== get()) { set(v); render(); }
    },
    onDoubleTap: () => { set(0); render(); },
  });
  render();
  return el;
}

// Response graph; in parametric mode the band points can be dragged.
const eqX = (W, f) => (Math.log10(f / 20) / Math.log10(1000)) * W;
const eqY = (H, d) => H / 2 - (d / 20) * (H / 2 - 8);

function eqGraph(s, mode) {
  const cv = h('canvas', { class: 'eqgraph', width: 800, height: 220 });
  const keys = eqKeys(s);
  let selected = -1, target = null;
  const draw = () => drawEq(cv, eqValues(s), selected, target);
  keys.forEach(x => bind(cv, x, () => requestAnimationFrame(draw)));
  new ResizeObserver(() => { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; draw(); }).observe(cv);

  if (mode === 'param') {
    const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    drag(cv, {
      onStart: e => {
        const [x, y] = toCanvas(e);
        const v = eqValues(s);
        const reach = (e.pointerType === 'touch' ? 44 : 24) * devicePixelRatio;
        let best = -1, bd = Infinity;
        E.BANDS.forEach((b, i) => {
          const d = Math.hypot(eqX(cv.width, F.eqFreqHz(v[b.f])) - x, eqY(cv.height, Math.max(-20, Math.min(20, v[b.g] / 10))) - y);
          if (d < bd) { bd = d; best = i; }
        });
        selected = bd <= reach ? best : -1;
        draw();
      },
      onMove: (dx, dy, e) => {
        if (selected < 0) return;
        const b = E.BANDS[selected];
        const [x, y] = toCanvas(e);
        const px = Math.max(0, Math.min(cv.width, x)), py = Math.max(0, Math.min(cv.height, y));
        S.set(keys[b.f], E.freqIndex(20 * Math.pow(1000, px / cv.width)));
        if (E.bandType(b, eqValues(s)) !== 'filter') S.set(keys[b.g], Math.max(-E.G_MAX, Math.min(E.G_MAX, Math.round(((cv.height / 2 - py) / (cv.height / 2 - 8)) * 200))));
      },
      onEnd: () => { selected = -1; draw(); },
    });
  }
  const wrap = h('div', { class: 'eqwrap' }, cv, mode === 'param' ? h('div', { class: 'hint' }, 'Arraste os pontos coloridos: horizontal = frequência, vertical = ganho. Toque num botão giratório para ajuste fino.') : null);
  wrap.setTarget = t => { target = t; requestAnimationFrame(draw); };
  return wrap;
}

function drawEq(cv, v, selected = -1, target = null) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, css = getComputedStyle(cv);
  const dpr = devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const fx = f => eqX(W, f), gy = d => eqY(H, d);
  ctx.strokeStyle = css.getPropertyValue('--grid'); ctx.lineWidth = 1;
  ctx.fillStyle = css.getPropertyValue('--muted'); ctx.font = `${10 * dpr}px system-ui`;
  for (const [f, l] of [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']]) {
    ctx.beginPath(); ctx.moveTo(fx(f), 0); ctx.lineTo(fx(f), H); ctx.stroke(); ctx.fillText(l, fx(f) + 3 * dpr, H - 4 * dpr);
  }
  for (const d of [-12, -6, 0, 6, 12]) { ctx.beginPath(); ctx.moveTo(0, gy(d)); ctx.lineTo(W, gy(d)); ctx.stroke(); ctx.fillText((d > 0 ? '+' : '') + d, 3 * dpr, gy(d) - 3 * dpr); }
  const on = v[E.EQ_ON] === 1;
  const fl = E.filters(v);
  if (target) {
    ctx.fillStyle = css.getPropertyValue('--c-aux');
    E.GEQ_FREQS.forEach((f, i) => { ctx.globalAlpha = 0.85; ctx.fillRect(fx(f) - 3 * dpr, gy(target[i]) - 3 * dpr, 6 * dpr, 6 * dpr); });
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2.5 * dpr;
  ctx.strokeStyle = on ? css.getPropertyValue('--accent') : css.getPropertyValue('--muted');
  ctx.fillStyle = on ? css.getPropertyValue('--accent-soft') : 'transparent';
  ctx.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const f = 20 * Math.pow(1000, x / W);
    const d = on ? E.response(fl, f) : 0;
    const y = gy(Math.max(-24, Math.min(24, d)));
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo(W, gy(0)); ctx.lineTo(0, gy(0)); ctx.closePath(); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
  if (target) return;
  E.BANDS.forEach((b, i) => {
    const t = E.bandType(b, v);
    const x = fx(F.eqFreqHz(v[b.f])), y = t === 'filter' ? gy(0) : gy(Math.max(-20, Math.min(20, v[b.g] / 10)));
    ctx.fillStyle = css.getPropertyValue(`--band${i}`);
    if (i === selected) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 20 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.beginPath(); ctx.arc(x, y, (i === selected ? 10 : 8) * dpr, 0, 2 * Math.PI); ctx.fill();
  });
}

// --- Dynamics ----------------------------------------------------------------

function dynPanel(s) {
  return h('div', { class: 'cards' }, s.kind === 'in' ? gateCard(s) : null, compCard(s));
}

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
  return h('div', { class: 'card wide' }, h('h3', {}, 'ENVIOS AUX'), h('div', { class: 'sends' }, rows));
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
  return h('div', { class: 'cards' }, card('ROTEAMENTO',
    row(toggle(k.routing(s, 0), 'STEREO'), toggle(k.routing(s, 2), 'DIRECT'), toggle(k.routing(s, 1), 'PAN LINK')),
    h('div', { class: 'hint' }, 'BUS 1–8'),
    row(...Array.from({ length: 8 }, (_, i) => toggle(k.routing(s, 3 + i), String(i + 1), { className: 'sq' }))),
  ));
}

function busToStCard(s) {
  return h('div', { class: 'cards' }, card('PARA O STEREO',
    row(toggle(k.busToSt(s, 0), 'ON', { className: 'onbtn' }),
      knob(k.busToSt(s, 2), { min: -63, max: 63, home: 0, label: 'PAN', format: F.pan })),
    hslider(k.busToSt(s, 1), { max: 1023, home: F.ZERO_DB, format: F.faderDb })));
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
