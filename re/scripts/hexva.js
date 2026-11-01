const {b,va2o,cstr}=require('./pe.js');
for(const a of process.argv.slice(3)){const [v,n]=a.split(':');const o=va2o(parseInt(v,16));console.log('== '+v);
 for(let i=0;i<(+n||96);i+=4){const d=b.readUInt32LE(o+i);const so=va2o(d);const sx=so&&b[so]>=0x20&&b[so]<0x7f?cstr(so).slice(0,40):'';process.stdout.write(d.toString(16).padStart(8,'0')+(sx?'('+sx+')':'')+((i/4)%6==5?'\n':' '))}console.log()}
