#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:4173';
const engines = [['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const failures=[]; const passes=[];

function rpcName(url){ try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';} }
function pikkenPayload(state){
  const players=[
    {player_id:'p1',id:'p1',name:'Ada',player_name:'Ada',seat:1,dice_count:6,alive:true},
    {player_id:'p2',id:'p2',name:'Bram',player_name:'Bram',seat:2,dice_count:6,alive:true}
  ];
  return {
    game:{id:'pk-audit',lobby_code:'PKAUDIT',status:state.pik.phase,state_version:state.pik.version,config:{penalty_mode:state.pik.penaltyMode,start_dice:6},state:{phase:state.pik.phase,round_no:state.pik.round,current_turn_seat:state.pik.turn,bid:state.pik.bid,last_reveal:state.pik.lastReveal,winner_name:state.pik.winner||''}},
    players, viewer:{player_id:'p1',name:'Ada',player_name:'Ada',seat:1,dice_count:6,alive:true,is_host:true,my_hand:state.pik.hand},
    my_hand:state.pik.hand, dice_totals:{current_total:12,start_total:12}, votes:[]
  };
}
function paardPayload(state){
  const players=[
    {player_name:'Ada',selected_suit:'spades',wager_bakken:2,total_bakken_owed:0,is_host:true,is_ready:true,is_winner:state.paard.stage==='nominations'},
    {player_name:'Bram',selected_suit:'hearts',wager_bakken:2,total_bakken_owed:0,is_host:false,is_ready:true,is_winner:false}
  ];
  return {
    room:{room_code:'PRAUDIT',stage:state.paard.stage,stage_label:state.paard.stage,can_draw:state.paard.stage==='race'},
    match:{horse_positions:{spades:3,hearts:2,clubs:1,diamonds:4},gate_cards:['2H','3S','4D','5C','6H','7S','8D','9C','10H','JS'],resolved_gates:[1,2],gate_events:[{gate_no:1,suit:'hearts'},{gate_no:2,suit:'spades'}],draw_deck:['2H','3S','4D','5C','6H'],draw_index:2,last_draw_card:'QH',winner_suit:state.paard.stage==='nominations'?'spades':''},
    players,
    viewer:{player_name:'Ada',is_host:state.paard.host,can_nominate:state.paard.stage==='nominations',nomination_budget_bakken:state.paard.stage==='nominations'?4:0}
  };
}
function mockRpc(name,payload,state){
  if(name==='pikken_get_state_scoped') return pikkenPayload(state);
  if(name==='pikken_place_bid_scoped') { state.pik.bid={count:Number(payload.bid_count_input),face:Number(payload.bid_face_input),bidder_name:'Ada',bidder_seat:1}; state.pik.turn=2; state.pik.version++; return pikkenPayload(state); }
  if(name==='pikken_reject_bid_scoped'){state.pik.phase='voting';state.pik.version++;return pikkenPayload(state);}
  if(name==='pikken_cast_vote_scoped'){state.pik.version++;return pikkenPayload(state);}
  if(/^pikken_(record_completed|abandon_and_record|leave_game|destroy_game)/.test(name)) return {ok:true};
  if(name==='get_paardenrace_room_state_fast_v687'||name==='get_paardenrace_room_state_safe') return paardPayload(state);
  if(name==='paardenrace_cleanup_idle_lobbies_v495'){state.paard.cleanupCalls++;return {ok:true};}
  if(name==='draw_paardenrace_card_safe') return paardPayload(state);
  if(name==='kick_paardenrace_player_safe') return paardPayload(state);
  if(name==='reset_paardenrace_room_safe'){state.paard.stage='lobby';return paardPayload(state);}
  if(name==='submit_paardenrace_nominations_safe'){state.paard.stage='finished';return paardPayload(state);}
  if(/^(leave_paardenrace_room_safe|disband_paardenrace_room_safe|destroy_paardenrace_room_safe|close_paardenrace_room_safe)$/.test(name)) return {ok:true};
  return [];
}
async function contextFor(browser,viewport={width:390,height:844}){
  const state={pik:{phase:'bidding',version:1,round:1,turn:1,bid:null,hand:[1,2,3,4,5,6],lastReveal:null,winner:'',penaltyMode:'wrong_loses'},paard:{stage:'race',host:true,cleanupCalls:0}};
  const calls=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{
    localStorage.setItem('jas_session_token_v11','audit-session-token-123456789');
    sessionStorage.setItem('jas_session_token_v11','audit-session-token-123456789');
    window.__confirmMessages=[];
    window.confirm=(msg)=>{window.__confirmMessages.push(String(msg));return false;};
    window.alert=()=>{};
  });
  await context.route('**/*',async route=>{
    const req=route.request(); let url; try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname.includes('supabase.co')){
      if(url.pathname.includes('/rest/v1/rpc/')){
        const name=rpcName(req.url()); let payload={}; try{payload=req.postDataJSON()||{};}catch{}
        calls.push({name,payload,method:req.method()});
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mockRpc(name,payload,state))});
      }
      calls.push({name:`ESCAPE:${req.method()}:${url.pathname}`});
      return route.abort('blockedbyclient');
    }
    if(url.pathname==='/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });
  return {context,state,calls};
}
async function openPage(context,path){
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  assert.ok(res&&res.status()<400,`${path} navigation HTTP ${res?.status()}`);
  const expected=new URL(`${BASE}${path}`).pathname;
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).pathname,expected,`${path} redirected unexpectedly to ${page.url()}`);
  assert.ok(!/login\.html$/i.test(new URL(page.url()).pathname),`${path} landed on login`);
  return {page,errors};
}
function noErrors(errors,label){assert.deepEqual(errors,[],`${label} page errors: ${errors.join(' | ')}`);}
async function noOverflow(page,label){const x=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(x<=6,`${label} horizontal overflow ${x}px`);}

