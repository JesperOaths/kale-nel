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
const browser=await chromium.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"]});
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
 await wait(p,()=>room?.role==="player");
}
async function createGame(host){
 await host.locator("#create").click();
 await wait(host,()=>room?.role==="host"&&room.code?.length===6);
 return (await state(host));
}
async function waitBuzz(p){
 await wait(p,()=>{const b=document.querySelector("#buzz");return b&&!b.hidden&&!b.disabled},22000);
}
try {
 if(process.env.TUNE_RUSH_YOUTUBE_ONLY!=="1"){
 const host=await page(pad,"demo-host"),alice=await page(phone1,"demo-alice"),bob=await page(phone2,"demo-bob");
 const initial=await createGame(host);
 await Promise.all([join(alice,initial.code,"QAlice"),join(bob,initial.code,"QBob")]);
 await wait(host,()=>room?.players.length===2);
 assert.ok((await host.locator("#lobby-players").innerText()).includes("QBob"));
 await host.locator("#start").click();
 await wait(host,()=>room?.round===1&&room?.phase!=="lobby");
 await waitBuzz(alice);
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
 // Separate YouTube mode host + two independent phone-browser sessions.
 const yHostCtx=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const yAContext=await browser.newContext({...devices["iPhone 13"]});
 const yBContext=await browser.newContext({...devices["Pixel 7"]});
 const yh=await page(yHostCtx,"youtube-host"),ya=await page(yAContext,"youtube-a"),yb=await page(yBContext,"youtube-b");
 const ytRequestsFailed=[],ytConsoleErrors=[];
 yh.on("requestfailed",req=>{if(/youtube|googlevideo|ytimg|gstatic/i.test(req.url()))ytRequestsFailed.push([req.url().slice(0,170),req.failure()?.errorText])});
 yh.on("console",msg=>{if(msg.type()==="error")ytConsoleErrors.push(msg.text().slice(0,200))});
 const youtube=await createGame(yh);
 await Promise.all([join(ya,youtube.code,"YouA"),join(yb,youtube.code,"YouB")]);
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

 // Attempt actual YouTube playback; external ads, embed restrictions and bot checks
 // can prevent starting a video, so log precisely rather than claiming sound works.
 await yh.locator("#youtube-play-hint").click();
 await yh.waitForTimeout(2200);
 const yPlayback=await yh.evaluate(()=>({
  step:room.step,phase:room.phase,playerState:ytPlayer?.getPlayerState?.()??null,
  iframe:!!document.querySelector("#youtube-player iframe"),
  toast:document.querySelector("#toast")?.textContent||""
 }));
 console.log("BROWSER_YOUTUBE_PLAYBACK_OBSERVATION",JSON.stringify(yPlayback));
 console.log("BROWSER_TEST_PASS",JSON.stringify({demo:"2 rounds",steal:"plus and minus",youtubeIframe:"loaded",browserContexts:6}));
} finally {
 console.log("BROWSER_PAGE_ERRORS",JSON.stringify(errors.slice(0,12)));
 await browser.close();
}
