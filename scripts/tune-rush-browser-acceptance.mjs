// Audius-only production-route browser regression using a real live game database.
// The streaming transport is fixture-backed: real tablet speaker playback is checked separately.
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {chromium,devices} from "playwright-core";

const BASE=process.env.TUNE_RUSH_BASE||"https://kalenel.nl/music/";
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].find(x=>x&&existsSync(x));
assert.ok(chrome,"Chrome or Chromium is required");
const browser=await chromium.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const pad=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
const phone=await browser.newContext({...devices["iPhone 13"]});
const errors=[];
function makeWav(freq=440,seconds=38){
 const rate=8000,samples=seconds*rate,b=Buffer.alloc(44+samples*2);
 b.write("RIFF",0);b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);
 b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
 b.write("data",36);b.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*freq/rate)*4500),44+i*2);
 return b;
}
const ids=["abc12x","abc13x","abc14x"];
let metadataRequests=0,streamRequests=0;
try{
 const host=await pad.newPage(),guest=await phone.newPage();
 for(const [p,label] of [[host,"host"],[guest,"guest"]])
  p.on("pageerror",e=>errors.push(label+": "+e.message));
 await host.route("https://api.audius.co/v1/tracks/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith("/stream")){
   streamRequests++;
   await route.fulfill({status:200,contentType:"audio/wav",
    headers:{"access-control-allow-origin":"*","accept-ranges":"bytes"},
    body:makeWav(430+streamRequests*40)});
   return;
  }
  metadataRequests++;
  await route.fulfill({status:200,contentType:"application/json",
   headers:{"access-control-allow-origin":"*"},
   body:JSON.stringify({data:ids.map((id,i)=>({id,title:"Test Track "+i,
    user:{name:"Test Artist "+i},genre:"Pop",duration:38,
    release_date:"2025-03-14T00:00:00Z",is_streamable:true,is_unlisted:false}))})});
 });
 await Promise.all([
  host.goto(BASE,{waitUntil:"domcontentloaded",timeout:30000}),
  guest.goto(BASE,{waitUntil:"domcontentloaded",timeout:30000})
 ]);
 await host.locator("#create").waitFor({state:"visible"});
 // Retired providers must have no controls, imports, iframes or module requests.
 assert.equal(await host.locator('input[name="music-source"]').count(),0);
 for(const id of ["youtube-host","youtube-setup","local-settings","deezer-host","deezer-source-option","source-select"])
  assert.equal(await host.locator("#"+id).count(),0,"retired source still exposed: "+id);
 assert.ok(await host.locator(".hero-record").isVisible());
 await host.locator("#create").click();
 await host.waitForFunction(()=>room?.role==="host"&&room?.phase==="lobby",null,{timeout:17000});
 const code=await host.evaluate(()=>room.code);
 await guest.locator("#join-code").fill(code);
 await guest.locator("#nickname").fill("Test Player");
 await guest.locator("#join-form button[type=submit]").click();
 await guest.waitForFunction(()=>room?.role==="player"&&room?.phase==="lobby",null,{timeout:17000});
 await host.waitForFunction(()=>room?.players?.length>=1,null,{timeout:17000});
 assert.ok(await host.locator(".stream-hero").isVisible());
 assert.equal(await guest.locator(".stream-hero").isVisible(),false);
 await host.locator("#audius-check").click();
 await host.waitForFunction(()=>audiusPool.length===3&&!audiusChecking,null,{timeout:20000});
 assert.match(await host.locator("#audius-availability").innerText(),/3 distinct streamable tracks/);
 const mobile=await guest.evaluate(()=>({vw:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(mobile.scroll<=mobile.vw+3,"guest page overflows phone viewport");
 await host.locator("#start").click();
 await host.waitForFunction(()=>room?.mode==="local"&&room?.round===1&&audiusActive,null,{timeout:26000});
 const first=await host.evaluate(()=>({source:room.audio.source,id:audiusTrack.id}));
 assert.match(first.source,/^local:\d+$/);
 assert.equal((await guest.evaluate(()=>room?.audio)),null,"guest must not learn Audius stream or private answer");
 assert.match(await host.locator("#licensed-player").getAttribute("src"),/^https:\/\/api\.audius\.co\/v1\/tracks\/[A-Za-z0-9_-]+\/stream$/);
 await host.locator("#audius-play-hint").click();
 await host.waitForFunction(()=>room?.step===0&&room?.phase==="paused",null,{timeout:22000});
 const heard=await host.evaluate(()=>({playedMs:1000*(playerAudio.currentTime-room.audio.cueMs/1000),failedClue,step:room.step}));
 assert.ok(heard.playedMs>370,"audio must really advance before a 0.5s clue ends");
 assert.equal(heard.failedClue,"");
 await host.locator("#skip-round").click();
 await host.waitForFunction(()=>room?.phase==="solved",null,{timeout:15000});
 assert.ok(await host.locator("#audius-credit").isVisible());
 await host.locator("#next-round").click();
 await host.waitForFunction(()=>room?.round===2&&room?.phase==="paused",null,{timeout:25000});
 const second=await host.evaluate(()=>({source:room.audio.source,ids:rotationHistory?.games?.at(-1)?.audius||[]}));
 assert.notEqual(second.source,first.source,"no-repeat selection must avoid previous track");
 assert.ok(second.ids.length>=2,"playing history must persist Audius IDs");
 assert.ok(streamRequests>=2&&metadataRequests>0);
 assert.deepEqual(errors,[],"no uncaught browser errors");
 console.log("BROWSER_AUDIUS_ONLY_STUDIO_PASS",JSON.stringify({
  source:"Audius only",rooms:2,tracks:3,streamRequests,metadataRequests,
  nextRound:2,playedMs:Math.round(heard.playedMs),noRepeat:true,mobileOverflow:false,
  removedLegacyUI:true,guestPrivateAnswers:true}));
} finally {console.log("BROWSER_PAGE_ERRORS",JSON.stringify(errors.slice(0,12)));await browser.close();}
