if(!process.argv[2]){console.error('usage: node eltable.js <01V96.dll>');process.exit(1)}
const {b,va2o,cstr}=require('./pe.js');
const s=n=>{const o=va2o(n);return o?cstr(o):null};
const T=0x2ed208-0x17*8;
for(let e=0;e<0x80;e++){const o=T+e*8;const p=b.readUInt32LE(o),q=b.readUInt32LE(o+4);const n=s(p),m=s(q);process.stdout.write(e.toString(16).padStart(2,'0')+' '+(n&&/^k/.test(n)?n:p.toString(16))+' '+(m&&/^k/.test(m)?m:q.toString(16))+(e%3==2?'\n':' | '))}
