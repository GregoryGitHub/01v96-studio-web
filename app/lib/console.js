'use strict';
// MIDI link to the 01V96: port discovery, paced parameter requests, state cache
// and meter streaming. Emits 'param' (key, value, source), 'meter', 'status'.

const { EventEmitter } = require('events');
const midi = require('@julusian/midi');
const proto = require('./protocol');
const { syncPlan, el } = require('./model');

const key = a => a.join(':');
// Elements whose param 0 is a physical fader on the surface.
const FADER_ELEMS = new Set(['kInputFader', 'kAUXFader', 'kBusFader', 'kStereoFader'].map(n => el(n).element));

class Console01V96 extends EventEmitter {
  constructor({ portMatch = /01V96(i)?-1\b/i, device = 0 } = {}) {
    super();
    this.portMatch = portMatch;
    this.device = device;
    this.model = proto.MODEL_01V96;
    this.state = new Map();
    this.input = null;
    this.output = null;
    this.portName = null;
    this.queue = [];          // pending request addresses (deduped)
    this.queued = new Set();
    this.inflight = new Map(); // key -> {addr, sent, tries}
    this.retries = new Map();
    this.faderLock = false;
    this.reassert = new Map();
    // Requests in flight. The console answers in order but its USB-MIDI output
    // is slow (and shared with meters), so replies can lag by hundreds of ms;
    // it silently drops all-channel requests that arrive while it is busy.
    this.window = 2;
    this.failed = [];
    this.timeoutMs = 1500;
    this.sync = { total: 0, done: 0, running: false };
    this.metersUntil = 0;
    this.timer = setInterval(() => this.tick(), 5);
    this.watch = setInterval(() => this.ensureOpen(), 3000);
    this.ensureOpen();
  }

  get connected() { return !!this.output; }

  status() {
    return { connected: this.connected, port: this.portName, sync: { ...this.sync }, faderLock: this.faderLock };
  }

  // "Logical faders": ignore level changes coming from the console's physical
  // faders (worn/dirty faders report noise) and keep the console at the level
  // set in the app by re-sending it. Values arriving while the initial sync
  // runs are still accepted so the app learns the starting levels.
  setFaderLock(on) {
    this.faderLock = !!on;
    this.emit('status', this.status());
  }

  isFaderKey(addr) {
    return addr[0] === 1 && addr[2] === 0 && FADER_ELEMS.has(addr[1]);
  }

  // Returns true when the incoming value must be discarded.
  guardFader(addr, value) {
    if (!this.faderLock || this.sync.running || !this.isFaderKey(addr)) return false;
    const k = key(addr);
    const mine = this.state.get(k);
    if (mine === undefined || mine === value) return false;
    // Small noise is ignored silently; larger moves are pushed back to our value,
    // at most every 250 ms per fader so a noisy fader cannot flood the link.
    if (Math.abs(mine - value) > 3) {
      const now = Date.now();
      if (now - (this.reassert.get(k) || 0) > 250) {
        this.reassert.set(k, now);
        this.send(proto.buildChange(addr, mine, this.device, this.model));
      }
    }
    return true;
  }

  // Is the console still listed by the MIDI driver?
  portPresent() {
    try {
      const o = new midi.Output();
      for (let k = 0; k < o.getPortCount(); k++) if (this.portMatch.test(o.getPortName(k))) return true;
      return false;
    } catch { return true; }
  }

  ensureOpen() {
    if (this.output) {
      // Only drop the link when the device is really gone (USB unplugged or
      // console switched off): closing a live WinMM port can crash the driver.
      if (!this.portPresent()) this.close();
      return;
    }
    try {
      const i = new midi.Input(), o = new midi.Output();
      const find = dev => { for (let k = 0; k < dev.getPortCount(); k++) if (this.portMatch.test(dev.getPortName(k))) return k; return -1; };
      const ip = find(i), op = find(o);
      if (ip < 0 || op < 0) { i.closePort?.(); return; }
      i.ignoreTypes(false, true, true);
      i.on('message', (dt, m) => this.onMessage(m));
      i.openPort(ip);
      o.openPort(op);
      this.input = i; this.output = o; this.portName = o.getPortName(op);
      this.model = /01V96i/i.test(this.portName) ? proto.MODEL_01V96I : proto.MODEL_01V96;
      this.emit('status', this.status());
      this.resync();
    } catch (err) {
      this.close();
      this.emit('error', err);
    }
  }

