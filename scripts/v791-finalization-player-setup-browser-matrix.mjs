#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.V791_BASE_URL||'http://127.0.0.1:4173';
const ENGINES=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const VIEWPORTS=[['mobile',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const NAMES=['Ada','Bram','Caro','Daan','Evi','Fleur','Gijs','Hugo','Iris','Jens'];
const passes=[];
const failures=[];

function safeInit(){
  try{
    for(const key of Object.keys(localStorage)){
      if(/toepen|boerenbridge|bb_|draft/i.test(key)) localStorage.removeItem(key);
    }
    for(const key of Object.keys(sessionStorage)){
      if(/toepen|boerenbridge|bb_|draft/i.test(key)) sessionStorage.removeItem(key);
    }
    localStorage.setItem('jas_session_token_v11','v791-finalization-safe-session');
    sessionStorage.setItem('jas_session_token_v11','v791-finalization-safe-session');
  }catch(_){}
  const names=['Ada','Bram','Caro','Daan','Evi','Fleur','Gijs','Hugo','Iris','Jens'];
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    const raw=typeof input==='string'?input:input?.url;
    let url;
    try{url=new URL(raw,location.href);}catch(_){return originalFetch(input,init);}
    if(url.hostname.includes('supabase.co')&&url.pathname.includes('/rest/v1/rpc/')){
      const rpc=decodeURIComponent(url.pathname.split('/').pop()||'');
      let data=[];
      if(/(names|player_selector|active_names)/i.test(rpc)){
        data=names.map((name,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:name,public_display_name:name,player_name:name,login_active:true,active:true,site_scope:'friends'}));
      }else if(rpc==='get_toepen_app_state'){
        data={recent_games:[]};
      }else if(/public_state|homepage_state|jas_app_state|account_public_state/i.test(rpc)){
        data={session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada'}};
      }else if(rpc==='save_boerenbridge_match'){
        data={match_id:'bb-audit-safe'};
      }else{
        data=[];
      }
      return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    if(url.hostname.includes('supabase.co')){
      return new Response('[]',{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    return originalFetch(input,init);
  };
}

async function contextFor(browser,viewport){
  const escaped=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(safeInit);
  await context.route('https://*.supabase.co/**',async route=>{escaped.push(route.request().url());await route.abort();});
  return {context,escaped};
}

async function open(context,path){
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(res&&res.status()<400,`${path}: navigation status ${res?.status()}`);
  await page.waitForTimeout(300);
  assert.ok(!page.url().includes('login.html'),`${path}: unexpected login redirect`);
  return {page,errors};
}

async function noPageProblems(page,errors,label){
  assert.deepEqual(errors,[],`${label}: page errors: ${errors.join(' | ')}`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=6,`${label}: document horizontal overflow ${overflow}px`);
}

async function chooseUniqueSetupPlayers(page,containerSelector,count){
  for(let i=0;i<count;i+=1){
    const sel=page.locator(`${containerSelector} [data-player-index="${i}"]`);
    await sel.waitFor({state:'visible',timeout:5000});
    await sel.selectOption({label:NAMES[i]});
  }
}

async function testToepenCount(context,n){
  const {page,errors}=await open(context,`/toepen.html?audit_count=${n}`);
  await page.locator('#setupDialog[open]').waitFor({state:'visible',timeout:5000});
  const legal=await page.locator('#playerCount option').evaluateAll(os=>os.map(o=>Number(o.value||o.textContent.trim())));
  assert.deepEqual(legal,[2,3,4,5,6,7,8],`${n}p Toepen: legal count list drifted`);
  await page.locator('#playerCount').selectOption(String(n));
  await page.waitForFunction(expected=>document.querySelectorAll('#setupPlayers select[data-seat]').length===expected,n);
  for(let i=0;i<n;i+=1){
    const sel=page.locator(`#setupPlayers select[data-seat="${i}"]`);
    await sel.selectOption({label:NAMES[i]});
  }
  assert.equal(await page.locator('#dealer option').count(),n,`${n}p Toepen: dealer list must contain every selected player`);
  await page.locator('#dealer').selectOption('0');
  await page.locator('#setupForm button[type="submit"], #setupForm button:not([type])').last().click();
  await page.waitForFunction(()=>!document.querySelector('#setupDialog')?.open);
  assert.equal((await page.locator('#activeStat').textContent())?.trim(),`${n}/${n}`,`${n}p Toepen: active count did not initialize`);
  assert.equal(await page.locator('#roundForm').isVisible(),true,`${n}p Toepen: round form did not become active`);
  const winnerOptions=await page.locator('#winner option').count();
  assert.equal(winnerOptions,n,`${n}p Toepen: winner selector must contain all active players`);
  await page.locator('#winner').selectOption('1');
  await page.locator('#stake').selectOption('3');
  await page.locator('#roundForm button[type="submit"], #roundForm button:not([type])').last().click();
  await page.waitForFunction(()=>document.querySelector('#history')?.textContent?.includes('Ronde 1'));
  assert.equal((await page.locator('#roundStat').textContent())?.trim(),'2',`${n}p Toepen: next round index must be 2 after a saved round`);
  await page.locator('#undoBtn').click();
  assert.equal((await page.locator('#roundStat').textContent())?.trim(),'1',`${n}p Toepen: undo must restore round 1`);
  await noPageProblems(page,errors,`Toepen ${n}p`);
  await page.close();
}

async function testBoerenbridgeCount(context,n){
  const {page,errors}=await open(context,`/boerenbridge.html?audit_count=${n}`);
  await page.locator('#setupOverlay.show').waitFor({state:'visible',timeout:6000});
  const legal=await page.locator('#playerCountInput option').evaluateAll(os=>os.map(o=>Number(o.value)));
  assert.deepEqual(legal,[2,3,4,5,6,7],`${n}p Boerenbridge: legal count list drifted`);
  await page.locator('#playerCountInput').selectOption(String(n));
  await page.waitForFunction(expected=>document.querySelectorAll('#playerFields [data-player-index]').length===expected,n);
  await chooseUniqueSetupPlayers(page,'#playerFields',n);
  assert.equal(await page.locator('#dealerInput option').count(),n,`${n}p Boerenbridge: dealer list must contain all selected players`);
  await page.locator('#dealerInput').selectOption('0');
  await page.locator('#setupSaveBtn').click();
  await page.waitForFunction(()=>!document.querySelector('#setupOverlay')?.classList.contains('show'));
  assert.equal((await page.locator('#playersStat').textContent())?.trim(),String(n),`${n}p Boerenbridge: player stat drifted`);
  await page.locator('#bidOverlay.show').waitFor({state:'visible',timeout:5000});
  assert.equal(await page.locator('#bidPlayerCards [data-bid-player-index]').count(),n,`${n}p Boerenbridge: bid editor must contain every player`);
  const dealerForbidden=page.locator('#bidPlayerCards [data-bid-player-index="0"] option[value="1"]');
  assert.equal(await dealerForbidden.isDisabled(),true,`${n}p Boerenbridge: dealer must not be allowed to make total bid equal first-round trick count`);
  await page.locator('#bidSaveBtn').click();
  await page.locator('#wonOverlay.show').waitFor({state:'visible',timeout:5000});
  assert.equal(await page.locator('#wonPlayerCards [data-won-player-index]').count(),n,`${n}p Boerenbridge: won editor must contain every player`);
  await page.locator('#wonPlayerCards [data-won-player-index="0"]').selectOption('1');
  for(let i=1;i<n;i+=1) await page.locator(`#wonPlayerCards [data-won-player-index="${i}"]`).selectOption('0');
  await page.locator('#wonSaveBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('#roundBody tr.done-row[data-round-index]').length>=1);
  const savedCells=await page.locator('#roundBody tr.done-row[data-round-index="0"] td').count();
  assert.equal(savedCells,n+1,`${n}p Boerenbridge: saved round row must contain round label plus every player`);
  const selectSpecial=page.locator('#roundBody [data-special-index="0"] option[value="Selectie maken"]');
  const halfHalf=page.locator('#roundBody [data-special-index="0"] option[value="Half half"]');
  assert.equal(await selectSpecial.isDisabled(),n>5,`${n}p Boerenbridge: Selectie maken max-5 rule drifted`);
  assert.equal(await halfHalf.isDisabled(),n>6,`${n}p Boerenbridge: Half half max-6 rule drifted`);
  await noPageProblems(page,errors,`Boerenbridge ${n}p`);
  await page.close();
}

async function run(engineName,browser,viewName,viewport){
  const {context,escaped}=await contextFor(browser,viewport);
  try{
    for(let n=2;n<=8;n+=1){
      await testToepenCount(context,n);
      passes.push(`${engineName}:${viewName}:toepen:${n}`);
      console.log(`V791_SETUP_PASS ${engineName} ${viewName} Toepen ${n}p`);
    }
    for(let n=2;n<=7;n+=1){
      await testBoerenbridgeCount(context,n);
      passes.push(`${engineName}:${viewName}:boerenbridge:${n}`);
      console.log(`V791_SETUP_PASS ${engineName} ${viewName} Boerenbridge ${n}p`);
    }
    assert.deepEqual(escaped,[],`${engineName}:${viewName}: backend request escaped page-local safety mock`);
  }catch(err){
    failures.push(`${engineName}:${viewName}: ${err?.stack||err}`);
    console.error(`V791_SETUP_FAIL ${engineName} ${viewName}: ${err?.stack||err}`);
  }finally{
    await context.close();
  }
}

for(const [engineName,engine] of ENGINES){
  const browser=await engine.launch({headless:true});
  for(const [viewName,viewport] of VIEWPORTS) await run(engineName,browser,viewName,viewport);
  await browser.close();
}

console.log(`V791_SETUP_PASSES=${passes.length}`);
console.log(`V791_SETUP_FAILURES=${failures.length}`);
if(failures.length){
  console.error('V791_FINALIZATION_PLAYER_SETUP_BROWSER_MATRIX=FAIL');
  failures.forEach(f=>console.error(`- ${f}`));
  process.exit(1);
}
assert.equal(passes.length,78,'Expected 78 cross-engine/view player-count setup proofs');
console.log('V791_FINALIZATION_PLAYER_SETUP_BROWSER_MATRIX=PASS');
