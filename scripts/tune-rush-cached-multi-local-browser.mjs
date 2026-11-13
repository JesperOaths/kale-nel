// Full browser contract for two physical devices using the S21's same-origin
// LAN path. The test server supplies state only; MP3 truth is tested natively.
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {chromium,devices} from "playwright-core";

const browserPath=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
 "/usr/bin/chromium","/usr/bin/chromium-browser"].find(existsSync);
assert.ok(browserPath,"Chromium required");
const browser=await chromium.launch({headless:true,executablePath:browserPath,
 args:["--no-sandbox","--disable-dev-shm-usage"]});
let game=null,cloudRequests=0;
const errors=[],actions=[];
function view(hash,action){
 const host=hash===game.host;
 const player=game.players.find(x=>x.hash===hash);
 const role=host?"host":player?"player":"unknown";
 const data={code:game.code,phase:game.phase,role,me:player?.id||null,
  players:game.players.map(x=>({id:x.id,name:x.name,score:x.score})),
  genres:game.genres,decades:game.decades,round:game.round,step:game.step,
  firstAnswered:game.firstAnswered,stealTurn:false,titleDone:game.titleDone,
  artistDone:game.artistDone,lockedPlayer:game.lockedPlayer,winner:game.winner,
  title:game.phase==="solved"||game.phase==="finished"?"Testing Song":null,
  artist:game.phase==="solved"||game.phase==="finished"?"Testing Artist":null,
  audio:host&&game.phase==="playing"?{source:"cached:"+game.round,cueMs:7000}:null,
  myBlockedStep:player?.blockedStep??-99};
 if(host&&action==="play")
  data.clipAudio="data:audio/mpeg;base64,SUQzAAAAAA==";
 return data;
}
async function handle(route){
 const input=route.request().postDataJSON();
 const {action,code,hash,data}=input;
 actions.push(action);
 if(action==="create"&&!game)
  game={code,host:hash,phase:"lobby",players:[],genres:["pop","rock"],decades:[],
   round:0,step:-1,firstAnswered:false,titleDone:false,artistDone:false,
   lockedPlayer:null,winner:null};
 let error="";
 if(!game||code!==game.code)error="room_not_found";
 else if(action==="join"){
  if(game.phase!=="lobby")error="game_already_started";
  else if(game.players.some(x=>x.name===data.name))error="name_taken";
  else game.players.push({id:"p"+(game.players.length+1),name:data.name,hash,score:0,blockedStep:-99});
 }else if(hash!==game.host&&!game.players.some(x=>x.hash===hash))
  error="unauthorized";
 else if(action==="settings"){
  game.genres=[...data.genres];game.decades=[...data.decades];
 }else if(action==="start"){
  if(hash!==game.host||data.mode!=="persistent-library")error="invalid_music_source";
  else{game.phase="paused";game.round=1;game.step=-1;}
 }else if(action==="play"){
  if(hash!==game.host||game.phase!=="paused")error="not_ready_for_clip";
  else{game.phase="playing";game.step++;}
 }else if(action==="buzz"){
  if(hash===game.host||game.phase!=="playing")error="buzz_closed";
  else{game.phase="answering";game.lockedPlayer=game.players.find(x=>x.hash===hash).id;}
 }else if(action==="answer"){
  if(game.phase!=="answering"||game.lockedPlayer!==game.players.find(x=>x.hash===hash)?.id)
   error="not_your_turn";
  else{
   const player=game.players.find(x=>x.hash===hash);
   if(data.song==="Testing Song"&&data.artist==="Testing Artist")player.score+=1;
   game.phase="solved";game.lockedPlayer=null;game.titleDone=true;game.artistDone=true;
  }
 }else if(action==="next"){
  if(hash!==game.host||data.mode!=="persistent-library")error="invalid_music_source";
  else{game.phase="paused";game.round++;game.step=-1;game.titleDone=false;game.artistDone=false;}
 }else if(action==="finish"){
  game.phase="finished";game.winner=game.players[0]?.id||null;
 }
 const output=error?{error}:{state:view(hash,action)};
 return route.fulfill({status:error?400:200,contentType:"application/json",
  headers:{"Cache-Control":"no-store"},body:JSON.stringify(output)});
}
try{
 const tabletContext=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const phoneContext=await browser.newContext({...devices["iPhone 13"]});
 for(const context of [tabletContext,phoneContext]){
  await context.route("**/api/multiplayer",handle);
  await context.route("**/rest/v1/rpc/**",route=>{cloudRequests++;return route.abort()});
 }
 const tablet=await tabletContext.newPage(),phone=await phoneContext.newPage();
 tablet.on("pageerror",e=>errors.push("tablet: "+e.message));
 phone.on("pageerror",e=>errors.push("phone: "+e.message));
 const base="http://127.0.0.1:8798/";
 // The original homepage Create lobby link must open a native S21 room.
 // Refreshing must not create another room.
 await tablet.goto(base+"?autocreate=1",{waitUntil:"domcontentloaded"});
 assert.equal(await tablet.evaluate(()=>LOCAL_DIRECT),true);
 assert.equal(await tablet.locator("#cloud-notice").isVisible(),false,
  "Local game should never show the remote outage warning");
 await tablet.waitForFunction(()=>state?.role==="host"&&state?.phase==="lobby");
 assert.equal(new URL(tablet.url()).searchParams.has("autocreate"),false);
 assert.equal(actions.filter(x=>x==="create").length,1);
 await tablet.reload({waitUntil:"domcontentloaded"});
 await tablet.waitForFunction(()=>state?.role==="host"&&state?.phase==="lobby");
 assert.equal(actions.filter(x=>x==="create").length,1,
  "Page refresh must not create a second lobby");
 assert.equal(await tablet.locator("#start").isDisabled(),true);
 const code=await tablet.locator("#room-code").innerText();
 assert.match(code,/^[A-HJ-NP-Z2-9]{6}$/);
 const invite=await tablet.locator("#invite-link").inputValue();
 assert.equal(new URL(invite).searchParams.get("room"),code);
 assert.equal(new URL(invite).origin,"http://127.0.0.1:8798");
 // The real S21 uses HTTP on a LAN IP, where navigator.clipboard is absent.
 // Exercise the non-secure fallback and verify honest manual-copy feedback.
 await tablet.evaluate(()=>{
   Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true});
   window.__legacyCopyCalls=0;
   document.execCommand=(command)=>{if(command==="copy")window.__legacyCopyCalls++;return false;};
 });
 await tablet.locator("#copy-invite").click();
 assert.equal(await tablet.locator("#invite-link").inputValue(),invite);
 assert.match(await tablet.locator("#notice").innerText(),/Select and copy the phone invite link/);
 assert.equal(await tablet.evaluate(()=>window.__legacyCopyCalls),1);
 await tablet.evaluate(()=>{document.execCommand=(command)=>command==="copy"});
 await tablet.locator("#copy-invite").click();
 assert.match(await tablet.locator("#notice").innerText(),/Phone invite link copied/);
 const hostToken=await tablet.evaluate(()=>JSON.parse(localStorage.getItem(
  "tune-rush-s21-multi-access-v1")).hash);
 await tablet.locator("#tablet-toggle").click();
 const embedded=tablet.frameLocator("#tablet-frame");
 await embedded.locator("#room").waitFor({state:"visible",timeout:12000});
 await tablet.waitForFunction(()=>state?.players?.length===1,null,{timeout:10000});
 assert.equal(game.players[0].name,"Tablet Player");
 const frameUrl=await tablet.locator("#tablet-frame").getAttribute("src");
 assert.equal(new URL(frameUrl).searchParams.get("room"),code);
 assert.equal(new URL(frameUrl).searchParams.has("hash"),false);
 // The original homepage Join game form must reach the same S21 backend.
 await phone.goto(base+"?room="+code+"&name=Phone%20Tester&autojoin=1",
  {waitUntil:"domcontentloaded"});
 await phone.waitForFunction(()=>state?.role==="player",null,{timeout:12000});
 assert.equal(new URL(phone.url()).searchParams.has("autojoin"),false);
 assert.equal(new URL(phone.url()).searchParams.has("name"),false);
 await tablet.waitForFunction(()=>state?.players?.length===2,null,{timeout:10000});
 assert.equal(await tablet.locator("#start").isEnabled(),true);
 assert.deepEqual(game.players.map(x=>x.name).sort(),["Phone Tester","Tablet Player"]);
 assert.equal(await tablet.evaluate(()=>JSON.parse(localStorage.getItem(
  "tune-rush-s21-multi-access-v1")).hash),hostToken);
 await tablet.locator("#tablet-close").click();
 assert.equal(await tablet.locator("#tablet-panel").isVisible(),false);
 await tablet.locator("#start").click();
 await tablet.waitForFunction(()=>state?.phase==="paused");
 assert.equal(game.round,1);
 await tablet.locator("#play").click();
 await tablet.waitForFunction(()=>state?.phase==="playing");
 await phone.waitForFunction(()=>state?.phase==="playing",null,{timeout:10000});
 assert.equal(await phone.locator("#buzz").isVisible(),true);
 await phone.locator("#buzz").click();
 await phone.waitForFunction(()=>state?.phase==="answering");
 await phone.locator("#guess-title").fill("Testing Song");
 await phone.locator("#guess-artist").fill("Testing Artist");
 await phone.locator("#answer-form button[type=submit]").click();
 await phone.waitForFunction(()=>state?.phase==="solved");
 assert.equal(game.players.find(x=>x.name==="Phone Tester").score,1);
 await tablet.waitForFunction(()=>state?.phase==="solved",null,{timeout:10000});
 await tablet.locator("#next").click();
 await tablet.waitForFunction(()=>state?.round===2);
 assert.equal(game.round,2);
 tablet.once("dialog",dialog=>dialog.accept());
 await tablet.locator("#finish").click();
 await tablet.waitForFunction(()=>state?.phase==="finished");
 assert.equal(await tablet.locator("#finished-view").isVisible(),true);
 assert.equal(cloudRequests,0,"direct local game must not contact Supabase");
 assert.deepEqual(errors,[],"no browser page errors");
 console.log("TUNERUSH_DIRECT_S21_TWO_DEVICE_PASS",JSON.stringify({
   simulatedDevices:2,tabletHostAndPlayer:true,phoneJoined:true,
   sameOriginS21:true,backendMusicMode:"persistent-library",
   scoredGuess:true,roundAdvance:true,cloudRequests:0,uniquePlayerTokens:true
 }));
}finally{await browser.close()}
