#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.PROOF_BASE_URL||'http://127.0.0.1:4173';
const engines=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const viewports=[['mobile',{width:390,height:844}],['desktop',{width:1366,height:768}]];
const failures=[]; const passes=[];

function rpcName(url){try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';}}
function payload(state){
  const players=[
    {player_id:'p1',id:'p1',name:'Ada',player_name:'Ada',seat:1,dice_count:6,alive:true},
    {player_id:'p2',id:'p2',name:'Bram',player_name:'Bram',seat:2,dice_count:6,alive:true}
  ];
  return {
    game:{id:'pk-v790-proof',lobby_code:'PK790',status:state.phase,state_version:state.version,config:{penalty_mode:'wrong_loses',start_dice:6},state:{phase:state.phase,round_no:1,current_turn_seat:state.turn,bid:state.bid,last_reveal:null,winner_name:''}},
    players,
    viewer:{player_id:'p1',id:'p1',name:'Ada',player_name:'Ada',seat:1,dice_count:6,alive:true,is_host:true,my_hand:[1,2,3,4,5,6]},
    my_hand:[1,2,3,4,5,6],dice_totals:{current_total:12,start_total:12},votes:[]
  };
}

async function runCase(browser,engine,viewportName,viewport){
  const state={phase:'bidding',version:1,turn:1,bid:{count:4,face:6,bidder_name:'Bram',bidder_seat:2}};
  const calls=[]; const errors=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    localStorage.setItem('jas_session_token_v11','proof-session-token-123456789');
    sessionStorage.setItem('jas_session_token_v11','proof-session-token-123456789');
    window.alert=()=>{}; window.confirm=()=>false;
  });
  await context.route('**/*',async route=>{
    const req=route.request(); let u; try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname.includes('supabase.co')){
      if(u.pathname.includes('/rest/v1/rpc/')){
        const name=rpcName(req.url()); let body={}; try{body=req.postDataJSON()||{};}catch{}
        calls.push({name,body,method:req.method()});
        if(name==='pikken_get_state_scoped') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload(state))});
        if(name==='pikken_place_bid_scoped'){
          state.bid={count:Number(body.bid_count_input),face:Number(body.bid_face_input),bidder_name:'Ada',bidder_seat:1}; state.turn=2; state.version++;
          return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload(state))});
        }
        if(name==='pikken_abandon_and_record_scoped'||name==='pikken_record_completed_scoped') return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'});
      }
      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`}); return route.abort('blockedbyclient');
    }
    if(u.pathname==='/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });
  try{
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(String(e?.message||e)));
    const res=await page.goto(`${BASE}/pikken_live.html?client_match_id=pk-v790-proof&proof=1`,{waitUntil:'domcontentloaded',timeout:30000});
    assert.ok(res&&res.status()<400,`HTTP ${res?.status()}`);
    await page.waitForFunction(()=>document.querySelector('#diceFraction')?.textContent==='12/12',{timeout:7000});
    assert.equal(new URL(page.url()).pathname,'/pikken_live.html','Pikken proof redirected unexpectedly');
    assert.ok(!/login\.html$/i.test(new URL(page.url()).pathname),'Pikken proof landed on login');
    assert.equal(await page.locator('#diceStateNote img.die').count(),6,'Six private dice must render');
    const below=await page.locator('#bidSelect option').evaluateAll(opts=>opts.map(o=>o.value));
    assert.equal(below.includes('2:1'),false,'2 x pik must remain unavailable below 5 regular');

    state.bid={count:5,face:6,bidder_name:'Bram',bidder_seat:2}; state.turn=1; state.version++;
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#bidSelect option')).some(o=>o.value==='2:1'),{timeout:5000});
    const labels=await page.locator('#bidSelect option').allTextContents();
    assert.ok(labels.some(x=>/2 x pik/i.test(x)),'5 regular must visibly unlock 2 x pik');
    await page.locator('#bidSelect').selectOption('2:1');
    await page.locator('#bidBtn').click();
    await page.waitForFunction(()=>document.querySelector('#bidControls')?.classList.contains('hidden'),{timeout:5000});
    const bidCall=calls.find(c=>c.name==='pikken_place_bid_scoped');
    assert.ok(bidCall,'Physical bid click did not reach pikken_place_bid_scoped');
    assert.equal(Number(bidCall.body.bid_count_input),2,'Physical bid submitted wrong pik count');
    assert.equal(Number(bidCall.body.bid_face_input),1,'Physical bid submitted wrong pik face');
    assert.equal(String(bidCall.body.game_id_input),'pk-v790-proof','Physical bid submitted wrong game id');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Unexpected non-RPC Supabase traffic escaped interception');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=6,`horizontal overflow ${overflow}px`);
    assert.deepEqual(errors,[],`page errors: ${errors.join(' | ')}`);
    passes.push(`${engine}:${viewportName}`); console.log(`PROOF_PASS ${engine} ${viewportName}`);
    state.phase='finished'; state.version++;
    await page.close();
  } finally {await context.close();}
}

for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const [viewportName,viewport] of viewports){
    try{await runCase(browser,engineName,viewportName,viewport);}catch(err){failures.push(`${engineName}:${viewportName}: ${err?.stack||err}`);console.error(`PROOF_FAIL ${engineName} ${viewportName}\n${err?.stack||err}`);}
  }
  await browser.close();
}
console.log(`V790_PIKKEN_PROOF_PASSES=${passes.length}`);
console.log(`V790_PIKKEN_PROOF_FAILURES=${failures.length}`);
if(failures.length){failures.forEach(f=>console.error(`- ${f}`));process.exit(1);} console.log('V790_PIKKEN_RUNTIME_PROOF=PASS');
