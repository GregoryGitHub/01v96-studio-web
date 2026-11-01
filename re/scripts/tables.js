// Extract display lookup tables from decompiled AirControls/AirFader.cs
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const out = {};
const re = /private (decimal|string)\[\] (\w+) = new \w+\[\d+\]\s*(\{[\s\S]*?\});/g;
let m;
while ((m = re.exec(s))) {
  const body = m[3];
  let arr;
  if (m[1] === 'string') arr = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
  else arr = [...body.matchAll(/new decimal\(new int\[4\] \{ (-?\d+), (-?\d+), (-?\d+), (-?\d+) \}\)|(-?\d+(?:\.\d+)?)m|(-?\d+)(?=\s*[,}])/g)].map(x => {
    if (x[1] !== undefined) { const lo = (+x[1]) >>> 0, flags = +x[4]; return (flags < 0 ? -1 : 1) * lo / 10 ** ((flags >> 16) & 0xff); }
    return +(x[5] ?? x[6]);
  });
  out[m[2]] = arr;
  console.log(m[2], arr.length, JSON.stringify(arr.slice(0, 6)), '...', JSON.stringify(arr.slice(-3)));
}
require('fs').writeFileSync(process.argv[3], JSON.stringify(out));
