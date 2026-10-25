import assert from "node:assert/strict";
import {inspectLocalTrack,prepareTrackMetadata,parseFilename,chooseNextLocalTrack,
 chooseFullTrackCue,classifyGenres} from "../music/local-tracks.js";
const encoder=new TextEncoder();
const tagBytes=(name,value)=>{
 const data=Buffer.concat([Buffer.from([3]),Buffer.from(value,"utf8")]);
 const head=Buffer.alloc(10);head.write(name,0,"ascii");head.writeUInt32BE(data.length,4);
 return Buffer.concat([head,data]);
};
const frames=Buffer.concat([
 tagBytes("TIT2","Bohemian Rhapsody"),tagBytes("TPE1","Queen"),
 tagBytes("TDRC","1975"),tagBytes("TCON","Rock / Pop")
]);
const head=Buffer.alloc(10);head.write("ID3");head[3]=3;let n=frames.length;
head[6]=(n>>21)&127;head[7]=(n>>14)&127;head[8]=(n>>7)&127;head[9]=n&127;
const song=new File([head,frames,Buffer.alloc(200)],"01 - uncertain filename.mp3",{type:"audio/mpeg"});
const found=await inspectLocalTrack(song,0);
assert.equal(found.artist,"Queen");assert.equal(found.title,"Bohemian Rhapsody");
assert.equal(found.year,1975);assert.ok(found.genres.includes("rock"));assert.ok(found.genres.includes("pop"));
assert.equal(found.needsReview,false);
assert.deepEqual(parseFilename("03 - Daft Punk - One More Time.mp3"),{artist:"Daft Punk",title:"One More Time"});
const manual=prepareTrackMetadata(new File(["placeholder"],"ABBA - Dancing Queen.flac"),{genre:"Pop, Disco",year:"1976"},1);
assert.equal(manual.needsReview,false);assert.deepEqual(manual.genres,["disco","pop"]);
const fallback=prepareTrackMetadata(new File(["placeholder"],"Unknown.wav"),{},2);
assert.equal(fallback.needsReview,true);
assert.deepEqual(classifyGenres("Hip-Hop / Rap"),["hiphop"]);
assert.equal(chooseNextLocalTrack([found,manual],["pop"],["1970"],new Set(),()=>0).index,0);
const played=new Set([0]);
assert.equal(chooseNextLocalTrack([found,manual],["pop"],["1970"],played,()=>0).index,1);
played.add(1);assert.ok([0,1].includes(chooseNextLocalTrack([found,manual],["pop"],["1970"],played,()=>0).index));
assert.equal(played.size,0,"cycle reset after matching tracks exhausted");
assert.throws(()=>chooseNextLocalTrack([found,manual],["pop"],["1990"],new Set()),/No local tracks match/);
assert.throws(()=>chooseNextLocalTrack([fallback],["pop"],[],new Set()),/No local tracks match/);
assert.equal(chooseFullTrackCue(200,()=>0),30000);
assert.equal(chooseFullTrackCue(200,()=>1),179000);
assert.equal(chooseFullTrackCue(30,()=>1),9000);
assert.throws(()=>chooseFullTrackCue(20),/at least 30/);
assert.throws(()=>chooseFullTrackCue(Infinity),/at least 30/);
console.log("LOCAL_TRACKS_PASS",JSON.stringify({ID3:"title/artist/year/genre",filenameFallback:"yes",
 independentGenreAndDecade:"yes",noRepeatBeforeExhausted:"yes",cycleNoLimit:"yes",
 cueRange:"duration-21 seconds",filesUploaded:0}));
