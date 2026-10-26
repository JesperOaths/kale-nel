/** Run with: node --test music/tests/audius-rotation.test.mjs (Node 20+) */
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Load browser ESM without changing the repository's package.json/module type.
async function browserModule(filename){
 const bytes=await readFile(new URL("../"+filename,import.meta.url));
 return import("data:text/javascript;base64,"+bytes.toString("base64"));
}
const rotation=await browserModule("game-rotation.js");
const audius=await browserModule("audius-stream.js");
const example={id:"yyR1OZE",title:"Housewife (Chris Bessy Remix)",
 user:{name:"Chris Bessy"},permalink:"/chrisbessy/housewife-chris-bessy-remix",
 duration:232,genre:"Pop",release_date:"2026-10-22T18:43:58Z",
 is_streamable:true,is_unlisted:false,is_delete:false};

test("Audius selections persist across filter changes and de-duplicate within a room",()=>{
 const h=rotation.emptyRotation();
 rotation.notePlayed(h,"ABCDEF","audius","yyR1OZE");
 rotation.notePlayed(h,"ABCDEF","audius","yyR1OZE");
 rotation.notePlayed(h,"ABCDEF","audius","zKaxkmz");
 assert.deepEqual([...rotation.playedKeys(h,"audius")],["yyR1OZE","zKaxkmz"]);
 assert.equal(h.games[0].audius.length,2);
});
test("Audius identifiers survive browser storage reloads and preserve other sources",()=>{
 const h=rotation.emptyRotation();
 rotation.notePlayed(h,"ABCDEF","audius","yyR1OZE");
 rotation.notePlayed(h,"ABCDEF","catalog","dQw4w9WgXcQ");
 rotation.notePlayed(h,"ABCDEF","local","0123456789abcdef");
 const reloaded=rotation.readRotation(JSON.stringify(h));
 assert.equal(rotation.playedKeys(reloaded,"audius").has("yyR1OZE"),true);
 assert.equal(rotation.playedKeys(reloaded,"catalog").size,1);
 assert.equal(rotation.playedKeys(reloaded,"local").size,1);
});
test("Audius rotation retains exactly the last three rooms",()=>{
 const h=rotation.emptyRotation();
 const rooms=["ABCDEF","FGHJKL","MNPQRS","TUVWXY"];
 const ids=["yyR1OZE","zKaxkmz","EW0w538","xx4e7E"];
 rooms.forEach((room,i)=>rotation.notePlayed(h,room,"audius",ids[i]));
 assert.deepEqual(h.games.map(g=>g.code),rooms.slice(1));
 assert.equal(rotation.playedKeys(h,"audius").has(ids[0]),false);
 assert.equal(rotation.playedKeys(h,"audius").has(ids[3]),true);
});
test("Old histories with no Audius field remain loadable",()=>{
 const legacy=JSON.stringify({version:1,games:[{code:"ABCDEF",local:[],catalog:[]}]});
 const h=rotation.readRotation(legacy);
 assert.equal(rotation.playedKeys(h,"audius").size,0);
 rotation.notePlayed(h,"ABCDEF","audius","yyR1OZE");
 assert.equal(rotation.playedKeys(h,"audius").size,1);
});
test("Invalid provider names and unsafe track IDs fail closed",()=>{
 const h=rotation.emptyRotation();
 assert.throws(()=>rotation.notePlayed(h,"ABCDEF","other","yyR1OZE"),/Invalid source/);
 assert.throws(()=>rotation.notePlayed(h,"ABCDEF","audius","../secret"),/Invalid song identifier/);
 assert.throws(()=>audius.streamUrl("../secret"),/Invalid Audius track ID/);
});
test("Audius track metadata preserves the real artist link and strict filters",()=>{
 const t=audius.normalizeAudiusTrack(example);
 assert.equal(t.permalink,"https://audius.co/chrisbessy/housewife-chris-bessy-remix");
 assert.equal(t.title,example.title);
 assert.equal(t.year,2026);
 assert.equal(audius.matchesAudiusFilters(t,["pop"],["2020"]),true);
 assert.equal(audius.matchesAudiusFilters(t,["rock"],["2020"]),false);
 assert.equal(audius.matchesAudiusFilters(t,["pop"],["1980"]),false);
 assert.equal(audius.normalizeAudiusTrack({...example,is_streamable:false}),null);
 assert.equal(audius.normalizeAudiusTrack({...example,is_unlisted:true}),null);
});
test("Bad provider permalinks cannot move the attribution outside Audius",()=>{
 const t=audius.normalizeAudiusTrack({...example,permalink:"//evil.example/a"});
 assert.equal(t.permalink,"https://audius.co/tracks/yyR1OZE");
});
test("Track choice excludes played Audius IDs instead of repeating",()=>{
 const a=audius.normalizeAudiusTrack(example),b=audius.normalizeAudiusTrack({...example,id:"zKaxkmz"});
 assert.equal(audius.chooseAudiusTrack([a,b],new Set([a.id]),()=>0).id,b.id);
 assert.throws(()=>audius.chooseAudiusTrack([a,b],new Set([a.id,b.id])),/All matching/);
});
test("Audius discovery deduplicates IDs across provider pages without audio downloads",async()=>{
 const requestUrls=[];
 const fakeFetch=async url=>{
  requestUrls.push(url);
  return {ok:true,json:async()=>({data:[example]})};
 };
 const tracks=await audius.discoverAudiusTracks(["pop"],[],fakeFetch);
 assert.equal(tracks.length,1);
 assert.equal(tracks[0].id,example.id);
 assert.equal(requestUrls.length,3);
 assert.ok(requestUrls.every(url=>url.includes("/tracks/trending?")));
});
test("Randomized cue starts within the track and leaves room for progressive clues",()=>{
 const atStart=audius.randomizedCueMs(232,()=>0);
 const atEnd=audius.randomizedCueMs(232,()=>0.999999);
 assert.ok(atStart>=0);
 assert.ok(atEnd>atStart);
 assert.ok(atEnd<232000-20000);
});
