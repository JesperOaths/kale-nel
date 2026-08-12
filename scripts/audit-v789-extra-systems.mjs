#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.AUDIT_BASE_URL||'http://127.0.0.1:4173';
const engines=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const failures=[]; const passes=[];
const rpcName=(url)=>{try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';}};

function ballroomPayload(s){
  return {
    has_king:s.ballroom.hasKing,
    king:s.ballroom.hasKing?{display_name:s.ballroom.king,avatar_url:''}:null,
    approved_members:s.ballroom.members.map(display_name=>({display_name,avatar_url:''})),
    succession_line:s.ballroom.members.map(display_name=>({display_name})),
    pending_requests:s.ballroom.requests.map((display_name,i)=>({id:i+1,display_name,avatar_url:'',requested_at:'2026-08-12T20:00:00Z'})),
    viewer:{is_king:s.ballroom.viewer==='king',is_member:s.ballroom.viewer==='member',pending:s.ballroom.viewer==='pending'}
  };
}
function drinksRead(s){
  const eventTypes=[
    {key:'bier',label:'1 Bak',unit_value:1},{key:'2bakken',label:'2 Bakken',unit_value:2},
    {key:'liter_bier',label:'Liter Bier',unit_value:3},{key:'ice',label:'Ice',unit_value:2.8},{key:'wijnfles',label:'Fles Wijn',unit_value:9}
  ];
  return {ok:true,data:{event_types:eventTypes,speed_page:{my_attempts:s.drinks.mine,verify_queue:s.drinks.queue,top_attempts:s.drinks.top},speed_leaderboards:eventTypes.filter(x=>x.key!=='shot').map(x=>({key:x.key,label:x.label,rows:s.drinks.top.filter(r=>r.speed_type_key===x.key)}))}};
}
function marketData(s){
  return {market:{id:42,title:'Auditmarkt',description:'Alleen lokale test',outcome_a:'Ja',outcome_b:'Nee',pool_a:10,pool_b:12,status:'open'},positions:s.beurs.positions};
}
function dashboardData(s){
  return {wallet:{balance:500,player_name:'Ada'},ledger:[],leaderboard:[{player_name:'Ada',balance:500}],totals:{open_markets:s.beurs.created?1:0},markets:s.beurs.created?[{id:42,title:'Auditmarkt',description:'Alleen lokale test',outcome_a:'Ja',outcome_b:'Nee',pool_a:10,pool_b:12,status:'open'}]:[],positions:s.beurs.positions};
}
function mockRpc(name,p,s){
  if(name==='get_despimarkt_dashboard_v669') return dashboardData(s);
  if(name==='create_despimarkt_market_v669'){s.beurs.created=true;return {market_id:42,id:42};}
  if(name==='get_despimarkt_market_v669') return marketData(s);
  if(name==='buy_despimarkt_position_v669'){s.beurs.positions.push({player_name:'Ada',outcome:p.outcome_input,status:'open',stake:Number(p.stake_input)});return {ok:true};}
  if(name==='get_despimarkt_wallet_v669') return {wallet:{balance:500,player_name:'Ada'},ledger:[]};
  if(name==='get_despimarkt_ladder_v669') return {leaderboard:[]};
  if(name==='get_despimarkt_stats_v669') return {totals:{open_markets:s.beurs.created?1:0}};

  if(/^get_ballroom_(state|public_state)(_safe)?$/.test(name)) return ballroomPayload(s);
  if(name==='ballroom_claim_king_safe'){s.ballroom.hasKing=true;s.ballroom.king='Ada';s.ballroom.viewer='king';return {ok:true};}
  if(name==='ballroom_abdicate_safe'){s.ballroom.hasKing=false;s.ballroom.king='';s.ballroom.viewer='none';return {ok:true};}
  if(name==='ballroom_request_entry_safe'){s.ballroom.viewer='pending';if(!s.ballroom.requests.includes('Ada'))s.ballroom.requests.push('Ada');return {ok:true};}
  if(name==='ballroom_resolve_request_safe'){const idx=Math.max(0,Number(p.request_id_input||1)-1);const [nameResolved]=s.ballroom.requests.splice(idx,1);if(p.approve_input&&nameResolved&&!s.ballroom.members.includes(nameResolved))s.ballroom.members.push(nameResolved);return {ok:true};}

  if(name==='contract_drinks_read_v664') return drinksRead(s);
  if(name==='contract_drinks_write_v664'){
    const action=p.action; const payload=p.payload||{}; s.drinks.actions.push(action);
    if(action==='create_speed_attempt'){
      const row={id:101,player_name:'Ada',speed_type_key:payload.event_type_key,speed_type_label:payload.event_type_key==='ice'?'Ice':'1 Bak',duration_seconds:Number(payload.duration_seconds),status:'pending'};
      s.drinks.mine=[row]; return {ok:true,data:{attempt_id:101}};
    }
    if(action==='cancel_speed_attempt'){s.drinks.mine=s.drinks.mine.filter(r=>Number(r.id)!==Number(payload.attempt_id));return {ok:true,data:{ok:true}};}
    if(action==='verify_speed_attempt'){s.drinks.queue=s.drinks.queue.filter(r=>Number(r.id)!==Number(payload.attempt_id));return {ok:true,data:{ok:true}};}
    return {ok:true,data:{ok:true}};
  }
  if(name==='contract_drinks_queue_nearby_v664'||name==='queue_nearby_verification_pushes_v3') return {ok:true,queued_count:0};
  return [];
}

async function makeContext(browser){
  const state={
    beurs:{created:false,positions:[]},
    ballroom:{hasKing:false,king:'',viewer:'none',members:[],requests:[]},
    drinks:{mine:[],queue:[{id:102,player_name:'Bram',speed_type_key:'bier',speed_type_label:'1 Bak',duration_seconds:4.2,status:'pending'}],top:[],actions:[]}
  };
  const calls=[];
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block',geolocation:{latitude:52.37,longitude:4.89,accuracy:10},permissions:['geolocation']});
  await context.addInitScript(()=>{
    localStorage.setItem('jas_session_token_v11','audit-session-token-123456789');
    sessionStorage.setItem('jas_session_token_v11','audit-session-token-123456789');
    window.alert=()=>{}; window.confirm=()=>true;
  });
  await context.route('**/*',async route=>{
    const req=route.request(); let u; try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname.includes('supabase.co')){
      if(u.pathname.includes('/rest/v1/rpc/')){
        const name=rpcName(req.url()); let payload={}; try{payload=req.postDataJSON()||{};}catch{}
        calls.push({name,payload});
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mockRpc(name,payload,state))});
      }
      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`}); return route.abort('blockedbyclient');
    }
    if(u.pathname==='/favicon.ico') return route.fulfill({status:204,body:''});
    return route.continue();
  });
  return {context,state,calls};
}
async function open(context,path){
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:30000}); assert.ok(res&&res.status()<400,`${path} HTTP ${res?.status()}`);
  await page.waitForTimeout(700); assert.equal(new URL(page.url()).pathname,new URL(BASE+path).pathname,`${path} redirected to ${page.url()}`); assert.ok(!/login\.html$/i.test(new URL(page.url()).pathname));
  return {page,errors};
}
async function noOverflow(page,label){const x=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(x<=6,`${label} overflow ${x}px`);}
function noErrors(errors,label){assert.deepEqual(errors,[],`${label} pageerror: ${errors.join(' | ')}`);}

async function beursFlow(browser,engine){
  const {context,state,calls}=await makeContext(browser);
  try{
    let {page,errors}=await open(context,'/beurs.html?auditplay=1');
    await page.waitForFunction(()=>/Beurs geladen/.test(document.querySelector('#status')?.textContent||''),{timeout:7000});
    assert.match(await page.locator('#marketList').innerText(),/geen|nog/i,'Beurs should start with no mocked market');
    await page.locator('#quickMarketTitle').fill('Auditmarkt'); await page.locator('#quickMarketDescription').fill('Alleen lokale test');
    await page.locator('#quickMarketForm').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#marketList')?.textContent?.includes('Auditmarkt'),{timeout:7000});
    assert.ok(state.beurs.created,'Quick market creation action did not execute');
    noErrors(errors,`${engine}:beurs-hub`); await noOverflow(page,`${engine}:beurs-hub`); await page.close();

    ({page,errors}=await open(context,'/despimarkt_market.html?market_id=42&auditplay=1'));
    await page.waitForFunction(()=>document.querySelector('#marketBox')?.textContent?.includes('Auditmarkt'),{timeout:7000});
    await page.locator('#stakeInput').fill('25'); await page.locator('[data-buy="A"]').click();
    await page.waitForFunction(()=>document.querySelector('#marketBox')?.textContent?.includes('Ada'),{timeout:7000});
    assert.deepEqual(state.beurs.positions.map(p=>[p.outcome,p.stake]),[['A',25]],'Beurs buy lifecycle mismatch');
    assert.ok(calls.some(c=>c.name==='create_despimarkt_market_v669')&&calls.some(c=>c.name==='buy_despimarkt_position_v669'),'Beurs preferred create/buy RPC path not used');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Beurs emitted non-RPC Supabase traffic');
    noErrors(errors,`${engine}:beurs-market`); await noOverflow(page,`${engine}:beurs-market`); await page.close();
    passes.push(`${engine}:beurs`); console.log(`ACCEPT_PASS ${engine} beurs`);
  } finally {await context.close();}
}

async function ballroomFlow(browser,engine){
  const {context,state,calls}=await makeContext(browser);
  try{
    let {page,errors}=await open(context,'/ballroom.html?auditplay=1');
    await page.waitForFunction(()=>!document.querySelector('#claimBtn')?.disabled,{timeout:5000});
    await page.locator('#claimBtn').click(); await page.waitForFunction(()=>document.querySelector('#abdicateBtn')?.offsetParent!==null,{timeout:5000});
    assert.equal(state.ballroom.viewer,'king','Ballroom claim did not transition viewer to king');
    await page.locator('#abdicateBtn').click(); await page.waitForFunction(()=>document.querySelector('#claimBtn')?.offsetParent!==null,{timeout:5000});
    assert.equal(state.ballroom.hasKing,false,'Ballroom abdication did not release crown');
    noErrors(errors,`${engine}:ballroom-claim`); await page.close();

    state.ballroom.hasKing=true; state.ballroom.king='Bram'; state.ballroom.viewer='none';
    ({page,errors}=await open(context,'/ballroom.html?auditplay=request'));
    await page.waitForFunction(()=>document.querySelector('#joinBtn')?.offsetParent!==null&&!document.querySelector('#joinBtn')?.disabled,{timeout:5000});
    await page.locator('#joinBtn').click(); await page.waitForFunction(()=>/beoordeling/.test(document.querySelector('#statusMsg')?.textContent||''),{timeout:5000});
    assert.equal(state.ballroom.viewer,'pending','Ballroom request did not become pending');
    noErrors(errors,`${engine}:ballroom-request`); await page.close();

    state.ballroom.viewer='king'; state.ballroom.king='Ada'; state.ballroom.requests=['Bram'];
    ({page,errors}=await open(context,'/ballroom.html?auditplay=resolve'));
    await page.waitForFunction(()=>document.querySelector('[data-resolve="approve"]'),{timeout:5000}); await page.locator('[data-resolve="approve"]').click();
    await page.waitForFunction(()=>document.querySelector('#memberList')?.textContent?.includes('Bram'),{timeout:5000});
    assert.ok(state.ballroom.members.includes('Bram'),'Ballroom approval did not add member');
    assert.ok(['ballroom_claim_king_safe','ballroom_request_entry_safe','ballroom_resolve_request_safe','ballroom_abdicate_safe'].every(n=>calls.some(c=>c.name===n)), 'Ballroom safe write chain incomplete');
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Ballroom emitted non-RPC Supabase traffic');
    noErrors(errors,`${engine}:ballroom-resolve`); await noOverflow(page,`${engine}:ballroom`); await page.close();
    passes.push(`${engine}:ballroom`); console.log(`ACCEPT_PASS ${engine} ballroom`);
  } finally {await context.close();}
}

async function drinksFlow(browser,engine){
  const {context,state,calls}=await makeContext(browser);
  try{
    const {page,errors}=await open(context,'/drinks_speed.html?auditplay=1');
    await page.waitForFunction(()=>document.querySelectorAll('#speedTypeButtons button').length>=5,{timeout:7000});
    assert.match(await page.locator('#speedTypeButtons').innerText(),/Ice/,'Ice speed type missing');
    const iceUnit=await page.evaluate(()=>window.GEJAST_DRINKS_WORKFLOW?.drinkTypes?.find?.(x=>x.key==='ice')?.unit_value ?? null).catch(()=>null);
    if(iceUnit!==null) assert.equal(Number(iceUnit),2.8,'Ice unit changed from 2.8');
    await page.getByRole('button',{name:/Ice/i}).first().click(); await page.locator('#speedSeconds').fill('3.7'); await page.locator('#submitSpeed').click();
    await page.waitForFunction(()=>document.querySelector('#speedMine')?.textContent?.includes('3.7'),{timeout:8000});
    assert.ok(state.drinks.actions.includes('create_speed_attempt'),'Drinks Speed did not use preferred create action');
    await page.locator('[data-cancel-speed="101"]').click(); await page.waitForFunction(()=>!document.querySelector('[data-cancel-speed="101"]'),{timeout:8000});
    assert.ok(state.drinks.actions.includes('cancel_speed_attempt'),'Drinks Speed did not use preferred cancel action');
    await page.locator('[data-speed-verify="102"]').click(); await page.waitForFunction(()=>!document.querySelector('[data-speed-verify="102"]'),{timeout:8000});
    assert.ok(state.drinks.actions.includes('verify_speed_attempt'),'Drinks Speed did not use preferred verify action');
    const writes=calls.filter(c=>c.name==='contract_drinks_write_v664').map(c=>c.payload.action);
    for(const action of ['create_speed_attempt','cancel_speed_attempt','verify_speed_attempt']) assert.ok(writes.includes(action),`Missing v664 action ${action}`);
    assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),'Drinks Speed emitted non-RPC Supabase traffic');
    noErrors(errors,`${engine}:drinks-speed`); await noOverflow(page,`${engine}:drinks-speed`); await page.close();
    passes.push(`${engine}:drinks-speed`); console.log(`ACCEPT_PASS ${engine} drinks-speed`);
  } finally {await context.close();}
}

for(const [name,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const fn of [beursFlow,ballroomFlow,drinksFlow]){
    try{await fn(browser,name);}catch(err){failures.push(`${name}:${fn.name}: ${err?.stack||err}`);console.error(`ACCEPT_FAIL ${name} ${fn.name}\n${err?.stack||err}`);}
  }
  await browser.close();
}
console.log(`AUDIT_EXTRA_PASSES=${passes.length}`); console.log(`AUDIT_EXTRA_FAILURES=${failures.length}`);
if(failures.length){console.error('AUDIT_V789_EXTRA=FAIL');failures.forEach(x=>console.error(`- ${x}`));process.exit(1);} console.log('AUDIT_V789_EXTRA=PASS');