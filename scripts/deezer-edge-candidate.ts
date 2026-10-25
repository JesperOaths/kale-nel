/**
 * STAGED ONLY; do not deploy to Supabase until Deezer authorizes public
 * preview use for interactive music trivia. Zero downloads or proxying audio.
 * Move to supabase/functions/tune-rush-deezer-preview/index.ts once approved.
 */
const BASE=Deno.env.get("SUPABASE_URL")||"";
const ADMIN=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const ALLOWED_ORIGINS=new Set(["https://kalenel.nl","https://www.kalenel.nl"]);
const headers=(origin:string)=>({
 "Access-Control-Allow-Origin":origin,
 "Access-Control-Allow-Headers":"content-type,apikey,authorization",
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Vary":"Origin","Cache-Control":"no-store",
 "Content-Type":"application/json; charset=utf-8"
});
const reply=(data:Record<string,unknown>,status:number,origin:string)=>
 new Response(JSON.stringify(data),{status,headers:headers(origin)});
const normalize=(s:string)=>(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const exactTitle=(s:string)=>normalize((s||"").replace(
 /\s*[\[(](?:\d{4}\s*)?(?:remaster(?:ed)?|album version|radio edit)[^)\]]*[\])]/gi,""));
Deno.serve(async request=>{
 const origin=request.headers.get("Origin")||"";
 if(!ALLOWED_ORIGINS.has(origin))return new Response(null,{status:403});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
 if(request.method!=="POST")return reply({error:"method_not_allowed"},405,origin);
 if(!BASE.startsWith("https://")||!ADMIN)return reply({error:"server_not_configured"},503,origin);
 try{
  const {code,hash}=await request.json();
  if(typeof code!=="string"||typeof hash!=="string"||
     !/^[A-HJ-NP-Z2-9]{6}$/.test(code)||!/^[a-f0-9]{64}$/.test(hash))
     return reply({error:"unauthorized"},403,origin);
  // The privileged RPC validates host capability, active room and *server-side*
  // written approval before returning the selected (unrevealed) track ID.
  const auth=await fetch(BASE+"/rest/v1/rpc/musicquiz_deezer_host_preview_v1",{
   method:"POST",headers:{"apikey":ADMIN,"Authorization":"Bearer "+ADMIN,
     "Content-Type":"application/json"},
   body:JSON.stringify({p_code:code,p_hash:hash}),signal:AbortSignal.timeout(8000)
  });
  if(!auth.ok)return reply({error:"not_authorized"},403,origin);
  const meta=await auth.json();
  if(!Number.isSafeInteger(Number(meta.trackId))||Number(meta.trackId)<=0||
     !Number.isInteger(meta.cueMs)||meta.cueMs<0||meta.cueMs>9000)
   return reply({error:"invalid_room_track"},503,origin);
  const response=await fetch("https://api.deezer.com/track/"+String(meta.trackId),{
   method:"GET",headers:{"Accept":"application/json"},signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return reply({error:"deezer_unavailable"},503,origin);
  const track=await response.json();
  if(Number(track.id)!==Number(meta.trackId)||
     exactTitle(track.title_short||track.title||"")!==exactTitle(meta.title||"")||
     normalize(track.artist?.name||"")!==normalize(meta.artist||"")||
     !track.preview||track.readable===false)
    return reply({error:"deezer_track_mismatch_or_missing_preview"},422,origin);
  const u=new URL(track.preview);
  if(u.protocol!=="https:"||u.hostname!=="cdnt-preview.dzcdn.net"||
     !u.pathname.startsWith("/stream/")||!/\.mp3$/i.test(u.pathname)||
     u.username||u.password||u.port||u.hash)
    return reply({error:"invalid_deezer_preview_source"},502,origin);
  // Return fresh Deezer HTTPS preview URL only to the room's authorized host.
  // Audio streams directly from provider via <audio>; never cache/transcode it.
  return reply({previewUrl:u.href,trackId:meta.trackId,
    cueMs:meta.cueMs,durationSeconds:30,round:meta.round,attribution:"Deezer"},200,origin);
 }catch{return reply({error:"temporary_failure"},503,origin)}
});
