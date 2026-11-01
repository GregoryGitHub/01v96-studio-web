// Extract O1V96V2 sysex templates from decompiled MixEngine.cs
const fs=require('fs');const src=fs.readFileSync(process.argv[2],'utf8').split('\n');
const [start,end,label]=[+process.argv[3],+process.argv[4],process.argv[5]];
let pr=[],ct=[],inO1=false,depth=0,o1depth=-1,out=[];
for(let i=start-1;i<end;i++){const l=src[i];
  let m=l.match(/^\s*case (?:Channel\.|EFX\.|OutPort\.)?Pr\.(\w+):/); if(m){ if(!pr.lastWasCase) pr=[]; pr.push(m[1]); pr.lastWasCase=true; continue;}
  m=l.match(/^\s*case ChannelTypes\.(\w+):/); if(m){ if(!ct.lastWasCase) ct=[]; ct.push(m[1]); ct.lastWasCase=true; continue;}
  if(/^\s*case /.test(l)) continue;
  pr.lastWasCase=false; ct.lastWasCase=false;
  if(/switch \(param\)/.test(l)) {ct=[];}
  if(/ConsoleTypes\.(O1V96V2|O1V96)\b/.test(l) && /if/.test(l)) inO1=true;
  else if(/ConsoleTypes\./.test(l) && /if/.test(l)) inO1=false;
  if(inO1){ for(const s of l.matchAll(/"(F043[^"]*)"((?:\s*\+[^;]*?)*)\)?;/g)) out.push({line:i+1,param:pr.join('|'),chtype:ct.join('|')||null,tpl:s[1],expr:l.trim()}); }
}
console.log(JSON.stringify(out,null,0).replace(/\},\{/g,'},\n{'));
