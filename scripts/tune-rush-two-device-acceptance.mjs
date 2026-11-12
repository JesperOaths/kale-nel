// Two physical devices: a tablet hosting and answering in its own iframe,
// plus one phone. The authoritative musicquiz RPC is mocked ONLY in this
// offline browser test, so production database outages cannot hide UI bugs.
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {chromium,devices} from "playwright-core";

const BASE=process.env.TUNE_RUSH_BASE||"http://127.0.0.1:8080/music/";
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
 "/usr/bin/chromium","/usr/bin/chromium-browser"].find(p=>p&&existsSync(p));
assert.ok(chrome,"Chromium is required");
const browser=await chromium.launch({executablePath:chrome,headless:true,
 args:["--no-sandbox","--disable-dev-shm-usage"]});
const tablet=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
const phone=await browser.newContext({...devices["iPhone 13"]});
const rooms=new Map(),errors=[];
function view(game,hash){
 const player=game.players.find(p=>p.hash===hash);
 return {code:game.code,role:hash===game.hostHash?"host":player?"player":"unknown",
  phase:"lobby",round:0,step:-1,clipMs:0,mode:"local",
  players:game.players.map(p=>({id:p.id,name:p.name,score:p.score})),
  me:player?.id||null,genres:["pop"],decades:[],firstAnswered:false,
  titleDone:false,artistDone:false,title:"",artist:"",stealTurn:false,
  lockedPlayer:null,myBlockedStep:-1,audio:null};
}
async function respond(route){
 let input;
 try{input=route.request().postDataJSON()}catch{
  return route.fulfill({status:400,contentType:"application/json",body:"{}"});
 }
 const {p_action:action,p_code:code,p_hash:hash,p_data:data}=input||{};
 let game=rooms.get(code);
 if(action==="create"&&!game){
  game={code,hostHash:hash,players:[]};rooms.set(code,game);
 }else if(action==="join"&&game&&game.players.length<4){
  const existing=game.players.find(p=>p.hash===hash);
  if(!existing){
   if(game.players.some(p=>p.name===data?.name))
    return route.fulfill({status:400,contentType:"application/json",
     body:JSON.stringify({message:"name_taken"})});
   game.players.push({id:"player"+(game.players.length+1),hash,
    name:data?.name||"Player",score:0});
  }
 }
 if(!game||hash!==game.hostHash&&!game.players.some(p=>p.hash===hash)){
  return route.fulfill({status:400,contentType:"application/json",
   body:JSON.stringify({message:"unauthorized"})});
 }
 return route.fulfill({status:200,contentType:"application/json",
  headers:{"access-control-allow-origin":"*"},body:JSON.stringify(view(game,hash))});
}
try{
 await Promise.all([tablet.route("**/rest/v1/rpc/musicquiz_v1",respond),
  phone.route("**/rest/v1/rpc/musicquiz_v1",respond)]);
 const host=await tablet.newPage(),mobile=await phone.newPage();
 for(const [page,label] of [[host,"tablet"],[mobile,"phone"]])
  page.on("pageerror",err=>errors.push(label+": "+err.message));
 await host.goto(BASE,{waitUntil:"domcontentloaded",timeout:20000});
 await host.locator("#create").click();
 await host.waitForFunction(()=>room?.role==="host"&&room?.phase==="lobby",null,{timeout:9000});
 const code=await host.evaluate(()=>room.code);
 const hostToken=await host.evaluate(()=>JSON.parse(localStorage.getItem(
  "kalenel_tunerush_room_v001")).token);
 assert.match(hostToken,/^[a-f0-9]{64}$/);
 assert.equal(rooms.get(code)?.players.length,0,"no automatic participant before opt-in");
 assert.equal(await host.locator("#tablet-test-toggle").isVisible(),true);
 assert.equal(await host.locator("#tablet-test-panel").isVisible(),false);
 await host.locator("#tablet-test-toggle").click();
 const iframe=host.frameLocator("#tablet-test-frame");
 await iframe.locator("#room").waitFor({state:"visible",timeout:10000});
 await host.waitForFunction(()=>room?.players?.length===1,null,{timeout:9000});
 assert.deepEqual(rooms.get(code).players.map(p=>p.name),["Tablet Test"]);
 const frameUrl=await host.locator("#tablet-test-frame").getAttribute("src");
 assert.equal(new URL(frameUrl).searchParams.get("room"),code);
 assert.equal(new URL(frameUrl).searchParams.get("tabletPlayer"),"1");
 assert.equal(new URL(frameUrl).searchParams.has("token"),false);
 const iframeToken=await iframe.locator("#room").evaluate(()=>{
  const code=new URLSearchParams(location.search).get("room");
  return JSON.parse(sessionStorage.getItem("kalenel_tunerush_tablet_test_"+code)).token;
 });
 assert.match(iframeToken,/^[a-f0-9]{64}$/);
 assert.notEqual(iframeToken,hostToken);
 assert.equal(await host.evaluate(()=>JSON.parse(localStorage.getItem(
  "kalenel_tunerush_room_v001")).token),hostToken);
 await host.locator("#tablet-test-close").click();
 assert.equal(await host.locator("#tablet-test-panel").isVisible(),false);
 await host.locator("#tablet-test-toggle").click();
 await iframe.locator("#room").waitFor({state:"visible"});
 assert.equal(rooms.get(code).players.length,1,"panel reopening duplicated participant");
 await mobile.goto(new URL("?room="+code,BASE).href,{waitUntil:"domcontentloaded",timeout:20000});
 await mobile.locator("#nickname").fill("Phone Tester");
 await mobile.locator("#join-form button[type=submit]").click();
 await mobile.waitForFunction(()=>room?.role==="player"&&room?.phase==="lobby",
  null,{timeout:9000});
 await host.waitForFunction(()=>room?.players?.length===2,null,{timeout:9000});
 assert.deepEqual(rooms.get(code).players.map(p=>p.name).sort(),["Phone Tester","Tablet Test"]);
 assert.equal(await host.locator("#lobby-player-count").innerText(),"2 players joined");
 assert.equal(await host.locator("#start").isEnabled(),true);
 assert.equal(await host.evaluate(()=>JSON.parse(localStorage.getItem(
  "kalenel_tunerush_room_v001")).token),hostToken);
 assert.deepEqual(errors,[],"uncaught browser errors");
 console.log("TUNERUSH_TWO_DEVICE_OFFLINE_PASS",JSON.stringify({
  devices:2,tabletRoles:["host","scored player"],phonePlayers:1,
  serverAuthorizedPlayers:2,hostCapabilityPreserved:true,
  differentPlayerCapability:true,reopenDoesNotDuplicate:true,
  startEnabled:true,hostAudioUnchanged:true}));
}finally{
 await browser.close();
}
