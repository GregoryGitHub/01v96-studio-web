'use strict';
// 01V96 parameter model: which addresses exist for each strip and which ones
// the server syncs. Element numbers come from the Studio Manager table
// (data/elements.json); group-2 elements are table index - 0x69.

const elements = require('../data/elements.json');
const byName = Object.fromEntries(elements.map(e => [e.name, e]));

const G1 = 1, G_NAME = 2, G_SETUP = 3, G_FUNC = 4;

function el(name) {
  const e = byName[name];
  if (!e) throw new Error('unknown element ' + name);
  return e;
}

// Group-2 elements are numbered from kChannelInput = 1.
const NAME_ELEM = {
  in: el('kInputChannelName').element - 0x69,      // 0x04
  stin: el('kStereoInChannelName').element - 0x69, // 0x17
  bus: el('kBusModuleName').element - 0x69,
  aux: el('kAUXModuleName').element - 0x69,
  st: el('kStereoOutModuleName').element - 0x69,
};

// [elementName, params (array of indices) or null = all]
const INPUT_ELEMS = [
  ['kInputPhase', null], ['kInputPair', null], ['kInputInsert', [0]], ['kInputChannelOn', null],
  ['kInputChannelPan', null], ['kInputFader', [0]], ['kInputAttenuator', [0]], ['kInputGate', null],
  ['kInputComp', null], ['kInputEQ', null], ['kInputDelay', null], ['kInputRouting', null],
  ['kInputAUX', range(24)], ['kInputAUXPan', range(4)], ['kInputGroup', [...range(16), 24, 25, 26]],
];
const BUS_ELEMS = [
  ['kBusPair', null], ['kBusInsert', [0]], ['kBusChannelOn', null], ['kBusBalance', null], ['kBusFader', [0]],
  ['kBusAttenuator', [0]], ['kBusComp', null], ['kBusEQ', null], ['kBusDelay', null], ['kBusToStereo', null],
];
const AUX_ELEMS = [
  ['kAUXPair', null], ['kAUXInsert', [0]], ['kAUXChannelOn', null], ['kAUXType', null], ['kAUXBalance', null],
  ['kAUXFader', [0]], ['kAUXAttenuator', [0]], ['kAUXComp', null], ['kAUXEQ', null], ['kAUXDelay', null],
];
const ST_ELEMS = [
  ['kStereoInsert', [0]], ['kStereoChannelOn', null], ['kStereoBalance', null], ['kStereoFader', [0]],
  ['kStereoAttenuator', [0]], ['kStereoComp', null], ['kStereoEQ', null], ['kStereoDelay', null],
];

function range(n) { return [...Array(n).keys()]; }

// Every request asks for all channels at once (channel 0x7F); the console
// answers with one value per channel of that element.
const ALL = 0x7f;

function expand(list) {
  const out = [];
  for (const [name, params] of list) {
    const e = el(name);
    const ps = params || e.params.map(p => p.index);
    for (const p of ps) out.push([G1, e.element, p, ALL]);
  }
  return out;
}

function nameAddrs(elem) {
  return [0, 1, 2, 3].map(p => [G_NAME, elem, p, ALL]);
}

const FX_ELEM = el('kEffect').element;

// Sync plan in priority order: the console surface first, deep parameters after.
function syncPlan() {
  const quick = [
    ...nameAddrs(NAME_ELEM.in), ...nameAddrs(NAME_ELEM.stin),
    ...expand([['kInputChannelOn', null], ['kInputFader', [0]], ['kInputChannelPan', null]]),
    ...expand([['kAUXChannelOn', null], ['kAUXFader', [0]], ['kBusChannelOn', null], ['kBusFader', [0]]]),
    ...expand([['kStereoChannelOn', null], ['kStereoFader', [0]], ['kStereoBalance', null]]),
    ...nameAddrs(NAME_ELEM.aux), ...nameAddrs(NAME_ELEM.bus), ...nameAddrs(NAME_ELEM.st),
    [G_FUNC, 0x0a, 0, 0], [G_FUNC, 0x09, 0, 0],
  ];
  const fx = [];
  for (let p = 0; p <= 52; p++) fx.push([G1, FX_ELEM, p, ALL]);
  const deep = [
    ...fx, ...expand(INPUT_ELEMS), ...expand(AUX_ELEMS), ...expand(BUS_ELEMS), ...expand(ST_ELEMS),
    ...expand([['kInFaderGrpMaster', null], ['kOutFaderGrpMaster', null], ['kInMuteGrpMaster', null], ['kOutMuteGrpMaster', null]]),
    ...expand([['kAuxSendPrePoint', null]]),
    [G_SETUP, 0x2d, 0, 0], [G_SETUP, 0x2e, 0, ALL],
  ];
  const seen = new Set();
  return [...quick, ...deep].filter(a => { const k = a.join(':'); if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { elements, el, NAME_ELEM, FX_ELEM, G1, G_NAME, G_SETUP, G_FUNC, syncPlan };
