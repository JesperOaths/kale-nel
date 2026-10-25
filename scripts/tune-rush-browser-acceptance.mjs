// Real headless Chromium acceptance of the PUBLIC Tune Rush site and LIVE Supabase.
// One tablet-sized host plus two separate phone-sized browser contexts.
// Does not claim physical iPad/phone or audible speaker verification.
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {chromium,devices} from "playwright-core";

const BASE=process.env.TUNE_RUSH_BASE||"https://kalenel.nl/music/?browser_qa=20261025";
const demos={
 "demo:twinkle":["Twinkle Twinkle Little Star","Traditional"],
 "demo:ode":["Ode to Joy","Ludwig van Beethoven"],
 "demo:jacques":["Frère Jacques","Traditional"],
 "demo:elise":["Für Elise","Ludwig van Beethoven"],
 "demo:greensleeves":["Greensleeves","Traditional"]
};
const chrome=[process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser"].find(p=>p&&existsSync(p));
if(!chrome)throw Error("No Chrome/Chromium found on the CI runner.");
const errors=[];
const browser=await chromium.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const pad=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834},ignoreHTTPSErrors:false});
const phone1=await browser.newContext({...devices["iPhone 13"]});
const phone2=await browser.newContext({...devices["Pixel 7"]});
async function page(ctx,label){
 const p=await ctx.newPage();
 p.on("pageerror",e=>errors.push(label+": "+e.message));
 await p.goto(BASE,{waitUntil:"domcontentloaded",timeout:25000});
 await p.locator("#welcome").waitFor({state:"visible",timeout:12000});
 return p;
}
const wait=(page,fn,timeout=17000)=>page.waitForFunction(fn,null,{timeout});
const state=page=>page.evaluate(()=>({
 code:room?.code,phase:room?.phase,step:room?.step,round:room?.round,mode:room?.mode,
 players:room?.players,audio:room?.audio, title:room?.title, artist:room?.artist,
 role:room?.role,me:room?.me,blocked:room?.myBlockedStep
}));
const playerScore=(r,name)=>Number(r.players.find(p=>p.name===name)?.score);
async function join(p,code,name){
 await p.locator("#join-code").fill(code);
 await p.locator("#nickname").fill(name);
 await p.locator("#join-form button[type=submit]").click();
 try{await wait(p,()=>room?.role==="player")}
 catch(e){
  const diagnosis=await p.evaluate(()=>({
   toast:document.querySelector("#toast")?.textContent||"",
   joinCode:document.querySelector("#join-code")?.value||"",
   hasRoom:Boolean(room),role:room?.role||null,
   formVisible:!document.querySelector("#join-form")?.hidden,
   pending:loading
  }));
  console.error("BROWSER_JOIN_DIAGNOSTIC",JSON.stringify({name,code,...diagnosis}));
  throw e;
 }
}
async function createGame(host){
 await host.locator("#create").click();
 await wait(host,()=>room?.role==="host"&&room.code?.length===6);
 return (await state(host));
}
async function waitBuzz(p,host=null){
 try{
  await wait(p,()=>{const b=document.querySelector("#buzz");return b&&!b.hidden&&!b.disabled},22000);
 }catch(e){
  const details=await p.evaluate(()=>({phase:room?.phase,step:room?.step,round:room?.round,mode:room?.mode,
   firstAnswered:room?.firstAnswered,blockedStep:room?.myBlockedStep,buttonDisabled:document.getElementById("buzz")?.disabled,
   toast:document.getElementById("toast")?.textContent||"",loading,pollBusy}));
  const hostState=host?await host.evaluate(()=>({phase:room?.phase,step:room?.step,round:room?.round,mode:room?.mode,
   loading,clipTimer:clipTimer!==null,nextTimer:nextTimer!==null,ctxState:ctx?.state||"none",
   toast:document.getElementById("toast")?.textContent||""})):null;
  console.error("BROWSER_BUZZ_NOT_READY",JSON.stringify({details,hostState}));
  throw e;
 }
}
try {
 if(process.env.TUNE_RUSH_YOUTUBE_ONLY!=="1"){
 const host=await page(pad,"demo-host"),alice=await page(phone1,"demo-alice"),bob=await page(phone2,"demo-bob");
 const initial=await createGame(host);
 assert.ok(await host.locator("#room").evaluate(el=>el.classList.contains("host-mode")),"tablet host uses immersive studio theme");
 await host.locator(".lobby-caption").waitFor({state:"visible"});
 assert.ok(await host.locator("#host-fullscreen").isVisible(),"tablet host has working fullscreen control");
 assert.equal(await host.locator(".source-select label:visible").count(),4,"all four music sources are visible");
 assert.equal(await host.locator("#deezer-source-option").isVisible(),true,"Deezer is visibly listed rather than hidden");
 assert.ok(await host.locator('#deezer-source-option input[type=radio]').isDisabled(),"Deezer cannot be selected without server approval");
 assert.ok((await host.locator("#deezer-license-status").innerText()).includes("not authorized"),"explicit Deezer approval status must be readable");
 const lobbyUI=await host.evaluate(()=>{
   const cards=[...document.querySelectorAll(".source-select .source-card")].map(c=>{
     const b=c.getBoundingClientRect();
     return {title:c.querySelector(".source-copy strong")?.textContent,w:b.width,h:b.height,x:b.x,y:b.y}
   });
   const box=document.getElementById("lobby")?.getBoundingClientRect();
   return {cards,lobbyWidth:box?.width,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
 });
 assert.equal(lobbyUI.cards.length,4);
 assert.ok(lobbyUI.cards.every(c=>c.w>220&&c.h>145),"music cards must remain readable at tablet size: "+JSON.stringify(lobbyUI));
 assert.ok(Math.abs(lobbyUI.cards[0].y-lobbyUI.cards[1].y)<3&&lobbyUI.cards[2].y>lobbyUI.cards[0].y,
   "music sources should form an ordered 2x2 desktop grid");
 assert.ok(lobbyUI.scrollWidth<=lobbyUI.viewport+2,"host lobby must not overflow horizontally");
 console.log("BROWSER_LOBBY_V9_PASS",JSON.stringify({cards:4,deezer:"visible but unavailable",grid:"2x2",viewport:lobbyUI.viewport}));
 assert.ok(!(await alice.locator(".host-stage-hero").isVisible()),"welcome phone never shows host stage");
 await join(alice,initial.code,"QAlice");
 await join(bob,initial.code,"QBob");
 await wait(host,()=>room?.players.length===2);
 assert.ok((await host.locator("#lobby-players").innerText()).includes("QBob"));
 await host.locator("#start").click();
 await wait(host,()=>room?.round===1&&room?.phase!=="lobby");
 await host.locator(".host-stage-hero").waitFor({state:"visible"});
 assert.ok(await host.locator(".disc-core").isVisible(),"mystery cover on tablet");
 assert.equal(await host.locator(".sound-bars i").count(),21,"21 decorative waveform bars");
 assert.ok(await host.locator("#host-track-context").isVisible(),"host audio source context readable");
 assert.ok(await host.locator(".score-panel").isVisible(),"host scoreboard visible");
 await wait(alice,()=>room?.phase!=="lobby"&&room?.round===1);
 assert.ok(await alice.locator(".mobile-disc-icon").isVisible(),"old player phone disc preserved");
 assert.ok(!(await alice.locator(".disc-art-top").isVisible()),"mystery studio graphics not shown on phone");
 const geometry=await host.evaluate(()=>({vw:innerWidth,scroll:document.documentElement.scrollWidth,track:document.getElementById("host-track-context")?.textContent||""}));
 assert.ok(geometry.scroll<=geometry.vw+2,"tablet page must not overflow horizontally: "+JSON.stringify(geometry));
 console.log("BROWSER_HOST_STUDIO_LAYOUT_PASS",JSON.stringify({viewport:geometry.vw,waveBars:21,scoreboard:"visible",playerTheme:"preserved"}));
 await waitBuzz(alice,host);
 await alice.locator("#buzz").click();
 await wait(alice,()=>room?.phase==="answering"&&room.lockedPlayer===room.me);
 await alice.locator("#answer-overlay").waitFor({state:"visible"});
 await alice.locator("#song-guess").fill("Definitely Incorrect");
 await alice.locator("#artist-guess").fill("Absolutely Incorrect");
 await alice.locator("#answer-form button[type=submit]").click();
 await wait(bob,()=>room?.phase==="holding");
 assert.equal(playerScore(await state(alice),"QAlice"),0,"wrong answers cannot give negative scores");
 await bob.locator("#steal").click();
 await wait(bob,()=>room?.phase==="answering"&&room.stealTurn);
 const d=demos[(await state(host)).audio?.source];
 assert.ok(d,"host should have one of five demo songs");
 await bob.locator("#song-guess").fill(d[0]);
 await bob.locator("#artist-guess").fill(d[1]);
 await bob.locator("#answer-form button[type=submit]").click();
 await wait(host,()=>room?.phase==="solved");
 assert.equal(playerScore(await state(bob),"QBob"),1,"steal should grant two half-points");
 assert.ok((await host.locator("#scores").innerText()).includes("QBob"),"host scoreboard shows both players");
 console.log("BROWSER_DEMO_ROUND1_PASS",JSON.stringify({code:initial.code,round:1,aliceScore:0,bobScore:1}));

 await host.locator("#next-round").click();
 await wait(host,()=>room?.round===2);
 await waitBuzz(alice);
 await alice.locator("#buzz").click();
 await wait(alice,()=>room?.phase==="answering"&&room.lockedPlayer===room.me);
 const d2=demos[(await state(host)).audio?.source];
 assert.ok(d2,"new round demo sound source");
 await alice.locator("#song-guess").fill(d2[0]);
 await alice.locator("#artist-guess").fill("");
 await alice.locator("#answer-form button[type=submit]").click();
 await wait(bob,()=>room?.phase==="holding"&&room.titleDone&&!room.artistDone);
 assert.equal(playerScore(await state(alice),"QAlice"),0.5,"partial correct answer grants half point");
 await bob.locator("#steal").click();
 await wait(bob,()=>room?.phase==="answering"&&room.stealTurn);
 await bob.locator("#artist-guess").fill("Incorrect Steal");
 await bob.locator("#answer-form button[type=submit]").click();
 await wait(bob,()=>room?.phase==="holding"&&Number(room.players.find(p=>p.name==="QBob")?.score)===0);
 await wait(host,()=>room?.phase==="holding"&&Number(room.players.find(p=>p.name==="QBob")?.score)===0);
 assert.equal(playerScore(await state(host),"QBob"),0,"steal wrong artist reduces 1 point, floor zero");
 await host.locator("#continue-hints").click();
 await wait(host,()=>room?.step>=1&&room?.phase!=="holding",7500);
 console.log("BROWSER_DEMO_ROUND2_CONTINUE_PASS",JSON.stringify({aliceScore:0.5,bobScore:0,step:(await state(host)).step}));

 }
 // Browser verify automatic library filtering, quick skip and automatic next song.
 const catalogCtx=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const catalogGuestCtx=await browser.newContext({...devices["iPhone 13"]});
 const catalogHost=await page(catalogCtx,"catalog-host"),catalogGuest=await page(catalogGuestCtx,"catalog-guest");
 const cr=await createGame(catalogHost);
 await join(catalogGuest,cr.code,"CatalogPlayer");
 await catalogHost.locator('input[name="music-source"][value="catalog"]').check();
 await catalogHost.locator("#catalog-settings").waitFor({state:"visible"});
 assert.ok((await catalogHost.locator(".lobby-caption").isVisible()),"catalog host setup uses tablet studio");
 assert.ok(!(await catalogGuest.locator(".lobby-caption").isVisible()),"player never sees host studio setup");
 await catalogHost.locator("#genre-options input[value=rock]").uncheck();
 await catalogHost.locator("#decade-options input[value='1970']").check();
 await catalogHost.locator("#start").click();
 await wait(catalogHost,()=>room?.mode==="catalog"&&room.round===1);
 await catalogHost.waitForTimeout(1200);
 assert.equal((await state(catalogHost)).step,-1,"catalog must wait for the host's Play tap");
 const firstVideo=(await state(catalogHost)).audio.source;
 assert.equal((await state(catalogGuest)).audio,null,"guest cannot read video ID in catalog mode");
 assert.equal((await state(catalogGuest)).title,null,"guest cannot read catalog answer");
 assert.ok(await catalogHost.locator("#skip-round").isVisible(),"host can skip embedding failure on first hint");
 await catalogHost.locator("#skip-round").click();
 await wait(catalogHost,()=>room?.phase==="solved");
 await catalogHost.locator("#next-round").click();
 await wait(catalogHost,()=>room?.round===2);
 assert.notEqual((await state(catalogHost)).audio.source,firstVideo,"catalog should not repeat before pool exhausted");
 console.log("BROWSER_CATALOG_FILTERS_PASS",JSON.stringify({mode:"catalog",decade:"1970",genre:"pop",round:2}));

 // Functional LOCAL AUDIO mode: WAV File objects stay in the host browser.
 const makeWav=(hz,seconds=35)=>{
  const rate=8000,samples=rate*seconds,out=Buffer.alloc(44+samples*2);
  out.write("RIFF",0);out.writeUInt32LE(out.length-8,4);out.write("WAVEfmt ",8);
  out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);
  out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);
  out.write("data",36);out.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)out.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*hz/rate)*700),44+2*i);
  return out;
 };
 const localCtx=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const localGuestCtx=await browser.newContext({...devices["iPhone 13"]});
 const lh=await page(localCtx,"local-host"),lg=await page(localGuestCtx,"local-guest");
 const localGame=await createGame(lh);
 await join(lg,localGame.code,"LocalPlayer");
 await lh.locator('input[name="music-source"][value="local"]').check();
 await lh.locator("#local-settings").waitFor({state:"visible"});
 await lh.locator("#local-music-files").setInputFiles([
  {name:"ABBA - Dancing Queen.wav",mimeType:"audio/wav",buffer:makeWav(440)},
  {name:"Queen - Bohemian Rhapsody.wav",mimeType:"audio/wav",buffer:makeWav(520)}
 ]);
 await wait(lh,()=>localTracks.length===2&&!localImporting,15000);
 assert.ok(await lh.locator("#local-review").isVisible(),"local metadata editor is visible");
 const rows=lh.locator(".local-track-row");
 for(let i=0;i<2;i++){
  await rows.nth(i).locator("input").nth(2).fill("pop");
  await rows.nth(i).locator("input").nth(2).press("Tab");
  await rows.nth(i).locator("input").nth(3).fill("1975");
  await rows.nth(i).locator("input").nth(3).press("Tab");
 }
 await lh.locator("#decade-options input[value='1970']").check();
 assert.ok((await lh.locator("#local-music-count").innerText()).includes("2 match"));
 await lh.locator("#start").click();
 await wait(lh,()=>room?.mode==="local"&&room?.round===1,17000);
 const firstLocal=await state(lh);
 assert.match(firstLocal.audio?.source||"",/^local:\d+$/);
 assert.equal((await state(lg)).audio,null,"guest cannot see local host audio index or cue");
 assert.equal((await state(lg)).title,null,"guest cannot see the local title");
 assert.ok(await lh.locator("#local-play-hint").isVisible(),"host local play button available");
 assert.ok((await lh.locator("#licensed-player").getAttribute("src")||"").startsWith("blob:"),
  "host audio file plays directly from browser-created object URL");
 await lh.locator("#local-play-hint").click();
 await wait(lh,()=>room?.step===0&&room?.phase==="paused",17000);
 await lh.locator("#skip-round").click();
 await wait(lh,()=>room?.phase==="solved");
 await lh.locator("#next-round").click();
 await wait(lh,()=>room?.round===2&&room?.mode==="local",17000);
 assert.notEqual((await state(lh)).audio.source,firstLocal.audio.source,"local tracks don't repeat before exhaustion");
 console.log("BROWSER_LOCAL_FILES_PASS",JSON.stringify({round:2,source:"host-only WAV blobs",
  uploadedRecordingBytes:0,metadata:"editable",cue:"random middle",guestAudio:"hidden",nextSong:"different"}));

 // Separate YouTube mode host + two independent phone-browser sessions.
 const yHostCtx=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const yAContext=await browser.newContext({...devices["iPhone 13"]});
 const yBContext=await browser.newContext({...devices["Pixel 7"]});
 const yh=await page(yHostCtx,"youtube-host"),ya=await page(yAContext,"youtube-a"),yb=await page(yBContext,"youtube-b");
 const ytRequestsFailed=[],ytConsoleErrors=[];
 yh.on("requestfailed",req=>{if(/youtube|googlevideo|ytimg|gstatic/i.test(req.url()))ytRequestsFailed.push([req.url().slice(0,170),req.failure()?.errorText])});
 yh.on("console",msg=>{if(msg.type()==="error")ytConsoleErrors.push(msg.text().slice(0,200))});
 const youtube=await createGame(yh);
 await join(ya,youtube.code,"YouA");
 await join(yb,youtube.code,"YouB");
 await yh.locator('input[name="music-source"][value="youtube"]').check();
 await yh.locator("#youtube-setup").waitFor({state:"visible"});
 await yh.locator("#youtube-link").fill("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
 await yh.locator("#youtube-song").fill("Never Gonna Give You Up");
 await yh.locator("#youtube-artist").fill("Rick Astley");
 await yh.locator("#youtube-cue").fill("0");
 await yh.locator("#start").click();
 await wait(yh,()=>room?.round===1&&room.mode==="youtube");
 assert.equal((await state(ya)).audio,null,"player cannot see host YouTube URL");
 await yh.locator("#youtube-host").waitFor({state:"visible"});
 try {
  await wait(yh,()=>document.querySelector("iframe#youtube-player, #youtube-player iframe")!==null,24000);
 } catch(e) {
  const diagnostics=await yh.evaluate(()=>({
   iframeCount:document.querySelectorAll("#youtube-player iframe").length,
   ytType:typeof window.YT,playerType:typeof window.YT?.Player,
   apiReadyCallback:typeof window.onYouTubeIframeAPIReady,
   ytScripts:[...document.scripts].filter(x=>/youtube/i.test(x.src)).map(x=>x.src),
   playerHost:document.getElementById("youtube-player")?.outerHTML.slice(0,800),
   toast:document.getElementById("toast")?.textContent,
   iframeError:typeof ytReadyPromise==="object"
  }));
  console.error("BROWSER_YOUTUBE_EMBED_DIAGNOSTIC",JSON.stringify({...diagnostics,ytRequestsFailed:ytRequestsFailed.slice(0,10),ytConsoleErrors:ytConsoleErrors.slice(0,10)}));
  throw e;
 }
 const frame=await yh.locator("iframe#youtube-player, #youtube-player iframe").first().getAttribute("src");
 assert.ok(frame?.includes("youtube.com/embed/"),"official YouTube iframe visible");
 assert.ok((await yh.locator("#youtube-host").isVisible()),"host frame must remain visible");
 assert.ok(!(await ya.locator("#youtube-host").isVisible()),"player must not see host player");
 console.log("BROWSER_YOUTUBE_HOST_IFRAME_PASS",JSON.stringify({code:youtube.code,iframe:frame?.split("?")[0]}));

 // A loaded iframe is not playback proof. Verify time advancement and clue pause,
 // and distinguish provider restrictions from an actual successful video test.
 await yh.locator("#youtube-play-hint").scrollIntoViewIfNeeded();
 await yh.locator("#youtube-play-hint").click();
 await wait(yh,()=>ytError||(!loading&&room.step>=0&&room.phase==="paused"),22000);
 const yPlayback=await yh.evaluate(()=>({
  step:room.step,phase:room.phase,playerState:ytPlayer?.getPlayerState?.()??null,
  currentTime:ytPlayer?.getCurrentTime?.()??0,
  iframe:!!document.querySelector("iframe#youtube-player, #youtube-player iframe"),
  error:ytError?.message||null,status:document.querySelector("#youtube-status")?.textContent||""
 }));
 const playbackPassed=!yPlayback.error&&yPlayback.currentTime>=0.1&&yPlayback.playerState===2;
 console.log(playbackPassed?"BROWSER_YOUTUBE_PLAYBACK_PASS":"BROWSER_YOUTUBE_PLAYBACK_NOT_VERIFIED",JSON.stringify(yPlayback));
 if(process.env.TUNE_RUSH_REQUIRE_YOUTUBE_PLAYBACK==="1")assert.ok(playbackPassed,"YouTube must advance and pause; iframe creation alone cannot pass");
 assert.deepEqual(errors,[],"no browser JavaScript exceptions");
 console.log("BROWSER_GAMEPLAY_PASS",JSON.stringify({demo:process.env.TUNE_RUSH_YOUTUBE_ONLY==="1"?"skipped":"2 rounds",steal:process.env.TUNE_RUSH_YOUTUBE_ONLY==="1"?"skipped":"plus and minus",youtubePlayback:playbackPassed?"passed":"NOT VERIFIED",browserContexts:8}));
} finally {
 console.log("BROWSER_PAGE_ERRORS",JSON.stringify(errors.slice(0,12)));
 await browser.close();
}
