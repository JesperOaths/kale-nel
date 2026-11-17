#!/usr/bin/env node
// Standalone Klaverjassen bidding: local browser, mocked guest RPC, no production data writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.KLAVERJASSEN_TEST_BASE || 'http://127.0.0.1:8080/klaverjassen/';
const CODE='V5KG35';
const players=[
 {seat:0,name:'QA',team:1,is_bot:false,player_type:'human'},
 {seat:1,name:'Leerling Schoppen',team:2,is_bot:true,player_type:'bot',bot_difficulty:'easy'},
 {seat:2,name:'Leerling Harten',team:1,is_bot:true,player_type:'bot',bot_difficulty:'easy'},
 {seat:3,name:'Leerling Ruiten',team:2,is_bot:true,player_type:'bot',bot_difficulty:'easy'}
];
const cards=[
 ['hearts','A'],['hearts','8'],['spades','8'],['diamonds','8'],
 ['clubs','10'],['clubs','K'],['clubs','J'],['clubs','8']
].map(([suit,rank])=>({id:`${suit}-${rank}`,suit,rank}));
const gameState={
 phase:'bidding',players,settings:{finish_mode:'fixed_rounds',bot_count:3},
 hands:[cards,[],[],[]],dealer:0,totals:[0,0],roem_by_team:[0,0],
 rounds:[],trick:[],taken:[],plays:[],pending_trick:null,last_trick:null,
 accepted_bid:null,
 current_bid:{action:'bid',mode:'suit',suit:'diamonds',points:90,player:2,team:1},
 bidder_turn:0,turn:null,action_needed_seat:0
};
const remote={
 viewer:{seat:0,name:'QA',is_host:true},
 players,
 game:{id:'00000000-0000-4000-8000-000000000001',lobby_code:CODE,
 status:'playing',created_by_player_name:'QA',dealer_index:0,revision:4,state:gameState,log:[]}
};
const chromePath=process.env.CHROME_BIN || '/usr/bin/google-chrome';
const browser=await chromium.launch({headless:true,executablePath:chromePath,args:['--no-sandbox','--disable-dev-shm-usage']});
const categoryGroups={
 hearts:7,spades:7,diamonds:7,clubs:7,sans:6
};
const cases=[
 {name:'desktop',width:1478,height:880},
 {name:'compact-desktop',width:990,height:680},
 {name:'tablet',width:768,height:820},
 {name:'mobile',width:390,height:780},
 {name:'narrow-mobile',width:320,height:640}
];
try{
 for(const viewport of cases){
  const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}});
  const pageErrors=[],saved=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.addInitScript(({code,token})=>{
   localStorage.setItem('kalenel_klaverjassen_guest_room_v1',code);
   localStorage.setItem('kalenel_klaverjassen_guest_cap_v1_'+code,JSON.stringify({token,name:'QA'}));
  },{code:CODE,token:'a'.repeat(64)});
  await page.route('**/rest/v1/rpc/klaverjassen_guest_v1',async route=>{
   const request=route.request();
   const body=JSON.parse(request.postData()||'{}');
   if(body.action_input==='save')saved.push(body);
   await route.fulfill({status:200,contentType:'application/json',
    headers:{'access-control-allow-origin':'*'},
    body:JSON.stringify(body.action_input==='list'?[]:remote)});
  });
  try{
   await page.goto(BASE+'room.html?room='+CODE,{waitUntil:'domcontentloaded'});
   await page.locator('#actionPanel .bid-category').first().waitFor({state:'visible',timeout:12000});
   assert.equal(await page.locator('#actionPanel .bid-category').count(),5,`${viewport.name}: all five suit selectors`);
   assert.equal(await page.locator('#actionPanel .bid-pass').count(),1,`${viewport.name}: permanent pass`);
   assert.equal(await page.locator('#bidStat').innerText(),'90 Ruiten',`${viewport.name}: current bid`);
   const dimension=await page.evaluate(()=>{
    const rect=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    const table=rect('#table'),center=rect('#table .center'),hand=rect('.hand-wrap');
    return {table,center,hand,scrollable:getComputedStyle(document.querySelector('#table .center')).overflowY,viewportHeight:innerHeight};
   });
   assert(dimension.center.top>=dimension.table.top-3 &&
          dimension.center.bottom<=dimension.table.bottom+3,
          `${viewport.name}: bidding panel must fit within table: ${JSON.stringify(dimension)}`);
   assert.equal(dimension.scrollable,'auto',`${viewport.name}: fallback inner scrolling`);
   assert(dimension.hand.top>=0&&dimension.hand.bottom<=dimension.viewportHeight+4,
     `${viewport.name}: hand must remain visible in the game viewport: ${JSON.stringify(dimension)}`);
   assert(dimension.hand.bottom<=dimension.table.bottom+6,
     `${viewport.name}: hand belongs inside or overlays the felt, not below it`);
   for(const [key,expected] of Object.entries(categoryGroups)){
    const button=page.locator('[data-bid-category="'+key+'"]');
    await button.click({timeout:3500});
    assert.equal(await button.getAttribute('aria-pressed'),'true',`${viewport.name}: ${key} selection`);
    assert.equal(await page.locator('#actionPanel .bid-value').count(),expected,
      `${viewport.name}: ${key} has the correct playable bids`);
    await page.locator('#actionPanel .bid-value').last().click({trial:true,timeout:3500});
    await page.locator('#actionPanel .bid-pass').click({trial:true,timeout:3500});
   }
   await page.locator('[data-bid-category="clubs"]').click();
   const bidButton=page.locator('#actionPanel .bid-value').first();
   await bidButton.click({timeout:3500});
   await page.waitForTimeout(600);
   assert(saved.length>0,`${viewport.name}: clicking bid must POST a save`);
   const latest=saved.at(-1).payload_input.state;
   assert.equal(latest.last_progress_reason,'bid',`${viewport.name}: expected bidding action`);
   assert.equal(latest.current_bid.suit,'clubs',`${viewport.name}: selected suit must reach backend`);
   assert(pageErrors.length===0,`${viewport.name}: JavaScript errors: ${pageErrors.join('; ')}`);
   console.log('KLAVERJASSEN_BIDDING_UI_PASS',viewport.name,
     `${viewport.width}x${viewport.height}`, 'categories=5', 'legalPoints=34',
     'bidAction=clubs', 'clipped=false');
  }finally{await page.close();}
 }
 console.log('RESULT=KLAVERJASSEN_STANDALONE_BIDDING_BROWSER_PASS');
}finally{await browser.close();}
