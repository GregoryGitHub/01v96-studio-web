// Decode SM 01V96 element/sub-parameter tables into JSON
const {b,va2o,cstr}=require('./pe.js');
const s=v=>{const o=va2o(v);return o!=null&&b[o]>=0x20&&b[o]<0x7f?cstr(o):null};
const T=0x2ed208-0x17*8,out=[];
for(let e=1;e<0x200;e++){const o=T+e*8;const name=s(b.readUInt32LE(o));if(!name||!/^k/.test(name))break;
 const sub=va2o(b.readUInt32LE(o+4)),params=[];
 if(sub!=null)for(let i=0;i<256;i++){const p=sub+i*12,np=b.readUInt32LE(p),w=b.readUInt32LE(p+4),c=b.readUInt32LE(p+8);if(w===0xffffffff)break;params.push({name:s(np),index:w>>>16,elem:(w&0xffff)+1,count:c})}
 out.push({element:e,name,params})}
require('fs').writeFileSync(process.argv[3],JSON.stringify(out,null,1));
console.log(out.length,'elements');
for(const e of out.filter(e=>/kEffect$|kInputAUX$|kInputGate|kInputComp|kGEQ$|kInputDelay|kInputRouting|kInputGroup|kInputAUXPan|kInputPair|kAuxSend/.test(e.name)))console.log(e.element.toString(16),e.name,e.params.map(p=>p.index+':'+p.name+(p.count>1?'x'+p.count:'')+(p.elem!==e.element?'@'+p.elem.toString(16):'')).join(' '));
