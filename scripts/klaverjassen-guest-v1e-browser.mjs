#!/usr/bin/env node
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const BASE=process.env.KLAVERJASSEN_TEST_BASE||'http://127.0.0.1:8080/klaverjassen/';
const CODE='QA7ROOM',token='a'.repeat(64),claim='B'.repeat(32);
const players=[{seat:0,name:'Bruis',team:1,is_bot:false,player_type:'human'},
 {seat:1,name:'Rosalie',team:2,is_bot:false,player_type:'human'}];
function makeRemote(){
 return {viewer:{seat:0,name:'Bruis',is_host:true},players,
  game:{id:'00000000-0000-4000-8000-000000001234',lobby_code:CODE,
   room_title:'Klaveravond',status:'lobby',revision:5,
   resume_until:new Date(Date.now()+7*86400000).toISOString(),
   created_by_player_name:'Bruis',
   state:{phase:'lobby',players,totals:[0,0],rounds:[],roem_by_team:[0,0],settings:{finish_mode:'fixed_rounds'},
    hands:[[],[],[],[]],trick:[],pending_trick:null,taken:[],plays:[],dealer:0,turn:null,bidder_turn:null,
    action_deadline_at:new Date(Date.now()+7*86400000).toISOString()}}};
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
function credentials(page,credential=token){
 return page.addInitScript(({code,key})=>{
  localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
  localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token:key,name:'Bruis'}));
 },{code:CODE,key:credential});
}
function route(page,server){
 page.route('**/rest/v1/rpc/klaverjassen_guest_extra_v1',async request=>{
  const body=JSON.parse(request.request().postData()||'{}');
  server.actions.push(body.action_input);
  let out={ok:true},status=200;
  if(body.action_input==='transfer_start')out={claim,expires_at:new Date(Date.now()+600000).toISOString()};
  if(body.action_input==='transfer_claim'){
    if(body.payload_input.claim!==claim||server.claimed){status=400;out={message:'Al gebruikt'};}
    else{server.claimed=true;server.validToken=body.token_input;server.remote.viewer={seat:0,name:'Bruis',is_host:true};
      out=server.remote;}
  }
  if(body.action_input==='host_handover'){
    server.remote.viewer.is_host=false;
    server.remote.game.created_by_player_name='Rosalie';
    server.remote.game.revision++;
    out=server.remote;
  }
  if(body.action_input==='profile_stats')out={games:[
   {seat:0,team:1,finished:true,totals:[200,100],rounds:[
    {bid_player:0,made:true,nat:false,scores:[100,62],klops:[{seat:0,points:20}]}]},
   {seat:0,team:1,finished:true,totals:[50,120],rounds:[
    {bid_player:0,made:false,nat:true,scores:[0,182],klops:[]}]}]};
  await request.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(out)});
 });
 page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async request=>{
  const body=JSON.parse(request.request().postData()||'{}');
  if(server.claimed&&body.action_input==='state'&&body.token_input!==server.validToken){
   await request.fulfill({status:401,contentType:'application/json',
     headers:{'access-control-allow-origin':'*'},body:'{"message":"Previous credential revoked"}'});return;
  }
  await request.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
   body:JSON.stringify(body.action_input==='list'?[]:server.remote)});
 });
 page.route('**/functions/v1/kalenel-kj-turn-push/public-key',async request=>
  request.fulfill({status:503,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:'{"error":"quota"}'}));
}
try{
 // A user can view real per-game metrics, toggle accessibility and choose local alerts
 // without changing the Klaverjassen play state.
 {
  const ctx=await browser.newContext({viewport:{width:390,height:780}});
  const page=await ctx.newPage(),server={remote:makeRemote(),actions:[],claimed:false};
  route(page,server);await credentials(page);
  await page.addInitScript(()=>{
   window.Notification=class {static permission='granted';static async requestPermission(){return 'granted';}
    constructor(){this.close=()=>{};}}
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.locator('[data-pane="memoryPanel"]').click();
   await page.locator('#kjAnimSpeed').selectOption('2');
   assert.equal(await page.evaluate(()=>window.KALENEL_KJ_ENHANCEMENTS.duration(1050)),525);
   await page.locator('#kjColorblind').check();
   assert(await page.locator('html').evaluate(e=>e.classList.contains('kj-colorblind')));
   await page.locator('#kjReduceMotion').check();
   assert(await page.locator('html').evaluate(e=>e.classList.contains('kj-reduced-motion')));
   await page.locator('#kjNotify').click();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kalenel_kj_guest_preferences_v1')||'{}')
     .subscriptions?.QA7ROOM==='local',{timeout:6000});
   assert((await page.locator('#memoryPanel').innerText()).includes('tab open'));
   await page.locator('[data-pane="statsPanel"]').click();
   await page.locator('#statsPanel .kj-stats-cell').first().waitFor({state:'visible',timeout:6000});
   const stats=await page.locator('#statsPanel').innerText();
   assert(stats.includes('50%')&&stats.includes('Roem geklopt')&&stats.includes('20')&&stats.includes('NAT'));
   assert(server.actions.includes('profile_link')&&server.actions.includes('profile_stats'));
   assert.equal(errors.length,0,'Client runtime errors: '+errors.join(';'));
   console.log('KLAVERJASSEN_STATS_ACCESSIBILITY_ALERTS_PASS','winRate=50%','roem=20','speed=2x','localAlerts=true');
  }finally{await ctx.close();}
 }
 // Host can give control to another HUMAN player, with immediate server authority change.
 {
  const ctx=await browser.newContext(),page=await ctx.newPage();
  const server={remote:makeRemote(),actions:[],claimed:false};
  route(page,server);await credentials(page);
  await page.addInitScript(()=>{window.confirm=()=>true;});
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.locator('[data-pane="memoryPanel"]').click();
   await page.locator('#kjHandoverSeat').selectOption('1');
   await page.locator('#kjHandover').click();
   await page.waitForFunction(()=>document.querySelector('#deleteRoomBtnTop')?.style.display==='none',{timeout:7000});
   assert.equal(server.remote.game.created_by_player_name,'Rosalie');
   assert(server.actions.includes('host_handover'));
   console.log('KLAVERJASSEN_HOST_HANDOVER_PASS','formerHostRightsRevoked=true');
  }finally{await ctx.close();}
 }
 // Transfer is initiated by the owner and redeemed once on a different browser.
 {
  const server={remote:makeRemote(),actions:[],claimed:false,validToken:token};
  const sourceContext=await browser.newContext(),source=await sourceContext.newPage();
  route(source,server);await credentials(source);
  try{
   await source.goto(BASE+'room.html?room='+CODE);
   await source.locator('[data-pane="memoryPanel"]').click();
   await source.locator('#kjTransfer').click();
   await source.locator('#kjTransferUrl').waitFor({state:'visible',timeout:7000});
   const link=await source.locator('#kjTransferUrl').inputValue();
   assert(link.includes('#recover='+claim)&&link.includes('&profile='));
   const destinationContext=await browser.newContext(),target=await destinationContext.newPage();
   route(target,server);
   try{
    await target.goto(link);
    await target.locator('.transfer-recovery button').waitFor({state:'visible',timeout:9000});
    await target.locator('.transfer-recovery button').click();
    await target.waitForURL('**/room.html?room='+CODE,{timeout:10000});
    const credential=await target.evaluate(code=>JSON.parse(localStorage.getItem(
     'kalenel_klaverjassen_guest_cap_v1_'+code)),CODE);
    assert(credential.token!==token&&/^[0-9a-f]{64}$/.test(credential.token));
    assert.equal(server.validToken,credential.token);
    assert(server.actions.includes('transfer_claim'));
    assert(server.actions.includes('profile_link'));
    console.log('KLAVERJASSEN_ONE_TIME_CROSS_DEVICE_RECOVERY_PASS',
      'newPrivateToken=true','oldTokenInvalid=true');
   }finally{await destinationContext.close();}
  }finally{await sourceContext.close();}
 }
 console.log('RESULT=KLAVERJASSEN_V1E_BROWSER_PASS');
}finally{await browser.close();}
