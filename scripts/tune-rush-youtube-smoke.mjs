// Real network integration: YouTube Music URL mode uses a host-visible official player.
// This only verifies private room/answer handling, not YouTube playback or mobile Safari.
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const api="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_v1";
const key="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code=[...randomBytes(6)].map(n=>alphabet[n%alphabet.length]).join("");
const host=randomBytes(32).toString("hex"),first=randomBytes(32).toString("hex"),second=randomBytes(32).toString("hex");
const sha=t=>createHash("sha256").update(t).digest("hex");
async function rpc(action,token,data={}){
 const result=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json","apikey":key},
  signal:AbortSignal.timeout(12000),body:JSON.stringify({
   p_action:action,p_code:code,p_hash:sha(token),p_data:data
  })});
 const json=await result.json();
 if(!result.ok)throw Error(action+": HTTP "+result.status+" "+JSON.stringify(json));
 return json;
}
async function main(){
 const html=readFileSync("music/index.html","utf8"),js=readFileSync("music/app.js","utf8");
 new Script(js,{filename:"music/app.js"});
 for(const id of ["youtube-host","youtube-player","youtube-play-hint","youtube-next-form","youtube-link","youtube-song","youtube-artist"]){
  assert.ok(html.includes('id="'+id+'"'),"missing UI: "+id);
 }
 assert.ok(js.includes("youtubeVideoIsVisible"),"player visibility guard");
 assert.ok(js.includes("https://www.youtube.com/iframe_api"),"official YouTube player");
 assert.ok(!js.includes("youtube-dl")&&!js.includes("yt-dlp"),"no extractor");
 const created=await rpc("create",host);
 assert.equal(created.role,"host");
 await Promise.all([rpc("join",first,{name:"YoutubePlayerOne"}),rpc("join",second,{name:"YoutubePlayerTwo"})]);
 let result=await rpc("start",host,{mode:"youtube",videoId:"M7lc1UVf-VE",song:"Test Music Example",
  artist:"Sample Artist",cueMs:3000});
 assert.equal(result.mode,"youtube");
 assert.equal(result.audio.source,"youtube:M7lc1UVf-VE");
 assert.equal(result.audio.cueMs,3000);
 result=await rpc("state",first);
 assert.equal(result.mode,"youtube");assert.equal(result.audio,null);
 assert.equal(result.title,null);assert.equal(result.artist,null);
 await rpc("play",host);
 await rpc("buzz",first);
 result=await rpc("answer",first,{song:"Test Music Exampel",artist:"wrong"});
 assert.equal(result.phase,"holding");assert.equal(result.title,"Test Music Example");
 await rpc("steal",second);
 result=await rpc("answer",second,{artist:"Sample Artist"});
 assert.equal(result.phase,"solved");assert.equal(result.artist,"Sample Artist");
 result=await rpc("next",host,{videoId:"M7lc1UVf-VE",song:"Round Two",artist:"Another Artist",cueMs:0});
 assert.equal(result.round,2);assert.equal(result.mode,"youtube");
 assert.equal(result.audio.source,"youtube:M7lc1UVf-VE");
 console.log("MUSIC_YOUTUBE_HOST_NETWORK_SMOKE_PASS",JSON.stringify({code,players:2,mode:"youtube",hidden:"yes",typo:"yes",steal:"yes",nextRound:2}));
}
main().catch(e=>{console.error("MUSIC_YOUTUBE_HOST_NETWORK_SMOKE_FAIL",e);process.exitCode=1});
