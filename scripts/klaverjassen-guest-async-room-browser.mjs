#!/usr/bin/env node
// Standalone Klaverjassen asynchronous lobby/trick UX regression; all API responses mocked.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const BASE=process.env.KLAVERJASSEN_TEST_BASE||'http://127.0.0.1:8080/klaverjassen/';
const CODE='BRUIS2026',token='a'.repeat(64);
const players=[0,1,2,3].map(i=>({seat:i,name:['Bruis','Speler 2','Speler 3','Speler 4'][i],
 team:i%2?2:1,is_bot:false,player_type:'human'}));
const deck=[['hearts','A'],['hearts','8'],['hearts','9'],['hearts','K']].map(([suit,rank])=>({suit,rank,id:suit+'-'+rank}));
const bid={action:'bid',mode:'suit',suit:'diamonds',points:90,team:1,player:0};
const clone=o=>JSON.parse(JSON.stringify(o));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
function makeRoom(roem){
 const cards=[{player:0,card:deck[0]},{player:1,card:deck[1]},{player:2,card:deck[2]},{player:3,card:deck[3]}];
 return {
  viewer:{seat:0,name:'Bruis',is_host:true},players,
  game:{id:'00000000-0000-4000-8000-000000000124',lobby_code:CODE,
    room_title:'Klaveravond bij Bruis',status:'playing',revision:4,
    resume_until:new Date(Date.now()+7*86400000).toISOString(),
    trick_completed_at:new Date(Date.now()-(roem?0:3000)).toISOString(),
    created_by_player_name:'Bruis',
    state:{phase:'playing',players,settings:{finish_mode:'fixed_rounds'},
      hands:[[deck[0]],[],[],[]],totals:[0,0],rounds:[],taken:[],roem_by_team:[0,0],
      trick:[],plays:cards.map((x,i)=>({...x,trick_no:1,player_name:players[i].name})),
      pending_trick:{winner:0,cards,roem:{points:roem,items:roem?[{label:'Stuk',points:roem}]:[]},klopped:false},
      current_bid:bid,accepted_bid:bid,turn:null,action_needed_seat:0,
      dealer:0,klop_events:[],bid_history:[],action_deadline_at:new Date(Date.now()+7*86400000).toISOString()}
  }
 };
}
function routeRoom(page,room,saved=[]){
 return page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
  const request=JSON.parse(route.request().postData()||'{}');
  const action=request.action_input;
  if(action==='save'){
   saved.push({reason:request.payload_input?.state?.last_progress_reason,at:Date.now()});
   room.game.state=clone(request.payload_input.state);
   room.game.revision++;
   room.game.trick_completed_at=room.game.state.pending_trick?room.game.trick_completed_at:null;
  }
  await route.fulfill({status:200,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},
   body:JSON.stringify(action==='list'?[]:room)});
 });
}
function injectCredential(page){
 return page.addInitScript(({code,token})=>{
  localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
  localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token,name:'Bruis'}));
 },{code:CODE,token});
}
try{
 // Custom code and room title are submitted, with a completely unguessable private token.
 {
  const context=await browser.newContext(),page=await context.newPage(),calls=[];
  const r=makeRoom(0);r.game.state={...r.game.state,phase:'lobby',pending_trick:null,players:[players[0]],hands:[[],[],[],[]]};
  await page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
   const body=JSON.parse(route.request().postData()||'{}');
   calls.push(body);
   if(body.action_input==='create'){
     r.game.lobby_code=body.payload_input?.settings?.lobby_code?.toUpperCase()||CODE;
     r.game.room_title=body.payload_input?.settings?.room_title||'';
   }
   await route.fulfill({status:200,contentType:'application/json',
     headers:{'access-control-allow-origin':'*'},
     body:JSON.stringify(body.action_input==='list'?[]:r)});
  });
  try{
   await page.goto(BASE+'index.html?left=1');
   await page.locator('#guestName').fill('Bruis');
   await page.locator('#customRoomCode').fill('bruis2026');
   await page.locator('#customRoomTitle').fill('Klaveravond bij Bruis');
   await page.locator('#createBtn').click();
   await page.waitForURL('**/room.html?*',{timeout:10000});
   const call=calls.find(x=>x.action_input==='create');
   assert(call,'Create action missing');
   assert.equal(call.payload_input.settings.lobby_code,'BRUIS2026');
   assert.equal(call.payload_input.settings.room_title,'Klaveravond bij Bruis');
   assert(/^[0-9a-f]{64}$/.test(call.token_input));
   console.log('KLAVERJASSEN_CUSTOM_ROOM_CODE_PASS', 'code=BRUIS2026','title=Klaveravond bij Bruis');
  }finally{await context.close();}
 }
 // All of a user's own in-progress rooms must remain listed even after closing a tab.
 {
  const ctx=await browser.newContext(),page=await ctx.newPage();
  const r=makeRoom(0);
  await injectCredential(page);
  await routeRoom(page,r);
  try{
   await page.goto(BASE+'index.html?left=1');
   await page.locator('#rooms [data-room="BRUIS2026"]').waitFor({state:'visible',timeout:10000});
   assert((await page.locator('#rooms').innerText()).includes('Klaveravond bij Bruis'));
   assert((await page.locator('#rooms').innerText()).includes('Hervatten tot'));
   assert((await page.locator('#rooms').innerText()).includes('Verder spelen'));
   console.log('KLAVERJASSEN_SEVEN_DAY_RESUME_LIST_PASS');
  }finally{await ctx.close();}
 }
 // No roem: no collection button; the server-timed trick collects itself.
 {
  const ctx=await browser.newContext({viewport:{width:390,height:780}}),page=await ctx.newPage();
  const saved=[],r=makeRoom(0);
  await injectCredential(page);await routeRoom(page,r,saved);
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.locator('#contractRibbon').waitFor({state:'visible',timeout:10000});
   assert((await page.locator('#contractRibbon').innerText()).includes('90 Ruiten'));
   assert((await page.locator('#contractRibbon').innerText()).includes('TROEF'));
   assert((await page.locator('#roomTitleLabel').innerText()).includes('Klaveravond'));
   assert.equal(await page.locator('#collectBtn').count(),0);
   await page.waitForFunction(()=>!document.querySelector('#actionPanel')?.innerText?.includes('Automatisch ophalen')&&
     document.querySelector('#trick .trick-middle strong')?.textContent==='0/4',{timeout:10000}).catch(()=>{});
   await page.waitForFunction(()=>document.querySelector('#trick .trick-middle strong')?.textContent==='0/4'&&
     document.querySelector('#centerTitle')?.textContent?.includes('Beurt'),{timeout:9000});
   assert(saved.some(x=>x.reason==='auto_collect'),'Auto-collect not saved');
   assert.equal(r.game.state.taken.length,1);
   console.log('KLAVERJASSEN_AUTO_COLLECT_NO_ROEM_PASS','noManualButton=true','tricksTaken=1');
  }finally{await ctx.close();}
 }
 // Roem: the player gets a real Klop window; pressing Klop awards roem and then collects.
 {
  const ctx=await browser.newContext({viewport:{width:1478,height:880}}),page=await ctx.newPage();
  const saved=[],r=makeRoom(20);
  await injectCredential(page);await routeRoom(page,r,saved);
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.locator('#klopBtn').waitFor({state:'visible',timeout:10000});
   assert.equal(await page.locator('#collectBtn').count(),0);
   await page.waitForTimeout(900);
   assert.equal(saved.filter(x=>x.reason==='auto_collect').length,0,'Auto collection before Klop window');
   await page.locator('#klopBtn').click();
   await page.waitForFunction(()=>document.querySelector('#roemStat')?.textContent?.trim().startsWith('20 - 0'),{timeout:6000});
   assert.equal(r.game.state.roem_by_team[0],20);
   await page.waitForFunction(()=>document.querySelector('#centerTitle')?.textContent?.includes('Beurt'),{timeout:9500});
   assert.deepEqual(saved.map(x=>x.reason),['klop_roem','auto_collect']);
   assert.equal(r.game.state.taken.length,1);
   console.log('KLAVERJASSEN_KLOP_THEN_AUTO_COLLECT_PASS','roem=20','correctMoveOrder=true');
  }finally{await ctx.close();}
 }
 console.log('RESULT=KLAVERJASSEN_ASYNC_ROOM_TRICK_BROWSER_PASS');
}finally{await browser.close();}
