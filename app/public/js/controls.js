// Reusable UI controls bound to store keys.
import * as S from './store.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

// Keep a subscription alive only while the element is in the document.
const live = new Map();
export function bind(el, k, fn) {
  fn(S.get(k));
  const off = S.on(k, fn);
  live.set(el, [...(live.get(el) || []), off]);
}
export function unbindTree(root) {
  for (const [el, offs] of live) if (root.contains(el)) { offs.forEach(f => f()); live.delete(el); }
}

// Drag helper for mouse, pen and touch. Calls onMove(dx, dy, event) with the
// pixels moved since the last event (dy > 0 = upwards) and onTap(event) for a
// double tap / double click. One pointer per control; extra fingers are ignored
// so two controls can be moved at once on a tablet.
export function drag(el, { onStart, onMove, onEnd, onDoubleTap, onTap }) {
  let tapTimer = null;
  // Stop iOS/Android from scrolling or zooming the page when a gesture starts on
  // a control (touch-action alone is not honoured everywhere, e.g. inside SVG).
  el.style.touchAction = 'none';
  el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  let active = null, lastTap = 0, moved = 0;
  el.addEventListener('pointerdown', e => {
    if (active !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    active = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch {}
    let lx = e.clientX, ly = e.clientY;
    moved = 0;
    el.classList.add('dragging');
    onStart?.(e);
    const move = ev => {
      if (ev.pointerId !== active) return;
      const dx = ev.clientX - lx, dy = ly - ev.clientY;
      lx = ev.clientX; ly = ev.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      onMove(dx, dy, ev);
    };
    const up = ev => {
      if (ev.pointerId !== active) return;
      active = null;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      onEnd?.(ev);
      if (moved < 6) {
        const now = performance.now();
        if (now - lastTap < 350) { lastTap = 0; clearTimeout(tapTimer); onDoubleTap?.(ev); }
        else {
          lastTap = now;
          // A single tap fires only once it is clear it was not a double tap.
          if (onTap) { clearTimeout(tapTimer); tapTimer = setTimeout(() => onTap(ev), 360); }
        }
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// Fader: value 0..max mapped linearly to track height (the 01V96 fader law is
// already in the raw value). Double-click recalls `home` (0 dB).
export function fader(k, { max = 1023, home = 823, format = String, className = '' } = {}) {
  const thumb = h('div', { class: 'thumb' });
  const fill = h('div', { class: 'fill' });
  const marks = h('div', { class: 'marks' });
  const track = h('div', { class: 'track' }, fill, marks, thumb);
  const readout = h('div', { class: 'readout' });
  const el = h('div', { class: 'fader ' + className }, track, readout);
  let value = 0, dragging = false, acc = 0;
  const render = v => {
    value = v;
    const pct = (v / max) * 100;
    thumb.style.bottom = `calc(${pct}% - var(--thumb-h) * ${pct / 100})`;
    fill.style.height = pct + '%';
    readout.textContent = format(v);
  };
  bind(el, k, v => { if (!dragging) render(v); });
  drag(track, {
    onStart: e => {
      dragging = true; acc = value;
      // A mouse click on the track jumps the fader there. Touch is always
      // relative: brushing the track with a finger must not jump the level.
      if (e.pointerType === 'mouse') {
        const r = track.getBoundingClientRect();
        const t = thumb.getBoundingClientRect();
        if (e.clientY < t.top || e.clientY > t.bottom) {
          acc = Math.round(Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height)) * max);
          S.set(k, acc); render(acc);
        }
      }
    },
    onMove: (dx, dy, ev) => {
      const r = track.getBoundingClientRect();
      acc = Math.max(0, Math.min(max, acc + dy * (max / r.height) * (ev.shiftKey ? 0.15 : 1)));
      const v = Math.round(acc);
      if (v !== value) { S.set(k, v); render(v); }
    },
    onEnd: () => { dragging = false; },
    onDoubleTap: () => { S.set(k, home); render(home); },
  });
  track.addEventListener('wheel', e => { e.preventDefault(); const v = Math.max(0, Math.min(max, value + (e.deltaY < 0 ? 4 : -4))); S.set(k, v); render(v); }, { passive: false });
  return el;
}

// Rotary knob over [min,max] with an arc. Vertical drag, wheel, double-click home.
export function knob(k, { min = 0, max = 127, home = min, label = '', format = String, size = 'md', bipolar = min < 0 } = {}) {
  const R = 18, C = 2 * Math.PI * R, sweep = 0.75;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  const mk = (cls) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', 24); c.setAttribute('cy', 24); c.setAttribute('r', R); c.setAttribute('class', cls); c.setAttribute('transform', 'rotate(135 24 24)'); svg.append(c); return c; };
  const bg = mk('arc-bg'); bg.style.strokeDasharray = `${C * sweep} ${C}`;
  const fg = mk('arc-fg');
  const dot = document.createElementNS(ns, 'line'); dot.setAttribute('class', 'needle'); dot.setAttribute('x1', 24); dot.setAttribute('y1', 24); dot.setAttribute('x2', 24); dot.setAttribute('y2', 9); svg.append(dot);
  const val = h('div', { class: 'kval' });
  const el = h('div', { class: `knob ${size}`, title: label }, svg, h('div', { class: 'klabel' }, label), val);
  let value = 0, acc = 0, dragging = false;
  const span = max - min || 1;
  const render = v => {
    value = v;
    const t = (v - min) / span;
    const t0 = bipolar ? (0 - min) / span : 0;
    const a = Math.min(t, t0), b = Math.max(t, t0);
    fg.style.strokeDasharray = `${C * sweep * (b - a)} ${C}`;
    fg.style.strokeDashoffset = `${-C * sweep * a}`;
    dot.setAttribute('transform', `rotate(${-135 + 270 * t} 24 24)`);
    val.textContent = format(v);
  };
  bind(el, k, v => { if (!dragging) render(v); });
  const setv = v => { v = Math.round(Math.max(min, Math.min(max, v))); if (v !== value) { S.set(k, v); render(v); } };
  // Up or right increases. The whole knob (label and value too) is the grab area,
  // which gives fingers a much bigger target than the dial alone.
  drag(el, {
    onStart: () => { dragging = true; acc = value; },
    onMove: (dx, dy, ev) => { acc += (dy + dx) * span / (ev.shiftKey ? 600 : ev.pointerType === 'touch' ? 220 : 150); setv(acc); },
    onEnd: () => { dragging = false; },
    onDoubleTap: () => setv(home),
    onTap: () => { if (!el.classList.contains('disabled')) fineAdjust({ k, min, max, home, label, format }); },
  });
  svg.addEventListener('wheel', e => { e.preventDefault(); setv(value + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(span / 100))); }, { passive: false });
  return el;
}

export function toggle(k, label, { className = '', on = 1, off = 0, invert = false } = {}) {
  const el = h('button', { class: 'tog ' + className, type: 'button' }, label);
  bind(el, k, v => el.classList.toggle('on', invert ? v !== on : v === on));
  el.addEventListener('click', () => S.set(k, S.get(k) === on ? off : on));
  return el;
}

export function select(k, options, { label = '' } = {}) {
  const sel = h('select', {}, options.map((o, i) => h('option', { value: i }, o)));
  bind(sel, k, v => { sel.value = v; });
  sel.addEventListener('change', () => S.set(k, +sel.value));
  return label ? h('label', { class: 'sel' }, h('span', {}, label), sel) : sel;
}

// Big fine-adjust panel for one parameter: wide slider, -/+ steps and reset.
// Opened by tapping a knob; much easier than turning a small dial with a finger.
export function fineAdjust({ k, min, max, home, label, format }) {
  const span = max - min;
  const step = Math.max(1, Math.round(span / 100));
  const val = h('div', { class: 'fine-val' });
  const slider = h('input', { type: 'range', min, max, step: 1, class: 'fine-slider' });
  const render = v => { val.textContent = format(v); slider.value = v; };
  const setv = v => { v = Math.max(min, Math.min(max, Math.round(v))); S.set(k, v); render(v); };
  slider.addEventListener('input', () => setv(+slider.value));
  const btn = (txt, d) => h('button', { class: 'sheet-btn', onclick: () => setv(S.get(k) + d) }, txt);
  const close = () => { off(); root.remove(); };
  const box = h('div', { class: 'sheet fine' },
    h('h2', {}, label || 'Ajuste'), val, slider,
    h('div', { class: 'sheet-actions' }, btn('−−', -step * 5), btn('−', -1), h('button', { class: 'sheet-btn', onclick: () => setv(home) }, 'Padrão'), btn('+', 1), btn('++', step * 5)),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'sheet-btn primary', onclick: close }, 'OK')));
  const root = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === root) close(); } }, box);
  const off = S.on(k, render);
  render(S.get(k));
  document.body.append(root);
}

