/**
 * Three-game non-repeat memory. Store only song fingerprints or video IDs;
 * audio and track names are never written to localStorage.
 * Normal rounds have no fixed limit; when a small matching pool is exhausted
 * the UI warns and repetition becomes mathematically unavoidable.
 */
export const THREE_GAME_TARGET=120;
export const TYPICAL_SONGS_PER_GAME=40;
export const STORAGE_KEY="tune-rush-rotation-v1";
const validCode=s=>typeof s==="string"&&/^[A-HJ-NP-Z2-9]{6}$/.test(s);
function stableKey(s){
 const bytes=new TextEncoder().encode(String(s||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim());
 // Two independent 32-bit FNV variants provide stable, short local identifiers.
 let a=0x811c9dc5,b=0x7feb352d;
 for(const x of bytes){a=Math.imul(a^x,0x01000193)>>>0;b=Math.imul(b^x,0x85ebca6b)>>>0}
 return a.toString(16).padStart(8,"0")+b.toString(16).padStart(8,"0");
}
export function songFingerprint({artist,title}){return stableKey(artist+"\x00"+title)}
export function emptyRotation(){return {version:1,games:[]}}
export function readRotation(text){
 try{
  const obj=JSON.parse(text||"null");
  if(obj?.version!==1||!Array.isArray(obj.games))return emptyRotation();
  const games=obj.games.filter(g=>validCode(g?.code)&&
   Array.isArray(g?.local)&&Array.isArray(g?.catalog))
   .map(g=>({code:g.code,local:g.local.filter(x=>typeof x==="string"&&/^[a-f0-9]{16}$/.test(x)).slice(-10000),
    catalog:g.catalog.filter(x=>typeof x==="string"&&/^[A-Za-z0-9_-]{11}$/.test(x)).slice(-10000)}));
  return {version:1,games:games.slice(-3)};
 }catch{return emptyRotation()}
}
export function openGame(history,roomCode){
 if(!validCode(roomCode))throw Error("Invalid room code for rotation");
 const games=history.games.filter(g=>g.code!==roomCode);
 const old=history.games.find(g=>g.code===roomCode);
 games.push(old||{code:roomCode,local:[],catalog:[]});
 history.games=games.slice(-3);
 return history;
}
export function playedKeys(history,kind){
 if(kind!=="local"&&kind!=="catalog")throw Error("Invalid source");
 return new Set((history.games||[]).flatMap(g=>g[kind]||[]));
}
export function notePlayed(history,roomCode,kind,key){
 openGame(history,roomCode);
 if(kind!=="local"&&kind!=="catalog")throw Error("Invalid source");
 const correct=kind==="local"?/^[a-f0-9]{16}$/:/^[A-Za-z0-9_-]{11}$/;
 if(!correct.test(key))throw Error("Invalid song identifier");
 const current=history.games[history.games.length-1][kind];
 if(!current.includes(key))current.push(key);
 return history;
}
export function matchingLocalTracks(tracks,genres,decades){
 const accepted=new Set(genres),years=new Set(decades);
 const matches=tracks.filter(t=>t.title?.trim()&&t.artist?.trim()&&Number.isInteger(t.year)&&
  t.genres?.some(g=>accepted.has(g))&&
  (!years.size||years.has(String(Math.floor(t.year/10)*10))));
 const seen=new Set();
 return matches.filter(t=>{const key=songFingerprint(t);if(seen.has(key))return false;seen.add(key);return true});
}
export function readiness(uniqueMatchingTracks,seen,threshold=THREE_GAME_TARGET){
 const keys=new Set(uniqueMatchingTracks.map(t=>typeof t==="string"?t:songFingerprint(t)));
 const remaining=[...keys].filter(key=>!seen.has(key)).length;
 return {total:keys.size,remaining,goal:threshold,
  ready:remaining>=threshold,
  shortfall:Math.max(0,threshold-remaining),
  expectedGames:Math.floor(remaining/TYPICAL_SONGS_PER_GAME)};
}
export function catalogReadiness(available,used,threshold=THREE_GAME_TARGET){
 const total=Math.max(0,Math.floor(Number(available)||0));
 const remaining=Math.max(0,total-Math.max(0,Math.floor(Number(used)||0)));
 return {total,remaining,goal:threshold,ready:remaining>=threshold,
  shortfall:Math.max(0,threshold-remaining),
  expectedGames:Math.floor(remaining/TYPICAL_SONGS_PER_GAME)};
}
