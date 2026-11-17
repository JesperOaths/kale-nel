#!/usr/bin/env node
// Visual regressions: on-board hand, player-owned cards, throw animation,
// bid badges, roem claims, NAT round breakdown and persisted final scores.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE=process.env.KLAVERJASSEN_TEST_BASE||'http://127.0.0.1:8080/klaverjassen/';
const CODE='V5KG35',id='00000000-0000-4000-8000-000000000001';
const players=[
 {seat:0,team:1,name:'Bruis',is_bot:false,player_type:'human'},
 {seat:1,team:2,name:'Leerling Schoppen',is_bot:true,player_type:'bot'},
 {seat:2,team:1,name:'Leerling Harten',is_bot:true,player_type:'bot'},
 {seat:3,team:2,name:'Leerling Ruiten',is_bot:true,player_type:'bot'}
];
const cards=[['hearts','A'],['hearts','8'],['spades','8'],['diamonds','8'],['clubs','10'],['clubs','K'],['clubs','J'],['clubs','8']]
  .map(([suit,rank])=>({id:suit+'-'+rank,suit,rank}));
const bid={action:'bid',mode:'suit',suit:'diamonds',points:90,player:2,team:1};
const history=[
 {seat:1,action:'pass',mode:null,points:0},
 {seat:2,action:'bid',mode:'suit',suit:'diamonds',points:90},
 {seat:3,action:'pass',mode:null,points:0},
 {seat:0,action:'pass',mode:null,points:0}
];
const clone=x=>JSON.parse(JSON.stringify(x));
function stateFor(phase){
 const s={
  phase,players,deal_nonce:'browser-test-deal-1',settings:{finish_mode:'fixed_rounds',bot_count:3},
  hands:[cards,[],[],[]],dealer:0,totals:[0,0],roem_by_team:[0,0],
  rounds:[],trick:[],taken:[],plays:[],pending_trick:null,last_trick:null,turn:0,
  current_bid:bid,accepted_bid:bid,bid_history:history,klop_events:[],
  action_deadline_at:new Date(Date.now()+86400000).toISOString(),action_needed_seat:0
 };
 if(phase==='bidding'){s.bidder_turn=0;s.accepted_bid=null;}
 if(phase==='roundOver'||phase==='finished'){
  const r={round:1,bid,bidder_team:1,roem_by_team:[20,0],dealer:0,
   totals:[0,182],bid_history:history,
   klop_events:[{team:1,seat:0,points:20,labels:['Stuk'],trick_no:2}],
   result:{nat:true,made:false,target:90,cardScores:[80,82],trickCounts:[3,5],
    scores:[0,182],raw:[100,82]}};
  s.rounds=[r];s.totals=[0,182];s.roem_by_team=[20,0];
  s.turn=null;
 }
 return s;
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const sizes=[{width:1478,height:880},{width:390,height:780},{width:320,height:640}];
async function setup(width,height,phase){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const remote={viewer:{seat:0,name:'Bruis',is_host:true},players,
  game:{id,lobby_code:CODE,status:phase==='finished'?'finished':'playing',revision:4,
   created_by_player_name:'Bruis',state:stateFor(phase),log:[]}};
 await page.addInitScript(code=>{
  localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
  localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token:'a'.repeat(64),name:'Bruis'}));
 },CODE);
 await page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
  const data=JSON.parse(route.request().postData()||'{}');
  if(data.action_input==='save'){
   remote.game.state=clone(data.payload_input.state);
   remote.game.revision++;
  }
  await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
   body:JSON.stringify(data.action_input==='list'?[]:remote)});
 });
 await page.goto(BASE+'room.html?room='+CODE,{waitUntil:'domcontentloaded'});
 await page.locator('.seat.s0 .seat-card').waitFor({state:'visible',timeout:12000});
 return {context,page,remote,errors};
}
try{
 for(const viewport of sizes){
  const {context,page,errors}=await setup(viewport.width,viewport.height,'playing');
  try{
   const measurements=await page.evaluate(()=>{
    const rect=el=>{const r=document.querySelector(el).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
    return {screen:innerHeight,table:rect('#table'),hand:rect('.hand-wrap'),
      root:document.querySelector('.hand-wrap').parentElement.id};
   });
   assert.equal(measurements.root,'table','hand must be a child of the felt table');
   assert(measurements.hand.top>=0&&measurements.hand.bottom<=measurements.screen+5,
    'hand invisible below viewport: '+JSON.stringify({viewport,measurements}));
   const badge=await page.locator('.seat.s2 .seat-bid').innerText();
   assert(badge.includes('90')&&badge.includes('♦'),'seat 2 shows floating 90 ♦ bid: '+badge);
   assert.equal(await page.locator('.seat.s1 .seat-bid').innerText(),'Pas');
   assert.equal(await page.locator('#hand button.card').count(),8);
   // Exactly four fixed slots, arranged as a cross around the trick centre.
   assert.equal(await page.locator('#trick .trick-slot').count(),4,'one slot per seat');
   const layout=await page.evaluate(()=>{
     const center=el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,top:r.top,bottom:r.bottom,left:r.left,right:r.right}};
     const stage=center(document.querySelector('#table'));
     const middle=center(document.querySelector('#trick .trick-middle'));
     const slots={};
     for(let seat=0;seat<4;seat++){
       const el=document.querySelector('#trick .trick-slot[data-slot-seat="'+seat+'"]');
       slots[seat]=center(el);
       const plate=getComputedStyle(document.querySelector('.seat.s'+seat+' .seat-card')).borderTopColor;
       const outline=getComputedStyle(el).borderTopColor;
       if(plate!==outline)throw Error('Unmatched seat/slot outline '+seat+': '+plate+' vs '+outline);
     }
     return {stage,middle,slots};
   });
   const sl=layout.slots,mid=layout.middle;
   assert(sl[2].y<mid.y-10 && sl[0].y>mid.y+10,'north and south slots are oriented to seat position: '+JSON.stringify(layout));
   assert(sl[3].x<mid.x-10 && sl[1].x>mid.x+10,'west and east slots are oriented to seat position: '+JSON.stringify(layout));
   assert(Math.abs(sl[2].x-mid.x)<3 && Math.abs(sl[0].x-mid.x)<3,'top/bottom slots are horizontally centred');
   assert(Math.abs(sl[1].y-mid.y)<3 && Math.abs(sl[3].y-mid.y)<3,'left/right slots are vertically centred');
   assert(Object.values(sl).every(p=>p.top>=measurements.table.top-3&&p.bottom<=measurements.table.bottom+3),
     'all four slot cards must be inside the felt');

   const score=await page.locator('#scorePanel').innerText();
   assert(score.toLowerCase().includes('team 1')&&score.toLowerCase().includes('team 2'),'score panel visible: '+JSON.stringify({score,errors}));
   await page.locator('#hand button.card:not([disabled])').first().click({timeout:6000});
   const flight=page.locator('.flying-card');
   await flight.first().waitFor({state:'attached',timeout:4500});
   assert(await flight.first().evaluate(el=>getComputedStyle(el).getPropertyValue('--dx').includes('px')),
    'flight animation must travel from a seat nameplate');
   const trajectory=await page.evaluate(()=>{
     const middle=el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}};
     const from=middle(document.querySelector('.seat.s0 .seat-card'));
     const target=middle(document.querySelector('#trick .trick-slot[data-slot-seat="0"]'));
     const ghost=document.querySelector('.flying-card');
     return {expectedDx:target.x-from.x,expectedDy:target.y-from.y,
       actualDx:parseFloat(ghost.style.getPropertyValue('--dx')),
       actualDy:parseFloat(ghost.style.getPropertyValue('--dy'))};
   });
   assert(Math.abs(trajectory.actualDx-trajectory.expectedDx)<3&&
     Math.abs(trajectory.actualDy-trajectory.expectedDy)<3,
     'card animation must land in the throwing player own slot: '+JSON.stringify(trajectory));
   assert.equal(await page.locator('#trick .trick-slot.occupied').count(),1,
     'one card must occupy exactly one seat slot');
   const play=page.locator('#trick .play-card[data-play-seat="0"] .card');
   await play.waitFor({state:'visible',timeout:4000});
   const colors=await page.evaluate(()=>({
    plate:getComputedStyle(document.querySelector('.seat.s0 .seat-card')).borderTopColor,
    card:getComputedStyle(document.querySelector('#trick .play-card[data-play-seat="0"] .card')).borderTopColor
   }));
   assert.equal(colors.plate,colors.card,'card border color must match player nameplate');
   assert.equal(await page.locator('#trick .trick-slot[data-slot-seat="0"] .play-card[data-play-seat="0"]').count(),1,
     'south card must land in south slot, not a common central pile');
   await page.waitForTimeout(900);
   assert.equal(await page.locator('#trick .trick-slot.is-arriving').count(),0,
     'newly thrown cards must become visible after their flight animation');
   assert.equal(errors.length,0,'browser runtime errors: '+errors.join('; '));
   console.log('KLAVERJASSEN_TABLE_HAND_FLIGHT_PASS',viewport.width+'x'+viewport.height,
     'handInViewport=true','bidBadge=true','flight=true','matchingBorder=true');
  }finally{await context.close();}
 }

 // Four cards in arbitrary play order must retain their seat-specific positions.
 {
  const {context,page,remote,errors}=await setup(390,780,'playing');
  try{
   remote.game.state.pending_trick={
     winner:1,
     cards:[{player:3,card:cards[3]},{player:0,card:cards[0]},{player:2,card:cards[2]},{player:1,card:cards[1]}],
     roem:{points:0,items:[]},klopped:false
   };
   await page.reload({waitUntil:'domcontentloaded'});
   await page.locator('#trick .trick-slot.occupied').first().waitFor({state:'visible'});
   assert.equal(await page.locator('#trick .trick-slot.occupied').count(),4,'all four slots hold one card');
   for(let seat=0;seat<4;seat++){
     const slot=page.locator('#trick .trick-slot[data-slot-seat="'+seat+'"]');
     assert.equal(await slot.locator('.play-card[data-play-seat="'+seat+'"]').count(),1,
       'wrong card in seat-specific slot '+seat);
     const colors=await page.evaluate(i=>({
       plate:getComputedStyle(document.querySelector('.seat.s'+i+' .seat-card')).borderTopColor,
       border:getComputedStyle(document.querySelector('.trick-slot[data-slot-seat="'+i+'"] .card')).borderTopColor
     }),seat);
     assert.equal(colors.border,colors.plate,'card and plate highlights mismatch at seat '+seat);
   }
   assert.equal(errors.length,0,'four-card slot JS errors: '+errors.join('; '));
   console.log('KLAVERJASSEN_FOUR_SLOT_TRICK_PASS','allCardsVisible=true',
      'northEastSouthWest=true','seatColorOutlines=true');
  }finally{await context.close();}
 }
 // A human clicks Klop: roem is persisted, announced and attributed to the proper team.
 {
  const {context,page,remote,errors}=await setup(1478,880,'playing');
  try{
   remote.game.state.pending_trick={
    winner:0,cards:[{player:0,card:cards[0]},{player:1,card:cards[1]},{player:2,card:cards[2]},{player:3,card:cards[3]}],
    roem:{points:20,items:[{label:'Stuk',points:20}]},klopped:false
   };
   await page.reload({waitUntil:'domcontentloaded'});
   await page.locator('#klopBtn').waitFor({state:'visible'});
   await page.locator('#klopBtn').click();
   await page.locator('#eventToasts .event-toast.roem').waitFor({state:'visible',timeout:4500});
   assert.equal(remote.game.state.roem_by_team[0],20);
   assert.equal(remote.game.state.klop_events[0].seat,0);
   assert((await page.locator('#eventBanner').innerText()).includes('Roem geklopt!'));
   await page.locator('[data-pane="log"]').click();
   assert((await page.locator('#log').innerText()).includes('KLOP!'));
   assert.equal(errors.length,0,'Klop runtime errors: '+errors.join('; '));
   console.log('KLAVERJASSEN_ROEM_KLOP_PASS','awarded=20','seat=0','toast=true');
  }finally{await context.close();}
 }
 // Existing persisted results must be readable, even after the match is closed.
 for(const phase of ['roundOver','finished']){
  const {context,page,errors}=await setup(390,780,phase);
  try{
   assert(await page.locator('#table').isVisible(),phase+': board hidden');
   assert((await page.locator('#eventBanner').innerText()).includes(phase==='finished'?'Eindstand':'NAT'));
   await page.locator('[data-pane="roundPanel"]').click();
   assert((await page.locator('#roundPanel').innerText()).includes('NAT'));
   assert((await page.locator('#roundPanel').innerText()).includes('162 kaartpunten plus alle roem'));
   assert.equal(await page.locator('#roundPanel .round-score-row').count(),2);
   assert((await page.locator('#roundPanel').innerText()).includes('182'));
   await page.locator('[data-pane="scorePanel"]').click();
   if(phase==='finished')assert((await page.locator('#scorePanel').innerText()).includes('Team 2 wint'));
   assert.equal(errors.length,0,'round view runtime errors: '+errors.join('; '));
   console.log('KLAVERJASSEN_ROUND_RESULTS_PASS',phase,'NAT=true','award=0–182','history=true');
  }finally{await context.close();}
 }
 console.log('RESULT=KLAVERJASSEN_TABLE_UX_V2_BROWSER_PASS');
}finally{await browser.close();}
