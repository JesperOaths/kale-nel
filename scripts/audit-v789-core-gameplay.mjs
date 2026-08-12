#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const BASE=process.env.AUDIT_BASE_URL||'http://127.0.0.1:4173';
const NAMES=['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo'];
const engines=[['chromium',chromium],['firefox',firefox],['webkit',webkit]];
const failures=[]; const passes=[];

function rpcName(url){try{return decodeURIComponent(new URL(url).pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]||'');}catch{return '';}}
function playerRows(){return NAMES.map((name,i)=>({player_id:`p${i+1}`,id:`p${i+1}`,display_name:name,player_name:name,public_display_name:name,login_active:true,active:true,site_scope:'friends'}));}
function paardState(s){
  if(!s.paard.exists)return {room:null,players:[],viewer:{}};
  const ada={player_id:'p1',player_name:'Ada',selected_suit:s.paard.locked?'spades':null,selected_suit_label:s.paard.locked?'Schoppen':'',wager_bakken:s.paard.locked?1:0,wager_verified:s.paard.locked,is_ready:s.paard.ready};
  const bram={player_id:'p2',player_name:'Bram',selected_suit:'hearts',selected_suit_label:'Harten',wager_bakken:1,wager_verified:true,is_ready:true};
  return {room:{room_code:'PR789',stage:s.paard.stage,stage_label:s.paard.stage,host_name:'Ada',can_start:s.paard.ready},players:[ada,bram],viewer:{...ada,is_host:true,has_locked_choice:s.paard.locked},pending_verifications:[]};
}
function pikkenState(s){
  if(!s.pikken.exists)return {game:null,players:[],viewer:{}};
  return {game:{id:'pk-v789-core',game_id:'pk-v789-core',lobby_code:'PK789',status:s.pikken.phase,state_version:s.pikken.version,state:{phase:s.pikken.phase,current_turn_player_id:'p1',current_turn_seat:1,current_bid:s.pikken.phase==='bidding'?{count:1,face:2,player_id:'p2'}:null}},game_id:'pk-v789-core',lobby_code:'PK789',code:'PK789',players:[{player_id:'p1',player_name:'Ada',display_name:'Ada',seat:1,dice_count:6,is_ready:s.pikken.ready,alive:true,is_alive:true},{player_id:'p2',player_name:'Bram',display_name:'Bram',seat:2,dice_count:6,is_ready:true,alive:true,is_alive:true}],viewer:{player_id:'p1',player_name:'Ada',seat:1,dice_count:6,alive:true,is_host:true,is_ready:s.pikken.ready,my_hand:[1,2,3,4,5,6]},my_hand:[1,2,3,4,5,6],dice_totals:{current_total:12,start_total:12},votes:[]};
}
function mockRpc(name,p,s){
  if(/^(get_login_active_names_v687|get_login_names_scoped|get_login_names|get_player_selector_source_v1|get_game_player_names_fast_v687)$/.test(name))return playerRows();
  if(/^(get_public_state|get_gejast_homepage_state|get_jas_app_state|account_public_state_v687)$/.test(name))return {session_valid:true,is_logged_in:true,my_name:'Ada',display_name:'Ada',player_name:'Ada',viewer:{player_id:'p1',display_name:'Ada',player_name:'Ada'}};
  if(name==='get_toepen_app_state')return {recent_games:[]};
  if(name==='create_toepen_game')return {ok:true,game_id:'toep-v789-core'};
  if(name==='get_beerpong_leaderboard_public')return {leaderboard:[],recent_matches:[]};
  if(name==='get_beerpong_pussycup_ranking_public')return {ranking:[]};
  if(name==='save_beerpong_match')return {ok:true,match_id:'bp-v789-core'};
  if(/^get_paardenrace_open_rooms/.test(name)||/^get_paardenrace_stats/.test(name))return [];
  if(name==='create_paardenrace_room_fast_v687'){s.paard.exists=true;s.paard.locked=false;s.paard.ready=false;s.paard.stage='lobby';return paardState(s);}
  if(name==='get_paardenrace_room_state_fast_v687'||name==='get_paardenrace_room_state_safe')return paardState(s);
  if(name==='update_paardenrace_room_choice_safe'){s.paard.exists=true;s.paard.locked=true;return paardState(s);}
  if(name==='verify_paardenrace_wager_safe'){s.paard.locked=true;return paardState(s);}
  if(name==='set_paardenrace_ready_safe'){s.paard.ready=Boolean(p?.ready_input);return paardState(s);}
  if(name==='start_paardenrace_countdown_safe'){s.paard.stage='countdown';s.paard.ready=true;return paardState(s);}
  if(/^(leave_paardenrace_room|leave_paardenrace_room_safe|disband_paardenrace_room_fast_v687|disband_paardenrace_room_safe)/.test(name)){s.paard.exists=false;return {ok:true};}
  if(name==='paardenrace_cleanup_idle_lobbies_v495')return {ok:true};
  if(/^get_pikken_open_lobbies/.test(name)||/^get_pikken_live_matches/.test(name))return [];
  if(name==='pikken_create_lobby_fast_v687'){s.pikken.exists=true;s.pikken.phase='lobby';s.pikken.ready=false;s.pikken.version++;return pikkenState(s);}
  if(name==='pikken_get_state_scoped')return pikkenState(s);
  if(name==='pikken_set_ready_scoped'){s.pikken.ready=Boolean(p?.ready_input);s.pikken.version++;return pikkenState(s);}
  if(name==='pikken_update_lobby_config_v715')return pikkenState(s);
  if(name==='pikken_start_game_scoped'){s.pikken.phase='bidding';s.pikken.ready=true;s.pikken.version++;return pikkenState(s);}
  if(/^pikken_(place_bid|challenge|call|reject|resolve|cast_vote)/.test(name))return pikkenState(s);
  if(/^pikken_(destroy|leave)/.test(name)){s.pikken.exists=false;return {ok:true};}
  if(/^(get_homepage|get_drinks_homepage|get_homepage_ladders|get_beta|get_live|get_shared|get_recent|get_.*leaderboard|get_.*stats|get_.*matches|get_.*rooms|get_.*lobbies)/.test(name))return [];
  if(/^(save_|create_|update_|set_|start_|join_|leave_|delete_|submit_|cast_|record_|sync_|upsert_|request_)/.test(name))return {ok:true,client_match_id:`v789-${name}`,room_code:'V789',game_id:'v789-game'};
  return [];
}
async function makeContext(browser,viewport={width:390,height:844}){
  const state={paard:{exists:false,locked:false,ready:false,stage:'lobby'},pikken:{exists:false,ready:false,phase:'lobby',version:1}};
  const calls=[];
  const context=await browser.newContext({viewport,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  await context.addInitScript(()=>{try{localStorage.setItem('jas_session_token_v11','v789-core-safe-session');sessionStorage.setItem('jas_session_token_v11','v789-core-safe-session');sessionStorage.setItem('toepen_names_v1',JSON.stringify(['Ada','Bram','Caro','Daan','Evi','Fons','Gijs','Hugo']));}catch(_){}window.confirm=()=>true;window.alert=()=>{};});
  await context.route('**/*',async route=>{
    const req=route.request();let u;try{u=new URL(req.url());}catch{return route.continue();}
    if(u.hostname.includes('supabase.co')){
      if(u.pathname.includes('/rest/v1/rpc/')){const name=rpcName(req.url());let payload={};try{payload=req.postDataJSON()||{};}catch{}calls.push({name,method:req.method(),payload});return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mockRpc(name,payload,state))});}
      calls.push({name:`ESCAPE:${req.method()}:${u.pathname}`,method:req.method(),payload:{}});return route.abort('blockedbyclient');
    }
    if(u.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    return route.continue();
  });
  return {context,calls,state};
}
async function openPage(context,path){
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));
  const res=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});assert.ok(res&&res.status()<400,`${path} navigation HTTP ${res?.status()}`);
  const expected=new URL(`${BASE}${path}`).pathname;await page.waitForTimeout(450);assert.equal(new URL(page.url()).pathname,expected,`${path} redirected unexpectedly to ${page.url()}`);assert.ok(!/login\.html$/i.test(new URL(page.url()).pathname),`${path} landed on login`);
  return {page,errors};
}
async function selectByText(page,selector,text){await page.waitForFunction(({selector,text})=>[...document.querySelectorAll(`${selector} option`)].some(o=>o.textContent.trim()===text),{selector,text},{timeout:8000});await page.locator(selector).selectOption({label:text});}
function noErrors(errors,label){assert.deepEqual(errors,[],`${label} page errors: ${errors.join(' | ')}`);}
function noEscapes(calls,label){assert.ok(calls.every(c=>!String(c.name).startsWith('ESCAPE:')),`${label} emitted unexpected non-RPC Supabase traffic`);}
async function noOverflow(page,label){const x=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(x<=6,`${label} horizontal overflow ${x}px`);}
async function visibleEnabled(page,selector){const el=page.locator(selector);await el.waitFor({state:'visible',timeout:7000});assert.equal(await el.isDisabled(),false,`${selector} should be enabled`);}
async function caseRun(engine,browser,label,fn){const {context,calls,state}=await makeContext(browser);try{await fn(context,calls,state);noEscapes(calls,`${engine}:${label}`);passes.push(`${engine}:${label}`);console.log(`CORE_PASS ${engine} ${label}`);}catch(err){failures.push(`${engine}:${label}: ${err?.stack||err}`);console.error(`CORE_FAIL ${engine} ${label}\n${err?.stack||err}`);}finally{await context.close();}}

