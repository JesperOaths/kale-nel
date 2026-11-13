import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {chromium,devices} from "playwright-core";
const chrome=["/usr/bin/google-chrome","/usr/bin/chromium","/usr/bin/chromium-browser"].find(existsSync);
assert.ok(chrome,"Chrome or Chromium is required");
const browser=await chromium.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const BASE=process.env.TUNERUSH_CACHED_BASE||"http://127.0.0.1:8080/music/multi/";
const errors=[];
try{
 const context=await browser.newContext({...devices["iPad Pro 11"],viewport:{width:1194,height:834}});
 const host=await context.newPage();host.on("pageerror",e=>errors.push("host: "+e.message));
 await host.goto(BASE,{waitUntil:"domcontentloaded",timeout:25000});
 await host.locator("#create").waitFor({state:"visible",timeout:15000});
 const bodyBackground=await host.locator("body").evaluate(e=>getComputedStyle(e).backgroundColor);
 assert.equal(bodyBackground,"rgb(16, 19, 15)","multiplayer must use Solo's forest-dark palette");
 assert.ok(await host.locator("#create").isVisible());
 assert.ok(await host.locator("#join-form button[type=submit]").isVisible());
 const home=await host.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(home.scroll<=home.width+2,"home horizontal overflow");
 const sample={code:"ABC234",role:"host",players:[],
   phase:"lobby",me:null,genres:["pop","rock"],decades:[],round:0,step:-1,
   audio:null,title:null,artist:null,firstAnswered:false,lockedPlayer:null,
   titleDone:false,artistDone:false,winner:null};
 await host.evaluate(s=>{access={code:s.code,hash:"a".repeat(64),name:"Host"};state=s;render()},sample);
 assert.ok(await host.locator("#room").isVisible());
 assert.ok(await host.locator("#genres .chip.selected").count()===2);
 assert.equal(await host.locator("#start").isDisabled(),true);
 await host.evaluate(s=>{state={...s,players:[{id:"phone",name:"Phone Tester",score:3.5},{id:"tablet",name:"Tablet Player",score:2.5}]};render()},sample);
 assert.equal(await host.locator("#start").isEnabled(),true);
 assert.equal(await host.locator(".roster-entry").count(),2);
 assert.equal(await host.locator("#roster .points").first().innerText(),"3.5");
 await host.locator("#tablet-toggle").click();
 assert.ok(await host.locator("#tablet-panel").isVisible());
 const frame=await host.locator("#tablet-frame").getAttribute("src");
 assert.equal(new URL(frame).searchParams.get("room"),"ABC234");
 assert.equal(new URL(frame).searchParams.get("tablet"),"1");
 assert.equal(new URL(frame).searchParams.has("hash"),false);
 await host.locator("#tablet-close").click();
 assert.ok(!(await host.locator("#tablet-panel").isVisible()));
 // The actual browser's audio output obeys the shared Solo mixer.
 await host.locator("#volume").evaluate(el=>{el.value="44";el.dispatchEvent(new Event("input",{bubbles:true}))});
 assert.equal(await host.locator("#clip-audio").evaluate(el=>el.volume),0.44);
 assert.equal(await host.evaluate(()=>JSON.parse(localStorage.getItem("tune-rush-host-output-v1")).level),44);
 await host.evaluate(s=>{state={...s,phase:"paused",round:1,step:-1,
   players:[{id:"phone",name:"Phone Tester",score:3.5},{id:"tablet",name:"Tablet Player",score:2.5}]};render()},sample);
 assert.ok(await host.locator("#play").isVisible());
 assert.equal(await host.locator("#song-title").innerText(),"Mystery track");
 await host.evaluate(s=>{state={...s,phase:"playing",round:1,step:0,
   players:[{id:"phone",name:"Phone Tester",score:3.5}]};render()},sample);
 assert.equal(await host.locator("#song-title").innerText(),"Mystery track");
 assert.equal(await host.locator("#clue-levels .current").innerText(),"500ms");
 const phone=await browser.newContext({...devices["iPhone 13"]});
 const guest=await phone.newPage();guest.on("pageerror",e=>errors.push("guest: "+e.message));
 await guest.goto(BASE+"?room=ABC234",{waitUntil:"domcontentloaded",timeout:25000});
 await guest.evaluate(s=>{access={code:s.code,hash:"b".repeat(64),name:"Phone Tester"};
   state={...s,role:"player",me:"phone",phase:"playing",round:1,step:0,
    players:[{id:"phone",name:"Phone Tester",score:0}]};render()},sample);
 assert.ok(await guest.locator("#buzz").isVisible());
 assert.equal(await guest.locator("#host-game-controls").isVisible(),false);
 assert.equal(await guest.locator("#mixer").isVisible(),false);
 const mobile=await guest.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(mobile.scroll<=mobile.width+2,"phone horizontal overflow");
 assert.deepEqual(errors,[],"uncaught browser errors");
 console.log("S21_CACHED_MULTIPLAYER_BROWSER_PASS",JSON.stringify({
  tabletHost:true,tabletGuestPanel:true,phoneGuest:true,soloTheme:true,
  responsive:true,realVolume:true,scoreboard:true,hostSecretsNotInURL:true}));
}finally{await browser.close()}
