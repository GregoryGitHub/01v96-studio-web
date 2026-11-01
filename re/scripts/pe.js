// Minimal PE32 helpers: offset<->VA and pointer search
const fs=require('fs');const b=fs.readFileSync(process.argv[2]);
const pe=b.readUInt32LE(0x3c),nsec=b.readUInt16LE(pe+6),optsz=b.readUInt16LE(pe+20),opt=pe+24,base=b.readUInt32LE(opt+28);
const secs=[];for(let i=0;i<nsec;i++){const s=opt+optsz+i*40;secs.push({name:b.toString('latin1',s,s+8).replace(/\0.*/,''),va:b.readUInt32LE(s+12),vsz:b.readUInt32LE(s+8),raw:b.readUInt32LE(s+20),rsz:b.readUInt32LE(s+16)})}
const o2va=o=>{for(const s of secs)if(o>=s.raw&&o<s.raw+s.rsz)return base+s.va+(o-s.raw)};
const va2o=v=>{for(const s of secs){const r=v-base;if(r>=s.va&&r<s.va+s.rsz)return s.raw+r-s.va}};
const cstr=o=>{let e=o;while(b[e])e++;return b.toString('latin1',o,e)};
module.exports={b,base,secs,o2va,va2o,cstr};
if(require.main===module){console.log(base.toString(16),secs.map(s=>s.name+' va='+s.va.toString(16)+' raw='+s.raw.toString(16)+' sz='+s.rsz.toString(16)).join('\n'));
 for(const h of process.argv.slice(3)){const off=parseInt(h,16),va=o2va(off);const hits=[];for(let i=0;i+4<=b.length;i++)if(b.readUInt32LE(i)===va)hits.push(i.toString(16));console.log(h,cstr(off),'va',va.toString(16),'refs at',hits.join(','))}}
