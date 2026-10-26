import assert from "node:assert/strict";
import {readRotation,emptyRotation,openGame,playedKeys,notePlayed,catalogReadiness,audiusReadiness,audiusIdentity,audiusFreshTracks,noteAudiusPlayed,THREE_GAME_TARGET} from "../music/game-rotation.js";
import {chooseAudiusTrack,discoverAudiusTracks} from "../music/audius-stream.js";

assert.equal(THREE_GAME_TARGET,120);
assert.equal(readRotation("garbage").games.length,0);
assert.equal(readRotation('{"version":2,"games":[]}').games.length,0);

const catalog=Array.from({length:150},(_,i)=>({id:"audTrack"+String(i).padStart(4,"0")}));
const history=emptyRotation();
const codes=["GME2AA","GME2AB","GME2AC"];
const selected=[];
for(const code of codes){
 openGame(history,code);
 for(let i=0;i<40;i++){
  const next=chooseAudiusTrack(catalog,playedKeys(history,"audius"),()=>0.13);
  assert.ok(!selected.includes(next.id),"Audius track repeated during the first three games");
  selected.push(next.id);
  notePlayed(history,code,"audius",next.id);
 }
}
assert.equal(selected.length,120);
assert.equal(playedKeys(history,"audius").size,120);
const capacity=catalogReadiness(catalog.length,playedKeys(history,"audius").size);
assert.deepEqual([capacity.total,capacity.remaining,capacity.shortfall,capacity.ready],[150,30,90,false]);
// A different genre/decade mix must count only the tracks heard from THAT
// filtered pool; global history may include many unrelated songs.
const mixedPool=[{id:"audiusA1"},{id:"audiusB2"},{id:"audiusB2"},{id:"audiusC3"}];
const mixStats=audiusReadiness(mixedPool,new Set(["audiusA1","elsewhere9"]));
assert.deepEqual([mixStats.total,mixStats.used,mixStats.remaining,mixStats.shortfall,
 mixStats.expectedGames],[3,1,2,118,0],"only overlapping played IDs count");
assert.equal(audiusReadiness(mixedPool,new Set()).remaining,3);
assert.equal(audiusReadiness(Array.from({length:130},(_,i)=>"music"+String(i).padStart(5,"0")),
 new Set()).ready,true);
assert.equal(audiusReadiness([],new Set()).remaining,0);
assert.equal(audiusReadiness(["not valid","validID1","validID1"],new Set()).total,1);
// Multiple Audius uploads of the same artist/title must count as one song.
const crossUploads=[
 {id:"variantA1",artist:"Beyoncé",title:"Halo"},
 {id:"variantB2",artist:"BEYONCE",title:"HALO!"},
 {id:"variantC3",artist:"Beyoncé",title:"Halo (Live)"},
 {id:"variantD4",artist:"Another Artist",title:"Halo"},
 {id:"variantA1",artist:"Beyoncé",title:"Halo"}
];
assert.equal(audiusIdentity(crossUploads[0]),audiusIdentity(crossUploads[1]),
 "case, accents and punctuation cannot evade song identity");
assert.notEqual(audiusIdentity(crossUploads[0]),audiusIdentity(crossUploads[2]),
 "a differently titled live version may still be selected");
assert.notEqual(audiusIdentity(crossUploads[0]),audiusIdentity(crossUploads[3]),
 "different artists remain separate");
const deduped=audiusFreshTracks(crossUploads,new Set());
assert.deepEqual(deduped.map(t=>t.id),["variantA1","variantC3","variantD4"]);
let uniqueCount=audiusReadiness(crossUploads,new Set());
assert.deepEqual([uniqueCount.total,uniqueCount.used,uniqueCount.remaining],[3,0,3]);
const sameSongHistory=emptyRotation();
noteAudiusPlayed(sameSongHistory,"GME2AB",crossUploads[0]);
const fingerprints=playedKeys(sameSongHistory,"audiusFingerprints");
assert.equal(fingerprints.size,1);
assert.match([...fingerprints][0],/^[a-f0-9]{16}$/);
assert.equal(JSON.stringify(sameSongHistory).includes("Halo"),false,
 "the local history may contain song fingerprints but no song names");
const candidates=audiusFreshTracks(crossUploads,new Set(),fingerprints);
assert.deepEqual(candidates.map(t=>t.id),["variantC3","variantD4"]);
uniqueCount=audiusReadiness(crossUploads,new Set(),120,fingerprints);
assert.deepEqual([uniqueCount.total,uniqueCount.used,uniqueCount.remaining,uniqueCount.shortfall],
 [3,1,2,118],"re-upload from a past game is not fresh");
const legacyIdOnly=audiusReadiness(crossUploads,new Set(["variantB2"]));
assert.equal(legacyIdOnly.remaining,2,"old ID-only history also blocks the matching artist/title group");
const roundTripped=readRotation(JSON.stringify(sameSongHistory));
assert.equal(playedKeys(roundTripped,"audiusFingerprints").size,1);
openGame(roundTripped,"GME2AC");
openGame(roundTripped,"GME2AD");
openGame(roundTripped,"GME2AE");
assert.equal(playedKeys(roundTripped,"audiusFingerprints").size,0,
 "fingerprints rotate out with the oldest of three games");
assert.throws(()=>notePlayed(roundTripped,"GME2AE","audiusFingerprints","Beyonce - Halo"),/Invalid song identifier/);
const restored=readRotation(JSON.stringify(history));
assert.equal(playedKeys(restored,"audius").size,120,"Audius history must persist after reload");
openGame(restored,"GME2AD");
assert.equal(restored.games.length,3);
assert.equal(playedKeys(restored,"audius").size,80,"oldest game expires after three-game window");
const tiny=catalogReadiness(6,0);
assert.deepEqual([tiny.total,tiny.remaining,tiny.shortfall,tiny.ready],[6,6,114,false]);
assert.equal(catalogReadiness(71,8).remaining,63);
const old=readRotation('{"version":1,"games":[{"code":"ABCDEF","local":[],"catalog":[]}]}');
notePlayed(old,"ABCDEF","audius","yyR1OZE");
assert.ok(playedKeys(old,"audius").has("yyR1OZE"),"old browser history migrates safely");
assert.throws(()=>notePlayed(history,"GME2AC","audius","../attack"),/Invalid song identifier/);
// Provider requests must inherit the host's cancellation signal, not only
// the per-page 8.5s timeout. An abandoned filter scan should stop immediately.
{
 const controller=new AbortController();
 let pageRequests=0,requestSignal=null;
 const heldFetch=(_url,{signal})=>{
  pageRequests++;requestSignal=signal;
  return new Promise((_resolve,reject)=>{
   if(signal.aborted)reject(Error("Request aborted"));
   else signal.addEventListener("abort",()=>reject(Error("Request aborted")),{once:true});
  });
 };
 const pending=discoverAudiusTracks(["pop"],[],heldFetch,{signal:controller.signal});
 assert.equal(pageRequests,1);
 assert.equal(requestSignal.aborted,false);
 controller.abort();
 assert.equal(requestSignal.aborted,true,"host abort must reach provider fetch");
 await assert.rejects(pending,/Audius scan cancelled/);
 assert.equal(pageRequests,1,"aborted scan must not request the next catalog page");
}
console.log("THREE_GAME_ROTATION_PASS",JSON.stringify({
 source:"Audius HTTPS",games:3,playedWithoutRepeating:selected.length,
 capacityGoal:THREE_GAME_TARGET,remaining:capacity.remaining,
 rotationPersists:true,legacyHistoryCompatible:true,uploadIdentityDedup:true}));
