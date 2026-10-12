const fs=require('fs');
function walk(p){
if(fs.statSync(p).isDirectory()){
for(const c of fs.readdirSync(p)){try{walk(p+'/'+c);}catch(e){}}}
else if(p.endsWith('.js')||p.endsWith('.mjs')){
const t=fs.readFileSync(p,'utf8');
const m=t.search(/require\(['"]playwright['"]\)/)!==-1||t.search(/from ['"]playwright['"]/)!==-1;
if(m){console.log('PLAYWRIGHT>>',p);}
}
}
walk('.');
