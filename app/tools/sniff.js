'use strict';
// Protocol debugging through the running server (no second MIDI connection):
// sends read-only requests and prints every frame the server could not parse.
//   node tools/sniff.js "F0 43 30 3E 7F 10 40 00 01 F7" ["..."] [--wait 3000]
const WebSocket = require('ws');
const args = process.argv.slice(2);
const wait = +(args[args.indexOf('--wait') + 1] || 0) || 2500;
const reqs = args.filter(a => /^[0-9a-f ]+$/i.test(a) && a.includes(' ')).map(s => s.trim().split(/\s+/).map(h => parseInt(h, 16)));
const ws = new WebSocket(`ws://localhost:${process.env.PORT || 8096}/ws`);
ws.on('open', async () => {
  ws.send(JSON.stringify({ t: 'sniff', on: true }));
  for (const bytes of reqs) {
    console.log('OUT', bytes.map(b => b.toString(16).padStart(2, '0')).join(' '));
    ws.send(JSON.stringify({ t: 'rawRequest', bytes }));
    await new Promise(r => setTimeout(r, 600));
  }
  setTimeout(() => process.exit(0), wait);
});
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'raw') {
    const b = Buffer.from(m.hex, 'hex');
    const text = [...b.slice(5, -1)].map(c => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('');
    console.log('IN ', b.length, m.hex.match(/../g).slice(0, 48).join(' '), JSON.stringify(text));
  } else if (m.t === 'rawSent' && !m.ok) console.log('   (recusado: só pedidos F0 43 3n … F7 são permitidos)');
  else if (m.t === 'scene') console.log('SCENE', m.n, JSON.stringify(m.title));
});
