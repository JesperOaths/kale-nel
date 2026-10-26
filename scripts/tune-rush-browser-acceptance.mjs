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
 assert.match(await host.locator("#lobby-launch-status").innerText(),/1 PLAYER READY/);
 // A soundtrack preset changes only the host's checkbox choices and saves to the room.
 await host.locator('[data-audius-preset="party"]').click();
 assert.deepEqual((await host.locator("#genre-options input:checked").evaluateAll(xs=>xs.map(x=>x.value))).sort(),
  ["dance","disco","electronic","pop"].sort());
 assert.equal(await host.locator("#decade-options input:checked").count(),0,"presets include all eras by default");
 await host.waitForFunction(()=>room?.genres?.includes("dance")&&room?.genres?.includes("disco"),null,{timeout:15000});
 await host.locator("#decade-options input[value='2020']").check();
 await host.locator("#clear-audius-decades").click();
 assert.equal(await host.locator("#decade-options input:checked").count(),0,"all eras shortcut removes decade restrictions");
 await host.waitForFunction(()=>!room?.decades?.length,null,{timeout:15000});
 await host.locator("#audius-check").click();
 await host.waitForFunction(()=>audiusPool.length===3&&!audiusChecking,null,{timeout:20000});
 assert.match(await host.locator("#audius-availability").innerText(),/3 distinct streamable tracks/);
 assert.equal(await host.locator("#audius-scan-progress").isVisible(),false,"scan meter hides after completion");
 assert.equal(await host.locator("#audius-scan-progress [role=progressbar]").getAttribute("aria-valuenow"),"100",
  "full Audius scans reach 100 percent");
 assert.match(await host.locator("#audius-scan-label").innerText(),/9 of 9 checks/);
 assert.equal(await host.locator("#audius-check").isDisabled(),false,"Check tracks re-enables after scan");
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
 // A real navigation must recover the same source and server round. It must
 // never auto-play, skip, reveal, lose the buzzer session, or change the cue.
 const prior=await host.evaluate(()=>({code:room.code,round:room.round,
  source:room.audio.source,cueMs:room.audio.cueMs,id:audiusTrack.id,
  checkpoint:JSON.parse(sessionStorage.getItem("tune-rush-audius-host-stream-v1")||"null")}));
 assert.equal(prior.checkpoint?.source,prior.source,"host saves its private track resume receipt");
 assert.equal(await guest.evaluate(()=>sessionStorage.getItem("tune-rush-audius-host-stream-v1")),null,
  "guest cannot access the host's private stream checkpoint");
 await host.reload({waitUntil:"domcontentloaded",timeout:30000});
 try{
  await host.waitForFunction(()=>room?.round===2&&room?.phase==="paused"&&
   audiusActive&&localCurrentIndex===Number(room.audio.source.slice(6))&&
   playerAudio.readyState>=1,null,{timeout:30000});
 }catch(error){
  const detail=await host.evaluate(()=>({
   room:room?{role:room.role,phase:room.phase,round:room.round,code:room.code,
    title:room.title,artist:room.artist,source:room.audio?.source}:null,
   saved:(()=>{try{return JSON.parse(sessionStorage.getItem("tune-rush-audius-host-stream-v1")||"null")}catch{return null}})(),
   active:audiusActive,restoring:audiusRestoring,stream:localAudioUrl,
   localCurrentIndex,readyState:playerAudio.readyState,
   mediaError:playerAudio.error?.message||null,
   status:document.getElementById("audius-playback-status")?.textContent,
   toast:document.getElementById("toast")?.textContent,
   scriptLoaded:document.scripts.length
  }));
  console.error("BROWSER_AUDIUS_RESUME_DIAGNOSTIC",JSON.stringify(detail));
  throw error;
 }
 const after=await host.evaluate(()=>({code:room.code,round:room.round,
  source:room.audio.source,cueMs:room.audio.cueMs,id:audiusTrack.id,
  status:document.getElementById("audius-playback-status")?.textContent}));
 assert.deepEqual([after.code,after.round,after.source,after.cueMs,after.id],
  [prior.code,prior.round,prior.source,prior.cueMs,prior.id],
  "reload keeps the exact same round, random seek, stream identity and game room");
 assert.match(after.status,/Stream recovered/);
 assert.ok(await host.locator("#audius-play-hint").isVisible());
 await host.locator("#audius-play-hint").click();
 await host.waitForFunction(()=>room?.step===0&&room?.phase==="paused",null,{timeout:22000});
 assert.ok(streamRequests>=3&&metadataRequests>0);
 assert.deepEqual(errors,[],"no uncaught browser errors");
 console.log("BROWSER_AUDIUS_ONLY_STUDIO_PASS",JSON.stringify({
  source:"Audius only",rooms:2,tracks:3,streamRequests,metadataRequests,
  nextRound:2,playedMs:Math.round(heard.playedMs),hostReload:"same track recovered",catalogScan:"9/9",noRepeat:true,mobileOverflow:false,
  removedLegacyUI:true,guestPrivateAnswers:true}));
} finally {console.log("BROWSER_PAGE_ERRORS",JSON.stringify(errors.slice(0,12)));await browser.close();}
