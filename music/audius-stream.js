/** Audius read-only HTTPS streaming; no audio download or file persistence. */
export const AUDIUS_API="https://api.audius.co/v1";
const supported=new Map([
 ["pop","Pop"],["rock","Rock"],["hiphop","Hip-Hop/Rap"],["electronic","Electronic"],
 ["dance","Electronic"],["disco","Disco"],["indie","Alternative"],["rnb","R&B/Soul"],
 ["metal","Metal"]
]);
export function streamUrl(id){
 if(typeof id!=="string"||!/^[A-Za-z0-9_-]{3,32}$/.test(id))throw Error("Invalid Audius track ID");
 return AUDIUS_API+"/tracks/"+encodeURIComponent(id)+"/stream";
}
export function normalizeAudiusTrack(t){
 if(!t||!t.is_streamable||t.is_unlisted||t.is_delete||t.is_premium||t.is_blocked)return null;
 const id=String(t.id||"");
 if(!/^[A-Za-z0-9_-]{3,32}$/.test(id))return null;
 const title=String(t.title||"").trim().slice(0,100);
 const artist=String(t.user?.name||"").trim().slice(0,100);
 const duration=Number(t.duration);
 if(!title||!artist||!Number.isFinite(duration)||duration<35||duration>7200)return null;
 const date=t.orig_release_date||t.release_date||"";
 const y=Number(String(date).slice(0,4)),year=y>=1960&&y<=2100?y:null;
 const rawGenre=String(t.genre||"");
 const genre=[...supported.entries()].filter(([,v])=>v.toLowerCase()===rawGenre.toLowerCase()).map(([k])=>k);
 if(rawGenre==="Hip-Hop/Rap")genre.push("hiphop");
 if(rawGenre==="R&B/Soul")genre.push("rnb");
 if(rawGenre==="Dance & EDM")genre.push("dance","electronic");
 if(rawGenre==="Electronic")genre.push("electronic","dance");
 if(rawGenre==="Indie")genre.push("indie");
 return {id,title,artist,duration,year,genres:[...new Set(genre)],
  provider:"Audius",permalink:"https://audius.co/tracks/"+encodeURIComponent(id)};
}
export function matchesAudiusFilters(t,genres,decades){
 if(!t||!t.genres.some(g=>genres.includes(g)))return false;
 return !decades.length||(t.year!==null&&decades.includes(String(Math.floor(t.year/10)*10)));
}
export async function discoverAudiusTracks(genres,decades,fetchImpl=fetch){
 const choices=[...new Set(genres.map(g=>supported.get(g)).filter(Boolean))].slice(0,8);
 if(!choices.length)return [];
 const found=new Map();
 for(const genre of choices){
  for(const offset of [0,100,200]){
  const u=new URL(AUDIUS_API+"/tracks/trending");
  u.searchParams.set("genre",genre);u.searchParams.set("limit","100");
  u.searchParams.set("offset",String(offset));
  try{
   const response=await fetchImpl(u.toString(),{cache:"no-store",signal:AbortSignal.timeout(12000),
     headers:{"Accept":"application/json"}});
   if(!response.ok)throw Error("Audius returned HTTP "+response.status);
   const data=await response.json();
   if(!Array.isArray(data?.data))throw Error("Invalid Audius response");
   for(const item of data.data){
    const track=normalizeAudiusTrack(item);
    if(track&&matchesAudiusFilters(track,genres,decades))found.set(track.id,track);
   }
  }catch(e){
   if(offset===0&&choices.length===1)throw Error("Could not reach Audius: "+String(e.message||e));
   break; // Stop paging this genre if a provider request fails.
  }
  if(found.size>=900)break;
  }
 }
 return [...found.values()];
}
export function chooseAudiusTrack(pool,used,random=Math.random){
 if(!pool.length)throw Error("Audius has no available full tracks for these selected genres and release decades.");
 const free=pool.filter(t=>!used.has(t.id));
 if(!free.length)throw Error("All matching Audius tracks found have been played. Change the filters to avoid repeats.");
 return free[Math.floor(Math.max(0,Math.min(0.99999999,random()))*free.length)];
}
export function randomizedCueMs(duration,random=Math.random){
 const d=Math.floor(duration*1000);
 if(!Number.isFinite(d)||d<35000)throw Error("Track is too short for full quiz clues");
 const last=d-21000,first=Math.min(last,Math.min(60000,Math.floor(d*0.15)));
 return first+Math.floor(Math.max(0,Math.min(.999999999,random()))*(last-first+1));
}
