#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.V792_BASE_URL||process.env.V791_BASE_URL||'http://127.0.0.1:4173';
const ENGINES=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const VIEWPORTS=[['phone',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const failures=[];
let passes=0;

function initSafeReadFixture(){
  try{
    localStorage.setItem('jas_session_token_v11','v792-isolated-audit-token');
    sessionStorage.setItem('jas_session_token_v11','v792-isolated-audit-token');
  }catch(_){}
  window.confirm=()=>true;
  window.alert=()=>{};
  const original=window.fetch.bind(window);
  window.fetch=async (input,init={})=>{
    const raw=typeof input==='string'?input:input?.url;
    let url; try{url=new URL(raw,location.href);}catch(_){return original(input,init);}
    if(url.hostname.includes('supabase.co')){
      const path=url.pathname;
      let body=[];
      if(path.includes('/rpc/get_public_state')||path.includes('/rpc/get_gejast_homepage_state')||path.includes('/rpc/account_public_state')){
        body={session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
      } else if(/login.*names|player.*names|selector/i.test(path)) {
        body=['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Henk'].map((name,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:name,player_name:name,public_display_name:name,login_active:true,active:true,site_scope:'friends'}));
      }
      return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    return original(input,init);
  };
}

async function open(context,path){
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(res&&res.status()<400,`${path} HTTP ${res?.status()}`);
  await page.waitForTimeout(450);
  return {page,errors};
}
async function common(page,errors,label){
  const version=await page.evaluate(()=>window.GEJAST_PAGE_VERSION||'');
  assert.equal(version,'v792',`${label} not on v792`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=8,`${label} horizontal overflow ${overflow}px`);
  assert.deepEqual(errors,[],`${label} page errors: ${errors.join(' | ')}`);
}

async function toepen(context){
  const {page,errors}=await open(context,'/toepen.html');
  const values=await page.locator('#playerCount option').allTextContents();
  assert.deepEqual(values.map(v=>Number(v.trim())).filter(Number.isFinite),[2,3,4,5,6,7,8]);
  for(const n of [2,3,4,5,6,7,8]){await page.locator('#playerCount').selectOption(String(n));assert.equal(await page.locator('#playerCount').inputValue(),String(n));}
  await common(page,errors,'Toepen'); await page.close();
}
async function boerenbridge(context){
  const {page,errors}=await open(context,'/boerenbridge.html');
  await page.locator('#playerCountInput').waitFor({state:'attached',timeout:5000});
  const values=await page.locator('#playerCountInput option').allTextContents();
  assert.deepEqual(values.map(v=>Number(v.trim())).filter(Number.isFinite),[2,3,4,5,6,7]);
  for(const n of [2,3,4,5,6,7]){await page.locator('#playerCountInput').selectOption(String(n));assert.equal(await page.locator('#playerCountInput').inputValue(),String(n));}
  await common(page,errors,'Boerenbridge'); await page.close();
}
async function beerpong(context){
  const {page,errors}=await open(context,'/beerpong.html');
  const values=await page.locator('#formatInput option').evaluateAll(os=>os.map(o=>o.value));
  assert.deepEqual(values,['2v2','1v1']);
  await page.locator('#formatInput').selectOption('1v1'); assert.equal(await page.locator('#formatInput').inputValue(),'1v1');
  await page.locator('#formatInput').selectOption('2v2'); assert.equal(await page.locator('#formatInput').inputValue(),'2v2');
  await common(page,errors,'Beerpong'); await page.close();
}
async function klaverjas(context){
  const {page,errors}=await open(context,'/scorer.html');
  const dialogs=await page.locator('[role="dialog"],dialog').count();
  assert.ok(dialogs>=1,'Klaverjas scorer has no setup/bid dialog owner');
  const selects=await page.locator('select').count();
  assert.ok(selects>=4,'Klaverjas scorer must expose four-player setup controls');
  await common(page,errors,'Klaverjas scorer'); await page.close();
}
async function rad(context){
  const {page,errors}=await open(context,'/rad.html');
  await page.locator('#spinBtn').waitFor({state:'visible',timeout:5000});
  const legend=await page.locator('#legendBox .legend-row').count();
  assert.equal(legend,21,'Rad must render all 21 weighted segments');
  const labels=await page.locator('#legendBox .legend-row').allTextContents();
  assert.ok(labels.every(t=>/%/.test(t)),'Rad legend probability labels missing');
  const probs=labels.map(t=>{const m=t.match(/([0-9]+(?:[,.][0-9]+)?)%/);return m?Number(m[1].replace(',','.')):NaN;}).filter(Number.isFinite);
  assert.equal(probs.length,21,'Rad must show a normalized probability for every segment');
  const roundedTotal=probs.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(roundedTotal-100)<=0.6,`Rad displayed rounded probabilities should total about 100%, got ${roundedTotal}`);
  await common(page,errors,'Rad'); await page.close();
}
async function navigation(context){
  const {page,errors}=await open(context,'/index.html');
  for(const href of ['pikken.html','paardenrace.html','toepen.html','beerpong.html','scorer.html','boerenbridge.html','rad.html']){
    assert.ok(await page.locator(`a[href*="${href}"]`).count(),`Homepage missing navigation to ${href}`);
  }
  await common(page,errors,'Homepage'); await page.close();
}

const TESTS=[['homepage-navigation',navigation],['toepen-counts',toepen],['boerenbridge-counts',boerenbridge],['beerpong-formats',beerpong],['klaverjas-four-player-ui',klaverjas],['rad-probabilities',rad]];
for(const [engineName,engine] of ENGINES){
  const browser=await engine.launch({headless:true});
  for(const [viewName,viewport] of VIEWPORTS){
    for(const [name,test] of TESTS){
      const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
      await context.addInitScript(initSafeReadFixture);
      try{await test(context);passes++;console.log(`V792_UI_PASS ${engineName} ${viewName} ${name}`);}
      catch(err){failures.push(`${engineName}:${viewName}:${name}: ${err?.stack||err}`);console.error(`V792_UI_FAIL ${engineName} ${viewName} ${name}: ${err?.stack||err}`);}
      finally{await context.close();}
    }
  }
  await browser.close();
}
console.log(`V792_BROAD_UI_PASSES=${passes}`);
console.log(`V792_BROAD_UI_FAILURES=${failures.length}`);
if(failures.length){failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}
console.log('V792_BROAD_UI_ACCEPTANCE=PASS');
