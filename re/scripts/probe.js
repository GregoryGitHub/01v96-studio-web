const midi=require('../../app/node_modules/@julusian/midi');
const hex=a=>a.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
const reqs=[[0xF0,0x43,0x30,0x3E,0x7F,0x01,0x1C,0x00,0x00,0xF7],[0xF0,0x43,0x30,0x3E,0x0D,0x01,0x1C,0x00,0x00,0xF7]];
(async()=>{for(let p=0;p<8;p++){const i=new midi.Input(),o=new midi.Output();i.ignoreTypes(false,true,true);
 let got=[];i.on('message',(d,m)=>got.push(hex(m)));i.openPort(p);o.openPort(p+1);
 for(const r of reqs)o.sendMessage(r);await new Promise(r=>setTimeout(r,800));
 console.log('port',p+1,got.length,'msgs');[...new Set(got)].slice(0,8).forEach(g=>console.log('  ',g));i.closePort();o.closePort();}})();
