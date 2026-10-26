import assert from "node:assert/strict";
import {AUDIUS_API,streamUrl,normalizeAudiusTrack,matchesAudiusFilters,
 discoverAudiusTracks,chooseAudiusTrack,randomizedCueMs} from "../music/audius-stream.js";
const t=(id,genre,year)=>({
 id,title:"Track "+id,user:{name:"Artist "+id},genre,duration:210,
 release_date:year+"-07-22T10:00:00Z",is_streamable:true,is_unlisted:false});
const a=normalizeAudiusTrack(t("abcdef","Pop",2021));
assert.equal(a.title,"Track abcdef");assert.equal(a.artist,"Artist abcdef");
assert.ok(a.genres.includes("pop"));assert.equal(a.year,2021);
assert.ok(matchesAudiusFilters(a,["pop"],["2020"]));
assert.ok(!matchesAudiusFilters(a,["pop"],["1980"]));
assert.ok(!matchesAudiusFilters(a,["rock"],[]));
assert.equal(normalizeAudiusTrack({...t("abcdef","Pop",2021),is_streamable:false}),null);
assert.equal(normalizeAudiusTrack({...t("abcdef","Pop",2021),is_unlisted:true}),null);
assert.equal(normalizeAudiusTrack({...t("abcdef","Pop",2021),is_premium:true}),null);
assert.equal(normalizeAudiusTrack({...t("abcdef","Pop",2021),duration:22}),null);
assert.equal(streamUrl("aBC2d"),AUDIUS_API+"/tracks/aBC2d/stream");
assert.throws(()=>streamUrl("https://evil.com/test"),/Invalid/);
const requested=[];
const fakeFetch=async(url)=>{
 requested.push(url);
 const genre=new URL(url).searchParams.get("genre");
 return {ok:true,json:async()=>({data:genre==="Pop"?
  [t("abc12","Pop",2021),t("abc13","Pop",2013),t("abc14","Pop",1998)]:
  [t("def16","Rock",2021),t("abc12","Pop",2021)]})};
};
const tracks=await discoverAudiusTracks(["pop","rock"],["2020"],fakeFetch);
assert.deepEqual(tracks.map(x=>x.id),["abc12","def16"]);
assert.ok(requested.every(u=>u.startsWith(AUDIUS_API+"/tracks/trending")));
assert.ok(requested.every(u=>!u.includes("/download")));
// Three concurrent genre workers, deterministic merging and live progress.
let running=0,peak=0;
const progress=[];
const slowFetch=async url=>{
 running++;peak=Math.max(peak,running);
 await new Promise(resolve=>setTimeout(resolve,8));
 running--;
 const genre=new URL(url).searchParams.get("genre");
 return {ok:true,json:async()=>({data:[t("song"+genre.replace(/[^a-z]/gi,"")+"x",genre==="Pop"?"Pop":genre==="Rock"?"Rock":"Alternative",2025)]})};
};
const concurrent=await discoverAudiusTracks(["pop","rock","indie"],[],slowFetch,{
 onProgress:step=>progress.push(step)});
assert.ok(peak>1&&peak<=3,"Audius provider search must overlap at most three requests");
assert.equal(concurrent.length,3,"genre responses must be deduplicated and merged");
assert.equal(concurrent[0].genres[0],"pop","genre order is deterministic despite networking");
assert.equal(progress.at(-1).completed,9);
assert.equal(progress.at(-1).total,9);
assert.equal(progress.at(-1).partial,false);
assert.ok(progress.some(x=>x.found>0),"progress reports discovered track counts");

// One broken genre must not hide valid results from other genres.
const partial=[];
const partialTracks=await discoverAudiusTracks(["pop","rock"],[],async url=>{
 if(new URL(url).searchParams.get("genre")==="Rock")throw Error("provider unavailable");
 return {ok:true,json:async()=>({data:[t("popwin1","Pop",2025)]})};
},{onProgress:x=>partial.push(x)});
assert.deepEqual(partialTracks.map(x=>x.id),["popwin1"]);
assert.equal(partial.at(-1).partial,true,"partial search must not pretend to be exhaustive");
assert.equal(partial.at(-1).failed,1);
await assert.rejects(
 discoverAudiusTracks(["pop"],[],async()=>{throw Error("blocked");}),
 /Could not reach Audius/,"all failed network pages must be a clear error"
);

// Provider requests that honor AbortSignal must never hold a host indefinitely.
const beforeTimeout=Date.now();
await assert.rejects(discoverAudiusTracks(["pop","rock"],[],async(_url,{signal})=>
 new Promise((_resolve,reject)=>{
  if(signal.aborted)return reject(Error("aborted"));
  signal.addEventListener("abort",()=>reject(Error("timed out")),{once:true});
 }),{timeoutMs:120}),/Could not reach Audius/);
assert.ok(Date.now()-beforeTimeout<1400,"timed-out Audius lookup must finish quickly");

const used=new Set(["abc12"]);
assert.equal(chooseAudiusTrack(tracks,used,()=>0).id,"def16");
assert.throws(()=>chooseAudiusTrack(tracks,new Set(["abc12","def16"])),/Change the filters/);
assert.throws(()=>chooseAudiusTrack([]),/no available full tracks/);
assert.equal(randomizedCueMs(180,()=>0),27000);
assert.equal(randomizedCueMs(180,()=>1),159000);
assert.throws(()=>randomizedCueMs(10),/too short/);
console.log("AUDIUS_DIRECT_STREAM_TEST_PASS",JSON.stringify({
 provider:"HTTPS official API",fileDownloads:0,apiQueries:requested.length,filtered:2,concurrency:peak,partialWarning:true,deadlineMs:120,
 cue:"random, leaving >=21 seconds",alreadyHeard:"excluded",guestMetadata:"not in adapter"
}));
