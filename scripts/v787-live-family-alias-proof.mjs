#!/usr/bin/env node
import { firefox, webkit } from 'playwright';

const base='https://kalenel.nl';
const aliases=[
  ['/familie/index.html','/index.html'],
  ['/familie/login.html','/login.html'],
  ['/familie/scorer.html','/scorer.html'],
  ['/familie/leaderboard.html','/leaderboard.html']
];
const engines=[['firefox',firefox],['webkit',webkit]];
const viewports=[['phone',390,844],['desktop',1366,768]];
const failures=[];
let blockedWrites=0;
let combinations=0;

for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const [viewportName,width,height] of viewports){
    for(const [alias,target] of aliases){
      combinations++;
      const requests=[];
      const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
      const page=await context.newPage();
      await context.route('**/*',async route=>{
        const req=route.request();
        let url; try{url=new URL(req.url());}catch{return route.continue();}
        if(!['GET','HEAD'].includes(req.method())){
          blockedWrites++;
          return route.fulfill({status:200,contentType:'application/json',body:'[]'});
        }
        if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&url.pathname===target&&url.searchParams.get('scope')==='family'){
          requests.push(url.pathname+url.search);
          return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Canonical family destination</title></head><body>destination</body></html>'});
        }
        return route.continue();
      });
      page.on('request',req=>{
        try{
          const u=new URL(req.url());
          if(u.hostname==='kalenel.nl'&&!requests.includes(u.pathname+u.search)) requests.push(u.pathname+u.search);
        }catch{}
      });
      let navigationError='';
      try{await page.goto(`${base}${alias}?v787_live_proof=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}
      catch(err){navigationError=String(err?.message||err);}
      await page.waitForTimeout(250);
      const final=new URL(page.url());
      const wrongFamily=requests.filter(value=>{
        const u=new URL(value,base);
        return u.pathname.startsWith('/familie/')&&u.pathname!==alias;
      });
      const expectedNavigation=requests.some(value=>{
        const u=new URL(value,base);
        return u.pathname===target&&u.searchParams.get('scope')==='family';
      });
      const ok=!navigationError&&final.pathname===target&&final.searchParams.get('scope')==='family'&&wrongFamily.length===0&&expectedNavigation;
      console.log(`${ok?'PASS':'FAIL'} ${engineName} ${viewportName} ${alias} -> ${final.pathname}${final.search} requests=${JSON.stringify(requests)}`);
      if(!ok) failures.push({engine:engineName,viewport:viewportName,alias,target,navigationError,final:final.pathname+final.search,requests,wrongFamily,expectedNavigation});
      await context.close();
    }
  }
  await browser.close();
}

console.log(`V787_LIVE_ALIAS_SUMMARY combinations=${combinations} failures=${failures.length} blockedWrites=${blockedWrites}`);
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exit(1);}
console.log('V787_LIVE_ALIAS_PROOF=PASS Firefox+WebKit phone+desktop; exact family-scope first destinations; zero wrong /familie/ subresource requests.');
