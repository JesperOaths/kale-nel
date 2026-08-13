#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.V791_BASE_URL||'http://127.0.0.1:4173';
const ENGINES=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const VIEWPORTS=[['mobile',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const NAMES=['Ada','Bram','Caro','Daan','Evi','Fleur'];
const passes=[];
const failures=[];

const supabaseStub=`
window.__V791_BP_CALLS=[];
window.supabase={createClient:function(){return {rpc:async function(name,payload){
  window.__V791_BP_CALLS.push({name:name,payload:payload||{}});
  if(name==='get_login_names_scoped'||name==='get_login_names') return {data:${JSON.stringify(NAMES)},error:null};
  if(name==='get_beerpong_leaderboard_public') return {data:{leaderboard:[],recent_matches:[]},error:null};
  if(name==='get_beerpong_pussycup_ranking_public') return {data:{ranking:[]},error:null};
  if(name==='save_beerpong_match') return {data:{ok:true,match_id:'bp-audit-safe'},error:null};
  return {data:[],error:null};
}}}};
`;

async function makeContext(browser,viewport){
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    try{
      localStorage.setItem('jas_session_token_v11','v791-beerpong-safe-session');
      sessionStorage.setItem('jas_session_token_v11','v791-beerpong-safe-session');
    }catch(_){}
  });
  const routed=[];
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',async route=>{
    routed.push('cdn-stub');
    await route.fulfill({status:200,contentType:'application/javascript',body:supabaseStub});
  });
  await context.route('https://*.supabase.co/**',async route=>{
    const req=route.request();
    routed.push(`${req.method()} ${req.url()}`);
    let rpc='';
    try{rpc=new URL(req.url()).pathname.split('/').pop()||'';}catch(_){}
    let body=[];
    if(/names|player_selector|active_names/i.test(rpc)) body=NAMES;
    else if(/public_state|homepage_state|jas_app_state/i.test(rpc)) body={session_valid:true,is_logged_in:true,my_name:'Ada'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'*'}});
  });
  return {context,routed};
}

