const {chromium}=require('playwright');
const cwd=process.cwd().replace(/\\/g,'/');
const b=async()=>{const p=await chromium.launch({channel:'chromium-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage']});
const r=await p.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
const fetched=[];const failed=[];
r.on('response',res=>{const u=res.url();if(/\.js(\.map)?$/.test(u))fetched.push(u.slice(-80));if(res.status()>=400)failed.push(u.slice(-80)+':'+res.status());});
const consoleMsgs=[];r.on('console',msg=>consoleMsgs.push(msg.type()+'='+msg.text().slice(0,100)));
await r.goto('file:///'+cwd+'/dist/index.html',{timeout:12000});
await r.waitForLoadState('domcontentloaded',{timeout:12000});
let rootSnippet='NO-ROOT',h1='NO H1',title='',bodyDetails='n/a';
try{
bodyDetails=await r.evaluate(()=>{const s=Array.from(document.styleSheets);const t=Array.from(document.scripts);return 'css:'+s.length+',js:'+t.length;});
rootSnippet=await r.evaluate(()=>{try{return document.getElementById('root')?.innerHTML?.slice(0,300)||'NO-ROOT';}catch(e){return 'ERR:'+e.message;}});
h1=await r.evaluate(()=>{try{const t=document.querySelector('h1');return t?String(t.innerText.trim()):'NO H1';}catch(e){return 'ERR:'+e.message;}});
title=await r.evaluate(()=>document.title);
}catch(e){}
await p.close();
return {title,h1,rootSnippet,bodyDetails,errs:failed.slice(0,6),consoleMsgs:consoleMsgs.slice(0,6),scriptsFetched:fetched.length};
};
b().then(t=>console.log(JSON.stringify(t,null,2))).catch(e=>{console.error('TOOLEXIT:'+e.message);process.exit(1);});
