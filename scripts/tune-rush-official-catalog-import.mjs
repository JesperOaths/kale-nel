// Official YouTube Data API discovery, not a YouTube scraper or stream downloader.
// GitHub Actions server-side job: API keys never sent to browsers or player clients.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const candidates=JSON.parse(readFileSync(new URL("../music/catalog-candidates.json",import.meta.url),"utf8")).candidates;
const allowed=new Set(["pop","rock","hiphop","electronic","indie","dutch","disco","rnb","metal","dance"]);
const norm=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
for(const c of candidates){
 assert.ok(c.title?.length>=1&&c.title.length<=100);
 assert.ok(c.artist?.length>=1&&c.artist.length<=100);
 assert.ok(Number.isInteger(c.year)&&c.year>=1950&&c.year<=2100);
 assert.ok(Array.isArray(c.genres)&&c.genres.length&&c.genres.every(g=>allowed.has(g)));
}
assert.equal(new Set(candidates.map(c=>norm(c.title)+":"+norm(c.artist))).size,candidates.length);
console.log("YOUTUBE_OFFICIAL_CANDIDATES_VALID",candidates.length);
if(process.argv.includes("--dry-run"))process.exit(0);
const key=process.env.YOUTUBE_DATA_API_KEY,admin=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!key||!admin){
 console.log("YOUTUBE_OFFICIAL_IMPORT_SKIPPED: no server-side YouTube Data API and/or Supabase service-role secret configured");
 process.exit(0);
}
async function yt(action,params){
 const u=new URL("https://www.googleapis.com/youtube/v3/"+action);
 Object.entries({key,...params}).forEach(([k,v])=>u.searchParams.set(k,String(v)));
 const r=await fetch(u,{signal:AbortSignal.timeout(12000)});
 const j=await r.json();
 if(!r.ok)throw Error("YouTube Data API "+r.status+" "+String(j?.error?.message||"unavailable").slice(0,140));
 return j;
}
function duration(v){
 const m=/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v||"");
 return m?3600*Number(m[1]||0)+60*Number(m[2]||0)+Number(m[3]||0):0;
}
async function findVideo(c){
 const search=await yt("search",{
  part:"snippet",q:c.artist+" "+c.title+" official music video",
  type:"video",videoEmbeddable:"true",maxResults:8,regionCode:"NL"
 });
 const ids=(search.items||[]).map(x=>x.id?.videoId).filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id||""));
 if(!ids.length)return null;
 const data=await yt("videos",{part:"snippet,status,contentDetails",id:ids.join(",")});
 const choices=(data.items||[]).filter(v=>{
  if(v.status?.embeddable!==true||v.status?.privacyStatus!=="public"||v.status?.madeForKids===true)return false;
  const sec=duration(v.contentDetails?.duration);
  if(sec<50||sec>900)return false;
  const title=v.snippet?.title||"", channel=v.snippet?.channelTitle||"";
  if(!norm(title).includes(norm(c.title)))return false;
  if(![title,channel].some(x=>norm(x).includes(norm(c.artist))))return false;
  return !/(karaoke|reaction|tutorial|instrumental|sped up|slowed|cover by|fan made|interview)/i.test(title);
 });
 choices.sort((a,b)=>{
  const rank=v=>Number(/official|vevo/i.test(v.snippet?.title||""))+Number(/vevo/i.test(v.snippet?.channelTitle||""));
  return rank(b)-rank(a);
 });
 const v=choices[0];
 return v?{videoId:v.id,title:c.title,artist:c.artist,year:c.year,
  genres:c.genres,verifiedTitle:String(v.snippet?.title||"").slice(0,180)}:null;
}
// API quota protection limits each scheduled batch, NOT the number of songs per game.
const perRun=12,start=(Math.floor(Date.now()/86400000)*perRun)%candidates.length;
const batch=Array.from({length:Math.min(perRun,candidates.length)},(_,i)=>candidates[(start+i)%candidates.length]);
const accepted=[],skipped=[];
for(const c of batch){
 try{
  const match=await findVideo(c);
  if(match)accepted.push(match);
  else skipped.push(c.artist+" - "+c.title+" (no confirmed eligible video)");
 }catch(e){skipped.push(c.artist+" - "+c.title+" ("+String(e.message).slice(0,100)+")")}
}
if(skipped.length)console.log("YOUTUBE_OFFICIAL_CATALOG_SKIPS",JSON.stringify(skipped));
if(!accepted.length){console.log("YOUTUBE_OFFICIAL_CATALOG_NO_ELIGIBLE_VIDEO");process.exit(0)}
const response=await fetch("https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/musicquiz_catalog_import_v1",{
 method:"POST",signal:AbortSignal.timeout(20000),
 headers:{"Content-Type":"application/json","apikey":admin,"Authorization":"Bearer "+admin},
 body:JSON.stringify({p_items:accepted})
});
const data=await response.json().catch(()=>({}));
if(!response.ok)throw Error("Supabase import rejected "+response.status+" "+String(data?.message||"").slice(0,140));
console.log("YOUTUBE_OFFICIAL_CATALOG_IMPORT_PASS",JSON.stringify({
 processed:data.processed,candidatesChecked:batch.length,editorialCandidateTotal:candidates.length
}));
