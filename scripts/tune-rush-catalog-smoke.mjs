// Production REST acceptance: 3 browser-independent clients, genre X decade, private answers,
// server-generated random 20-second-safe cue, no early repeats, and no fixed round count.
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
const api="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_v1";
const apikey="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code=[...randomBytes(6)].map(n=>alphabet[n%alphabet.length]).join("");
const secret=()=>randomBytes(32).toString("hex"),host=secret(),alice=secret(),bob=secret();
const sha=t=>createHash("sha256").update(t).digest("hex");
async function call(op,t,data={}){
 const resp=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json","apikey":apikey},
  body:JSON.stringify({p_action:op,p_code:code,p_hash:sha(t),p_data:data}),signal:AbortSignal.timeout(12000)});
 const json=await resp.json();
 if(!resp.ok)throw Error(op+" HTTP "+resp.status+" "+JSON.stringify(json));
 return json;
}
const assertFiltered70s=new Set(["xFrGuyw1V8s","unfzfe8f9NI","fNFzfwLM72c","WGU_4-5RaxU","aQUlA8Hcv4s","16y1AkoZkmQ"]);
async function main(){
 await call("create",host);
 await Promise.all([call("join",alice,{name:"PoolAlice"}),call("join",bob,{name:"PoolBob"})]);
 let v=await call("settings",host,{genres:["pop"],decades:["1970"]});
 assert.deepEqual(v.decades,["1970"]);
 v=await call("start",host,{mode:"catalog"});
 assert.equal(v.mode,"catalog");
 assert.ok(v.audio?.source?.startsWith("youtube:"));
 const first=v.audio.source.slice(8);
 assert.ok(assertFiltered70s.has(first),"1970s pop source required, got "+first);
 const guest=await call("state",alice);
 assert.equal(guest.mode,"catalog");assert.deepEqual(guest.decades,["1970"]);
 assert.equal(guest.audio,null);assert.equal(guest.title,null);assert.equal(guest.artist,null);
 v=await call("random_cue",host,{durationMs:180000});
 assert.ok(v.audio.cueMs>=10000&&v.audio.cueMs<159000,"20s must fit within video");
 await call("play",host);
 await call("buzz",alice);
 v=await call("answer",alice,{song:"Wrong",artist:"Wrong"});
 assert.equal(v.phase,"holding");
 await call("steal",bob);
 const hostState=await call("state",host);
 assert.ok(hostState.audio?.source?.startsWith("youtube:"),"host retains private video during steal");
 // End the steal without leaking anything else to the guest until next round.
 await call("forfeit",bob);
 await call("skip",host);
 v=await call("next",host);
 assert.equal(v.round,2);
 assert.notEqual(v.audio.source.slice(8),first,"avoid repeats until pool exhausted");
 for(let i=0;i<5;i++){
  await call("skip",host);
  v=await call("next",host);
 }
 assert.equal(v.round,7,"game should continue beyond matching catalog size");
 console.log("MUSIC_GENRE_DECADE_CATALOG_PASS",JSON.stringify({
  room:code,decade:"1970",genre:"pop",players:2,rounds:7,
  privateAnswers:"yes",randomCue:"duration safe",unlimitedRounds:"yes"
 }));
}
main().catch(e=>{console.error("MUSIC_GENRE_DECADE_CATALOG_FAIL",e);process.exitCode=1});
