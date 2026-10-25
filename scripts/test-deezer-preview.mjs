import assert from "node:assert/strict";
import {chooseDeezerMatch,chooseCueSeconds,validateDeezerPreviewUrl,DeezerPreviewPlayer} from "../music/deezer-preview.js";
const candidate={title:"Take on Me",artist:"a-ha",year:1985,genres:["pop"]};
const match=chooseDeezerMatch(candidate,[
 {id:2,title:"Take on Me (Karaoke)",title_short:"Take on Me",title_version:"(Karaoke)",artist:{name:"a-ha"},preview:"https://cdnt-preview.dzcdn.net/stream/other.mp3"},
 {id:3,title:"Take On Me",title_short:"Take On Me",artist:{name:"Unknown Tribute"},preview:"https://cdnt-preview.dzcdn.net/stream/other.mp3"},
 {id:4,title:"Take on Me",title_short:"Take on Me",artist:{name:"a-ha"},preview:"",readable:true},
 {id:664107,title:"Take on Me",title_short:"Take on Me",artist:{name:"a-ha"},preview:"https://cdnt-preview.dzcdn.net/stream/demo.mp3",readable:true}
]);
assert.equal(match?.id,664107,"match exact recorded artist and original song");
assert.equal(chooseDeezerMatch(candidate,[]),null);
assert.equal(chooseDeezerMatch(candidate,[{id:44,title:"Take on Me",artist:{name:"Queen"},preview:"x"}]),null);
assert.equal(chooseCueSeconds(30,20,()=>0),0);
assert.equal(chooseCueSeconds(30,20,()=>0.5),4.5);
assert.equal(chooseCueSeconds(30,20,()=>1),9);
assert.throws(()=>chooseCueSeconds(19,20),/preview_too_short/);
assert.throws(()=>chooseCueSeconds(30,20,()=>1.1),/invalid_random/);
assert.equal(validateDeezerPreviewUrl("https://cdnt-preview.dzcdn.net/stream/c-123.mp3"),"https://cdnt-preview.dzcdn.net/stream/c-123.mp3");
for(const url of ["http://cdnt-preview.dzcdn.net/stream/a.mp3",
 "https://example.org/stream/c-123.mp3","https://cdnt-preview.dzcdn.net.evil.com/stream/a.mp3",
 "https://cdnt-preview.dzcdn.net/redirect?to=https://example.org/music.mp3",
 "https://cdnt-preview.dzcdn.net/stream/a.mp3#hack"])
 assert.throws(()=>validateDeezerPreviewUrl(url),/invalid_deezer_preview_url/);
let tick=0,playCount=0,pauseCount=0;
const callbacks=new Map();
const fakeAudio={
 src:"",currentTime:0,preload:"",
 async play(){playCount++},pause(){pauseCount++},
 removeAttribute(name){if(name==="src")this.src=""},load(){}
};
const player=new DeezerPreviewPlayer(fakeAudio,{setTimer:(fn,ms)=>{const k=++tick;callbacks.set(k,{fn,ms});return k},clearTimer:k=>callbacks.delete(k)});
const cue=player.prepare("https://cdnt-preview.dzcdn.net/stream/a.mp3",30,()=>0.5);
assert.equal(cue,4.5);
assert.equal(player.audio.preload,"none");
assert.equal(await player.play(500),true);
assert.equal(fakeAudio.currentTime,4.5);
assert.equal(playCount,1);
assert.deepEqual([...callbacks.values()].map(t=>t.ms),[500]);
const first=callbacks.values().next().value.fn;
assert.equal(await player.play(1500),true);
assert.deepEqual([...callbacks.values()].map(t=>t.ms),[1500]);
first(); // stale callback cannot stop newer clue
assert.equal(player.started,true);
callbacks.values().next().value.fn();
assert.equal(player.started,false);
assert.equal(await player.play(20000),true);
player.dispose();
assert.equal(callbacks.size,0);
assert.equal(fakeAudio.src,"");
await assert.rejects(player.play(40000),/no_deezer_preview_loaded/);
console.log("DEEZER_PREVIEW_ADAPTER_PASS",JSON.stringify({exactMatch:"yes",previewLength:30,maxClue:20,randomCueRange:"0-9s",clueTimers:"500/1500/20000ms",stalePlaybackStopped:"yes",illegalOrigins:"rejected",networkAudioRequests:0}));