async function scorer(context){
  const {page,errors}=await openPage(context,'/scorer.html?auditplay=core');await page.locator('#setupOverlay.show').waitFor({timeout:8000});
  for(const [sel,name] of [['#playerW1','Ada'],['#playerZ1','Bram'],['#playerW2','Caro'],['#playerZ2','Daan']])await selectByText(page,sel,name);
  await page.getByRole('button',{name:'Opslaan en bieding kiezen'}).click();
  for(let round=1;round<=16;round++){await page.locator('#bidOverlay.show').waitFor({timeout:5000});await page.locator('[data-team-choice="W"]').click();await page.locator('[data-suit="♠"]').click();await page.getByRole('button',{name:'Bieding bewaren'}).click();await page.locator('#inputW').fill('90');await page.locator('#saveRoundBtn').click();}
  await visibleEnabled(page,'#saveMatchBtn');assert.ok(Number(await page.locator('#totalW').textContent())>0,'Klaverjas total did not advance');await page.locator('#saveMatchBtn').click();await page.waitForURL(/klaverjas_scorer_v596_repo_ready\.html.*handoff=1/,{timeout:8000});await page.waitForFunction(()=>document.querySelector('#a1')?.value==='Ada'&&Number(document.querySelector('#scoreA')?.value||0)>0,null,{timeout:8000});noErrors(errors,'scorer');await page.close();
}
async function toepen(context,calls){
  const {page,errors}=await openPage(context,'/toepen.html?auditplay=core');await page.locator('#setupDialog').waitFor({state:'visible',timeout:8000});for(const [i,name] of ['Ada','Bram','Caro','Daan'].entries())await selectByText(page,`#setupPlayers select[data-seat="${i}"]`,name);await page.locator('#target').selectOption('10');await page.locator('#dealer').selectOption('0');await page.locator('#setupForm').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>!document.querySelector('#roundForm')?.hidden);await page.locator('#stake').selectOption('10');await page.locator('#roundForm').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>document.querySelector('#activeStat')?.textContent==='1/4',null,{timeout:5000});assert.equal(await page.locator('#finishBtn').isDisabled(),false);await page.locator('#undoBtn').click();await page.waitForFunction(()=>document.querySelector('#activeStat')?.textContent==='4/4');await page.locator('#stake').selectOption('10');await page.locator('#roundForm').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>document.querySelector('#activeStat')?.textContent==='1/4');await page.locator('#finishBtn').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('opgeslagen'),null,{timeout:5000});assert.ok(calls.some(c=>c.name==='create_toepen_game'),'Toepen finish RPC missing');noErrors(errors,'toepen');await page.close();
}
async function boerenbridge(context){
  const {page,errors}=await openPage(context,'/boerenbridge.html?auditplay=core');await page.locator('#setupOverlay.show').waitFor({timeout:8000});await page.locator('#playerCountInput').selectOption('4');for(const [i,name] of ['Ada','Bram','Caro','Daan'].entries())await selectByText(page,`#playerFields select[data-player-index="${i}"]`,name);await page.locator('#dealerInput').selectOption('0');await page.locator('#setupSaveBtn').click();await page.locator('#bidOverlay.show').waitFor({timeout:5000});const bids=page.locator('[data-bid-player-index]');for(let i=0;i<await bids.count();i++)await bids.nth(i).selectOption('1');await page.locator('#bidSaveBtn').click();await page.locator('#wonOverlay.show').waitFor({timeout:5000});const won=page.locator('[data-won-player-index]');const max=await won.nth(0).locator('option').last().getAttribute('value');for(let i=0;i<await won.count();i++)await won.nth(i).selectOption(i===0?max:'0');await page.locator('#wonSaveBtn').click();await page.waitForFunction(()=>document.querySelectorAll('#roundBody tr.done-row:not(.totals-row)').length>=1,null,{timeout:5000});if(await page.locator('#bidOverlay.show').count())await page.locator('#bidCancelBtn').click();await page.locator('#undoBtn').click();await page.waitForFunction(()=>document.querySelectorAll('#roundBody tr.done-row:not(.totals-row)').length===0,null,{timeout:5000});noErrors(errors,'boerenbridge');await page.close();
}
async function beerpong(context,calls){
  const {page,errors}=await openPage(context,'/beerpong.html?auditplay=core');for(const [sel,name] of [['#teamA1','Ada'],['#teamA2','Bram'],['#teamB1','Caro'],['#teamB2','Daan']])await selectByText(page,sel,name);await page.locator('#cupsA').fill('10');await page.locator('#cupsB').fill('6');await page.locator('#pussycupA').check();await page.locator('#notesInput').fill('isolated core acceptance');await page.locator('#saveBtn').click();await page.waitForFunction(()=>document.querySelector('#formStatus')?.textContent.includes('opgeslagen'),null,{timeout:5000});assert.ok(calls.some(c=>c.name==='save_beerpong_match'),'Beerpong save RPC missing');await page.locator('#resetBtn').click();assert.equal(await page.locator('#cupsA').inputValue(),'0');assert.equal(await page.locator('#cupsB').inputValue(),'0');noErrors(errors,'beerpong');await page.close();
}
async function rad(context){const {page,errors}=await openPage(context,'/rad.html?auditplay=core');await page.evaluate(()=>{Math.random=()=>0.001;});await page.locator('#spinBtn').click();await page.waitForFunction(()=>!document.querySelector('#resultBox')?.textContent.includes('Nog niet gedraaid'),null,{timeout:16000});assert.ok(((await page.locator('#resultBox').textContent())||'').trim().length>3,'Rad returned no result');noErrors(errors,'rad');await page.close();}
async function paardenrace(context,calls){const {page,errors}=await openPage(context,'/paardenrace.html?auditplay=core');await page.locator('#createBtn').click();await page.waitForFunction(()=>document.querySelector('#roomCodeLabel')?.textContent==='PR789',null,{timeout:6000});assert.ok(calls.some(c=>c.name==='create_paardenrace_room_fast_v687'));await page.locator('#suitInput').selectOption('spades');await page.locator('#wagerInput').fill('1');await page.locator('#saveBtn').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#savedChoiceBox')).display!=='none',null,{timeout:5000});await visibleEnabled(page,'#readyBtn');await page.locator('#readyBtn').click();await page.waitForFunction(()=>document.querySelector('#roomReadyStat')?.textContent==='2/2',null,{timeout:5000});if(await page.locator('#startBtn').isEnabled()){await page.locator('#startBtn').click();await page.waitForTimeout(300);assert.ok(calls.some(c=>c.name==='start_paardenrace_countdown_safe'));}noErrors(errors,'paardenrace-lobby');await page.close();}
async function pikken(context,calls){const {page,errors}=await openPage(context,'/pikken.html?auditplay=core');await page.locator('#pkCreateLobbyBtn').click();await page.waitForTimeout(700);assert.ok(calls.some(c=>c.name==='pikken_create_lobby_fast_v687'));const code=(await page.locator('#pkLobbyCode').textContent())?.trim();assert.ok(code&&code!=='-');if(await page.locator('#pkReadyBtn').isVisible()&&await page.locator('#pkReadyBtn').isEnabled()){await page.locator('#pkReadyBtn').click();await page.waitForTimeout(250);}if(await page.locator('#pkStartBtn').isVisible()&&await page.locator('#pkStartBtn').isEnabled()){await page.locator('#pkStartBtn').click();await page.waitForTimeout(350);}noErrors(errors,'pikken-lobby');await page.close();}
async function klaverjasEngine(context){const {page,errors}=await openPage(context,'/klaverjas_online.html?auditplay=core');const proof=await page.evaluate(()=>{const rt=window.GEJAST_KLAVERJAS_ONLINE;if(!rt)return {missing:true};const deck=rt.createDeck();const hands=rt.deal(deck,0);const bids=rt.availableBids(null);const hand=[{suit:'hearts',rank:'A',id:'hearts-A'},{suit:'clubs',rank:'7',id:'clubs-7'}];const legal=rt.legalCards(hand,[{player:1,card:{suit:'hearts',rank:'7',id:'hearts-7'}}],0,'spades');return {deck:deck.length,hands:hands.map(h=>h.length),pass:bids.some(b=>b.action==='pass'),suit80:bids.some(b=>b.mode==='suit'&&b.points===80),legal:legal.map(c=>c.id)};});assert.equal(proof.missing,undefined);assert.equal(proof.deck,32);assert.deepEqual(proof.hands,[8,8,8,8]);assert.equal(proof.pass,true);assert.equal(proof.suit80,true);assert.deepEqual(proof.legal,['hearts-A']);noErrors(errors,'klaverjas-online');await page.close();}
const SURFACES=['/leaderboard.html','/boerenbridge_spectator.html','/boerenbridge_vault.html','/beerpong_vault.html','/toepen_vault.html','/paardenrace_stats.html','/paardenrace_ladder.html','/pikken_stats.html','/pikken_ladder.html','/beurs.html','/despimarkt.html','/ballroom.html','/drinks_speed.html','/drinks.html'];
async function secondary(context){for(const path of SURFACES){const {page,errors}=await openPage(context,`${path}?auditplay=core`);const st=await page.evaluate(()=>({title:document.title.trim(),text:(document.body?.innerText||'').trim(),width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(st.title,`${path} missing title`);assert.ok(st.text.length>8,`${path} empty`);assert.ok(st.width<=st.viewport+6,`${path} overflow ${st.width-st.viewport}px`);noErrors(errors,path);await page.close();}}

for(const [engineName,engine] of engines){const browser=await engine.launch({headless:true});for(const [label,fn] of [['klaverjas-scorer-16-round-handoff',scorer],['toepen-win-undo-save',toepen],['boerenbridge-bid-won-undo',boerenbridge],['beerpong-save-reset',beerpong],['rad-spin',rad],['paardenrace-lobby-ready-start',paardenrace],['pikken-lobby-ready-start',pikken],['klaverjas-online-rules',klaverjasEngine],['secondary-surfaces',secondary]])await caseRun(engineName,browser,label,fn);await browser.close();}
console.log(`AUDIT_CORE_PASSES=${passes.length}`);console.log(`AUDIT_CORE_FAILURES=${failures.length}`);if(failures.length){console.error('AUDIT_V789_CORE=FAIL');failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}console.log('AUDIT_V789_CORE=PASS');