// Touch-friendly modal sheet. `actions` = [{label, value, className}];
// resolves with the chosen value (or null when dismissed). With `input`, the
// text field value is returned as {value, text}.
export function sheet({ title, text = '', input = null, actions }) {
  return new Promise(resolve => {
    const field = input ? h('input', { class: 'sheet-input', type: 'text', value: input.value || '', maxlength: input.max || 16, placeholder: input.placeholder || '', autocomplete: 'off' }) : null;
    const close = v => { root.remove(); resolve(v); };
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, title), text ? h('p', {}, text) : null, field,
      h('div', { class: 'sheet-actions' }, actions.map(a =>
        h('button', { class: 'sheet-btn ' + (a.className || ''), onclick: () => close(field ? { value: a.value, text: field.value } : a.value) }, a.label))));
    const root = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === root) close(null); } }, box);
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && field) close({ value: actions.at(-1).value, text: field.value }); });
    document.body.append(root);
    (field || box.querySelector('.sheet-btn:last-child'))?.focus();
  });
}

export function meter(className = '') {
  const bar = h('div', { class: 'mbar' });
  const peak = h('div', { class: 'mpeak' });
  const el = h('div', { class: 'meter ' + className }, bar, peak);
  let pk = 0, pkT = 0;
  el.setLevel = v => {
    const pct = (v / 127) * 100;
    bar.style.height = pct + '%';
    const now = performance.now();
    if (v >= pk || now - pkT > 1200) { pk = v; pkT = now; }
    peak.style.bottom = (pk / 127) * 100 + '%';
    el.classList.toggle('clip', v >= 125);
  };
  return el;
}
