#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.V792_BASE_URL||'http://127.0.0.1:4173';
const ENGINES=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const VIEWPORTS=[['phone',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const ROUTES=[
  '/login.html','/request.html','/activate.html','/profiles.html','/player.html',
  '/drinks.html','/drinks_add.html','/drinks_pending.html','/drinks_history.html','/drinks_stats.html',
  '/beurs.html','/ballroom.html','/despimarkt.html','/despimarkt_wallet.html','/despimarkt_debts.html',
  '/ladder.html','/leaderboard.html','/familie.html'
];
const failures=[]; let passes=0;

function safeFixture(){
  try{
    localStorage.setItem('jas_session_token_v11','v792-isolated-audit-token');
    sessionStorage.setItem('jas_session_token_v11','v792-isolated-audit-token');
  }catch(_){}
  window.confirm=()=>true; window.alert=()=>{};
  const original=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const raw=typeof input==='string'?input:input?.url;
    let url; try{url=new URL(raw,location.href);}catch(_){return original(input,init);}
    if(url.hostname.includes('supabase.co')){
      let body=[];
      if(/public_state|session|profile.*self|current.*player/i.test(url.pathname)) body={session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
      return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    return original(input,init);
  };
}

for(const [engineName,engine] of ENGINES){
  const browser=await engine.launch({headless:true});
  for(const [viewName,viewport] of VIEWPORTS){
    const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
    await context.addInitScript(safeFixture);
    for(const route of ROUTES){
      const page=await context.newPage(); const errors=[];
      page.on('pageerror',e=>errors.push(String(e?.message||e)));
      try{
        const res=await page.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:30000});
        assert.ok(res&&res.status()<400,`${route} HTTP ${res?.status()}`);
        await page.waitForTimeout(350);
        assert.ok(!page.url().startsWith('https://')||page.url().startsWith(BASE),`${route} escaped isolated origin to ${page.url()}`);
        const version=await page.evaluate(()=>window.GEJAST_PAGE_VERSION||window.GEJAST_SITE_VERSION||'');
        assert.ok(version==='v792'||route==='/login.html',`${route} version marker is ${version||'missing'}`);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        assert.ok(overflow<=8,`${route} horizontal overflow ${overflow}px`);
        assert.deepEqual(errors,[],`${route} page errors: ${errors.join(' | ')}`);
        const interactive=await page.locator('a,button,input,select,textarea,[role="button"]').count();
        assert.ok(interactive>=1,`${route} rendered no interactive controls`);
        passes++; console.log(`V792_NON_GAME_PASS ${engineName} ${viewName} ${route}`);
      }catch(err){failures.push(`${engineName}:${viewName}:${route}: ${err?.stack||err}`);console.error(`V792_NON_GAME_FAIL ${engineName} ${viewName} ${route}: ${err?.stack||err}`);}
      finally{await page.close();}
    }
    await context.close();
  }
  await browser.close();
}
console.log(`V792_NON_GAME_PASSES=${passes}`); console.log(`V792_NON_GAME_FAILURES=${failures.length}`);
if(failures.length){failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}
console.log('V792_NON_GAME_UI_ACCEPTANCE=PASS');
