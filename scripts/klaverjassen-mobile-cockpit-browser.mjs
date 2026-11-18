#!/usr/bin/env node
// Responsive Klaverjassen cockpit regressions; mocked guest RPC, no live games.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const BASE=process.env.KLAVERJASSEN_TEST_BASE||'http://127.0.0.1:8080/klaverjassen/';
const CODE='KJV2DESIGN',TOKEN='a'.repeat(64);
const players=[0,1,2,3].map(i=>({
 seat:i,team:i%2?2:1,name:['Bruis','Leerling Links','Teamgenoot','Leerling Rechts'][i],
 is_bot:i!==0,player_type:i===0?'human':'bot',bot_difficulty:'easy'
}));
const card=(suit,rank)=>({suit,rank,id:suit+'-'+rank});
const cards=[card('hearts','A'),card('hearts','8'),card('spades','8'),card('diamonds','8'),
 card('clubs','10'),card('clubs','K'),card('clubs','J'),card('clubs','8')];
const bid={action:'bid',mode:'suit',suit:'diamonds',points:90,player:2,team:1};
const copy=o=>JSON.parse(JSON.stringify(o));
function fixture(phase='playing'){
 const st={
  phase,players,settings:{finish_mode:'fixed_rounds',bot_count:3},
  hands:[copy(cards),[],[],[]],dealer:3,turn:0,bidder_turn:0,
  current_bid:bid,accepted_bid:phase==='bidding'?null:bid,
  bid_history:[{seat:1,action:'pass',points:0},{seat:2,action:'bid',...bid}],
  taken:[],trick:[],plays:[],pending_trick:null,rounds:[],totals:[80,40],roem_by_team:[20,0],
  action_needed_seat:0,action_deadline_at:new Date(Date.now()+7*86400000).toISOString()
 };
 return {viewer:{seat:0,name:'Bruis',is_host:true},players,
  game:{id:'00000000-0000-4000-8000-000000001123',lobby_code:CODE,room_title:'Woensdagavond',
   status:'playing',created_by_player_name:'Bruis',revision:4,
   resume_until:new Date(Date.now()+7*86400000).toISOString(),state:st,log:[]}};
}
const browser=await chromium.launch({headless:true,
 executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
 args:['--no-sandbox','--disable-dev-shm-usage']});
