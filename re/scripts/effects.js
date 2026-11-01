// Build 01V96 effect catalog from SM plugin tables (layout confirmed via Ghidra FUN_100ba780)
const b=require('fs').readFileSync(process.argv[2]);
const TYPES=0x23a0c0,STRIDE=0x17,MAP=0x23a6e0,DESC=0x237cd8;
const desc=i=>{const o=DESC+i*24;return{name:b.toString('latin1',o,o+8).trim(),unit:b.toString('latin1',o+9,o+12).replace(/\0/g,'').trim(),max:b.readUInt32LE(o+12),min:b.readUInt16LE(o+16),disp:b[o+18],dec:b[o+19],curve:b[o+20],raw:[...b.slice(o+8,o+24)].map(x=>x.toString(16).padStart(2,'0')).join('')}};
const types=[];for(let t=0;t<=0x43;t++){const o=TYPES+t*STRIDE;const algo=b[o+0x11],n=b[o+0x12];const params=[];
 for(let p=0;p<n;p++){let v=b.readUInt16LE(MAP+(algo*32+p)*2);if(v===0xffff)v=b.readUInt16LE(MAP+(algo*32+p)*2-2);if(v>=400){params.push({slot:p,name:null});continue}params.push({slot:p,...desc(v),descIndex:v})}
 types.push({type:t,name:b.toString('latin1',o,o+16).trim(),algo,extra:[...b.slice(o+0x10,o+0x17)].map(x=>x.toString(16).padStart(2,'0')).join(''),params})}
require('fs').writeFileSync(process.argv[3],JSON.stringify(types,null,1));
for(const t of types)console.log(t.type,t.name,'algo',t.algo,'x'+t.extra,':',t.params.map(p=>`${p.name}[${p.min}-${p.max}${p.unit?' '+p.unit:''}${p.dec?' /'+p.dec:''} d${p.disp.toString(16)}${p.curve!==0xff?' c'+p.curve:''}]`).join(' '));
