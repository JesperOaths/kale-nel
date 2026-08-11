#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import { firefox, webkit } from 'playwright';

const aliases=[
  ['/familie/index.html','/index.html','family'],
  ['/familie/login.html','/login.html','family'],
  ['/familie/scorer.html','/scorer.html','family'],
  ['/familie/leaderboard.html','/leaderboard.html','family']
];
const engines=[['firefox',firefox],['webkit',webkit]];
const viewports=[['phone',390,844],['desktop',1366,768]];
const requests=[];
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  requests.push(url.pathname+url.search);
  const alias=aliases.find(([path])=>path===url.pathname);
  if(alias){
    const disk=alias[0].replace(/^\//,'');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(fs.readFileSync(disk,'utf8'));
    return;
  }
  const destination=aliases.find(([,target])=>target===url.pathname);
  if(destination){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end('<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Canonical destination</title></head><body>destination</body></html>');
    return;
  }
  res.writeHead(404,{'content-type':'text/plain'});res.end('not found');
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
const base=`http://127.0.0.1:${port}`;
const failures=[];
let combinations=0;
try{
  for(const [engineName,engine] of engines){
    const browser=await engine.launch({headless:true});
    for(const [viewportName,width,height] of viewports){
      for(const [alias,target,scope] of aliases){
        combinations++;
        requests.length=0;
        const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
        const page=await context.newPage();
        let navError='';
        try{await page.goto(base+alias,{waitUntil:'domcontentloaded',timeout:15000});}catch(err){navError=String(err?.message||err);}
        await page.waitForTimeout(150);
        const final=new URL(page.url());
        const wrongFamilyRequests=requests.filter((value)=>{
          const u=new URL(value,base);
          return u.pathname.startsWith('/familie/')&&u.pathname!==alias;
        });
        const unexpected=requests.filter((value)=>{
          const u=new URL(value,base);
          return u.pathname!==alias&&u.pathname!==target;
        });
        const ok=!navError&&final.pathname===target&&final.searchParams.get('scope')===scope&&wrongFamilyRequests.length===0&&unexpected.length===0&&requests.some((value)=>new URL(value,base).pathname===target);
        if(!ok) failures.push({engine:engineName,viewport:viewportName,alias,target,navError,final:final.pathname+final.search,requests:[...requests],wrongFamilyRequests,unexpected});
        console.log(`${ok?'PASS':'FAIL'} ${engineName} ${viewportName} ${alias} -> ${final.pathname}${final.search} requests=${JSON.stringify(requests)}`);
        await context.close();
      }
    }
    await browser.close();
  }
} finally { await new Promise(resolve=>server.close(resolve)); }
console.log(`V787_ALIAS_BROWSER_SUMMARY combinations=${combinations} failures=${failures.length}`);
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exit(1);}
console.log('V787_ALIAS_BROWSER_PROOF=PASS Firefox+WebKit phone+desktop; exact family destinations; zero wrong /familie/ subresource requests.');