async function setup(width,height,phase){
 const context=await browser.newContext({viewport:{width,height}});
 const page=await context.newPage(),errors=[],saves=[],remote=fixture(phase);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({code,token})=>{
   localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
   localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token,name:'Bruis'}));
 },{code:CODE,token:TOKEN});
 await page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
  const data=JSON.parse(route.request().postData()||'{}');
  if(data.action_input==='save'){
   remote.game.state=copy(data.payload_input.state);
   saves.push(remote.game.state.last_progress_reason||'save');
   remote.game.revision++;
  }
  await route.fulfill({status:200,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data.action_input==='list'?[]:remote)});
 });
 await page.route('**/rest/v1/rpc/klaverjassen_guest_extra_v1',async route=>{
  await route.fulfill({status:200,contentType:'application/json',
   headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
 });
 await page.goto(BASE+'room.html?room='+CODE,{waitUntil:'domcontentloaded'});
 await page.locator('#hand .card').first().waitFor({state:'visible',timeout:12000});
 return {context,page,errors,saves,remote};
}
function active(el){return el&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'}
try{
 const viewports=[
  {width:320,height:640},{width:360,height:740},{width:375,height:667},
  {width:390,height:780},{width:430,height:932},{width:760,height:850},
  {width:768,height:820},{width:1024,height:768},{width:1478,height:880}
 ];
 for(const size of viewports){
  const {context,page,errors}=await setup(size.width,size.height,'playing');
  try{
   const metrics=await page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,left:r.left,right:r.right,
      top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const table=document.querySelector('#table');
    const hand=document.querySelector('.hand-wrap');
    const cardBtns=[...document.querySelectorAll('#hand .card')];
    const dock=rect(hand),felt=rect(table),side=document.querySelector('#informationSide');
    const strip=document.querySelector('#mobileTurnStrip');
    const viewport={w:innerWidth,h:innerHeight};
    return {
      viewport,docWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,
      table:felt,hand:dock,
      handParent:hand.parentElement.id,
      deckWidth:document.querySelector('#hand').clientWidth,
      deckScrollWidth:document.querySelector('#hand').scrollWidth,
      cardBoxes:cardBtns.map(rect),
      cardCount:cardBtns.length,
      suitMarks:cardBtns.map(el=>{
        const key=el.querySelector('.suit-key'),glyph=el.querySelector('.suit-glyph');
        const label=key?.getBoundingClientRect(),bounds=el.getBoundingClientRect();
        return {suit:[...el.classList].find(c=>c.startsWith('suit-'))?.slice(5)||'',
          key:key?.textContent?.trim()||'',glyph:glyph?.textContent?.trim()||'',
          ink:getComputedStyle(el).color,
          labelInCard:!!label&&label.left>=bounds.left-1&&label.right<=bounds.right+1&&
            label.top>=bounds.top-1&&label.bottom<=bounds.bottom+1};
      }),
      stripVisible:strip.getBoundingClientRect().height>0&&getComputedStyle(strip).display!=='none',
      sideVisible:getComputedStyle(side).display!=='none',
      handPosition:getComputedStyle(hand).position,
      cue:document.querySelector('#mobileTurnMessage').textContent
    };
   });
   assert.equal(metrics.cardCount,8);
   const expectedSuits={hearts:['H','♥'],diamonds:['R','♦'],spades:['S','♠'],clubs:['K','♣']};
   for(const [suit,[key,glyph]] of Object.entries(expectedSuits)){
     const matching=metrics.suitMarks.filter(m=>m.suit===suit);
     assert(matching.length>0,'Missing '+suit+' suit on test hand');
     assert(matching.every(m=>m.key===key&&m.glyph===glyph&&m.labelInCard),
       suit+' must show its own visible suit shape and initial: '+JSON.stringify(matching));
   }
   assert.equal(new Set(Object.keys(expectedSuits).map(s=>
     metrics.suitMarks.find(m=>m.suit===s)?.ink)).size,4,
     'Hearts, diamonds, spades and clubs must each have distinct, legible colors');
   assert.equal(metrics.handParent,'table','hand must stay inside felt');
   assert(metrics.docWidth<=size.width+3&&metrics.bodyWidth<=size.width+3,
     'horizontal page overflow: '+JSON.stringify(metrics));
   assert(metrics.hand.top>=0&&metrics.hand.bottom<=size.height+6,
     'hand is below visible screen: '+JSON.stringify(metrics));
   assert(metrics.hand.left>=metrics.table.left-2&&metrics.hand.right<=metrics.table.right+2,
     'hand must stay inside felt: '+JSON.stringify(metrics));
   if(size.width<=760){
    assert(metrics.stripVisible,'mobile turn strip not visible at '+size.width);
    assert(!metrics.sideVisible,'mobile sidebar should be collapsed');
    assert(metrics.handPosition==='absolute','mobile hand must be within felt, not fixed to viewport');
    assert(metrics.cue.includes('Jij bent aan zet')&&metrics.cue.includes('Ruiten'),
      'mobile turn + trump message missing: '+metrics.cue);
    assert(metrics.deckScrollWidth<=metrics.deckWidth+3,
      'all 8 cards should be visible without horizontal scrolling: '+JSON.stringify(metrics));
    assert(metrics.cardBoxes.every(r=>r.left>=metrics.hand.left-3&&r.right<=metrics.hand.right+3),
      'hand cards overflow dock '+JSON.stringify(metrics));
    await page.locator('#mobileInfoButton').click();
    await page.locator('#informationSide.mobile-open').waitFor({state:'visible',timeout:2000});
    assert.equal(await page.locator('#mobileInfoButton').getAttribute('aria-expanded'),'true');
    assert(await page.locator('#informationSide #scorePanel').isVisible());
    await page.locator('.side-tabs [data-pane="roundPanel"]').click();
    assert(await page.locator('#roundPanel').isVisible(),'rounds inaccessible on mobile');
    await page.locator('#mobileCloseInfoButton').click();
    assert.equal(await page.locator('#mobileInfoButton').getAttribute('aria-expanded'),'false');
    assert(!await page.locator('#informationSide').isVisible());
    await page.locator('#mobileInfoButton').click();
    await page.keyboard.press('Escape');
    assert(!await page.locator('#informationSide').isVisible(),'Escape should close mobile drawer');
    await page.locator('#mobileMoreActions summary').click();
    assert(await page.locator('#mobileLeaveBtn').isVisible(),'leave table missing on mobile');
    assert(await page.locator('#mobileCloseRoomBtn').isVisible(),'host close missing on mobile');
    await page.locator('#mobileMoreActions summary').click();
    console.log('KJ_PREMIUM_PHONE_COCKPIT_PASS',size.width+'x'+size.height,
      'handVisible=true','noSideScroll=true','sheetAccessible=true','menuAccessible=true');
   }else{
    assert(!metrics.stripVisible,'mobile strip should not appear on desktop');
    assert(metrics.sideVisible,'desktop sidebar must remain visible');
    assert(await page.locator('#scorePanel').isVisible());
    assert(!await page.locator('#mobileMoreActions').isVisible(),'mobile actions menu shown on desktop');
    console.log('KJ_PREMIUM_DESKTOP_COCKPIT_PASS',size.width+'x'+size.height,
      'sidebarVisible=true','handVisible=true');
   }
   assert.equal(errors.length,0,errors.join('; '));
  }finally{await context.close();}
 }
 // Make sure all bidding categories are accessible on narrow phones, including
 // the buttons that previously clipped underneath the hand.
 for(const size of [{width:320,height:640},{width:390,height:780}]){
  const {context,page,errors,saves}=await setup(size.width,size.height,'bidding');
  try{
   const categories=page.locator('#actionPanel .bid-category');
   assert.equal(await categories.count(),5,'Five suits/modes should be present');
   for(const value of ['hearts','spades','diamonds','clubs','sans']){
    const category=page.locator('#actionPanel .bid-category[data-bid-category="'+value+'"]');
    assert.equal(await category.count(),1,'Missing category '+value);
    if(await category.isEnabled()){
     await category.scrollIntoViewIfNeeded();
     await category.click({timeout:5000});
     assert(await page.locator('#actionPanel .bid-value').count()>0,
       'Points not offered for '+value);
     const values=page.locator('#actionPanel .bid-value:not([disabled])');
     if(await values.count()){
       await values.last().scrollIntoViewIfNeeded();
       assert(await values.last().isVisible(),'last bid point is clipped '+value);
     }
    }
   }
   assert.equal(errors.length,0,errors.join('; '));
   console.log('KJ_PREMIUM_BIDDING_MOBILE_PASS',size.width+'x'+size.height,
     'allSuitsAccessible=true','pointsScrollable=true');
  }finally{await context.close();}
 }
 // Regression: when it is the player's turn to bid, the hand must remain
 // visibly *inside* the felt and not disappear under the chooser, even after
 // selecting a different suit or scrolling the list of legal bids.
 const bidViewports=[
  {width:320,height:640},{width:360,height:740},{width:390,height:780},
  {width:430,height:932},{width:760,height:850},{width:768,height:820},
  {width:1024,height:768},{width:1478,height:880}
 ];
 for(const size of bidViewports){
  const {context,page,errors}=await setup(size.width,size.height,'bidding');
  async function checkHand(stage){
   const m=await page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();
     return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const felt=document.querySelector('#table'),hand=document.querySelector('.hand-wrap');
    const cards=[...document.querySelectorAll('#hand button.card')];
    const handRect=rect(hand),feltRect=rect(felt);
    return {screen:{width:innerWidth,height:innerHeight},hand:handRect,felt:feltRect,
      parent:hand.parentElement.id,position:getComputedStyle(hand).position,
      cards:cards.map(el=>{
       const r=rect(el),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
       const hit=document.elementFromPoint(x,y);
       return {...r,opacity:Number(getComputedStyle(el).opacity),
         disabled:el.disabled,
         unobscured:!!hit?.closest('#hand button.card')&&hit.closest('#hand button.card')===el};
      }),
      instruction:document.querySelector('#legalCue').textContent,
      pageWidth:document.documentElement.scrollWidth};
   });
   assert.equal(m.parent,'table',stage+': hand must be inside felt');
   assert.equal(m.position,'absolute',stage+': bidding hand is undocked');
   assert.equal(m.cards.length,8,stage+': expected all eight private cards');
   assert(m.hand.top>=m.felt.top-3&&m.hand.bottom<=m.felt.bottom+3,
     stage+': hand outside felt '+JSON.stringify(m));
   assert(m.hand.top>=-2&&m.hand.bottom<=size.height+3,
     stage+': hand outside screen '+JSON.stringify(m));
   assert(m.cards.every(c=>c.width>19&&c.height>39&&c.left>=m.hand.left-3&&c.right<=m.hand.right+3
     &&c.top>=m.hand.top-3&&c.bottom<=m.hand.bottom+3&&c.opacity>=.95
     &&c.unobscured&&c.disabled),
     stage+': a bidding card is clipped, faded, playable or obscured '+JSON.stringify(m));
   assert(m.instruction.includes('Bekijk je 8 kaarten'),stage+': bidding hand guidance missing');
   assert(m.pageWidth<=size.width+3,stage+': page horizontal overflow');
  }
  try{
   await checkHand('initial '+size.width+'x'+size.height);
   const clubs=page.locator('#actionPanel [data-bid-category="clubs"]');
   await clubs.scrollIntoViewIfNeeded();
   if(await clubs.isEnabled())await clubs.click();
   await checkHand('after suit selection '+size.width+'x'+size.height);
   const last=page.locator('#actionPanel .bid-value').last();
   if(await last.count()){await last.scrollIntoViewIfNeeded();await checkHand('after bid scroll '+size.width+'x'+size.height);}
   assert.equal(errors.length,0,errors.join('; '));
   console.log('KJ_BIDDING_EIGHT_CARDS_VISIBLE_PASS',size.width+'x'+size.height,
     'fullContrast=true','inViewport=true','notObscured=true','notPlayable=true');
  }finally{await context.close();}
 }
 // Teammate's PUBLIC bid must be visible without opening the score panel,
 // both when it is your turn and while you wait for other bids.
 for(const size of [{width:320,height:640},{width:390,height:780},{width:768,height:820},{width:1478,height:880}]){
  for(const waiting of [false,true]){
   const {context,page,remote,errors}=await setup(size.width,size.height,'bidding');
   try{
    if(waiting){
     // Freeze the next bidding seat as a real human to avoid a bot
     // advancing this mocked room before the public mate bid is inspected.
     remote.game.state.bidder_turn=1;
     remote.game.state.players=remote.game.state.players.map((p,i)=>i===1?
       {...p,is_bot:false,player_type:'human'}:p);
     remote.players=remote.game.state.players;
     await page.reload({waitUntil:'domcontentloaded'});
    }
    const partner=page.locator('#actionPanel .bid-partner-strip');
    await partner.waitFor({state:'visible',timeout:6000});
    const text=await partner.innerText();
    assert(text.includes('JE MAAT')&&text.includes('Teamgenoot')&&text.includes('♦ 90'),
      'Teammate suit/points not visible: '+text);
    assert(text.includes('Hoogste bod'),'Leading bid indicator missing');
    const seatBid=page.locator('#seats .seat.s2 .seat-bid');
    assert(await seatBid.isVisible(),'Teammate nameplate bid missing');
    assert((await seatBid.innerText()).includes('♦ 90'),'Player badge suit/points incorrect');
    const visible=await page.evaluate(()=>{
      const parent=document.querySelector('#actionPanel .bid-partner-strip');
      const container=document.querySelector('#table');
      const b=parent.getBoundingClientRect(),t=container.getBoundingClientRect();
      return {bid:{top:b.top,bottom:b.bottom,left:b.left,right:b.right},
       table:{top:t.top,bottom:t.bottom,left:t.left,right:t.right},
       display:getComputedStyle(parent).display,
       text:parent.textContent};
    });
    assert(visible.bid.top>=visible.table.top-3&&visible.bid.bottom<=visible.table.bottom+3,
      'Teammate bid outside visible felt: '+JSON.stringify(visible));
    assert(visible.bid.bottom<=size.height+3,
      'Teammate bid offscreen: '+JSON.stringify(visible));
    // The 8-card hand must remain docked for the full bid phase,
    // including when another human has the bidding turn.
    const handGeometry=await page.evaluate(()=>{
      const felt=document.querySelector('#table'),hand=document.querySelector('.hand-wrap');
      const f=felt.getBoundingClientRect(),h=hand.getBoundingClientRect();
      const cards=[...document.querySelectorAll('#hand button.card')];
      return {position:getComputedStyle(hand).position,
        hand:{top:h.top,bottom:h.bottom,left:h.left,right:h.right},
        felt:{top:f.top,bottom:f.bottom,left:f.left,right:f.right},
        cards:cards.map(card=>{
          const r=card.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return {disabled:card.disabled,opacity:Number(getComputedStyle(card).opacity),
            width:r.width,height:r.height,
            visible:hit===card||card.contains(hit)};
        })};
    });
    assert.equal(handGeometry.position,'absolute','Bid hand must be docked on every bidding turn');
    assert.equal(handGeometry.cards.length,8,'All eight cards must be present while bidding');
    assert(handGeometry.hand.top>=handGeometry.felt.top-3 &&
      handGeometry.hand.bottom<=handGeometry.felt.bottom+3 &&
      handGeometry.hand.left>=handGeometry.felt.left-3 &&
      handGeometry.hand.right<=handGeometry.felt.right+3,
      'Bid hand extends beyond the felt: '+JSON.stringify(handGeometry));
    assert(handGeometry.hand.top>=-3&&handGeometry.hand.bottom<=size.height+3,
      'Bid hand is offscreen: '+JSON.stringify(handGeometry));
    assert(handGeometry.cards.every(c=>c.disabled&&c.opacity>=.95&&c.width>19&&c.height>39&&c.visible),
      'Bidding cards are hidden, faded or interactive: '+JSON.stringify(handGeometry));
    // The same badge must correctly reflect a later public pass.
    remote.game.state.bid_history.push({seat:2,action:'pass',points:0});
    remote.game.state.current_bid={action:'bid',mode:'suit',suit:'spades',points:100,player:1,team:2};
    await page.reload({waitUntil:'domcontentloaded'});
    const passed=page.locator('#actionPanel .bid-partner-strip');
    await passed.waitFor({state:'visible',timeout:6000});
    assert((await passed.innerText()).includes('Pas'),'Teammate pass is not visible');
    assert((await page.locator('#seats .seat.s2 .seat-bid').innerText()).includes('Pas'),
      'Teammate pass must appear in their player badge');
    assert.equal(errors.length,0,errors.join('; '));
    console.log('KJ_MATE_BID_VISIBLE_PASS',size.width+'x'+size.height,
      waiting?'waiting=true':'ownTurn=true','suit=diamonds','points=90');
   }finally{await context.close();}
  }
 }
 // The standalone lobby must be just as usable on small touch screens.
 for(const viewport of [{width:320,height:640},{width:390,height:780},{width:768,height:820}]){
  const context=await browser.newContext({viewport});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>
   route.fulfill({status:200,contentType:'application/json',
     headers:{'access-control-allow-origin':'*'},body:'[]'}));
  try{
   await page.goto(BASE+'index.html?left=1',{waitUntil:'domcontentloaded'});
   await page.locator('#guestName').waitFor({state:'visible',timeout:8000});
   for(const id of ['guestName','customRoomCode','customRoomTitle','finishMode','codeInput']){
    assert(await page.locator('#'+id).isVisible(),id+' not visible in responsive lobby');
   }
   const sizes=await page.evaluate(()=>{
    const width=innerWidth;
    const selectors=['#createBtn','#joinBtn','#guestName','#customRoomCode','#customRoomTitle'];
    const fields=selectors.map(s=>{
     const el=document.querySelector(s),r=el.getBoundingClientRect();
     return {id:s,left:r.left,right:r.right,height:r.height,width:r.width};
    });
    return {pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,width,fields};
   });
   assert(sizes.pageWidth<=viewport.width+3&&sizes.bodyWidth<=viewport.width+3,
     'lobby horizontal overflow '+JSON.stringify(sizes));
   assert(sizes.fields.every(f=>f.left>=0&&f.right<=viewport.width+3&&f.height>=40),
     'lobby form clipped/too small '+JSON.stringify(sizes));
   assert.equal(errors.length,0,'Lobby JS errors '+errors.join('; '));
   console.log('KJ_PREMIUM_LOBBY_RESPONSIVE_PASS',viewport.width+'x'+viewport.height,
     'allInputsVisible=true','touchTargets=true');
  }finally{await context.close();}
 }
 console.log('RESULT=KJ_PREMIUM_RESPONSIVE_COCKPIT_PASS');
}finally{await browser.close();}
