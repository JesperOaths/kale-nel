#!/usr/bin/env node
// Live-page mock acceptance: clockwise seat geometry, Amsterdam help and dealer rotation.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const BASE=process.env.KLAVERJASSEN_TEST_BASE||'http://127.0.0.1:8080/klaverjassen/';
const CODE='KJTURN26',TOKEN='a'.repeat(64);
const players=[0,1,2,3].map(i=>({seat:i,name:'Speler '+(i+1),team:i%2?2:1,is_bot:false,player_type:'human'}));
const c=(suit,rank)=>({id:suit+'-'+rank,suit,rank});
const cardSet=[c('hearts','8'),c('diamonds','7'),c('spades','A')];
const bid={action:'bid',mode:'suit',suit:'diamonds',points:90,team:1,player:0};
const clone=x=>JSON.parse(JSON.stringify(x));
function getState(view=0){
 const leader=(view+3)%4;
 const hands=[[],[],[],[]];hands[view]=clone(cardSet);
 return {phase:'playing',players,deal_nonce:'test-2026',settings:{finish_mode:'fixed_rounds'},
  dealer:3,turn:view,bidder_turn:null,action_needed_seat:view,
  hands,trick:[{player:leader,card:c('hearts','A')}],pending_trick:null,
  plays:[{trick_no:1,player:leader,card:c('hearts','A')}],taken:[],
  rounds:[],totals:[0,0],roem_by_team:[0,0],current_bid:bid,accepted_bid:bid,
  bid_history:[],klop_events:[],action_deadline_at:new Date(Date.now()+86400000).toISOString()};
}
function mock(page,remote,saves=[]){
 page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
  const body=JSON.parse(route.request().postData()||'{}');
  if(body.action_input==='save'){
   saves.push({reason:body.payload_input.state.last_progress_reason,state:clone(body.payload_input.state)});
   remote.game.state=clone(body.payload_input.state);
   remote.game.revision++;
   remote.game.trick_completed_at=remote.game.state.pending_trick?remote.game.trick_completed_at:null;
  }
  await route.fulfill({status:200,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},
   body:JSON.stringify(body.action_input==='list'?[]:remote)});
 });
 page.route('**/rest/v1/rpc/klaverjassen_guest_extra_v1',async route=>
  route.fulfill({status:200,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'}));
}
async function prep(page,viewer){
 await page.addInitScript(({code,token,name})=>{
  localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
  localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token,name}));
 },{code:CODE,token:viewer===0?TOKEN:String(viewer+1).repeat(64),name:players[viewer].name});
}
function remoteFor(view,st){
 return {viewer:{seat:view,name:players[view].name,is_host:view===0},players,
 game:{id:'00000000-0000-4000-8000-000000000020',lobby_code:CODE,room_title:'Clockwise acceptance',
  status:'playing',revision:5,trick_completed_at:null,
  created_by_player_name:players[0].name,
  resume_until:new Date(Date.now()+7*86400000).toISOString(),
  state:st,log:[]}};
}
const browser=await chromium.launch({headless:true,
 executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
 args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const sizes=[{w:1478,h:880},{w:390,h:780}];
 for(const size of sizes)for(let viewer=0;viewer<4;viewer++){
  const context=await browser.newContext({viewport:{width:size.w,height:size.h}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const remote=remoteFor(viewer,getState(viewer));
  mock(page,remote);await prep(page,viewer);
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.locator('#hand button.card').first().waitFor({state:'visible',timeout:9000});
   const visual=await page.evaluate(view=>{
    const center=el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}};
    const pos=['bottom','left','top','right'];
    const me=center(document.querySelector('.seat.s'+view+' .seat-card'));
    const next=(view+1)%4, partner=(view+2)%4,prev=(view+3)%4;
    const names=[view,next,partner,prev];
    const seats=names.map(i=>({seat:i,pos:document.querySelector('.seat.s'+i).className,
      plate:center(document.querySelector('.seat.s'+i+' .seat-card')),
      slot:center(document.querySelector('#trick .trick-slot[data-slot-seat="'+i+'"]'))}));
    return {seats,stage:document.querySelector('#table').getBoundingClientRect().toJSON(),me};
   },viewer);
   for(let relative=0;relative<4;relative++){
    const expected=['bottom','left','top','right'][relative],got=visual.seats[relative];
    assert(got.pos.includes('position-'+expected),
      'Seat '+got.seat+' should be '+expected+' for viewer '+viewer+' '+JSON.stringify(visual));
   }
   const slots=visual.seats.map(x=>x.slot);
   assert(slots[1].x<slots[0].x && slots[3].x>slots[0].x,
     'Clockwise seats must go bottom → left → top → right');
   assert(slots[2].y<slots[0].y,'Teammate must sit opposite');
   assert.equal(await page.locator('#hand button.card').count(),3);
   assert.equal(await page.locator('#hand button.card:not([disabled])').count(),1);
   assert.equal(await page.locator('#hand button[data-card="hearts-8"]:not([disabled])').count(),1);
   assert.equal(await page.locator('#hand button[data-card="diamonds-7"][disabled]').count(),1);
   assert.equal(await page.locator('#hand button[data-card="spades-A"][disabled]').count(),1);
   const cue=await page.locator('#legalCue').innerText();
   assert(cue.includes('Kleur bekennen')&&cue.includes('Harten'),cue);
   assert.equal(await page.locator('.seat.s3 .dealer-chip').count(),1);
   assert.equal(await page.locator('.seat.s0 .forehand-chip').count(),1);
   assert.equal(errors.length,0,'Page exceptions: '+errors.join('; '));
   console.log('KJ_CLOCKWISE_HAND_UI_PASS',size.w+'x'+size.h,'viewer='+viewer,
     'clockwise=true','dealerLeft=true','legalHighlights=true');
  }finally{await context.close();}
 }
 // Rules cover all Amsterdam exceptions, not simply one example of following suit.
 {
  const ctx=await browser.newContext(),page=await ctx.newPage();
  mock(page,remoteFor(0,getState(0)));await prep(page,0);
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   const cases=await page.evaluate(()=>{
    const K=window.GEJAST_KLAVERJAS_ONLINE;
    const c=(suit,rank)=>({id:suit+'-'+rank,suit,rank});
    const play=(player,suit,rank)=>({player,card:c(suit,rank)});
    const ids=(hand,trick,seat=2,trump='diamonds')=>K.guestLegalCards(hand,trick,seat,trump).map(x=>x.id).sort();
    return {
     follow:ids([c('hearts','8'),c('diamonds','J'),c('spades','A')],[play(1,'hearts','A')]),
     forcedTrump:ids([c('diamonds','7'),c('spades','A')],[play(1,'hearts','A')]),
     partner:ids([c('diamonds','7'),c('spades','A')],[play(0,'hearts','A')]),
     overtrump:ids([c('diamonds','7'),c('diamonds','J'),c('spades','A')],[play(1,'diamonds','9')]),
     noUndertrump:ids([c('diamonds','7'),c('spades','A')],[play(1,'hearts','A'),play(3,'diamonds','J')]),
     forcedUndertrump:ids([c('diamonds','7')],[play(1,'hearts','A'),play(3,'diamonds','J')]),
     sans:ids([c('hearts','8'),c('spades','A')],[play(1,'hearts','A')],2,'sans'),
     order:[0,1,2,3].map(x=>K.guestClockwiseNext(x))
    };
   });
   assert.deepEqual(cases,{
    follow:['hearts-8'],forcedTrump:['diamonds-7'],
    partner:['diamonds-7','spades-A'],overtrump:['diamonds-J'],
    noUndertrump:['spades-A'],forcedUndertrump:['diamonds-7'],sans:['hearts-8'],
    order:[1,2,3,0]
   });
   console.log('KJ_AMSTERDAM_RULES_PASS','followSuit=true','mandatoryTrump=true','mandatoryOvertrump=true','noUndertrump=true');
  }finally{await ctx.close();}
 }
 // Eighth trick must transfer dealer to the player on their left; next round
 // retains that dealer and starts bidding with *their* left-hand neighbor.
 {
  const ctx=await browser.newContext(),page=await ctx.newPage();
  const st=getState(0),dummy={winner:0,cards:[
    {player:0,card:c('hearts','8')},{player:1,card:c('hearts','7')},
    {player:2,card:c('hearts','K')},{player:3,card:c('hearts','9')}],
    roem:{points:0,items:[]},klopped:false};
  st.dealer=0;st.turn=null;st.action_needed_seat=0;st.trick=[];st.plays=[];
  st.hands=[[],[],[],[]];st.taken=Array.from({length:7},()=>clone(dummy));
  st.pending_trick=clone(dummy);
  const remote=remoteFor(0,st),saves=[];
  remote.game.trick_completed_at=new Date(Date.now()-4000).toISOString();
  mock(page,remote,saves);await prep(page,0);
  try{
   await page.goto(BASE+'room.html?room='+CODE);
   await page.waitForFunction(()=>document.querySelector('#nextBtn')!==null,{timeout:11000});
   assert.equal(remote.game.state.phase,'roundOver');
   assert.equal(remote.game.state.dealer,1,'Dealer should move from seat0 to left seat1');
   assert.equal(remote.game.state.rounds[0].dealer,0,'Completed round still records previous dealer');
   assert(saves.some(x=>x.reason==='auto_collect'));
   await page.locator('#nextBtn').click();
   await page.waitForFunction(()=>document.querySelector('#phaseStat')?.textContent==='bidding',{timeout:10000});
   assert.equal(remote.game.state.dealer,1);
   assert.equal(remote.game.state.bidder_turn,2,'Next forehand is left of new dealer seat1');
   assert.equal(await page.locator('.seat.s1 .dealer-chip').count(),1);
   assert.equal(await page.locator('.seat.s2 .forehand-chip').count(),1);
   assert.deepEqual(remote.game.state.hands.map(h=>h.length),[8,8,8,8]);
   assert(saves.some(x=>x.reason==='next_round'));
   console.log('KJ_DEALER_ROUND_ROTATION_PASS','oldDealer=0','nextDealer=1','nextForehand=2');
  }finally{await ctx.close();}
 }
 console.log('RESULT=KLAVERJASSEN_CLOCKWISE_AMSTERDAM_ACCEPTANCE_PASS');
}finally{await browser.close();}
