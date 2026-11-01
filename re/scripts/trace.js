// Trace: send a few name and fader requests, log every incoming frame with timestamps.
const midi = require('../../app/node_modules/@julusian/midi');
const i = new midi.Input(), o = new midi.Output();
i.ignoreTypes(false, true, true);
const t0 = Date.now();
const hex = a => a.map(b => b.toString(16).padStart(2, '0')).join(' ');
let n = 0;
i.on('message', (t, m) => { n++; if ((m[5] === 0x02) || (m[6] === 0x1c && m[8] < 2) || (m[6] === 0x1a)) console.log('+' + (Date.now() - t0) + 'ms IN ', m.length, hex(m.slice(0, 16))); });
i.openPort(0); o.openPort(1);
const reqs = [
  [0xF0, 0x43, 0x30, 0x3E, 0x0D, 0x02, 0x04, 0x00, 0x00, 0xF7],
  [0xF0, 0x43, 0x30, 0x3E, 0x0D, 0x02, 0x04, 0x01, 0x00, 0xF7],
  [0xF0, 0x43, 0x30, 0x3E, 0x7F, 0x01, 0x1C, 0x00, 0x00, 0xF7],
  [0xF0, 0x43, 0x30, 0x3E, 0x7F, 0x01, 0x1C, 0x00, 0x01, 0xF7],
  [0xF0, 0x43, 0x30, 0x3E, 0x7F, 0x01, 0x1A, 0x00, 0x00, 0xF7],
];
(async () => {
  for (const r of reqs) { console.log('+' + (Date.now() - t0) + 'ms OUT', hex(r)); o.sendMessage(r); await new Promise(r => setTimeout(r, 300)); }
  await new Promise(r => setTimeout(r, 1500));
  console.log('total in', n, 'in', Date.now() - t0, 'ms');
  i.closePort(); o.closePort();
})();