  close() {
    try { this.input?.closePort(); } catch {}
    try { this.output?.closePort(); } catch {}
    this.input = this.output = null;
    this.inflight.clear();
    this.emit('status', this.status());
  }

  send(bytes) {
    if (!this.output) return false;
    try {
      this.output.sendMessage(bytes);
      return true;
    } catch (err) {
      // Transient WinMM failures ("error preparing sysex header") happen when
      // the driver is busy; keep the ports open and let ensureOpen() decide
      // whether the device actually went away.
      const now = Date.now();
      if (now - (this.lastSendError || 0) > 2000) this.emit('error', err);
      this.lastSendError = now;
      return false;
    }
  }

  resync() {
    const plan = syncPlan();
    this.sync = { total: plan.length, done: 0, running: true };
    this.failed = [];
    for (const a of plan) this.request(a);
    this.emit('status', this.status());
  }

  request(addr) {
    const k = key(addr);
    if (this.queued.has(k) || this.inflight.has(k)) return;
    this.queued.add(k);
    this.queue.push(addr);
  }

  // Write a parameter. `source` identifies the originating client so it is
  // not echoed back to itself.
  set(addr, value, source = null) {
    value = Math.round(value);
    this.send(proto.buildChange(addr, value, this.device, this.model));
    this.store(addr, value, source);
  }

  store(addr, value, source) {
    const k = key(addr);
    if (this.state.get(k) === value) return;
    this.state.set(k, value);
    this.emit('param', k, value, source);
  }

  recallScene(n) {
    this.send([0xf0, 0x43, 0x10 | this.device, 0x3e, 0x7f, 0x10, 0x00, (n >> 7) & 0x7f, n & 0x7f, 0x02, 0x00, 0xf7]);
    // The console broadcasts the changed parameters; refresh everything anyway
    // so values that are not echoed (names, effects) stay accurate.
    setTimeout(() => this.resync(), 400);
  }

  storeScene(n, title) {
    this.send([0xf0, 0x43, 0x10 | this.device, 0x3e, 0x7f, 0x10, 0x20, (n >> 7) & 0x7f, n & 0x7f, 0x02, 0x00, 0xf7]);
    // Give the console time to write the memory before renaming it.
    if (title != null) setTimeout(() => this.setSceneTitle(n, title), 400);
    setTimeout(() => this.request([4, 0x0a, 0, 0]), 600);
  }

  setSceneTitle(n, title) {
    // The console only displays printable ASCII; strip accents (ç -> c, ã -> a).
    const ascii = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
    const t = ascii.padEnd(16, ' ').slice(0, 16);
    const chars = [...t].map(ch => ch.charCodeAt(0));
    this.send([0xf0, 0x43, 0x10 | this.device, 0x3e, 0x7f, 0x10, 0x40, (n >> 7) & 0x7f, n & 0x7f, ...chars, 0xf7]);
    // Read it back so every client shows what the console really stored.
    setTimeout(() => this.send([0xf0, 0x43, 0x30 | this.device, 0x3e, 0x7f, 0x10, 0x40, (n >> 7) & 0x7f, n & 0x7f, 0xf7]), 300);
  }

  requestSceneTitles(from = 1, to = 99) {
    this.sceneQueue = [];
    for (let n = from; n <= to; n++) this.sceneQueue.push(n);
  }

  selectChannel(c) {
    this.send([0xf0, 0x43, 0x10 | this.device, 0x3e, this.model, 0x04, 0x09, 0x18, 0x00, 0, 0, (c >> 7) & 0x7f, c & 0x7f, 0xf7]);
  }

