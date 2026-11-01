const midi = require('../../app/node_modules/@julusian/midi');
const i = new midi.Input(), o = new midi.Output(); i.ignoreTypes(false, true, true);
const t0 = Date.now(); const hex = a => a.map(b => b.toString(16).padStart(2, '0')).join(' ');
i.on('message', (t, m) => { if (m[5] === 0x02) console.log('+' + (Date.now()-t0), m.length, hex(m.slice(0, 24))); });
i.openPort(0); o.openPort(1);
[1,2,3].forEach((p, k) => setTimeout(() => o.sendMessage([0xF0,0x43,0x30,0x3E,0x0D,0x02,0x04,p,0x7F,0xF7]), k * 1200));
setTimeout(() => o.sendMessage([0xF0,0x43,0x30,0x3E,0x0D,0x02,0x04,0x01,0x05,0xF7]), 3800);
setTimeout(() => { i.closePort(); o.closePort(); }, 5500);
