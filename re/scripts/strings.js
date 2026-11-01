const b=require('fs').readFileSync(process.argv[2]);const min=+process.argv[3]||5;let out=[],cur='',st=0;
for(let i=0;i<b.length;i++){const c=b[i];if(c>=32&&c<127){if(!cur)st=i;cur+=String.fromCharCode(c)}else{if(cur.length>=min)out.push(st.toString(16)+' '+cur);cur=''}}
// utf16le
for(let i=0;i+1<b.length;i+=1){let s='',j=i;while(j+1<b.length&&b[j]>=32&&b[j]<127&&b[j+1]===0){s+=String.fromCharCode(b[j]);j+=2}if(s.length>=min){out.push(i.toString(16)+' W '+s);i=j}}
console.log(out.join('\n'));
