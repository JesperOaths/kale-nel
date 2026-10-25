/**
 * Tune Rush — Deezer short-preview adapter, staged pending explicit Deezer authorization.
 * Deezer's public API is metadata-only; this module never obtains full recordings,
 * scrapes, caches, saves or alters streams. Do not activate publicly without rights.
 *
 * Runtime contract: an approved host-only server must resolve the track ID to a fresh
 * Deezer preview URL and validate artist/title/year. Never expose unrevealed metadata
 * or the playable URL in guest room state.
 */
export const PREVIEW_LENGTH_SECONDS=30;
export const MAX_HINT_SECONDS=20;
const BAD_VERSION=/\b(karaoke|instrumental|cover|tribute|live|sped up|slowed|remix|demo)\b/i;
export const normalize=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
function primaryTitle(title){
 return normalize(String(title||"").replace(/\s*[\[(](?:\d{4}\s*)?(?:remaster(?:ed)?|radio edit|official video|album version)[^)\]]*[\])]/gi,""));
}
/** Choose strict artist/title matches; don't silently play another version or cover. */
export function chooseDeezerMatch(expected,searchResult){
 if(!expected?.title||!expected?.artist||!Array.isArray(searchResult))return null;
 const artist=normalize(expected.artist),title=primaryTitle(expected.title);
 const options=searchResult.filter(t=>{
  if(!Number.isSafeInteger(Number(t.id))||Number(t.id)<1)return false;
  if(typeof t.preview!=="string"||!t.preview.length)return false;
  const a=normalize(t.artist?.name),actual=primaryTitle(t.title_short||t.title||"");
  if(a!==artist||actual!==title)return false;
  const original=String(t.title||"")+" "+String(t.title_version||"");
  if(BAD_VERSION.test(original))return false;
  if(t.readable===false)return false;
  return true;
 });
 if(!options.length)return null;
 options.sort((a,b)=>Number(Boolean(b.explicit_lyrics===false))-Number(Boolean(a.explicit_lyrics===false)));
 const t=options[0];
 return {id:Number(t.id),title:expected.title,artist:expected.artist,
  year:expected.year,genres:expected.genres};
}
/**
 * A Deezer *preview* is not the whole song. The last of our 7 clues lasts 20s.
 * Seek only within the 30s excerpt, leaving 20s plus 0.5s margin available.
 */
export function chooseCueSeconds(duration=PREVIEW_LENGTH_SECONDS,maxHint=MAX_HINT_SECONDS,random=Math.random){
 if(!Number.isFinite(duration)||duration<maxHint+0.5||maxHint<=0)throw Error("preview_too_short");
 const maxStart=Math.max(0,Math.min(9,duration-maxHint-0.5));
 const r=Number(random());
 if(!Number.isFinite(r)||r<0||r>1)throw Error("invalid_random");
 return Math.round(maxStart*r*10)/10;
}
export function validateDeezerPreviewUrl(raw){
 const u=new URL(raw);
 if(u.protocol!=="https:"||u.hostname!=="cdnt-preview.dzcdn.net"||
    u.username||u.password||u.port||!u.pathname.startsWith("/stream/")||
    !/\.mp3$/i.test(u.pathname)||u.hash)throw Error("invalid_deezer_preview_url");
 return u.href;
}
/**
 * Adapter for HTMLAudioElement. Only call after license gate on server was confirmed.
 * Re-uses one element; never converts provider streams to Blob/ArrayBuffer.
 * Each clue seeks to the same cue and pauses after 0.5/1.5/3/5/8/12/20 seconds.
 */
export class DeezerPreviewPlayer{
 constructor(audio,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(!audio||typeof audio.play!=="function"||typeof audio.pause!=="function")
   throw Error("HTMLAudioElement required");
  this.audio=audio;
  this.setTimer=setTimer;this.clearTimer=clearTimer;
  this.timer=null;this.generation=0;this.started=false;
  this.currentUrl="";this.cue=0;
 }
 stop(){
  ++this.generation;
  if(this.timer!==null){this.clearTimer(this.timer);this.timer=null}
  try{this.audio.pause()}catch{}
  this.started=false;
 }
 prepare(previewUrl,duration=30,random=Math.random){
  this.stop();
  const url=validateDeezerPreviewUrl(previewUrl);
  this.cue=chooseCueSeconds(duration,20,random);
  this.currentUrl=url;
  if(this.audio.src!==url)this.audio.src=url;
  this.audio.preload="none";
  return this.cue;
 }
 async play(lengthMs){
  if(!this.currentUrl)throw Error("no_deezer_preview_loaded");
  if(![500,1500,3000,5000,8000,12000,20000].includes(lengthMs))
   throw Error("invalid_clue_length");
  this.stop();
  const generation=this.generation;
  this.audio.currentTime=this.cue;
  try{await this.audio.play()}catch(e){this.stop();throw e}
  if(this.generation!==generation)return false;
  this.started=true;
  this.timer=this.setTimer(()=>{
   if(this.generation===generation)this.stop();
  },lengthMs);
  return true;
 }
 dispose(){
  this.stop();this.audio.removeAttribute?.("src");this.audio.load?.();this.currentUrl="";
 }
}
