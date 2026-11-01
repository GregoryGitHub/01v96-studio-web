// Read-only probe using 3E 0D <group> format. args: group:elem:param:ch ...
const midi = require('../../app/node_modules/@julusian/midi');
const i = new midi.Input(), o = new midi.Output();
i.ignoreTypes(false, true, true);
const dec = d => { let v = (d[0] << 21) | (d[1] << 14) | (d[2] << 7) | d[3]; if (v & 0x8000000) v -= 0x10000000; return v; };
const want = process.argv.slice(2).map(s => s.split(':').map(Number));
const res = {};
i.on('message', (t, m) => {
  if (m[0] === 0xF0 && m[4] === 0x0D && m.length === 14) res[m[5] + ':' + m[6] + ':' + m[7] + ':' + m[8]] = dec(m.slice(9, 13));
});
i.openPort(0); o.openPort(1);
(async () => {
  for (const [g, e, p, c] of want) {
    const k = g + ':' + e + ':' + p + ':' + c;
    for (let t = 0; t < 3 && res[k] === undefined; t++) {
      o.sendMessage([0xF0, 0x43, 0x30, 0x3E, 0x0D, g, e, p, c, 0xF7]);
      for (let w = 0; w < 20 && res[k] === undefined; w++) await new Promise(r => setTimeout(r, 10));
    }
  }
  for (const [g, e, p, c] of want) { const k = g + ':' + e + ':' + p + ':' + c; const v = res[k]; console.log(k, v, v > 31 && v < 127 ? JSON.stringify(String.fromCharCode(v)) : ''); }
  i.closePort(); o.closePort();
})();
