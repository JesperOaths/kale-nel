import assert from "node:assert/strict";
import {readRotation,emptyRotation,openGame,playedKeys,notePlayed,songFingerprint,
 matchingLocalTracks,readiness,catalogReadiness,THREE_GAME_TARGET} from "../music/game-rotation.js";
import {chooseNextLocalTrack} from "../music/local-tracks.js";
assert.equal(THREE_GAME_TARGET,120);
assert.equal(readRotation("garbage").games.length,0);
assert.equal(readRotation('{"version":2,"games":[]}').games.length,0);
const all=Array.from({length:150},(_,i)=>({
 index:i,artist:"Artist "+i,title:"Track "+i,year:1970+i%10,genres:["pop"],file:{name:"audio-"+i+".wav"}
}));
assert.equal(matchingLocalTracks(all,["pop"],["1970"]).length,150);
const dup=[...all,{...all[0],index:999,file:{name:"other.mp3"}}];
assert.equal(matchingLocalTracks(dup,["pop"],["1970"]).length,150,"same artist/title is one song");
const history=emptyRotation();
const codes=["GME2AA","GME2AB","GME2AC"];
const chosen=[];
for(const code of codes){
 openGame(history,code);
 for(let n=0;n<40;n++){
  const fresh=matchingLocalTracks(all,["pop"],["1970"])
   .filter(x=>!playedKeys(history,"local").has(songFingerprint(x)));
  const next=chooseNextLocalTrack(fresh,["pop"],["1970"],new Set(),()=>0.13);
  const fingerprint=songFingerprint(next);
  assert.ok(!chosen.includes(fingerprint),"a song must not repeat during the first three games");
  chosen.push(fingerprint);
  notePlayed(history,code,"local",fingerprint);
 }
}
assert.equal(chosen.length,120);
assert.equal(playedKeys(history,"local").size,120);
const capacity=readiness(all,playedKeys(history,"local"));
assert.equal(capacity.remaining,30);
assert.equal(capacity.shortfall,90);
assert.equal(capacity.ready,false);
const restored=readRotation(JSON.stringify(history));
assert.equal(playedKeys(restored,"local").size,120,"history must persist across browser reloads");
openGame(restored,"GME2AD");
assert.equal(restored.games.length,3);
assert.equal(playedKeys(restored,"local").size,80,"oldest game history expires after the three-game window");
const tiny=all.slice(0,6),r=readiness(tiny,new Set());
assert.deepEqual([r.total,r.remaining,r.shortfall,r.ready],[6,6,114,false]);
assert.equal(catalogReadiness(6,0).shortfall,114);
assert.equal(catalogReadiness(71,8).remaining,63);
const h2=emptyRotation();openGame(h2,"GME3AA");notePlayed(h2,"GME3AA","catalog","dQw4w9WgXcQ");
assert.deepEqual([...playedKeys(h2,"catalog")],["dQw4w9WgXcQ"]);
assert.equal(playedKeys(h2,"local").size,0);
console.log("THREE_GAME_ROTATION_PASS",JSON.stringify({
 games:3,playedWithoutRepeating:chosen.length,capacityGoal:120,
 sourceSeparation:"yes",rotationPersists:"yes",sparsePoolWarns:"yes",
 songIdentity:"artist+title fingerprint",maxRoundsPerGame:"unlimited"
}));
