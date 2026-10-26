import assert from "node:assert/strict";
import {readRotation,emptyRotation,openGame,playedKeys,notePlayed,catalogReadiness,THREE_GAME_TARGET} from "../music/game-rotation.js";
import {chooseAudiusTrack} from "../music/audius-stream.js";

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
console.log("THREE_GAME_ROTATION_PASS",JSON.stringify({
 source:"Audius HTTPS",games:3,playedWithoutRepeating:selected.length,
 capacityGoal:THREE_GAME_TARGET,remaining:capacity.remaining,
 rotationPersists:true,legacyHistoryCompatible:true}));
