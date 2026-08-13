#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.V791_BASE_URL || 'http://127.0.0.1:4173';
const ENGINES = [['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const VIEWPORTS = [
  ['mobile',{width:390,height:844}],
  ['desktop',{width:1366,height:768}],
];
const failures=[];
const passes=[];

function auditInit(){
  const qs = new URLSearchParams(location.search);
  const livePikken = location.pathname.endsWith('/pikken_live.html');
  const bidRaw = String(qs.get('auditbid')||'');
  const bm = bidRaw.match(/^(\d+)x([1-6])$/);
  const audit = window.__V791_AUDIT = {
    calls:[],
    state:{
      paard:{exists:false,locked:false,ready:false,stage:'lobby'},
      pikken:{exists:livePikken,ready:livePikken,phase:livePikken?(qs.get('auditphase')||'bidding'):'lobby',bid:bm?{count:Number(bm[1]),face:Number(bm[2]),bidder_seat:2,bidder_name:'Bram'}:null,stateVersion:1}
    }
  };
  try {
    localStorage.setItem('jas_session_token_v11','v791-safe-session-token');
    sessionStorage.setItem('jas_session_token_v11','v791-safe-session-token');
    localStorage.setItem('gejast_pikken_participant_v687', JSON.stringify({game_id:'pk-v791',at:Date.now()}));
  } catch (_) {}
  window.confirm=()=>true;
  window.alert=(message)=>{ audit.calls.push({name:'ALERT',payload:{message:String(message||'')}}); };
  const originalFetch=window.fetch.bind(window);
  const paardState=()=>{
    if(!audit.state.paard.exists) return {room:null,players:[],viewer:{}};
    const a=audit.state.paard;
    const ada={player_id:'p1',player_name:'Ada',selected_suit:a.locked?'spades':null,selected_suit_label:a.locked?'Schoppen':'',wager_bakken:a.locked?1:0,wager_verified:a.locked,is_ready:a.ready};
    const bram={player_id:'p2',player_name:'Bram',selected_suit:'hearts',selected_suit_label:'Harten',wager_bakken:1,wager_verified:true,is_ready:true};
    return {room:{room_code:'PR791',stage:a.stage,stage_label:a.stage,host_name:'Ada',can_start:a.ready},players:[ada,bram],viewer:{...ada,is_host:true,has_locked_choice:a.locked},pending_verifications:[]};
  };
  const pikkenState=()=>{
    if(!audit.state.pikken.exists) return {game:null,players:[],viewer:{}};
    const p=audit.state.pikken;
    return {
      game:{id:'pk-v791',game_id:'pk-v791',lobby_code:'PK791',status:p.phase,config:{penalty_mode:'wrong_loses',start_dice:6},state_version:p.stateVersion,state:{phase:p.phase,round_no:1,current_turn_seat:1,vote_turn_seat:p.phase==='voting'?1:0,bid:p.bid,start_dice:6}},
      game_id:'pk-v791',lobby_code:'PK791',code:'PK791',state_version:p.stateVersion,
      players:[
        {player_id:'p1',player_name:'Ada',name:'Ada',seat:1,dice_count:6,is_ready:p.ready,alive:true,is_host:true},
        {player_id:'p2',player_name:'Bram',name:'Bram',seat:2,dice_count:6,is_ready:true,alive:true,is_host:false}
      ],
      viewer:{player_id:'p1',player_name:'Ada',name:'Ada',seat:1,is_host:true,is_ready:p.ready,alive:true,my_hand:[1,2,3,4,5,6]},
      my_hand:[1,2,3,4,5,6],dice_totals:{current_total:12,start_total:12},votes:[]
    };
  };
  const mock=(name,payload)=>{
    const p=audit.state.pikken;
    if(/^(get_login_active_names_v687|get_game_player_names_fast_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1)$/.test(name)) return ['Ada','Bram','Caro','Daan'].map((n,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:n,player_name:n,public_display_name:n,login_active:true,active:true,site_scope:'friends'}));
    if(/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name)) return {session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
    if(/^get_paardenrace_open_rooms/.test(name)||/^get_paardenrace_stats/.test(name)) return [];
    if(name==='create_paardenrace_room_fast_v687'){audit.state.paard.exists=true;return paardState();}
    if(name==='get_paardenrace_room_state_fast_v687'||name==='get_paardenrace_room_state_safe') return paardState();
    if(name==='update_paardenrace_room_choice_safe'||name==='verify_paardenrace_wager_safe'){audit.state.paard.exists=true;audit.state.paard.locked=true;return paardState();}
    if(name==='set_paardenrace_ready_safe'){audit.state.paard.ready=Boolean(payload?.ready_input);return paardState();}
    if(/^start_paardenrace_(countdown_safe|countdown_fast_v687|room_safe)$/.test(name)){audit.state.paard.stage='countdown';audit.state.paard.ready=true;return paardState();}
    if(/^get_pikken_open_lobbies/.test(name)||/^get_pikken_live_matches/.test(name)||name==='pikken_get_deep_stats_scoped') return [];
    if(name==='cleanup_stale_pikken_rooms_v706') return {ok:true};
    if(name==='pikken_create_lobby_fast_v687'||name==='pikken_create_lobby_scoped'){p.exists=true;p.phase='lobby';p.ready=false;p.stateVersion++;return {game_id:'pk-v791',id:'pk-v791',lobby_code:'PK791'};}
    if(name==='pikken_get_state_scoped') return pikkenState();
    if(name==='pikken_set_ready_scoped'){p.ready=Boolean(payload?.ready_input);p.stateVersion++;return pikkenState();}
    if(name==='pikken_update_lobby_config_v715'){p.stateVersion++;return pikkenState();}
    if(name==='pikken_start_game_scoped'){p.phase='bidding';p.ready=true;p.stateVersion++;return pikkenState();}
    if(name==='pikken_place_bid_scoped'){p.bid={count:Number(payload?.bid_count_input),face:Number(payload?.bid_face_input),bidder_seat:1,bidder_name:'Ada'};p.stateVersion++;return pikkenState();}
    if(name==='pikken_reject_bid_scoped'){p.phase='voting';p.stateVersion++;return pikkenState();}
    if(name==='pikken_cast_vote_scoped'){audit.calls.push({name:'VOTE_VALUE',payload:{vote:payload?.vote_input}});p.stateVersion++;return pikkenState();}
    if(/^pikken_(leave_game_scoped|destroy_game_scoped|destroy_game_fast_v687)$/.test(name)) return {ok:true};
    if(/^(get_|load_)/.test(name)) return [];
    return {ok:true};
  };
  window.fetch=async function(input,init={}){
    const raw=typeof input==='string'?input:input?.url;
    let url; try{url=new URL(raw,location.href);}catch(_){return originalFetch(input,init);}
    if(url.hostname.includes('supabase.co')&&url.pathname.includes('/rest/v1/rpc/')){
      const name=decodeURIComponent(url.pathname.split('/').pop()||'');
      let payload={}; try{payload=init?.body?JSON.parse(init.body):{};}catch(_){}
      audit.calls.push({name,payload});
      return new Response(JSON.stringify(mock(name,payload)),{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    if(url.hostname.includes('supabase.co')){
      audit.calls.push({name:`UNEXPECTED_BACKEND:${url.pathname}`,payload:{}});
      return new Response('[]',{status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    }
    return originalFetch(input,init);
  };
}

async function makeContext(browser,viewport){
  const escaped=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(auditInit);
  await context.route('https://*.supabase.co/**',async route=>{escaped.push(route.request().url());await route.abort();});
  return {context,escaped};
}

async function openPage(context,path){
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(res&&res.status()<400,`${path} navigation failed ${res?.status()}`);
  await page.waitForTimeout(450);
  assert.ok(!page.url().includes('login.html'),`${path} unexpectedly redirected to login`);
  return {page,errors};
}
async function noErrors(errors,label){assert.deepEqual(errors,[],`${label} pageerror: ${errors.join(' | ')}`);}
async function noOverflow(page,label){const x=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(x<=6,`${label} horizontal overflow ${x}px`);}
async function calls(page){return page.evaluate(()=>window.__V791_AUDIT?.calls||[]);}
async function hasCall(page,name){return (await calls(page)).some(c=>c.name===name);}

async function testPaardenrace(context){
  const {page,errors}=await openPage(context,'/paardenrace.html?auditplay=1');
  await page.locator('#createBtn').click();
  await page.waitForFunction(()=>document.querySelector('#roomCodeLabel')?.textContent==='PR791',null,{timeout:6000});
  assert.equal(await hasCall(page,'create_paardenrace_room_fast_v687'),true,'Paardenrace create RPC missing');
  await page.locator('#suitInput').selectOption('spades');
  await page.locator('#wagerInput').fill('1');
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#savedChoiceBox')).display!=='none',null,{timeout:5000});
  assert.equal(await hasCall(page,'update_paardenrace_room_choice_safe'),true,'Paardenrace choice RPC missing');
  await page.locator('#readyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#roomReadyStat')?.textContent==='2/2',null,{timeout:5000});
  assert.equal(await hasCall(page,'set_paardenrace_ready_safe'),true,'Paardenrace ready RPC missing');
  assert.equal(await page.locator('#startBtn').isEnabled(),true,'Paardenrace start should enable for two verified ready distinct suits');
  await page.locator('#startBtn').click();
  await page.waitForTimeout(350);
  assert.equal(await hasCall(page,'start_paardenrace_countdown_safe'),true,'Paardenrace start RPC missing');
  const render=await page.evaluate(()=>{
    const api=window.GEJAST_PAARDENRACE;
    const red=api.parseCard('AH');
    const black=api.parseCard('AS');
    const html=api.renderRaceMinimap({horse_positions:{spades:2,hearts:3,clubs:1,diamonds:4},gate_cards:['AH','2S','3D','4C','5H','6S','7D','8C','9H','10S'],resolved_gates:[1],gate_events:[{gate_no:1,suit:'hearts'}]});
    const host=api.summarizeLiveRoom({stage:'nominations'},{horse_positions:{},resolved_gates:[]},[{wager_bakken:2,wager_verified:true,is_ready:true}],{is_host:true});
    return {red:red.isRed,black:black.isRed,gateFirst:html.indexOf('pr-minimap-row--gates')<html.indexOf('data-suit="spades"'),redGate:/pr-gate-mini red/.test(html),isHost:host.isHost};
  });
  assert.deepEqual(render,{red:true,black:false,gateFirst:true,redGate:true,isHost:true},'Paardenrace card/gate rendering invariant failed');
  await noOverflow(page,'paardenrace'); await noErrors(errors,'paardenrace'); await page.close();
}

async function testPikkenLobby(context){
  const {page,errors}=await openPage(context,'/pikken.html?auditplay=1');
  await page.locator('#pkCreateLobbyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#pkLobbyCode')?.textContent?.includes('PK791'),null,{timeout:6000});
  assert.equal(await hasCall(page,'pikken_create_lobby_fast_v687'),true,'Pikken create RPC missing');
  await page.locator('#pkReadyBtn').waitFor({state:'visible',timeout:5000});
  await page.locator('#pkReadyBtn').click();
  await page.waitForFunction(()=>document.querySelector('#pkLobbyStickyNote')?.textContent?.includes('ready'),null,{timeout:5000});
  assert.equal(await hasCall(page,'pikken_set_ready_scoped'),true,'Pikken ready RPC missing');
  await page.locator('#pkStartBtn').click();
  await page.waitForURL(/pikken_live\.html\?client_match_id=pk-v791/, {timeout:7000});
  const c=await calls(page);
  assert.ok(c.some(x=>x.name==='pikken_update_lobby_config_v715'),'Pikken config RPC missing');
  assert.ok(c.some(x=>x.name==='pikken_start_game_scoped'),'Pikken start RPC missing');
  await noOverflow(page,'pikken-lobby/live'); await noErrors(errors,'pikken-lobby'); await page.close();
}

async function testPikkenBidRule(context){
  const low=await openPage(context,'/pikken_live.html?client_match_id=pk-v791&auditplay=1&auditbid=4x6');
  await low.page.locator('#bidSelect').waitFor({state:'visible',timeout:6000});
  let values=await low.page.locator('#bidSelect option').evaluateAll(os=>os.map(o=>o.value));
  assert.equal(values.includes('2:1'),false,'2 pik must not be legal after only 4 regular');
  assert.ok(values.includes('4:1')||values.includes('5:2'),'Pikken legal bid list did not advance');
  await noErrors(low.errors,'pikken-low-bid'); await low.page.close();

  const high=await openPage(context,'/pikken_live.html?client_match_id=pk-v791&auditplay=1&auditbid=5x6');
  await high.page.locator('#bidSelect').waitFor({state:'visible',timeout:6000});
  values=await high.page.locator('#bidSelect option').evaluateAll(os=>os.map(o=>o.value));
  assert.equal(values.includes('2:1'),true,'2 pik must become legal after 5 regular');
  await high.page.locator('#bidSelect').selectOption('2:1');
  await high.page.locator('#bidBtn').click();
  await high.page.waitForTimeout(250);
  assert.equal(await hasCall(high.page,'pikken_place_bid_scoped'),true,'Pikken live bid RPC missing');
  const dice=await high.page.locator('#myDice img.die, #diceBoard img.die').count();
  assert.ok(dice>=6,`Pikken private hand did not render six dice (${dice})`);
  await noOverflow(high.page,'pikken-live'); await noErrors(high.errors,'pikken-high-bid'); await high.page.close();
}

async function runCase(engineName,browser,viewName,viewport,label,fn){
  const {context,escaped}=await makeContext(browser,viewport);
  try{
    await fn(context);
    assert.deepEqual(escaped,[],`${label} allowed backend traffic to escape page-local mock`);
    passes.push(`${engineName}:${viewName}:${label}`);
    console.log(`V791_ACCEPT_PASS ${engineName} ${viewName} ${label}`);
  }catch(e){
    failures.push(`${engineName}:${viewName}:${label}: ${e?.stack||e}`);
    console.error(`V791_ACCEPT_FAIL ${engineName} ${viewName} ${label}: ${e?.stack||e}`);
  }finally{await context.close();}
}

for(const [engineName,engine] of ENGINES){
  const browser=await engine.launch({headless:true});
  for(const [viewName,viewport] of VIEWPORTS){
    await runCase(engineName,browser,viewName,viewport,'paardenrace-create-choice-ready-start-render',testPaardenrace);
    await runCase(engineName,browser,viewName,viewport,'pikken-create-ready-start',testPikkenLobby);
    await runCase(engineName,browser,viewName,viewport,'pikken-2pik-live-bid-private-dice',testPikkenBidRule);
  }
  await browser.close();
}

console.log(`V791_CORE_ACCEPT_PASSES=${passes.length}`);
console.log(`V791_CORE_ACCEPT_FAILURES=${failures.length}`);
if(failures.length){
  console.error('V791_CORE_GAMEPLAY_ACCEPTANCE=FAIL');
  failures.forEach(f=>console.error(`- ${f}`));
  process.exit(1);
}
console.log('V791_CORE_GAMEPLAY_ACCEPTANCE=PASS');
