// Map effect "curve" ids to 7-byte string tables using the decompiled FUN_100be6b0
// switch, then attach option labels to data/effects.json.
// usage: node enums.js <01V96.dll> <dec_0x100be6b0.json> <effects.json in> <effects.json out>
const fs = require('fs');
process.argv[2] = process.argv[2];
const { b, va2o } = require('./pe.js');
const dec = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const code = typeof dec.normalized_result === 'string' ? dec.normalized_result : dec.normalized_result.pseudocode;
const effects = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));

const tables = {};
const funcs = {};
for (const m of code.matchAll(/case (0x[0-9a-f]+|\d+):\s*\n([\s\S]*?)(?=\n\s*case |\n\s*default|\n\s*\}\s*\n\s*return)/g)) {
  const id = parseInt(m[1]);
  const body = m[2];
  let mm;
  if ((mm = body.match(/\*param_2 = \(&DAT_([0-9a-f]+)\)\[param_1\]/))) tables[id] = va2o(parseInt(mm[1], 16));
  else if ((mm = body.match(/\*param_2 = "((?:[^"\\]|\\.)*)"\[param_1\]/))) {
    const lit = Buffer.from(mm[1].replace(/\\(.)/g, '$1'), 'latin1');
    let at = -1;
    for (let from = 0; (at = b.indexOf(lit, from)) >= 0; from = at + 1) if (b[at + lit.length] === 0 && b[at + 7] !== undefined) break;
    tables[id] = at;
  } else if ((mm = body.match(/(FUN_[0-9a-f]+)\(/))) funcs[id] = mm[1];
}

const str7 = (o, i) => b.toString('latin1', o + i * 7, o + i * 7 + 6).replace(/\0.*$/, '').trim();
let labelled = 0;
for (const t of effects) for (const p of t.params) {
  if (!p || p.name == null) continue;
  const flags = parseInt(p.raw.slice(20, 22), 16) | (parseInt(p.raw.slice(22, 24), 16) << 8);
  p.kind = flags & 7;
  p.table = !!(flags & 8);
  p.decimals = (flags >> 8) & 0xf;
  const offset = p.min >= 0x8000 ? p.min - 0x10000 : p.min;
  p.offset = offset;
  delete p.min;
  if ((p.kind === 2 || p.kind === 3) && tables[p.curve] != null && tables[p.curve] >= 0) {
    p.options = [];
    for (let i = 0; i <= p.max; i++) p.options.push(str7(tables[p.curve], i + offset));
    labelled++;
  } else if (p.kind === 2 || p.kind === 3) p.formatter = funcs[p.curve] || null;
}
fs.writeFileSync(process.argv[5], JSON.stringify(effects, null, 1));
console.log('string tables', Object.keys(tables).length, 'formatter funcs', JSON.stringify(funcs), 'params labelled', labelled);
