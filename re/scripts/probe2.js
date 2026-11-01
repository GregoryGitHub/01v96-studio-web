// Read-only: request params and print decoded values. args: elem:param:ch ...
const midi=require('../../app/node_modules/@julusian/midi');
const i=new midi.Input(),o=new midi.Output();i.ignoreTypes(false,true,true);
const dec=d=>{let v=(d[0]<<21)|(d[1]<<14)|(d[2]<<7)|d[3];if(v&0x8000000)v-=0x10000000;return v};
const want=process.argv.slice(2).map(s=>s.split(':').map(Number));const res={};
i.on('message',(t,m)=>{if(m[0]===0xF0&&m[4]===0x7F&&m[5]===1&&m.length===14){const k=m[6]+':'+m[7]+':'+m[8];res[k]=dec(m.slice(9,13))}});
i.openPort(0);o.openPort(1);
(async()=>{for(const [e,p,c] of want){const k=e+":"+p+":"+c;for(let t=0;t<3&&res[k]===undefined;t++){o.sendMessage([0xF0,0x43,0x30,0x3E,0x7F,0x01,e,p,c,0xF7]);for(let w=0;w<20&&res[k]===undefined;w++)await new Promise(r=>setTimeout(r,10))}}
await new Promise(r=>setTimeout(r,600));for(const [e,p,c] of want){const k=e+':'+p+':'+c;console.log(k,res[k])}i.closePort();o.closePort()})();
