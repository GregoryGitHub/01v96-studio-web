// Parameter store + WebSocket link to the server.

const state = new Map();
const subs = new Map();      // key -> Set(fn)
const globalSubs = new Set(); // fn(msg)
let ws = null;
let outbox = new Map();
let flushPending = false;
export const status = { connected: false, server: false, connecting: false, retryAt: 0, port: null, sync: { total: 0, done: 0, running: false } };

export const key = (g, e, p, c) => `${g}:${e}:${p}:${c}`;
export const get = (k, d = 0) => (state.has(k) ? state.get(k) : d);
export const has = k => state.has(k);

export function on(k, fn) {
  let s = subs.get(k);
  if (!s) subs.set(k, (s = new Set()));
  s.add(fn);
  return () => s.delete(fn);
}

export function onMessage(fn) { globalSubs.add(fn); return () => globalSubs.delete(fn); }

function apply(k, v) {
  state.set(k, v);
  const s = subs.get(k);
  if (s) for (const fn of s) fn(v);
}

// Local update + coalesced send (one frame per animation frame per key).
export function set(k, v) {
  v = Math.round(v);
  if (state.get(k) === v) return;
  apply(k, v);
  if (!/^\d+:\d+:\d+:\d+$/.test(k)) return; // UI-only (virtual) key
  outbox.set(k, v);
  if (!flushPending) { flushPending = true; requestAnimationFrame(flush); }
}

function flush() {
  flushPending = false;
  if (!ws || ws.readyState !== 1) { outbox.clear(); return; }
  for (const [k, v] of outbox) ws.send(JSON.stringify({ t: 'set', a: k.split(':').map(Number), v }));
  outbox.clear();
}

export function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

export function connect() {
  clearTimeout(retryTimer);
  if (ws && ws.readyState <= 1) return;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  status.connecting = true; emit({ t: 'link' });
  sock.onopen = () => { status.server = true; status.connecting = false; attempts = 0; lastSeen = Date.now(); emit({ t: 'link' }); };
  sock.onclose = () => {
    if (ws !== sock) return;
    status.server = false; status.connected = false; status.connecting = false;
    // Back off 1.5 s -> 10 s while the server stays down.
    const delay = Math.min(10000, 1500 * 2 ** Math.min(attempts++, 3));
    status.retryAt = Date.now() + delay;
    retryTimer = setTimeout(connect, delay);
    emit({ t: 'link' });
  };
  sock.onmessage = ev => {
    lastSeen = Date.now();
    const m = JSON.parse(ev.data);
    if (m.t === 'hello') {
      for (const [k, v] of Object.entries(m.state)) apply(k, v);
      Object.assign(status, { connected: m.connected, port: m.port, sync: m.sync });
    } else if (m.t === 'p') {
      for (const [k, v] of m.a) apply(k, v);
    } else if (m.t === 'status') {
      Object.assign(status, { connected: m.connected, port: m.port, sync: m.sync });
    }
    emit(m);
  };
}

function emit(m) { for (const fn of globalSubs) fn(m); }

let retryTimer = null, attempts = 0, lastSeen = 0;

// Retry immediately (button, tab focus, network back).
export function reconnectNow() { attempts = 0; if (!status.server) connect(); }

// The server pings every 3 s; a silent socket is a dead one (e.g. PC slept,
// cable pulled) even if the browser has not noticed yet.
setInterval(() => {
  if (status.server && ws && Date.now() - lastSeen > 9000) ws.close();
}, 2000);
addEventListener('online', reconnectNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconnectNow(); });