async function open(context){
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(`${BASE}/beerpong.html?audit=1`,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(res&&res.status()<400,`Beerpong navigation ${res?.status()}`);
  await page.waitForFunction(()=>document.querySelector('#teamA1')?.options?.length>1,null,{timeout:8000});
  assert.ok(!page.url().includes('login.html'),'Beerpong unexpectedly redirected to login');
  return {page,errors};
}

async function selectByLabel(page,id,label){
  const select=page.locator(id);
  const option=select.locator('option').filter({hasText:label}).first();
  await option.waitFor({state:'attached',timeout:5000});
  const value=await option.getAttribute('value');
  await select.selectOption(value||{label});
}

async function saveCalls(page){
  return page.evaluate(()=>Array.isArray(window.__V791_BP_CALLS)?window.__V791_BP_CALLS.filter(c=>c.name==='save_beerpong_match'):[]);
}

async function assertHealthy(page,errors,label){
  assert.deepEqual(errors,[],`${label}: pageerror ${errors.join(' | ')}`);
  const x=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(x<=6,`${label}: document overflow ${x}px`);
}

async function test1v1(context){
  const {page,errors}=await open(context);
  await page.locator('#formatInput').selectOption('1v1');
  assert.equal(await page.locator('.duo').first().isVisible(),false,'1v1 must hide second-player team fields');
  await selectByLabel(page,'#teamA1','Ada');
  const b1Labels=await page.locator('#teamB1 option').allTextContents();
  assert.equal(b1Labels.some(x=>x.trim()==='Ada'),false,'1v1 must prevent duplicate player selection in the UI');
  await selectByLabel(page,'#teamB1','Bram');

  await page.locator('#cupsA').fill('9');
  await page.locator('#cupsB').fill('8');
  await page.locator('#saveBtn').click();
  assert.match((await page.locator('#formStatus').textContent())||'',/precies 10/i,'1v1 must reject no-winner score');
  assert.equal((await saveCalls(page)).length,0,'invalid 1v1 no-winner state must not reach save RPC');

  await page.locator('#cupsA').fill('10');
  await page.locator('#cupsB').fill('10');
  await page.locator('#saveBtn').click();
  assert.match((await page.locator('#formStatus').textContent())||'',/maar één winnaar|Niet allebei/i,'1v1 must reject double winner');
  assert.equal((await saveCalls(page)).length,0,'invalid 1v1 double winner must not reach save RPC');

  await page.locator('#cupsA').fill('10');
  await page.locator('#cupsB').fill('7');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#formStatus')?.textContent?.includes('Wedstrijd opgeslagen.'),null,{timeout:5000});
  const calls=await saveCalls(page);
  assert.equal(calls.length,1,'valid 1v1 must save exactly once');
  const payload=calls[0].payload?.payload||{};
  assert.equal(payload.format,'1v1','saved 1v1 payload format drifted');
  assert.equal(payload.cups_hit_a,10,'saved 1v1 winner cups drifted');
  assert.equal(payload.cups_hit_b,7,'saved 1v1 loser cups drifted');
  await assertHealthy(page,errors,'Beerpong 1v1');
  await page.close();
}

async function test2v2(context){
  const {page,errors}=await open(context);
  await page.locator('#formatInput').selectOption('2v2');
  assert.equal(await page.locator('.duo').first().isVisible(),true,'2v2 must show second-player team fields');
  for(const [id,name] of [['#teamA1','Ada'],['#teamA2','Bram'],['#teamB1','Caro'],['#teamB2','Daan']]) await selectByLabel(page,id,name);
  const selected=await page.locator('#teamA1,#teamA2,#teamB1,#teamB2').evaluateAll(sels=>sels.map(s=>s.value));
  assert.equal(new Set(selected).size,4,'2v2 UI must hold four unique players');
  await page.locator('#cupsA').fill('6');
  await page.locator('#cupsB').fill('10');
  await page.locator('#pussycupB').check();
  await page.locator('#notesInput').fill('isolated browser proof');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#formStatus')?.textContent?.includes('Wedstrijd opgeslagen.'),null,{timeout:5000});
  const calls=await saveCalls(page);
  assert.equal(calls.length,1,'valid 2v2 must save exactly once');
  const payload=calls[0].payload?.payload||{};
  assert.equal(payload.format,'2v2','saved 2v2 payload format drifted');
  assert.equal(payload.cups_hit_a,6,'saved 2v2 team A cups drifted');
  assert.equal(payload.cups_hit_b,10,'saved 2v2 team B cups drifted');
  assert.equal(payload.pussycup_b,true,'saved 2v2 pussycup flag drifted');
  assert.equal(Array.isArray(payload.team_a_player_ids),true,'2v2 payload team A ids missing');
  assert.equal(Array.isArray(payload.team_b_player_ids),true,'2v2 payload team B ids missing');
  assert.equal(payload.team_a_player_ids.length,2,'2v2 payload team A must have two players');
  assert.equal(payload.team_b_player_ids.length,2,'2v2 payload team B must have two players');
  await page.locator('#resetBtn').click();
  assert.equal(await page.locator('#cupsA').inputValue(),'0','reset must clear team A cups');
  assert.equal(await page.locator('#cupsB').inputValue(),'0','reset must clear team B cups');
  await assertHealthy(page,errors,'Beerpong 2v2');
  await page.close();
}

for(const [engineName,engine] of ENGINES){
  const browser=await engine.launch({headless:true});
  for(const [viewName,viewport] of VIEWPORTS){
    const {context}=await makeContext(browser,viewport);
    try{
      await test1v1(context);
      passes.push(`${engineName}:${viewName}:1v1`);
      console.log(`V791_BEERPONG_PASS ${engineName} ${viewName} 1v1`);
      await test2v2(context);
      passes.push(`${engineName}:${viewName}:2v2`);
      console.log(`V791_BEERPONG_PASS ${engineName} ${viewName} 2v2`);
    }catch(err){
      failures.push(`${engineName}:${viewName}: ${err?.stack||err}`);
      console.error(`V791_BEERPONG_FAIL ${engineName} ${viewName}: ${err?.stack||err}`);
    }finally{await context.close();}
  }
  await browser.close();
}
console.log(`V791_BEERPONG_PASSES=${passes.length}`);
console.log(`V791_BEERPONG_FAILURES=${failures.length}`);
if(failures.length){console.error('V791_FINALIZATION_BEERPONG_BROWSER_MATRIX=FAIL');failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}
assert.equal(passes.length,12,'Expected 12 Beerpong cross-engine/view/format proofs');
console.log('V791_FINALIZATION_BEERPONG_BROWSER_MATRIX=PASS');