  meters(on) {
    this.metersUntil = on ? Date.now() + 10000 : 0;
    if (!on) this.send(proto.buildMeterRequest(0x7f, this.device, this.model));
  }

  tick() {
    if (!this.output) return;
    const now = Date.now();
    for (const [k, f] of this.inflight) {
      if (now - f.sent > this.timeoutMs) {
        this.inflight.delete(k);
        // Retry at the back of the queue so a stuck address does not block the rest.
        if (f.tries < 3) { this.queue.push(f.addr); this.queued.add(k); this.retries.set(k, f.tries + 1); }
        else { this.retries.delete(k); this.failed.push(k); this.progress(); }
      }
    }
    while (this.inflight.size < this.window && this.queue.length) {
      const a = this.queue.shift();
      const k = key(a);
      this.queued.delete(k);
      this.inflight.set(k, { addr: a, sent: now, tries: this.retries.get(k) || 0 });
      this.send(proto.buildRequest(a, this.device, this.model));
    }
    if (this.sceneQueue?.length && this.inflight.size === 0 && !this.queue.length && now - (this.lastScene || 0) > 25) {
      const n = this.sceneQueue.shift();
      this.lastScene = now;
      this.send([0xf0, 0x43, 0x30 | this.device, 0x3e, 0x7f, 0x10, 0x40, (n >> 7) & 0x7f, n & 0x7f, 0xf7]);
    }
    if (this.metersUntil > now && now - (this.lastMeter || 0) > 2000) {
      this.lastMeter = now;
      for (const t of [0, 1, 2, 4]) this.send(proto.buildMeterRequest(t, this.device, this.model));
    }
  }

  progress() {
    if (!this.sync.running) return;
    this.sync.done++;
    if (this.sync.done >= this.sync.total && this.queue.length === 0) {
      this.sync.running = false;
      // Scene titles are cheap (one frame each); keep them in the state so the
      // scene picker is ready on every client.
      this.requestSceneTitles();
      if (this.failed.length) this.emit('error', new Error(`sync: no reply for ${this.failed.length} addresses: ${this.failed.slice(0, 20).join(' ')}`));
    }
    if (this.sync.done % 100 === 0 || !this.sync.running) this.emit('status', this.status());
  }

  // Debug: send a raw *request* (F0 43 3n ...). Writes are refused so the
  // debug channel can never change the mix.
  rawRequest(bytes) {
    if (!Array.isArray(bytes) || bytes[0] !== 0xf0 || bytes[1] !== 0x43 || (bytes[2] & 0xf0) !== 0x30 || bytes.at(-1) !== 0xf7) return false;
    if (!bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 0xff)) return false;
    return this.send(bytes);
  }

  onMessage(m) {
    // Scene title dump: F0 43 1n 3E 7F 10 40 hi lo <16 chars> F7
    if (m.length === 26 && m[4] === 0x7f && m[5] === 0x10 && m[6] === 0x40) {
      const n = (m[7] << 7) | m[8];
      // Empty memories answer "[   No Data!   ]"; expose them as null.
      const raw = String.fromCharCode(...m.slice(9, 25));
      const t = /No Data!/.test(raw) ? null : raw.trimEnd();
      this.state.set('scene:' + n, t);
      this.emit('scene', n, t);
      return;
    }
    const r = proto.parse(m);
    if (!r) { this.emit('raw', m); return; }
    if (r.kind === 'param') {
      const k = key(r.addr);
      if (this.inflight.delete(k)) { this.retries.delete(k); this.progress(); }
      if (!this.guardFader(r.addr, r.value)) this.store(r.addr, r.value, 'console');
    } else if (r.kind === 'bulk') {
      const k = key(r.addr);
      if (this.inflight.delete(k)) { this.retries.delete(k); this.progress(); }
      const [g, e, p] = r.addr;
      r.values.forEach((v, c) => { if (!this.guardFader([g, e, p, c], v)) this.store([g, e, p, c], v, 'console'); });
    } else if (r.kind === 'meter') {
      this.emit('meter', r.type, r.levels);
    }
  }
}

module.exports = { Console01V96 };
