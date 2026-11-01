// Turn decompiled effect value formatters (Ghidra, via `rea decompile-all`) into
// per-parameter label arrays in effects.json.
// usage: node formatters.js <01V96.dll> <functions dir> <dec_0x100be6b0.json> <effects in> <effects out>
const fs = require('fs');
const path = require('path');
const { b, va2o } = require('./pe.js');
const [, , , dir, switchJson, inFile, outFile] = process.argv;

// curve id -> function name, from the FUN_100be6b0 switch
const sw = JSON.parse(fs.readFileSync(switchJson, 'utf8'));
const swCode = typeof sw.normalized_result === 'string' ? sw.normalized_result : sw.normalized_result.pseudocode;
const curveFn = {};
for (const m of swCode.matchAll(/case (0x[0-9a-f]+|\d+):\s*\n\s*(FUN_[0-9a-f]+)\(/g)) curveFn[parseInt(m[1])] = m[2];

const decimalsFmt = (n, dec) => (dec ? (n / 10 ** dec).toFixed(dec) : String(n));

function analyse(fn) {
  const file = path.join(dir, '0x' + fn.slice(4) + '.c');
  if (!fs.existsSync(file)) return null;
  const c = fs.readFileSync(file, 'utf8');
  let m;
  // String table: (&DAT_X)[param_1 * N]
  if ((m = c.match(/\(&DAT_([0-9a-f]+)\)\[param_1 \* (\d+)\]/))) {
    const base = va2o(parseInt(m[1], 16));
    const stride = +m[2];
    const width = (c.match(/\(&DAT_[0-9a-f]+\)\[(?:param_1 \* \d+|iVar1)\]/g) || []).length;
    let special = null;
    const lit = c.match(/builtin_strncpy\(param_2,"([^"]*)"/);
    const chars = [...c.matchAll(/param_2\[(\d)\] = 0x([0-9a-f]+);/g)].map(x => [+x[1], parseInt(x[2], 16)]);
    let text = null;
    if (lit) text = lit[1].trim();
    else if (chars.length) { const a = Array(8).fill(' '); chars.forEach(([i, ch]) => (a[i] = String.fromCharCode(ch))); text = a.join('').trim(); }
    if (/param_1 != 0\)/.test(c)) special = { when: 'zero', text };
    else if (/param_1 != \*\(int \*\)\(param_3 \+ 0xc\)/.test(c)) special = { when: 'max', text };
    return { type: 'table', base, stride, width, special };
  }
  // Numeric: sprintf("%6d", param_1 * M [+ C]) or (param_1 + C)
  if ((m = c.match(/sprintf\(param_2,"%6d",([^;]+)\);/))) {
    const expr = m[1].trim();
    let mul = 1, add = 0, mm;
    if ((mm = expr.match(/^param_1 \* (-?\d+)$/))) mul = +mm[1];
    else if ((mm = expr.match(/^param_1 \+ (-?(?:0x)?[0-9a-f]+)$/))) add = parseInt(mm[1]);
    else if ((mm = expr.match(/^param_1 \* (-?\d+) \+ (-?(?:0x)?[0-9a-f]+)$/))) { mul = +mm[1]; add = parseInt(mm[2]); }
    else if (expr !== 'param_1') return null;
    const off = c.match(/builtin_strncpy\(param_2,"([^"]*)"/);
    return { type: 'num', mul, add, signed: /\*param_2 = '\+'/.test(c), zeroText: off && /param_1 != 0|param_1 == 0/.test(c) ? off[1].trim() : null };
  }
  return null;
}

const effects = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const stats = { table: 0, num: 0, curve: 0, none: new Set() };

// Unsigned values with the table flag read a u16 display value from
// PTR_DAT_10241940[curve] (FUN_100ba830 case 0). Only entries that point
// into .rdata are value tables.
const PTRS = va2o(0x10241940);
for (const t of effects) for (const p of t.params) {
  if (!p || p.name == null || p.kind !== 0 || !p.table) continue;
  const ptr = b.readUInt32LE(PTRS + p.curve * 4);
  if (ptr < 0x101f7000 || ptr >= 0x102e1000) continue;
  const o = va2o(ptr);
  p.labels = [];
  for (let raw = 0; raw <= p.max; raw++) {
    const n = b.readUInt16LE(o + (raw + (p.offset || 0)) * 2);
    p.labels.push((decimalsFmt(n, p.decimals) + (p.unit ? ' ' + p.unit : '')).trim());
  }
  stats.curve++;
}

for (const t of effects) for (const p of t.params) {
  if (!p || p.name == null || p.options || !(p.kind === 2 || p.kind === 3)) continue;
  const fn = curveFn[p.curve];
  const spec = fn && analyse(fn);
  if (!spec) { stats.none.add(fn || 'curve' + p.curve); continue; }
  const labels = [];
  for (let raw = 0; raw <= p.max; raw++) {
    const v = raw + (p.offset || 0);
    if (spec.type === 'table') {
      if (spec.special && ((spec.special.when === 'zero' && v === 0) || (spec.special.when === 'max' && raw === p.max))) { labels.push(spec.special.text); continue; }
      const o = spec.base + v * spec.stride;
      labels.push((b.toString('latin1', o, o + Math.max(spec.width, 1)).replace(/\0.*$/, '').trim() + (p.unit ? ' ' + p.unit : '')).trim());
    } else {
      if (spec.zeroText && v === 0) { labels.push(spec.zeroText); continue; }
      const n = v * spec.mul + spec.add;
      labels.push(((spec.signed && n > 0 ? '+' : '') + decimalsFmt(n, p.decimals) + (p.unit ? ' ' + p.unit : '')).trim());
    }
  }
  p.labels = labels;
  delete p.formatter;
  stats[spec.type]++;
}
fs.writeFileSync(outFile, JSON.stringify(effects, null, 1));
console.log('curve', stats.curve, 'table', stats.table, 'num', stats.num, 'unresolved', [...stats.none].join(' '));