async function pikkenRules(browser,engine){
  const {context,state,calls}=await contextFor(browser);
  try{
    const {page,errors}=await openPage(context,'/pikken_live.html?client_match_id=pk-audit&auditplay=1');
    await page.waitForFunction(()=>document.querySelector('#diceFraction')?.textContent==='12/12',{timeout:6000});
    assert.equal(await page.locator('#diceStateNote img.die').count(),6,'Pikken must render six private dice');
    assert.equal(await page.locator('#diceStateNote img.pik').count(),1,'Pikken hand must visually identify one as pik/joker');
    const initial=await page.locator('#bidSelect option').allTextContents();
    assert.deepEqual(initial.slice(0,6),['1 x 2','1 x 3','1 x 4','1 x 5','1 x 6','1 x pik'],'Pikken base face order must be 2<3<4<5<6<pik');

    state.pik.bid={count:5,face:6,bidder_name:'Bram',bidder_seat:2}; state.pik.turn=1; state.pik.version++;
    await page.waitForTimeout(950);
    const values=await page.locator('#bidSelect option').evaluateAll(opts=>opts.map(o=>o.value));
    assert.ok(values.includes('2:1'),'Approved Pikken rule violated: after 5 regular, legal 2 x pik conversion is missing');

    state.pik.lastReveal={bid:{count:6,face:1},bid_true:true,counted_total:6,loser_name:'Bram',loser_dice_after:5,next_round:2,hands:[{name:'Ada',dice:[1,2,3,4,5,6],loser:false},{name:'Bram',dice:[2,2,3,4,5,6],loser:true,dice_after:5}]}; state.pik.version++;
    await page.waitForTimeout(950);
    assert.match(await page.locator('#revealBody').innerText(),/6 x pik/i,'Straight/6-pik reveal must be represented');
    assert.match(await page.locator('#revealBody').innerText(),/6 hit/i,'Straight 1-6 acceptance fixture must surface six pik hits');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Pikken emitted non-RPC Supabase traffic');
    await noOverflow(page,`${engine}:pikken-mobile`); noErrors(errors,`${engine}:pikken`);
    await page.close(); passes.push(`${engine}:pikken-deep-rules`); console.log(`ACCEPT_PASS ${engine} pikken-deep-rules`);
  }finally{await context.close();}
}

