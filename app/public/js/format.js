// Value <-> display conversions for 01V96 parameters. Lookup tables come from
// /data/tables.json (console display tables) and /data/effects.json.

export let T = null;
export let FX = null;
export let EL = null;

export async function loadData() {
  const [t, fx, el] = await Promise.all(['tables', 'effects', 'elements'].map(n => fetch(`/data/${n}.json`).then(r => r.json())));
  T = t; FX = fx; EL = Object.fromEntries(el.map(e => [e.name, e.element]));
  ZERO_DB = T.dbMap.findIndex(v => v >= 0);
}

export let ZERO_DB = 823;

export function faderDb(v) {
  const d = T.dbMap[Math.max(0, Math.min(1023, v | 0))];
  if (d <= -138) return '-∞';
  return (d > 0 ? '+' : '') + (Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(1));
}

export const pan = v => (v === 0 ? 'C' : v < 0 ? 'L' + -v : 'R' + v);
export const tenths = (v, unit = 'dB') => (v > 0 ? '+' : '') + (v / 10).toFixed(1) + (unit ? ' ' + unit : '');
export const eqFreq = v => (T.freqMap[v] ?? v) + 'Hz';

export function eqFreqHz(v) {
  const s = T.freqMap[v];
  if (!s) return 1000;
  return s.endsWith('k') ? parseFloat(s) * 1000 : parseFloat(s);
}

export function eqQ(v) {
  const s = T.qMap[v];
  if (s === 'Lo') return 'L.SHELF';
  if (s === 'Hi') return 'H.SHELF';
  return s ?? String(v);
}

export function eqQValue(v) {
  const s = T.qMap[v];
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export const gateHold = v => T.holdTime48Map[v] ?? v;
export const decay = v => T.decay48Map[v] ?? v;
export const ratio = v => T.ratioMap[v] ?? v;
export const knee = v => T.kneeMap[v] ?? v;
export const ms = v => v + ' ms';

// Effect parameters ---------------------------------------------------------

// A type's parameter list. Values wider than 14 bits occupy two consecutive
// slots (high, low), which the catalogue lists as the same name twice.
export function fxLayout(type) {
  const t = FX[type];
  if (!t) return [];
  const out = [];
  for (let i = 0; i < t.params.length; i++) {
    const p = t.params[i];
    if (!p || p.name == null) continue;
    const wide = p.max > 0x3fff;
    out.push({ ...p, slot: i, wide });
    if (wide) i++;
  }
  return out;
}

export function fxDisplay(p, raw) {
  const v = raw + (p.offset || 0);
  if (p.options) return p.options[raw] ?? String(v);
  if (p.labels) return p.labels[raw] ?? String(v);
  if (p.kind === 0 || p.kind === 1) {
    const n = p.decimals ? (v / 10 ** p.decimals).toFixed(p.decimals) : String(v);
    const sign = p.kind === 1 && v > 0 ? '+' : '';
    return sign + n + (p.unit ? ' ' + p.unit : '');
  }
  return String(v) + (p.unit ? ' ' + p.unit : '');
}
