'use strict';
// Yamaha 01V96 SysEx parameter protocol.
//
// Derived by reverse engineering (see docs/protocol.md):
//   change : F0 43 1n 3E <model> <group> <elem> <param> <chan> d0 d1 d2 d3 F7
//   request: F0 43 3n 3E <model> <group> <elem> <param> <chan> F7
// model 0x7F (with group 0x01) addresses the scene/channel parameter table
// shared by the 01V96 V2 family; model 0x0D (0x1A on the 01V96i) addresses the
// 01V96-specific groups (2 = patch/names, 3 = setup, 4 = remote/function,
// 0x21 = level meters). Data is a 28-bit two's-complement value in 4x7 bits.

const MODEL_UNIVERSAL = 0x7f;
const MODEL_01V96 = 0x0d;
const MODEL_01V96I = 0x1a;

function encodeValue(v) {
  const u = v & 0x0fffffff;
  return [(u >> 21) & 0x7f, (u >> 14) & 0x7f, (u >> 7) & 0x7f, u & 0x7f];
}

function decodeValue(d0, d1, d2, d3) {
  let v = (d0 << 21) | (d1 << 14) | (d2 << 7) | d3;
  if (v & 0x8000000) v -= 0x10000000;
  return v;
}

// An address is [group, element, param, channel]. Group 1 travels on the
// universal model; every other group uses the console-specific model byte.
function modelFor(group, model01v96) {
  return group === 1 ? MODEL_UNIVERSAL : model01v96;
}

function buildChange(addr, value, device = 0, model01v96 = MODEL_01V96) {
  const [g, e, p, c] = addr;
  return [0xf0, 0x43, 0x10 | device, 0x3e, modelFor(g, model01v96), g, e, p, c, ...encodeValue(value), 0xf7];
}

function buildRequest(addr, device = 0, model01v96 = MODEL_01V96) {
  const [g, e, p, c] = addr;
  return [0xf0, 0x43, 0x30 | device, 0x3e, modelFor(g, model01v96), g, e, p, c, 0xf7];
}

// Level meters: type 0 = inputs, 1 = buses, 2 = aux, 4 = stereo; 0x7F = stop.
function buildMeterRequest(type, device = 0, model01v96 = MODEL_01V96) {
  if (type === 0x7f) return [0xf0, 0x43, 0x30 | device, 0x3e, model01v96, 0x21, 0x7f, 0, 0, 0, 0, 0xf7];
  return [0xf0, 0x43, 0x30 | device, 0x3e, model01v96, 0x21, type, 0, 0, 0, 1, 0xf7];
}

const METER_STRIDE = { 0: 6, 1: 4, 2: 4, 4: 4 };

// Raw meter word -> 0..127 display scale (same law the console uses on its LEDs).
function meterLevel(word) {
  const v = Math.round((word - 37) * 0.031170805879371516);
  return v < 0 ? 0 : v > 127 ? 127 : v;
}

// Parse one incoming SysEx frame. Returns {kind:'param', addr, value},
// {kind:'meter', type, levels}, {kind:'identify', model} or null.
function parse(m) {
  if (m.length < 7 || m[0] !== 0xf0 || m[1] !== 0x43 || m[3] !== 0x3e) return null;
  const model = m[4];
  if (m.length === 7 && m[5] === 0x7f) return { kind: 'identify', model };
  const paramModel = model === MODEL_UNIVERSAL || model === MODEL_01V96 || model === MODEL_01V96I;
  if ((m[2] & 0xf0) === 0x10 && m.length === 14 && paramModel && m[5] !== 0x21 && m[8] !== 0x7f) {
    return { kind: 'param', addr: [m[5], m[6], m[7], m[8]], value: decodeValue(m[9], m[10], m[11], m[12]) };
  }
  // Reply to an all-channels request (channel 0x7F): one value per channel.
  if ((m[2] & 0xf0) === 0x10 && paramModel && m[8] === 0x7f && m[5] !== 0x21 && (m.length - 10) % 4 === 0 && m.length >= 14) {
    const values = [];
    for (let i = 9; i + 4 < m.length; i += 4) values.push(decodeValue(m[i], m[i + 1], m[i + 2], m[i + 3]));
    return { kind: 'bulk', addr: [m[5], m[6], m[7], 0x7f], values };
  }
  if ((model === MODEL_01V96 || model === MODEL_01V96I) && m[5] === 0x21 && m[7] === 0x7f && m.length > 12) {
    const type = m[6];
    const stride = METER_STRIDE[type] || 4;
    const words = [];
    for (let i = 9; i + 1 < m.length - 1; i += 2) words.push((m[i] << 7) | m[i + 1]);
    // Inputs: pre, post-dyn, post, comp GR, EQ in, gate GR (6 words).
    // Outputs: post, pre, unused, comp GR (4 words). GR word 0x0FFF = none.
    const levels = [];
    for (let i = 0; i + stride <= words.length; i += stride) {
      const r = words.slice(i, i + stride);
      if (type === 0) levels.push([meterLevel(r[0]), meterLevel(r[2]), r[3] === 0x0fff ? 0 : meterLevel(r[3])]);
      else levels.push([meterLevel(r[1]), meterLevel(r[0]), r[3] === 0x0fff ? 0 : meterLevel(r[3])]);
    }
    return { kind: 'meter', type, levels };
  }
  return null;
}

module.exports = {
  MODEL_UNIVERSAL, MODEL_01V96, MODEL_01V96I,
  encodeValue, decodeValue, buildChange, buildRequest, buildMeterRequest, parse, meterLevel,
};