async function paardenraceRules(browser,engine){
  const {context,state,calls}=await contextFor(browser);
  try{
    const {page,errors}=await openPage(context,'/paardenrace_live.html?room=PRAUDIT&auditplay=1');
    await page.waitForFunction(()=>document.querySelector('#heroReady')?.textContent==='2/2',{timeout:6000});
    assert.ok(state.paard.cleanupCalls>0,'Paardenrace must run idle-lobby cleanup on live load');
    assert.equal(await page.locator('#boardBox .pr-minimap-row--gates').count(),1,'Paardenrace minimap must place GATE row at top');
    assert.equal((await page.locator('#boardBox .pr-minimap-label').first().textContent())?.trim(),'G','Paardenrace gate row label must be G');
    const cardProof=await page.evaluate(()=>({heart:GEJAST_PAARDENRACE.renderFaceUpCard('QH'),diamond:GEJAST_PAARDENRACE.renderFaceUpCard('10D'),spade:GEJAST_PAARDENRACE.renderFaceUpCard('AS'),club:GEJAST_PAARDENRACE.renderFaceUpCard('KC')}));
    assert.match(cardProof.heart,/pr-open-card red/); assert.match(cardProof.diamond,/pr-open-card red/); assert.doesNotMatch(cardProof.spade,/pr-open-card red/); assert.doesNotMatch(cardProof.club,/pr-open-card red/);
    assert.equal(await page.locator('#drawBtn').isVisible(),true,'Host draw control must be visible');
    await page.locator('#mobileDock [data-drawer-target="players"]').click();
    await page.waitForFunction(()=>document.querySelector('#mobileDrawer')?.classList.contains('show'),{timeout:3000});
    const visibleKick=page.locator('#drawerBody [data-kick-player]:visible');
    assert.equal(await visibleKick.count(),1,'Exactly one responsive kick control should be visible to host');
    await visibleKick.first().click();
    const confirms=await page.evaluate(()=>window.__confirmMessages);
    assert.ok(confirms.some(m=>/uit het spel gooien\?/i.test(m)),'Kick confirmation must be Dutch and explicit');
    await page.locator('#drawerCloseBtn').click();

    state.paard.host=false;
    await page.waitForTimeout(1950);
    assert.equal(await page.locator('#drawBtn').isVisible(),false,'Participant must not see host draw control');
    await page.locator('#mobileDock [data-drawer-target="players"]').click();
    assert.equal(await page.locator('#drawerBody [data-kick-player]:visible').count(),0,'Participant must not see host kick controls');
    await page.locator('#drawerCloseBtn').click();

    state.paard.host=true; state.paard.stage='nominations';
    await page.waitForTimeout(1950);
    await page.locator('#mobileDock [data-drawer-target="nominations"]').click();
    assert.match(await page.locator('#drawerBody').innerText(),/Jouw budget[\s\S]*4 Bakken/i,'Nomination budget must expose 2x a 2-Bakken starting wager');
    assert.doesNotMatch(await page.locator('#drawerBody').innerText(),/Ada[\s\S]*totaal verschuldigd/i,'Winner must not nominate self');
    assert.equal(await page.getByText('Noodrem',{exact:false}).count(),0,'Obsolete Noodrem control/text must be absent');
    const mobileLabels=await page.locator('#mobileDock button').allTextContents();
    assert.deepEqual(mobileLabels.map(s=>s.trim()),['Spelers','Log','Nomineer'],'Mobile dock must not contain obsolete Race bar');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Paardenrace emitted non-RPC Supabase traffic');
    await noOverflow(page,`${engine}:paardenrace-mobile`); noErrors(errors,`${engine}:paardenrace`);
    await page.close(); passes.push(`${engine}:paardenrace-deep-rules`); console.log(`ACCEPT_PASS ${engine} paardenrace-deep-rules`);
  }finally{await context.close();}
}

for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const fn of [pikkenRules,paardenraceRules]){
    try{await fn(browser,engineName);}catch(err){failures.push(`${engineName}:${fn.name}: ${err?.stack||err}`);console.error(`ACCEPT_FAIL ${engineName} ${fn.name}\n${err?.stack||err}`);}
  }
  await browser.close();
}
console.log(`AUDIT_RULES_PASSES=${passes.length}`); console.log(`AUDIT_RULES_FAILURES=${failures.length}`);
if(failures.length){console.error('AUDIT_V789_RULES=FAIL'); failures.forEach(f=>console.error(`- ${f}`)); process.exit(1);} console.log('AUDIT_V789_RULES=PASS');
