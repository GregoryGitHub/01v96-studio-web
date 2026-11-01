// 4-band parametric EQ model of the 01V96 plus a "graphic EQ" that fits the
// four bands to a set of bar gains.
//
// Band type encoding (observed on the console, see docs/protocol.md):
//   Q 0..40          peaking, Q = qMap[index] (10.0 .. 0.10)
//   LOW  Q 41 + flag(p4)=1   low shelf,  flag=0  high-pass filter
//   HIGH Q 42 + flag(p14)=1  high shelf, flag=0  low-pass filter
import * as F from './format.js';

export const BANDS = [
  { id: 'low', name: 'LOW', q: 1, f: 2, g: 3, flag: 4, shelfQ: 41, shelf: 'L.SHELF', filter: 'HPF' },
  { id: 'lmid', name: 'L-MID', q: 5, f: 6, g: 7 },
  { id: 'hmid', name: 'H-MID', q: 8, f: 9, g: 10 },
  { id: 'high', name: 'HIGH', q: 11, f: 12, g: 13, flag: 14, shelfQ: 42, shelf: 'H.SHELF', filter: 'LPF' },
];
export const EQ_ON = 15, EQ_MODE = 0;
export const F_MIN = 5, F_MAX = 124, Q_PEAK_MAX = 40, G_MAX = 180;

// v = array of the 16 EQ parameter values
export function bandType(b, v) {
  if (!b.flag || v[b.q] <= Q_PEAK_MAX) return 'peak';
  return v[b.flag] ? 'shelf' : 'filter';
}

// Parameter writes that switch a band to `type`, keeping the peak Q when possible.
export function typeWrites(b, type, v, lastPeakQ = 23) {
  if (type === 'peak') return [[b.q, v[b.q] <= Q_PEAK_MAX ? v[b.q] : lastPeakQ]];
  return [[b.q, b.shelfQ], [b.flag, type === 'shelf' ? 1 : 0]];
}

// Snap a frequency in Hz to the console's frequency table.
export function freqIndex(hz) {
  let best = F_MIN, err = Infinity;
  for (let i = F_MIN; i <= F_MAX; i++) { const e = Math.abs(Math.log(F.eqFreqHz(i) / hz)); if (e < err) { err = e; best = i; } }
  return best;
}

// RBJ cookbook magnitude (dB) at 48 kHz. Close to, not identical with, the
// console's own filters: good enough for display and fitting.
export function biquadDb(type, f0, gainDb, Q, f) {
  const fs = 48000, A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * Math.min(f0, 22000) / fs, cw = Math.cos(w0), sw = Math.sin(w0);
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

// Filters described by the current parameters: [kind, f0, gainDb, Q]
export function filters(v) {
  return BANDS.map(b => {
    const f0 = F.eqFreqHz(v[b.f]), g = v[b.g] / 10, t = bandType(b, v);
    if (t === 'filter') return [b.id === 'low' ? 'hpf' : 'lpf', f0, 0, 0.7];
    if (t === 'shelf') return [b.id === 'low' ? 'lowshelf' : 'highshelf', f0, g, 0.7];
    return ['peak', f0, g, F.eqQValue(v[b.q]) || 1];
  });
}

export const response = (fl, f) => fl.reduce((a, [t, f0, g, q]) => a + biquadDb(t, f0, g, q, f), 0);

// ---- Graphic EQ ---------------------------------------------------------------

export const GEQ_FREQS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const GEQ_LABELS = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const GEQ_RANGE = 12;

// Target curve on a dense log grid, interpolated between the bars (in log f).
function targetGrid(bars) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const f = 25 * Math.pow(18000 / 25, i / 48);
    const x = Math.log2(f / 31.5);
    const j = Math.max(0, Math.min(bars.length - 2, Math.floor(x)));
    const t = Math.max(0, Math.min(1, x - j));
    pts.push([f, bars[j] * (1 - t) + bars[j + 1] * t]);
  }
  return pts;
}

// Fit the four bands to the bar gains. Returns the 16-value parameter array
// (only bands, types and gains are touched; EQ ON and mode are left as given).
// Low/high bands may be shelves or peaks; the mids are peaks. Coordinate
// descent over the console's discrete steps, seeded from the bar shape.
export function fitGraphic(bars, base) {
  const grid = targetGrid(bars);
  const v = base.slice();
  // Seed: shelves at the ends, mids on the two largest remaining deviations.
  v[1] = 41; v[4] = 1; v[2] = freqIndex(90); v[3] = Math.round(((bars[0] + bars[1]) / 2) * 10);
  v[11] = 42; v[14] = 1; v[12] = freqIndex(9000); v[13] = Math.round(((bars[8] + bars[9]) / 2) * 10);
  const resid = bars.map((g, i) => (i < 2 ? g - v[3] / 10 : i > 7 ? g - v[13] / 10 : g));
  const order = resid.map((r, i) => [Math.abs(r), i]).filter(([, i]) => i >= 2 && i <= 7).sort((a, b) => b[0] - a[0]);
  const [m1, m2] = [order[0]?.[1] ?? 4, order.find(([, i]) => Math.abs(i - (order[0]?.[1] ?? 4)) >= 2)?.[1] ?? 7].sort((a, b) => a - b);
  v[6] = freqIndex(GEQ_FREQS[m1]); v[7] = Math.round(bars[m1] * 10); v[5] = 23;
  v[9] = freqIndex(GEQ_FREQS[m2]); v[10] = Math.round(bars[m2] * 10); v[8] = 23;

  const cost = vv => { const fl = filters(vv); let e = 0; for (const [f, t] of grid) { const d = response(fl, f) - t; e += d * d; } return e; };
  const clampG = g => Math.max(-G_MAX, Math.min(G_MAX, g));
  const moves = [
    [3, [-20, -5, 5, 20], clampG], [2, [-4, -1, 1, 4]], [13, [-20, -5, 5, 20], clampG], [12, [-4, -1, 1, 4]],
    [7, [-20, -5, -1, 1, 5, 20], clampG], [6, [-4, -1, 1, 4]], [5, [-3, -1, 1, 3]],
    [10, [-20, -5, -1, 1, 5, 20], clampG], [9, [-4, -1, 1, 4]], [8, [-3, -1, 1, 3]],
  ];
  let best = cost(v);
  for (let round = 0; round < 40; round++) {
    let improved = false;
    for (const [p, steps, clamp] of moves) {
      for (const s of steps) {
        const old = v[p];
        let nv = old + s;
        if (p === 2 || p === 6 || p === 9 || p === 12) nv = Math.max(F_MIN, Math.min(F_MAX, nv));
        if (p === 5 || p === 8) nv = Math.max(0, Math.min(Q_PEAK_MAX, nv));
        if (clamp) nv = clamp(nv);
        if (nv === old) continue;
        v[p] = nv;
        const c = cost(v);
        if (c < best - 1e-6) { best = c; improved = true; } else v[p] = old;
      }
    }
    // Let the end bands switch between shelf and peak when that fits better.
    for (const b of [BANDS[0], BANDS[3]]) {
      const old = [v[b.q], v[b.flag]];
      v[b.q] = v[b.q] === b.shelfQ ? 18 : b.shelfQ; v[b.flag] = 1;
      const c = cost(v);
      if (c < best - 1e-6) { best = c; improved = true; } else [v[b.q], v[b.flag]] = old;
    }
    if (!improved) break;
  }
  return { values: v, rms: Math.sqrt(best / grid.length) };
}
