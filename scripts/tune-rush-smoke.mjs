// Live integration smoke: three independent guest devices, production demo-only rooms.
// Runs in GitHub Actions on a PR change; does not touch any existing room or other game.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const API="https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_v1";
const KEY="sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
const codeChars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code=[...randomBytes(6)].map(n=>codeChars[n%codeChars.length]).join("");
const host=randomBytes(32).toString("hex"),alice=randomBytes(32).toString("hex"),bob=randomBytes(32).toString("hex");
const hash=token=>createHash("sha256").update(token).digest("hex");
const timeout=ms=>AbortSignal.timeout(ms);
async function request(action,token,extra={}){
 const response=await fetch(API,{
  method:"POST",
  headers:{"Content-Type":"application/json","apikey":KEY,"Origin":"https://kalenel.nl"},
  signal:timeout(12000),
  body:JSON.stringify({p_action:action,p_code:code,p_hash:hash(token),p_data:extra})
 });
 const body=await response.json();
 if(!response.ok)throw Error(action+": "+response.status+": "+body?.message);
 return body;
}
async function main(){
 const pre=await fetch(API,{method:"OPTIONS",headers:{
  Origin:"https://kalenel.nl",
  "Access-Control-Request-Method":"POST",
  "Access-Control-Request-Headers":"apikey,content-type"
 },signal:timeout(12000)});
 assert.ok(pre.ok,"CORS preflight must succeed");
 const hostState=await request("create",host);
 assert.equal(hostState.role,"host");
 await Promise.all([
  request("join",alice,{name:"SmokeAlice"}),
  request("join",bob,{name:"SmokeBob"})
 ]);
 let state=await request("state",alice);
 assert.equal(state.players.length,2);
 assert.equal(state.role,"player");
 await request("start",host);
 state=await request("state",bob);
 assert.equal(state.title,null,"Song title must be hidden from guest");
 assert.equal(state.audio,null,"Audio path must be hidden from guest");
 await request("play",host);
 const outcomes=await Promise.allSettled([request("buzz",alice),request("buzz",bob)]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1,"one first buzzer");
 const first=outcomes[0].status==="fulfilled"?alice:bob;
 const second=first===alice?bob:alice;
 state=await request("answer",first,{song:"really wrong",artist:"really wrong"});
 assert.equal(state.phase,"holding");
 assert.equal(Number(state.players.find(p=>p.id===state.me).score),0,"loss floor at 0");
 await request("steal",second);
 const hostView=await request("state",host);
 const demos={
  "demo:twinkle":["Twinkle Twinkle Little Star","Traditional"],
  "demo:ode":["Ode to Joy","Ludwig van Beethoven"],
  "demo:jacques":["Frère Jacques","Traditional"],
  "demo:elise":["Für Elise","Ludwig van Beethoven"],
  "demo:greensleeves":["Greensleeves","Traditional"]
 };
 const track=demos[hostView.audio?.source];
 assert.ok(track,"Only approved public-domain demo audio must be used");
 const typo=track[0].slice(0,-1);
 state=await request("answer",second,{song:typo,artist:track[1]});
 assert.equal(state.phase,"solved","a small typo should be accepted");
 assert.equal(state.title,track[0]);
 assert.equal(state.artist,track[1]);
 await request("next",host);
 state=await request("state",alice);
 assert.equal(state.round,2,"next round should start");
 console.log("MUSIC_LIVE_THREE_CLIENT_SMOKE_PASS",JSON.stringify({
  room:code,players:state.players.length,round:state.round,
  buzzer:"exclusive",steal:"complete",typo:"accepted",floor:"0"
 }));
}
main().catch(e=>{console.error("MUSIC_LIVE_THREE_CLIENT_SMOKE_FAIL",e);process.exitCode=1});
