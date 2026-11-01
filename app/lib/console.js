'use strict';
// MIDI link to the 01V96: port discovery, paced parameter requests, state cache
// and meter streaming. Emits 'param' (key, value, source), 'meter', 'status'.

const { EventEmitter } = require('events');
const midi = require('@julusian/midi');
const proto = require('./protocol');
const { syncPlan } = require('./model');

const key = a => a.join(':');

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
    return { connected: this.connected, port: this.portName, sync: { ...this.sync } };
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
    if (title != null) this.setSceneTitle(n, title);
  }

  setSceneTitle(n, title) {
    const t = String(title).padEnd(16, ' ').slice(0, 16);
    const chars = [...t].map(ch => ch.charCodeAt(0) & 0x7f);
    this.send([0xf0, 0x43, 0x10 | this.device, 0x3e, 0x7f, 0x10, 0x40, (n >> 7) & 0x7f, n & 0x7f, ...chars, 0xf7]);
    this.state.set('scene:' + n, t.trimEnd());
    this.emit('scene', n, t.trimEnd());
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
      if (this.failed.length) this.emit('error', new Error(`sync: no reply for ${this.failed.length} addresses: ${this.failed.slice(0, 20).join(' ')}`));
    }
    if (this.sync.done % 100 === 0 || !this.sync.running) this.emit('status', this.status());
  }

  onMessage(m) {
    // Scene title dump: F0 43 1n 3E 7F 10 40 hi lo <16 chars> F7
    if (m.length === 26 && m[4] === 0x7f && m[5] === 0x10 && m[6] === 0x40) {
      const n = (m[7] << 7) | m[8];
      const t = String.fromCharCode(...m.slice(9, 25)).trimEnd();
      this.state.set('scene:' + n, t);
      this.emit('scene', n, t);
      return;
    }
    const r = proto.parse(m);
    if (!r) return;
    if (r.kind === 'param') {
      const k = key(r.addr);
      if (this.inflight.delete(k)) { this.retries.delete(k); this.progress(); }
      this.store(r.addr, r.value, 'console');
    } else if (r.kind === 'bulk') {
      const k = key(r.addr);
      if (this.inflight.delete(k)) { this.retries.delete(k); this.progress(); }
      const [g, e, p] = r.addr;
      r.values.forEach((v, c) => this.store([g, e, p, c], v, 'console'));
    } else if (r.kind === 'meter') {
      this.emit('meter', r.type, r.levels);
    }
  }
}

module.exports = { Console01V96 };
