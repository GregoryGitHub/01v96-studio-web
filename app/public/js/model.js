// Client-side description of 01V96 strips and their parameter addresses.
import { EL } from './format.js';
import * as S from './store.js';

const G1 = 1, G_NAME = 2, G_SETUP = 3;

// Element-name prefixes per strip kind (Studio Manager naming).
const PREFIX = { in: 'kInput', aux: 'kAUX', bus: 'kBus', st: 'kStereo' };
// Group-2 name elements (Studio Manager table index - 0x69).
const NAME_EL = { in: 0x04, stin: 0x17, bus: 0x0f, aux: 0x10, st: 0x12 };

export const strips = {
  in: Array.from({ length: 32 }, (_, i) => ({ kind: 'in', c: i, id: `in${i}`, label: `CH${i + 1}`, meter: [0, i] })),
  stin: Array.from({ length: 8 }, (_, i) => ({ kind: 'in', stin: true, c: 32 + i, id: `in${32 + i}`, label: `ST${(i >> 1) + 1}${i & 1 ? 'R' : 'L'}`, meter: [0, 32 + i] })),
  aux: Array.from({ length: 8 }, (_, i) => ({ kind: 'aux', c: i, id: `aux${i}`, label: `AUX${i + 1}`, meter: [2, i] })),
  bus: Array.from({ length: 8 }, (_, i) => ({ kind: 'bus', c: i, id: `bus${i}`, label: `BUS${i + 1}`, meter: [1, i] })),
  st: [{ kind: 'st', c: 0, id: 'st0', label: 'STEREO', meter: [4, 0] }],
};
export const allStrips = [...strips.in, ...strips.stin, ...strips.aux, ...strips.bus, ...strips.st];
export const stripById = id => allStrips.find(s => s.id === id);

function elem(kind, suffix) {
  const n = EL[PREFIX[kind] + suffix];
  if (n == null) throw new Error('no element ' + PREFIX[kind] + suffix);
  return n;
}

export const addr = (s, suffix, p = 0) => S.key(G1, elem(s.kind, suffix), p, s.c);

export const k = {
  on: s => addr(s, 'ChannelOn'),
  fader: s => addr(s, 'Fader'),
  pan: s => (s.kind === 'in' ? addr(s, 'ChannelPan') : addr(s, 'Balance')),
  att: s => addr(s, 'Attenuator'),
  eq: (s, p) => addr(s, 'EQ', p),
  comp: (s, p) => addr(s, 'Comp', p),
  gate: (s, p) => addr(s, 'Gate', p),
  delay: (s, p) => addr(s, 'Delay', p),
  insert: s => addr(s, 'Insert'),
  phase: s => addr(s, 'Phase'),
  pair: s => addr(s, 'Pair'),
  routing: (s, p) => addr(s, 'Routing', p),
  group: (s, p) => (s.kind === 'in' ? addr(s, 'Group', p) : addr(s, 'OutGroup', p)),
  // Input -> AUX send n (0..7): on, pre, level
  sendOn: (s, n) => addr(s, 'AUX', n * 3),
  sendPre: (s, n) => addr(s, 'AUX', n * 3 + 1),
  send: (s, n) => addr(s, 'AUX', n * 3 + 2),
  sendPan: (s, pair) => addr(s, 'AUXPan', pair),
  busToSt: (s, p) => addr(s, 'ToStereo', p),
  cue: s => S.key(G_SETUP, 0x2e, 0, s.c),
};

export function nameKeys(s) {
  if (s.kind === 'in' && s.stin) return [0, 1, 2, 3].map(p => S.key(G_NAME, NAME_EL.stin, p, (s.c - 32) >> 1));
  return [0, 1, 2, 3].map(p => S.key(G_NAME, NAME_EL[s.kind], p, s.c));
}

export function name(s) {
  const ks = nameKeys(s);
  if (!ks.some(S.has)) return s.label;
  const n = ks.map(x => String.fromCharCode(S.get(x, 32) || 32)).join('').trimEnd();
  return n || s.label;
}

export function setName(s, text) {
  const t = (text || '').padEnd(4, ' ').slice(0, 4);
  nameKeys(s).forEach((x, i) => S.set(x, t.charCodeAt(i) & 0x7f));
}

export const fxKey = (unit, p) => S.key(G1, EL.kEffect, p, unit);
export const FX_PARAM0 = 16, FX_MIX = 48, FX_TYPE = 49, FX_BYPASS = 52;
