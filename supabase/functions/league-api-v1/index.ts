// League web backend source.
// Production currently deploys this source into a pre-existing retired diagnostic Edge Function slot
// because the Supabase project is at its function-count limit. The public contract is /league/;
// the legacy deployment slug is an internal implementation detail and can be renamed when a slot is free.


import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { buildDecisionIntelligence } from "./decision-intelligence.ts";

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SERVICE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const RIOT_KEY = String(Deno.env.get("RIOT_API_KEY") || Deno.env.get("RIOT_API_TOKEN") || "");
const PUBLIC_MAX_PROFILES=8;
const PUBLIC_MAX_FETCH_MATCHES=100;
const PUBLIC_MAX_CACHED_MATCHES_PER_PROFILE=100;
const PUBLIC_MAX_ANALYSES_PER_PROFILE=25;
const PUBLIC_MAX_FETCH_RUNS_PER_PROFILE=20;
const ANALYSIS_CACHE_METADATA_LIMIT=100;
const ANALYSIS_DEEP_TARGET_GAMES=20;
const ANALYSIS_DEEP_BATCH_SIZE=20;
const ANALYSIS_BASELINE_MAX_ROWS=100;
const ANALYSIS_HISTORY_TARGET_GAMES=100;
const ANALYZER_VERSION="league-web-behavior-v4.174";
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl","https://jesperoaths.github.io"]);
const text=(v:any)=>String(v??"").trim();
const hasNum=(v:any)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
const num=(v:any)=>hasNum(v)?Number(v):null;
const now=()=>new Date().toISOString();

function cors(req:Request){
  const origin=text(req.headers.get("origin"));
  const allow=ALLOWED_ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)?origin:"https://kalenel.nl";
  return {"Access-Control-Allow-Origin":allow,"Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-gejast-session, x-league-workspace, x-riot-api-key","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
}
const json=(req:Request,body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
function sbClient(){
  if(!SUPABASE_URL||!SERVICE_KEY) throw new Error("server_not_configured");
  return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
function safeKey(v:any){return text(v).toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64);}
function patchKey(v:any){
  const m=text(v).match(/^(\d+)\.(\d+)(?:\.|$)/);
  return m?m[1]+"."+m[2]:null;
}
function publicPatchKey(v:any){
  const raw=patchKey(v);if(!raw)return null;
  const [majorText,minorText]=raw.split("."),major=Number(majorText);
  if(major===15)return"25."+minorText;
  if(major===16)return"26."+minorText;
  return raw;
}
function platform(v:any){
  const p=text(v||"euw1").toLowerCase(), allowed=new Set(["br1","eun1","euw1","jp1","kr","la1","la2","na1","oc1","tr1","ru","ph2","sg2","th2","tw2","vn2"]);
  return allowed.has(p)?p:"euw1";
}
function routeFor(pv:any){
  const p=platform(pv);
  if(["br1","la1","la2","na1"].includes(p))return"americas";
  if(["kr","jp1"].includes(p))return"asia";
  if(["ph2","sg2","th2","tw2","vn2"].includes(p))return"sea";
  return"europe";
}
function role(v:any){
  const r=text(v).toUpperCase();
  if(r==="UTILITY"||r==="SUPPORT"||r==="DUO_SUPPORT")return"SUPPORT";
  if(r==="BOTTOM"||r==="BOT"||r==="ADC"||r==="DUO_CARRY")return"ADC";
  if(r==="MIDDLE"||r==="MID")return"MID";
  if(r==="JUNGLE")return"JUNGLE";
  if(r==="TOP")return"TOP";
  return"GENERIC";
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function avg(xs:any[]){const a=(xs||[]).filter(hasNum).map(Number);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function quantile(xs:any[],q:number){const a=(xs||[]).filter(hasNum).map(Number).sort((x,y)=>x-y);if(!a.length)return null;const pos=(a.length-1)*Math.max(0,Math.min(1,q)),lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);}
function distribution(xs:any[]){const a=(xs||[]).filter(hasNum).map(Number);return{n:a.length,median:quantile(a,.5),q25:quantile(a,.25),q75:quantile(a,.75),min:a.length?Math.min(...a):null,max:a.length?Math.max(...a):null};}
function pct(a:number,b:number){return b>0?a/b*100:null;}
function xy(v:any){const x=num(v?.x),y=num(v?.y);return x!=null&&y!=null?{x,y}:null;}

async function publicWorkspaceOwnerId(raw:any){
  const workspace=text(raw).slice(0,160);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspace),hex=/^lw1_[0-9a-f]{48,64}$/i.test(workspace);
  if(!uuid&&!hex)throw Object.assign(new Error("league_workspace_invalid"),{status:400});
  const bytes=new TextEncoder().encode(workspace),digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  let value=0;for(let i=0;i<6;i++)value=value*256+digest[i];
  return 900000000000000+(value%90000000000000);
}
async function accessContext(req:Request,body:any){
  const sb=sbClient(),workspace=text(req.headers.get("x-league-workspace")||body?.workspace_id);
  if(workspace){
    const playerId=await publicWorkspaceOwnerId(workspace);
    return{sb,viewer:{player_id:playerId,display_name:"Public League workspace",site_scope:"friends",anonymous:true,workspace_id:workspace}};
  }
  const token=text(req.headers.get("x-gejast-session")||body?.session_token);
  if(!token)throw Object.assign(new Error("league_workspace_required"),{status:400});
  const {data,error}=await sb.from("gejast_player_sessions_v746").select("player_id,display_name,site_scope,expires_at").eq("session_token",token).gt("expires_at",now()).maybeSingle();
  if(error||!data)throw Object.assign(new Error("invalid_session"),{status:401});
  return{sb,viewer:{...data,anonymous:false}};
}
async function trimAnonymousRows(sb:any,table:string,profileId:string,ownerId:number,keep:number,orderColumn="created_at"){
  const {data,error}=await sb.from(table).select("id").eq("profile_id",profileId).eq("owner_player_id",ownerId).order(orderColumn,{ascending:false}).range(keep,keep+199);
  if(error)throw error;
  const ids=(data||[]).map((x:any)=>x.id).filter(Boolean);
  if(ids.length){const{error:delError}=await sb.from(table).delete().in("id",ids);if(delError)throw delError;}
  return ids.length;
}
async function trimAnonymousMatchCache(sb:any,profileId:string,ownerId:number){
  const {data,error}=await sb.from("league_match_cache_v1").select("match_id").eq("profile_id",profileId).eq("owner_player_id",ownerId).order("game_start_at",{ascending:false}).order("updated_at",{ascending:false}).range(PUBLIC_MAX_CACHED_MATCHES_PER_PROFILE,PUBLIC_MAX_CACHED_MATCHES_PER_PROFILE+199);
  if(error)throw error;
  const matchIds=(data||[]).map((x:any)=>text(x.match_id)).filter(Boolean);
  if(matchIds.length){
    const{error:delError}=await sb.from("league_match_cache_v1").delete().eq("profile_id",profileId).eq("owner_player_id",ownerId).in("match_id",matchIds);
    if(delError)throw delError;
  }
  return matchIds.length;
}
async function riot(url:string, requestKey="", allowServerKey=true){
  const key=(allowServerKey?RIOT_KEY:"")||text(requestKey);
  if(!key)throw Object.assign(new Error("riot_api_key_not_configured"),{status:503});
  let last="riot_request_failed";
  for(let i=0;i<4;i++){
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
    try{
      const r=await fetch(url,{headers:{"X-Riot-Token":key,Accept:"application/json"},signal:c.signal});
      const raw=await r.text();
      if(r.ok){try{return raw?JSON.parse(raw):null}catch{throw new Error("riot_invalid_json");}}
      last="riot_http_"+r.status+":"+raw.slice(0,240);
      if(r.status===429||r.status>=500){
        const ra=Number(r.headers.get("retry-after")||0);
        await wait(Math.min(6000,Math.max(500,ra>0?ra*1000:500*Math.pow(2,i))));
        continue;
      }
      throw Object.assign(new Error(last),{status:r.status});
    }catch(e:any){
      if(e?.status)throw e;
      last=e?.name==="AbortError"?"riot_timeout":text(e?.message||e);
      if(i<3){await wait(Math.min(4000,500*Math.pow(2,i)));continue;}
    }finally{clearTimeout(timer);}
  }
  throw new Error(last);
}
async function getProfile(sb:any,owner:any,id:any){
  const {data,error}=await sb.from("league_profiles_v1").select("*").eq("id",text(id)).eq("owner_player_id",owner).maybeSingle();
  if(error||!data)throw Object.assign(new Error("profile_not_found"),{status:404});
  return data;
}
async function resolveProfile(sb:any,p:any,requestKey="",allowServerKey=true){
  if(text(p.puuid))return p;
  const gn=text(p.game_name),tag=text(p.tag_line);
  if(!gn||!tag)throw Object.assign(new Error("riot_id_required"),{status:400});
  const rr=text(p.routing_region)||routeFor(p.platform_region);
  const account=await riot("https://"+rr+".api.riotgames.com/riot/account/v1/accounts/by-riot-id/"+encodeURIComponent(gn)+"/"+encodeURIComponent(tag),requestKey,allowServerKey);
  const patch={puuid:text(account?.puuid),riot_account:account,last_resolved_at:now(),routing_region:rr,updated_at:now()};
  if(!patch.puuid)throw new Error("riot_account_missing_puuid");
  const {data,error}=await sb.from("league_profiles_v1").update(patch).eq("id",p.id).select("*").single();
  if(error)throw error;
  return data;
}

async function rankSnapshotFor(p:any,requestKey="",allowServerKey=true){
  if(!p||!text(p.puuid))return null;
  try{
    const plat=platform(p.platform_region);
    const rows=await riot("https://"+plat+".api.riotgames.com/lol/league/v4/entries/by-puuid/"+encodeURIComponent(p.puuid),requestKey,allowServerKey);
    if(!Array.isArray(rows))return null;
    const compact=(x:any)=>x?{
      queueType:text(x.queueType),tier:text(x.tier).toUpperCase(),rank:text(x.rank).toUpperCase(),
      leaguePoints:num(x.leaguePoints),wins:num(x.wins),losses:num(x.losses),
      veteran:!!x.veteran,hotStreak:!!x.hotStreak,freshBlood:!!x.freshBlood,inactive:!!x.inactive
    }:null;
    const solo=compact(rows.find((x:any)=>text(x?.queueType)==="RANKED_SOLO_5x5")),flex=compact(rows.find((x:any)=>text(x?.queueType)==="RANKED_FLEX_SR")),pick=solo||flex;
    if(!pick)return null;
    const byQueue:any={};if(solo)byQueue.RANKED_SOLO_5x5=solo;if(flex)byQueue.RANKED_FLEX_SR=flex;
    return{...pick,byQueue,schema:"rank_snapshot_v2",fetchedAt:now()};
  }catch(_){return null;}
}
function rankEntryFor(snapshot:any,queueType:any){
  const q=text(queueType).toUpperCase();if(!snapshot||!q)return null;
  const nested=snapshot?.byQueue?.[q];if(nested&&text(nested.tier))return nested;
  return text(snapshot?.queueType).toUpperCase()===q&&text(snapshot?.tier)?snapshot:null;
}
function rankComparisonForGame(g:any,playerRank:any){
  const peerRank=g?.peer?.rank;if(!playerRank||!peerRank)return null;
  const q=Number(g?.queueId||0),queues=q===420?["RANKED_SOLO_5x5"]:q===440?["RANKED_FLEX_SR"]:["RANKED_SOLO_5x5","RANKED_FLEX_SR"];
  for(const queueType of queues){
    const own=rankEntryFor(playerRank,queueType),peer=rankEntryFor(peerRank,queueType),ownScore=rankScore(own),peerScore=rankScore(peer);
    if(ownScore!=null&&peerScore!=null)return{queueType,own,peer,ownScore,peerScore,ownBand:Math.floor(Number(ownScore)),peerBand:Math.floor(Number(peerScore))};
  }
  return null;
}

const RANK_TIERS=["IRON","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","MASTER","GRANDMASTER","CHALLENGER"];
const RANK_DIVISIONS:any={IV:0,III:1,II:2,I:3};
function rankScore(r:any){
  if(!r||!text(r.tier))return null;
  const ti=RANK_TIERS.indexOf(text(r.tier).toUpperCase());if(ti<0)return null;
  const div=RANK_DIVISIONS[text(r.rank).toUpperCase()]??0;
  return ti*4+div+(Number(r.leaguePoints||0)/1000);
}
function rankLabel(r:any){
  if(!r||!text(r.tier))return"Unranked / unknown";
  return [text(r.tier).toUpperCase(),text(r.rank).toUpperCase(),hasNum(r.leaguePoints)?String(r.leaguePoints)+" LP":""].filter(Boolean).join(" ");
}

const LEGENDSTRACKER_RANK_BASELINES_20260323:any={
  IRON:{csMin:4.9,kda:2.4,kp:37,dpm:544,gpm:350,deaths:7.5},
  BRONZE:{csMin:5.8,kda:3.4,kp:45,dpm:698,gpm:401,deaths:6.5},
  SILVER:{csMin:6.6,kda:3.5,kp:46,dpm:809,gpm:434,deaths:6.4},
  GOLD:{csMin:6.8,kda:3.5,kp:46,dpm:739,gpm:428,deaths:6.4},
  PLATINUM:{csMin:7.1,kda:3.5,kp:46,dpm:763,gpm:438,deaths:6.4},
  EMERALD:{csMin:7.6,kda:3.6,kp:47,dpm:774,gpm:454,deaths:6.2},
  DIAMOND:{csMin:7.6,kda:3.6,kp:48,dpm:760,gpm:452,deaths:6.0},
  MASTER:{csMin:7.7,kda:3.6,kp:48,dpm:731,gpm:448,deaths:5.8},
  GRANDMASTER:{csMin:7.9,kda:3.9,kp:49,dpm:762,gpm:457,deaths:5.5},
  CHALLENGER:{csMin:8.1,kda:4.2,kp:50,dpm:798,gpm:466,deaths:5.3}
};
const LEGENDSTRACKER_ADC_MULTIPLIERS_20260323={csMin:1.1,kp:1.1,dpm:1.1};
function externalAdcTierBenchmark(tier:any){
  const key=text(tier).toUpperCase(),base=LEGENDSTRACKER_RANK_BASELINES_20260323[key];if(!base)return null;
  return{
    tier:key,
    csMin:Number((base.csMin*LEGENDSTRACKER_ADC_MULTIPLIERS_20260323.csMin).toFixed(2)),
    kp:Number((base.kp*LEGENDSTRACKER_ADC_MULTIPLIERS_20260323.kp).toFixed(1)),
    dpm:Number((base.dpm*LEGENDSTRACKER_ADC_MULTIPLIERS_20260323.dpm).toFixed(0)),
    kda:base.kda,
    deaths:base.deaths,
    gpm:base.gpm
  };
}
function externalAdcBenchmarkSet(rankSnapshot:any,cohortQueueId:any,selectedRole:any){
  const selectedRoleKey=role(selectedRole),queueId=Number(cohortQueueId||0),rankedQueueType=queueId===420?"RANKED_SOLO_5x5":queueId===440?"RANKED_FLEX_SR":null;
  const rankedEntry=rankedQueueType?rankEntryFor(rankSnapshot,rankedQueueType):null,tier=text(rankedEntry?.tier).toUpperCase(),idx=RANK_TIERS.indexOf(tier);
  const eligible=selectedRoleKey==="ADC"&&!!rankedQueueType&&idx>=0,sourceCapturedAt="2026-03-23",capturedMs=Date.parse(sourceCapturedAt+"T00:00:00Z"),calibrationAgeDays=Number.isFinite(capturedMs)?Math.max(0,Math.floor((Date.now()-capturedMs)/86400000)):null;
  const at=(offset:number)=>eligible&&idx+offset<RANK_TIERS.length?externalAdcTierBenchmark(RANK_TIERS[idx+offset]):null;
  return{
    source:"LegendsTracker methodology",
    sourceUrl:"https://legendstracker.fr/methodologie",
    sourceCapturedAt,
    sourceCapturedPatch:"26.6",
    sourceCapturedPatchBasis:"Riot patch 26.6 was live on the 2026-03-23 corpus capture date",
    calibrationAgeDays,
    freshnessStatus:hasNum(calibrationAgeDays)&&Number(calibrationAgeDays)>90?"historical_reference":"recent_reference",
    referenceOnly:true,
    coachingEligible:false,
    sourceCorpus:"830k+ ranked EUW1 games",
    sourcePopulation:"ranked_euw1",
    role:"ADC",
    sourceRole:"Bot (ADC)",
    roleLabel:"ADC",
    cohortQueueId:queueId||null,
    cohortQueueType:rankedQueueType,
    eligible,
    eligibilityReason:selectedRoleKey!=="ADC"?"selected_role_not_adc":!rankedQueueType?"selected_cohort_not_ranked":idx<0?"matching_rank_queue_tier_unavailable":"ranked_queue_and_tier_available",
    methodology:"Rank-level averages from the published ranked corpus. CS/min, KP and DPM are adjusted using the source's Bot (ADC) role multipliers ×1.1; KDA, deaths/game and GPM use the published rank averages directly. These values are visual/reference context only and are never inputs to coaching priority, practice targets, or rank predictions.",
    currentTier:tier||null,
    same:at(0),
    plus1:at(1),
    plus2:at(2)
  };
}


let dataDragonVersionsCache:string[]=[];
let dataDragonVersionsFetchedAt=0;
const itemCatalogByVersion=new Map<string,{data:any,fetchedAt:number}>();
async function dataDragonVersions(){
  if(dataDragonVersionsCache.length&&(Date.now()-dataDragonVersionsFetchedAt)<6*60*60*1000)return dataDragonVersionsCache;
  try{
    const versions=await fetch("https://ddragon.leagueoflegends.com/api/versions.json",{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():[]);
    if(Array.isArray(versions)&&versions.length){dataDragonVersionsCache=versions.map(String);dataDragonVersionsFetchedAt=Date.now();}
  }catch(_){}
  return dataDragonVersionsCache;
}
async function itemCatalogForPatch(requestedPatch:any=null){
  const requested=patchKey(requestedPatch),versions=await dataDragonVersions();
  const matched=requested?versions.find((v:string)=>patchKey(v)===requested):versions[0],version=matched||versions[0]||null;
  const exact=!!requested&&!!matched&&patchKey(matched)===requested,fallback=!!requested&&!exact;
  if(!version)return{data:{},requestedPatch:requested,version:null,exact:false,fallback};
  const cached=itemCatalogByVersion.get(version);
  if(cached&&(Date.now()-cached.fetchedAt)<6*60*60*1000)return{data:cached.data,requestedPatch:requested,version,exact:requested?exact:true,fallback};
  try{
    const payload=await fetch("https://ddragon.leagueoflegends.com/cdn/"+encodeURIComponent(version)+"/data/en_US/item.json",{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():null),data=payload?.data||{};
    itemCatalogByVersion.set(version,{data,fetchedAt:Date.now()});
    return{data,requestedPatch:requested,version,exact:requested?exact:true,fallback};
  }catch(_){
    return{data:cached?.data||{},requestedPatch:requested,version,exact:requested?exact:true,fallback};
  }
}

function nearestFrame(frames:any[],minute:number){
  if(!frames?.length)return null;
  const target=minute*60000;let best=null,d=Infinity;
  for(const f of frames){const x=Math.abs(Number(f?.timestamp||0)-target);if(x<d){best=f;d=x;}}
  return best;
}
function frameNearMinute(frames:any[],minute:number,maxDeltaMs=90000){
  if(!frames?.length)return null;
  const target=minute*60000;let best=null,d=Infinity;
  for(const f of frames){const x=Math.abs(Number(f?.timestamp||0)-target);if(x<d){best=f;d=x;}}
  return d<=maxDeltaMs?best:null;
}
function frameAtMs(frames:any[],ms:number){
  if(!frames?.length)return null;
  let chosen=frames[0]||null;
  for(const f of frames){if(Number(f?.timestamp||0)<=ms)chosen=f;else break;}
  return chosen;
}
function frameNearestMs(frames:any[],ms:number,maxDeltaMs=45000){
  if(!frames?.length)return null;
  let best=null,d=Infinity;
  for(const f of frames){const x=Math.abs(Number(f?.timestamp||0)-ms);if(x<d){best=f;d=x;}}
  return d<=maxDeltaMs?best:null;
}
function frameAfterMs(frames:any[],ms:number,maxWaitMs=90000){
  if(!frames?.length)return null;
  for(const f of frames){
    const t=Number(f?.timestamp||0);
    if(t>=ms)return t-ms<=maxWaitMs?f:null;
  }
  return null;
}
function frameStats(frame:any,pid:any){
  const p=frame?.participantFrames?.[String(pid)]||frame?.participantFrames?.[pid];
  if(!p)return null;
  return{gold:num(p.totalGold),currentGold:num(p.currentGold),cs:Number(p.minionsKilled||0)+Number(p.jungleMinionsKilled||0),xp:num(p.xp),level:num(p.level),position:xy(p.position)};
}
function participantRoleEvidence(p:any){
  const team=role(p?.teamPosition),individual=role(p?.individualPosition);
  if(team!=="GENERIC"&&individual!=="GENERIC"&&team!==individual){
    return{role:"GENERIC",confidence:"conflict",source:"teamPosition+individualPosition",teamPosition:team,individualPosition:individual,rawTeamPosition:text(p?.teamPosition),rawIndividualPosition:text(p?.individualPosition)};
  }
  const candidates=[
    {source:"teamPosition",raw:p?.teamPosition,value:team},
    {source:"individualPosition",raw:p?.individualPosition,value:individual},
    {source:"role",raw:p?.role,value:role(p?.role)},
    {source:"lane",raw:p?.lane,value:role(p?.lane)}
  ];
  const chosen=candidates.find((x:any)=>x.value!=="GENERIC"),confidence=!chosen?"missing":(chosen.source==="teamPosition"||chosen.source==="individualPosition")?"high":"fallback";
  return{role:chosen?.value||"GENERIC",confidence,source:chosen?.source||null,raw:chosen?text(chosen.raw):null,teamPosition:team,individualPosition:individual};
}
function participantRole(p:any){return participantRoleEvidence(p).role;}
function opponentResolution(match:any,p:any){
  const evidence=participantRoleEvidence(p),rr=evidence.role,ps=Array.isArray(match?.info?.participants)?match.info.participants:[];
  if(rr==="GENERIC")return{opponent:null,role:rr,candidateCount:0,reason:evidence.confidence==="conflict"?"player_role_conflict":"player_role_missing"};
  const candidates=ps.filter((x:any)=>Number(x.teamId)!==Number(p?.teamId)&&participantRole(x)===rr);
  if(candidates.length!==1)return{opponent:null,role:rr,candidateCount:candidates.length,reason:candidates.length?"ambiguous_enemy_role":"enemy_role_missing",opponentRoleConfidence:null,opponentRoleSource:null};
  const opponentEvidence=participantRoleEvidence(candidates[0]);
  return{opponent:candidates[0],role:rr,candidateCount:1,reason:null,opponentRoleConfidence:opponentEvidence.confidence,opponentRoleSource:opponentEvidence.source};
}
function opponent(match:any,p:any){return opponentResolution(match,p).opponent;}
function dist2(a:any,b:any){
  if(!a||!b||a.x==null||a.y==null||b.x==null||b.y==null)return Infinity;
  const dx=Number(a.x)-Number(b.x),dy=Number(a.y)-Number(b.y);return dx*dx+dy*dy;
}
function pointSegDist2(p:any,a:any,b:any){
  const px=Number(p?.x),py=Number(p?.y),ax=Number(a.x),ay=Number(a.y),bx=Number(b.x),by=Number(b.y);
  if(![px,py,ax,ay,bx,by].every(Number.isFinite))return Infinity;
  const vx=bx-ax,vy=by-ay,wx=px-ax,wy=py-ay,den=vx*vx+vy*vy;
  const t=den?Math.max(0,Math.min(1,(wx*vx+wy*vy)/den)):0;
  const dx=px-(ax+t*vx),dy=py-(ay+t*vy);return dx*dx+dy*dy;
}
function laneDistance2(pos:any,lane:string){
  const paths:any={
    TOP:[[{x:1800,y:1800},{x:1500,y:12800}],[{x:1500,y:12800},{x:13200,y:13200}]],
    MID:[[{x:2200,y:2200},{x:12800,y:12800}]],
    BOT:[[{x:1800,y:1800},{x:12800,y:1500}],[{x:12800,y:1500},{x:13200,y:13200}]]
  };
  return Math.min(...(paths[lane]||[]).map((seg:any)=>pointSegDist2(pos,seg[0],seg[1])));
}
function zoneFor(mapId:any,pos:any,teamId:any){
  if(Number(mapId)!==11||!pos)return"unknown";
  const x=Number(pos.x),y=Number(pos.y);if(!Number.isFinite(x)||!Number.isFinite(y))return"unknown";
  if((Number(teamId)===100&&x<3000&&y<3000)||(Number(teamId)===200&&x>12000&&y>12000))return"base";
  const laneRadius2=1500*1500;
  const ds=[["top lane",laneDistance2(pos,"TOP")],["mid lane",laneDistance2(pos,"MID")],["bot lane",laneDistance2(pos,"BOT")]].sort((a:any,b:any)=>a[1]-b[1]);
  if(Number(ds[0][1])<=laneRadius2)return String(ds[0][0]);
  if(Math.abs((x+y)-15000)<=1500&&x>2500&&x<12500&&y>2500&&y<12500)return"river";
  return"jungle";
}
function homeLaneForRole(rr:string){
  if(rr==="TOP")return"top lane";if(rr==="MID")return"mid lane";if(rr==="ADC"||rr==="SUPPORT")return"bot lane";if(rr==="JUNGLE")return"jungle";return null;
}
function deathArea(mapId:any,pos:any,teamId:any){
  const zone=zoneFor(mapId,pos,teamId);
  if(zone!=="jungle")return zone;
  if(!pos)return"jungle";
  const sum=Number(pos.x)+Number(pos.y);if(!Number.isFinite(sum))return"jungle";
  if(sum>=13500&&sum<=16500)return"neutral jungle";
  const enemy=Number(teamId)===100?sum>16500:Number(teamId)===200?sum<13500:false;
  return enemy?"enemy jungle":"own jungle";
}
function fightArea(mapId:any,pos:any,teamId:any){
  if(Number(mapId)!==11||!pos)return"unknown";
  let x=Number(pos.x),y=Number(pos.y);if(!Number.isFinite(x)||!Number.isFinite(y))return"unknown";
  // Normalize both teams to the blue-side perspective so "our/their" map labels
  // mean the same thing regardless of which side the reviewed account spawned on.
  if(Number(teamId)===200){x=15000-x;y=15000-y;}
  const p={x,y},zone=zoneFor(11,p,100);
  if(zone==="base")return"our base";
  if(zone==="river"){
    if(Math.abs(x-y)<900)return"mid river";
    return y>x?"top river":"bot river";
  }
  if(zone==="jungle"){
    const sum=x+y;
    if(sum>=13500&&sum<=16500)return y>x?"top river-jungle entrances":"bot river-jungle entrances";
    if(sum<13500)return x>y?"our red-side jungle":"our blue-side jungle";
    return x>y?"their blue-side jungle":"their red-side jungle";
  }
  const own={x:1800,y:1800},enemy={x:13200,y:13200},dOwn=Math.sqrt(dist2(p,own)),dEnemy=Math.sqrt(dist2(p,enemy)),progress=(dOwn+dEnemy)>0?dOwn/(dOwn+dEnemy):.5;
  const lane=zone.replace(" lane","");
  if(progress<.18)return"our "+lane+" inner-tower area";
  if(progress<.36)return"our "+lane+" outer-tower area";
  if(progress>.82)return"their "+lane+" inner-tower area";
  if(progress>.64)return"their "+lane+" outer-tower area";
  return lane+" lane central";
}
function wardTerritory(teamId:any,pos:any){
  if(!pos)return"unknown";const sum=Number(pos.x)+Number(pos.y);if(!Number.isFinite(sum))return"unknown";
  if(sum>=13500&&sum<=16500)return"river";
  if(Number(teamId)===100)return sum>16500?"offensive":"defensive";
  if(Number(teamId)===200)return sum<13500?"offensive":"defensive";
  return"unknown";
}
const VERIFIED_2026_RULES_THROUGH_MINOR=19;
const STANDARD_PVP_SR_QUEUE_IDS=new Set([400,420,430,440,490,700]);
const ASSIGNED_POSITION_SR_QUEUE_IDS=new Set([400,420,440,490]);
const SWIFTPLAY_SR_QUEUE_IDS=new Set([480]);
function supportedLeagueQueue(queueId:any){
  const q=Number(queueId||0);
  if(STANDARD_PVP_SR_QUEUE_IDS.has(q)){
    const roleQuestAssignmentKnown=ASSIGNED_POSITION_SR_QUEUE_IDS.has(q);
    return{supported:true,family:"standard_pvp_sr",rulesFamily:"standard",roleQuestAssignmentKnown,roleQuestAssignmentBasis:roleQuestAssignmentKnown?"assigned_position_queue":"queue_assignment_unverified"};
  }
  if(SWIFTPLAY_SR_QUEUE_IDS.has(q))return{supported:true,family:"swiftplay_sr",rulesFamily:"swiftplay",roleQuestAssignmentKnown:true,roleQuestAssignmentBasis:"swiftplay_explicit_exclusion"};
  return{supported:false,family:q?"unsupported_queue_"+q:"queue_unknown",rulesFamily:"unverified",roleQuestAssignmentKnown:false,roleQuestAssignmentBasis:"unsupported_queue"};
}
function cachedMatchStartMs(row:any){
  const direct=Number(row?.match_json?.info?.gameStartTimestamp||0);if(direct>0)return direct;
  const parsed=Date.parse(text(row?.game_start_at));return Number.isFinite(parsed)?parsed:0;
}
function cachedRowRole(row:any,puuid:any){
  const stored=role(row?.player_role);
  if(stored!=="GENERIC")return stored;
  const ps=Array.isArray(row?.match_json?.info?.participants)?row.match_json.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===text(puuid));
  return p?participantRole(p):"GENERIC";
}
function orderRowsByIds(rows:any[],ids:any[]){
  const byId=new Map((rows||[]).map((r:any)=>[text(r?.match_id||r?.match_json?.metadata?.matchId),r]));
  return (ids||[]).map((id:any)=>byId.get(text(id))).filter(Boolean);
}
function selectRecentQueueCohort(rows:any[],windowSize=20){
  const recent=[...(rows||[])].sort((a:any,b:any)=>cachedMatchStartMs(b)-cachedMatchStartMs(a)).slice(0,Math.max(1,windowSize));
  const stats=new Map<number,{count:number,newestMs:number}>();
  for(const row of recent){
    const q=Number(row?.match_json?.info?.queueId||row?.queue_id||0);if(!q)continue;
    const prev=stats.get(q)||{count:0,newestMs:0};prev.count++;prev.newestMs=Math.max(prev.newestMs,cachedMatchStartMs(row));stats.set(q,prev);
  }
  const ranked=[...stats.entries()].sort((a,b)=>Number(b[1].count)-Number(a[1].count)||Number(b[1].newestMs)-Number(a[1].newestMs)||Number(a[0])-Number(b[0]));
  return{queueId:ranked[0]?.[0]??null,windowSize:Math.max(1,windowSize),considered:recent.length,counts:Object.fromEntries(ranked.map(([q,s])=>[String(q),s.count])),basis:"dominant_within_recent_supported_window_tie_newest"};
}
const STANDARD_SR_2026_RULES={
  key:"standard_sr_2026",season:"2026",phaseComparable:true,midRoutingComparable:true,lane15Comparable:true,fixed15to25Comparable:true,closing25Comparable:true,
  // 14:00 is a current macro-transition marker because minion cadence changes there; it is NOT a plate-expiry or literal lane-ending rule.
  earlyEndMin:14,lateStartMin:20,macroTransitionMin:14,postLaneStartMin:14,roamEndMin:20,midRoutingStartMin:15,midRoutingEndMin:25,earlyKpEndMin:14,
  baronSpawnMin:20,platesPermanent:true,plateScope:"all_turrets_with_nexus_special_case",
  atakhanEnabled:false,featsOfStrengthEnabled:false,firstBloodBonusGold:100,firstTurretBonusGold:300,
  minionFastWaveStartMin:14,minionUltraFastWaveStartMin:30,sourceBasis:"patch_26_1"
};
const SWIFTPLAY_2026_RULES={
  key:"swiftplay_2026",season:"2026",phaseComparable:true,midRoutingComparable:false,lane15Comparable:false,fixed15to25Comparable:false,closing25Comparable:false,
  // Swiftplay starts accelerated and has Baron at 12:00; do not invent a standard-SR-style transition bucket.
  earlyEndMin:12,lateStartMin:12,macroTransitionMin:12,postLaneStartMin:12,roamEndMin:12,midRoutingStartMin:null,midRoutingEndMin:null,earlyKpEndMin:12,
  baronSpawnMin:12,elderSpawnMin:15,suddenDeathMin:25,startsLevel:3,startingGold:1400,
  voidGrubsEnabled:false,riftHeraldEnabled:false,elementalDrakeCap:2,dragonSoulRequirement:2,minionFrenzyEnabled:true,
  platesPermanent:true,plateScope:"all_turrets_with_nexus_special_case",sourceBasis:"swiftplay_2026"
};
const LEGACY_SR_RULES={
  key:"legacy_sr_pre2026",season:"pre2026",phaseComparable:false,midRoutingComparable:false,lane15Comparable:true,fixed15to25Comparable:true,closing25Comparable:true,
  earlyEndMin:14,lateStartMin:25,macroTransitionMin:14,postLaneStartMin:14,roamEndMin:20,midRoutingStartMin:14,midRoutingEndMin:25,earlyKpEndMin:14,
  platesPermanent:false,sourceBasis:"historical_compatibility"
};
const FUTURE_UNVERIFIED_RULES={
  key:"future_rules_unverified",season:"future",phaseComparable:false,midRoutingComparable:false,lane15Comparable:false,fixed15to25Comparable:false,closing25Comparable:false,
  earlyEndMin:14,lateStartMin:20,macroTransitionMin:14,postLaneStartMin:14,roamEndMin:20,midRoutingStartMin:15,midRoutingEndMin:25,earlyKpEndMin:14,
  platesPermanent:null,sourceBasis:"do_not_coach_from_unverified_future_mechanics"
};
function roleQuestRevisionFor2026(minor:any){
  const m=Number(minor||0);
  if(m>=19)return"26.19_top_teleport";
  if(m>=16)return"26.16_support_roam_penalty";
  if(m>=11)return"26.11_mid_8pct";
  if(m>=9)return"26.9_role_quest_rework";
  return"26.1_initial";
}
function roleQuestRevisionForRole2026(minor:any,rr:any){
  const m=Number(minor||0),role=text(rr).toUpperCase();
  if(!(m>0))return"2026_revision_unknown";
  if(role==="TOP")return m>=19?"top_26.19_teleport":m>=9?"top_26.9_xp":"top_26.1_initial";
  if(role==="MID")return m>=11?"mid_26.11_8pct":m>=9?"mid_26.9_6pct":"mid_26.1_empowered_recall";
  if(role==="ADC")return m>=9?"adc_26.9_40g_takedown":"adc_26.1_initial";
  if(role==="SUPPORT")return m>=16?"support_26.16_roam_penalty":m>=7?"support_26.7_farm_penalty_removed":"support_26.1_core";
  if(role==="JUNGLE")return"jungle_26.1_core";
  return"2026_generic_"+role.toLowerCase();
}
function gameRules(match:any){
  const queueId=Number(match?.info?.queueId||0),mode=text(match?.info?.gameMode).toUpperCase(),gv=text(match?.info?.gameVersion),parts=gv.split(".");
  const major=Number(parts[0]||0),minor=Number(parts[1]||0),start=Number(match?.info?.gameStartTimestamp||0);
  const queueProfile=supportedLeagueQueue(queueId),isSwift=queueProfile.rulesFamily==="swiftplay"||mode==="SWIFTPLAY";
  const is2026=major===16||(!major&&start>=Date.UTC(2026,0,7)&&start<Date.UTC(2027,0,1));
  if(!queueProfile.supported)return{...FUTURE_UNVERIFIED_RULES,season:"unsupported_queue",patchMinor:minor||null,publicPatchKey:publicPatchKey(gv),laneRoleQuestsEnabled:null,roleQuestRevision:"queue_unverified",verifiedThroughPublicPatch:"26."+VERIFIED_2026_RULES_THROUGH_MINOR,queueFamily:queueProfile.family,sourceBasis:"do_not_coach_from_unsupported_queue"};
  if(major>16||(!major&&start>=Date.UTC(2027,0,1)))return{...FUTURE_UNVERIFIED_RULES,patchMinor:minor||null,publicPatchKey:publicPatchKey(gv),laneRoleQuestsEnabled:null,roleQuestRevision:"future_unverified",verifiedThroughPublicPatch:"26."+VERIFIED_2026_RULES_THROUGH_MINOR,queueFamily:queueProfile.family};
  if(is2026){
    if(minor>VERIFIED_2026_RULES_THROUGH_MINOR)return{...FUTURE_UNVERIFIED_RULES,season:"2026_unverified_minor",patchMinor:minor,publicPatchKey:publicPatchKey(gv),laneRoleQuestsEnabled:null,roleQuestRevision:"2026_minor_unverified",verifiedThroughPublicPatch:"26."+VERIFIED_2026_RULES_THROUGH_MINOR,queueFamily:queueProfile.family,sourceBasis:"2026_minor_newer_than_verified_rules"};
    const base=isSwift?SWIFTPLAY_2026_RULES:STANDARD_SR_2026_RULES,revision=minor>0?roleQuestRevisionFor2026(minor):"2026_revision_unknown",questKnown=isSwift||queueProfile.roleQuestAssignmentKnown===true;
    return{...base,patchMinor:minor||null,publicPatchKey:publicPatchKey(gv),laneRoleQuestsEnabled:isSwift?false:questKnown?true:null,roleQuestRevision:isSwift?"swiftplay_legacy_quest_model":questKnown?revision:"queue_assignment_unverified",roleQuestAssignmentBasis:queueProfile.roleQuestAssignmentBasis,verifiedThroughPublicPatch:"26."+VERIFIED_2026_RULES_THROUGH_MINOR,queueFamily:queueProfile.family,sourceBasis:isSwift?"swiftplay_2026":questKnown?("2026_standard|"+revision):"2026_standard|quest_assignment_unverified"};
  }
  return{...LEGACY_SR_RULES,patchMinor:minor||null,publicPatchKey:publicPatchKey(gv),laneRoleQuestsEnabled:false,roleQuestRevision:"legacy_pre2026",queueFamily:queueProfile.family};
}
function roleQuestContext(rules:any,rr:string){
  const roleName=text(rr).toUpperCase(),minor=Number(rules?.patchMinor||0),revision=rules?.key==="standard_sr_2026"?roleQuestRevisionForRole2026(minor,roleName):text(rules?.roleQuestRevision);
  if(rules?.laneRoleQuestsEnabled===null)return{enabled:null,role:roleName,revision,known:false,economyCheckpointCaveat:true,note:rules?.season==="2026_unverified_minor"?"This 2026 minor patch is newer than the analyzer’s verified rules boundary ("+text(rules?.verifiedThroughPublicPatch||"unknown")+"); mechanics-sensitive assumptions are suppressed until audited.":revision==="queue_assignment_unverified"?"Standard Summoner's Rift mechanics remain usable, but this queue does not provide verified assigned-position Role Quest evidence, so quest-specific economy/reward assumptions are withheld.":"Future mechanics are unverified; no current role-quest assumptions are applied."};
  if(rules?.key==="swiftplay_2026")return{enabled:false,role:roleName,revision,known:true,economyCheckpointCaveat:false,note:"Swiftplay does not use the standard 2026 lane-role quest package; accelerated queue rules are kept separate."};
  if(rules?.key!=="standard_sr_2026")return{enabled:false,role:roleName,revision,known:false,economyCheckpointCaveat:false,note:"Historical game; current 2026 role-quest assumptions are not back-applied."};
  if(!(minor>0))return{enabled:true,role:roleName,revision:"2026_revision_unknown",known:false,economyCheckpointCaveat:true,completionObserved:false,completionTime:null,reward:"2026 standard role quest",detail:"Exact 2026 minor patch is unavailable, so patch-specific reward details are not asserted.",checkpointEffect:"Observed gold/XP/level can include quest rewards, but the analyzer does not guess which 2026 reward revision applied."};
  const base:any={enabled:true,role:roleName,revision,known:true,economyCheckpointCaveat:true,completionObserved:false,completionTime:null};
  if(roleName==="TOP")return{...base,reward:"Level cap 20 and role-quest XP/Teleport package",detail:minor>=19?"Current cohort includes the 26.19 shorter Teleport cooldown revision.":minor>=9?"26.9+ top reward uses the revised XP package.":"Initial 26.1 top role-quest reward package.",checkpointEffect:"XP/level checkpoints can include quest reward effects once completed."};
  if(roleName==="JUNGLE")return{...base,reward:"35-stack jungle quest with post-completion camp gold/XP and jungle/river movement reward",detail:"Standard 2026 jungle quest context.",checkpointEffect:"Gold/XP checkpoints can include post-quest camp bonuses once completed."};
  if(roleName==="MID"){
    const detail=minor>=11?"26.11+ mid reward includes +8% bonus AD/AP after quest completion.":minor>=9?"26.9–26.10 mid reward used +6% bonus AD/AP after quest completion.":"26.1–26.8 mid reward used the initial empowered-Recall package.";
    return{...base,reward:"Free tier-3 boots plus patch-specific mid role reward",detail,checkpointEffect:"Damage/item-power interpretation changes across 26.9/26.11 even when raw gold is unchanged."};
  }
  if(roleName==="ADC")return{...base,reward:"Bot quest income package and boots-slot upgrade",detail:minor>=9?"26.9+ takedown bonus is 40g; completion still adds the bot income package.":"Initial 26.1 bot quest used the earlier takedown reward.",checkpointEffect:"Gold checkpoints can include quest completion and post-completion lane/takedown income."};
  if(roleName==="SUPPORT")return{...base,reward:"Support quest plus post-completion control-ward discount/storage",detail:minor>=16?"26.16+ support quest progression penalizes heavy early roaming more strongly; the 26.7 removal of the rapid-minion-farming gold penalty also remains in effect. Control Wards cost 40g after quest completion.":minor>=7?"26.7–26.15 support context: the old rapid-minion-farming gold penalty is removed; Control Wards cost 40g after quest completion.":"26.1–26.6 support context retains the earlier anti-fast-farming gold rule; Control Wards cost 40g after quest completion.",checkpointEffect:"Support CS/GPM is not directly comparable across the 26.7 farm-penalty boundary, and roaming/quest timing is not directly comparable across 26.16; later shop-spend estimates that include Control Wards can differ from static Data Dragon prices.",spendEstimateCaveat:"support_quest_control_ward_discount_unobserved",controlWardPriceAfterQuest:40};
  return{...base,reward:"Role-quest package",detail:"Role-specific reward context unavailable for this normalized role.",checkpointEffect:"Gold/XP checkpoints may include quest rewards."};
}
function isNeutralObjectiveEvent(o:any){return text(o?.type)==="ELITE_MONSTER_KILL";}
function isStructureEvent(o:any){const t=text(o?.type);return t==="BUILDING_KILL"||t==="TURRET_PLATE_DESTROYED";}
function participantNearEvent(frames:any[],participantId:number,event:any,radius=2200,maxFrameDeltaMs=35000){
  if(!event||!hasNum(event.x)||!hasNum(event.y))return false;
  // Riot participant positions are frame-sampled. Anchor presence to the nearest
  // frame to the actual event and reject evidence that is too temporally distant.
  const fr=frameNearestMs(frames,Number(event.tMs||0),maxFrameDeltaMs),fs=frameStats(fr,participantId);
  return !!(fs?.position&&dist2(fs.position,event)<=radius*radius);
}
function structureEventLane(event:any){
  const lane=text(event?.laneType).toUpperCase();
  if(lane.includes("TOP"))return"top lane";
  if(lane.includes("MID"))return"mid lane";
  if(lane.includes("BOT")||lane.includes("BOTTOM"))return"bot lane";
  return null;
}
function turretTier(event:any){
  const t=text(event?.towerType).toUpperCase();
  if(t.includes("OUTER"))return"outer";
  if(t.includes("INNER"))return"inner";
  if(t.includes("BASE")||t.includes("INHIB"))return"inhibitor";
  if(t.includes("NEXUS"))return"nexus";
  return"unknown";
}
function structureInvolvementEvidence(event:any,frames:any[],participantId:number,participantTeam:number,mapId=11){
  if(Number(event?.ownerTeam)!==Number(participantTeam))return null;
  if(Number(event?.killerId)===Number(participantId))return"direct_event_credit";
  if(participantNearEvent(frames,participantId,event,2200))return"event_position_proximity";
  // TURRET_PLATE_DESTROYED often has lane/tower metadata but no x/y coordinates. Use the nearest timeline
  // frame only as supported lane-presence evidence instead of incorrectly treating missing killerId as no involvement.
  const lane=structureEventLane(event);
  if(lane&&Number(mapId)===11){
    const fs=frameStats(frameNearestMs(frames,Number(event?.tMs||0),45000),participantId),zone=fs?.position?zoneFor(mapId,fs.position,participantTeam):null;
    if(zone===lane)return"timeline_lane_presence";
  }
  return null;
}
function structureStrongInvolvementEvidence(event:any,frames:any[],participantId:number,participantTeam:number,mapId=11){
  const evidence=structureInvolvementEvidence(event,frames,participantId,participantTeam,mapId);
  return evidence==="direct_event_credit"||evidence==="event_position_proximity"?evidence:null;
}
function structureInvolvement(event:any,frames:any[],participantId:number,participantTeam:number,mapId=11){
  return !!structureStrongInvolvementEvidence(event,frames,participantId,participantTeam,mapId);
}
function structureLanePresenceOnly(event:any,frames:any[],participantId:number,participantTeam:number,mapId=11){
  return structureInvolvementEvidence(event,frames,participantId,participantTeam,mapId)==="timeline_lane_presence";
}
function hasLeftBaseBefore(frames:any[],participantId:number,mapId:number,teamId:number,beforeMs:number){
  return (frames||[]).some((fr:any)=>{
    const t=Number(fr?.timestamp||0);if(t<=0||t>=beforeMs)return false;
    const fs=frameStats(fr,participantId);return !!(fs?.position&&zoneFor(mapId,fs.position,teamId)!=="base");
  });
}
function applyDynamicShopSpendBounds(visits:any[],roleQuest:any){
  const caveat=text(roleQuest?.spendEstimateCaveat),controlWardFloor=Number(roleQuest?.controlWardPriceAfterQuest||0);
  for(const v of visits||[]){
    v.spendEstimateCaveats=Array.isArray(v.spendEstimateCaveats)?v.spendEstimateCaveats:[];
    if(caveat&&controlWardFloor>0){
      const wards=(v.items||[]).filter((it:any)=>Number(it.itemId)===2055||text(it.name).toLowerCase()==="control ward");
      if(wards.length){
        v.spendApproximate=true;
        if(!v.spendEstimateCaveats.includes(caveat))v.spendEstimateCaveats.push(caveat);
        if(hasNum(v.spentLowerBound)){
          const possibleDiscount=wards.reduce((n:number,it:any)=>n+Math.max(0,Number(it.cost||it.totalCost||0)-controlWardFloor),0);
          v.spentLowerBound=Math.max(0,Number(v.spentLowerBound)-possibleDiscount);
        }
      }
    }
    v.spendEstimateCaveat=v.spendEstimateCaveats.length?v.spendEstimateCaveats.join("|"):null;
  }
  return visits;
}
function firstMeaningfulReturnShop(visits:any[],frames:any[],participantId:number,mapId:number,teamId:number){
  return (visits||[]).find((v:any)=>Number(v.startMin)<=12&&hasNum(v.spentLowerBound)&&Number(v.spentLowerBound)>=250&&hasLeftBaseBefore(frames,participantId,mapId,teamId,Number(v.startMs)))||null;
}
function phaseExposureMinutes(durationMin:any,phase:string,rules:any){
  const d=Math.max(0,Number(durationMin||0)),early=Number(rules?.earlyEndMin||14),late=Number(rules?.lateStartMin||20);
  if(phase==="early")return Math.min(d,early);
  if(phase==="mid")return Math.max(0,Math.min(d,late)-early);
  return Math.max(0,d-late);
}

function neutralObjectiveFamily(o:any){
  const mt=text(o?.monsterType).toUpperCase(),st=text(o?.monsterSubType).toUpperCase();
  return mt||st||"NEUTRAL_OBJECTIVE";
}
function neutralObjectiveWindows(events:any[]){
  const sorted=[...(events||[])].filter(isNeutralObjectiveEvent).sort((a:any,b:any)=>Number(a.tMs)-Number(b.tMs)),windows:any[]=[];
  for(const ev of sorted){
    const family=neutralObjectiveFamily(ev),team=Number(ev.ownerTeam||0);
    let w=windows[windows.length-1];
    // Group one contested multi-kill encounter even when ownership is split (for example a 2-1 Void Grub camp).
    const merge=!!w&&w.family===family&&Number(ev.tMs)-Number(w.endMs)<=90000;
    if(!merge){
      w={family,objectiveType:text(ev.monsterType||ev.monsterSubType||"neutral objective"),startMs:Number(ev.tMs),endMs:Number(ev.tMs),startMin:Number(ev.tMin),endMin:Number(ev.tMin),count:0,members:[],ownerCounts:{}};
      windows.push(w);
    }
    w.endMs=Number(ev.tMs);w.endMin=Number(ev.tMin);w.count++;w.members.push(ev);
    if(team===100||team===200)w.ownerCounts[String(team)]=Number(w.ownerCounts[String(team)]||0)+1;
  }
  return windows;
}
function objectiveWindowNear(frames:any[],participantId:number,w:any,radius=2500){
  const members=(w?.members||[]).filter((x:any)=>hasNum(x.x)&&hasNum(x.y)&&hasNum(x.tMs));
  if(!members.length)return false;
  return members.some((event:any)=>participantNearEvent(frames,participantId,event,radius,35000));
}
function objectiveWindowParticipantsNear(frames:any[],participantIds:number[],w:any,radius=2500){
  const out:number[]=[];
  for(const id of participantIds||[])if(objectiveWindowNear(frames,Number(id),w,radius))out.push(Number(id));
  return out;
}
function objectiveWindowSetupFrame(frames:any[],participantId:number,w:any){
  const points=(w?.members||[]).filter((x:any)=>hasNum(x.x)&&hasNum(x.y)),startMs=Number(w?.startMs||0);if(!points.length||!(startMs>0))return null;
  // Riot participant positions are coarse timeline samples. Use the latest supported frame
  // in a 45–105 second pre-objective band: this targets genuine prior setup while avoiding
  // credit from an incidental pass nearly two minutes before the contest.
  let best:any=null;
  for(const fr of frames||[]){
    const t=Number(fr?.timestamp||0),leadMs=startMs-t;if(leadMs<45000||leadMs>105000)continue;
    const fs=frameStats(fr,participantId);if(fs?.position&&points.some((p:any)=>dist2(fs.position,p)<=3000*3000)){if(!best||t>Number(best.timestamp||0))best=fr;}
  }
  return best;
}
function objectiveOwnerTeam(e:any,byId:Map<number,any>){
  if(e?.type==="ELITE_MONSTER_KILL"){
    const killerTeamId=Number(e?.killerTeamId||0);if(killerTeamId===100||killerTeamId===200)return killerTeamId;
    if(byId.has(Number(e.killerId)))return Number(byId.get(Number(e.killerId))?.teamId)||null;
  }
  if(e?.type==="BUILDING_KILL"||e?.type==="TURRET_PLATE_DESTROYED"){
    if(byId.has(Number(e.killerId)))return Number(byId.get(Number(e.killerId))?.teamId)||null;
    const victimTeam=Number(e?.teamId);if(victimTeam===100)return 200;if(victimTeam===200)return 100;
  }
  return null;
}
function playerInKill(e:any,pid:any){
  return Number(e?.killerId)===Number(pid)||(Array.isArray(e?.assistingParticipantIds)&&e.assistingParticipantIds.map(Number).includes(Number(pid)));
}
function repeatDeathSummary(events:any[],windowMs=240000){
  const sorted=[...(events||[])].sort((a:any,b:any)=>Number(a.tMs)-Number(b.tMs)),pairs:any[]=[];
  for(let i=1;i<sorted.length;i++){
    const prev=sorted[i-1],cur=sorted[i],gapMs=Number(cur.tMs)-Number(prev.tMs);
    if(gapMs>=0&&gapMs<=windowMs)pairs.push({firstMs:Number(prev.tMs),secondMs:Number(cur.tMs),firstMin:Number(prev.tMin),secondMin:Number(cur.tMin),gapSec:Math.round(gapMs/1000)});
  }
  const opportunities=Math.max(0,sorted.length-1);
  return{deaths:sorted.length,opportunities,repeatDeaths:pairs.length,rate:opportunities?100*pairs.length/opportunities:null,events:pairs};
}
function killConversionWindows(kills:any[],objectives:any[]){
  const sorted=[...(kills||[])].sort((a,b)=>a.tMs-b.tMs),windows:any[]=[];
  for(const ev of sorted){
    let w=windows[windows.length-1];
    if(!w||ev.tMs-w.endMs>30000){w={startMs:ev.tMs,endMs:ev.tMs,kills:1,events:[ev]};windows.push(w);}
    else{w.endMs=ev.tMs;w.kills++;w.events.push(ev);}
  }
  const objs=[...(objectives||[])].sort((a,b)=>a.tMs-b.tMs),usedTeam=new Set<number>(),usedSupported=new Set<number>();
  for(const w of windows){
    let teamIndex=-1,supportedIndex=-1;
    for(let i=0;i<objs.length;i++){
      const o=objs[i];if(o.tMs<w.endMs)continue;if(o.tMs>w.endMs+75000)break;
      if(teamIndex<0&&!usedTeam.has(i))teamIndex=i;
      if(supportedIndex<0&&!usedSupported.has(i)&&o.playerSupported===true)supportedIndex=i;
      if(teamIndex>=0&&supportedIndex>=0)break;
    }
    const teamHit=teamIndex>=0?objs[teamIndex]:null,supportedHit=supportedIndex>=0?objs[supportedIndex]:null;
    if(teamIndex>=0)usedTeam.add(teamIndex);if(supportedIndex>=0)usedSupported.add(supportedIndex);
    w.teamConverted=!!teamHit;w.playerSupportedConverted=!!supportedHit;w.converted=w.playerSupportedConverted;
    w.startMin=w.startMs/60000;w.endMin=w.endMs/60000;
    w.teamObjectiveType=teamHit?text(teamHit.monsterType||teamHit.buildingType||teamHit.type):null;
    w.teamSecondsAfter=teamHit?Math.round((teamHit.tMs-w.endMs)/1000):null;
    w.objectiveType=supportedHit?text(supportedHit.monsterType||supportedHit.buildingType||supportedHit.type):null;
    w.secondsAfter=supportedHit?Math.round((supportedHit.tMs-w.endMs)/1000):null;
    delete w.events;
  }
  const teamConverted=windows.filter(w=>w.teamConverted).length,converted=windows.filter(w=>w.playerSupportedConverted).length;
  return{windows:windows.length,converted,playerSupportedConverted:converted,teamConverted,rate:windows.length?100*converted/windows.length:null,teamRate:windows.length?100*teamConverted/windows.length:null,definition:"supported rate requires player proximity/involvement at the conversion event; team rate is context only",events:windows};
}
function itemInfo(catalog:any,itemId:any){return catalog?.[String(itemId)]||null;}
function isMajorItem(info:any){
  if(!info)return false;const total=Number(info?.gold?.total||0),tags=Array.isArray(info?.tags)?info.tags:[];
  return total>=2200&&!tags.includes("Boots")&&!tags.includes("Consumable")&&!tags.includes("Trinket");
}
function inventoryCountsAt(events:any[],atMs:number){
  const counts=new Map<number,number>(),add=(id:any,delta:number)=>{const n=Number(id||0);if(!n)return;const next=Math.max(0,(counts.get(n)||0)+delta);if(next)counts.set(n,next);else counts.delete(n);};
  for(const e of [...(events||[])].sort((a:any,b:any)=>Number(a.tMs)-Number(b.tMs))){
    if(Number(e.tMs)>atMs)break;
    if(e.type==="ITEM_PURCHASED")add(e.itemId,1);
    else if(e.type==="ITEM_SOLD"||e.type==="ITEM_DESTROYED")add(e.itemId,-1);
    else if(e.type==="ITEM_UNDO"){add(e.beforeId,-1);add(e.afterId,1);}
  }
  return counts;
}
function committedPurchaseEvents(events:any[]){
  const sorted=[...(events||[])].sort((a:any,b:any)=>Number(a.tMs)-Number(b.tMs)),purchases:any[]=[],openByItem=new Map<number,number[]>();
  for(const e of sorted){
    if(e.type==="ITEM_PURCHASED"){
      const copy={...e,committed:true},idx=purchases.length,id=Number(e.itemId||0);purchases.push(copy);
      if(id){const stack=openByItem.get(id)||[];stack.push(idx);openByItem.set(id,stack);}
    }else if(e.type==="ITEM_UNDO"){
      const id=Number(e.beforeId||0),stack=id?(openByItem.get(id)||[]):[];
      while(stack.length&&purchases[stack[stack.length-1]]?.committed===false)stack.pop();
      const idx=stack.pop();if(idx!=null)purchases[idx].committed=false;
    }
  }
  return purchases.filter((x:any)=>x.committed!==false).map(({committed,...x}:any)=>x);
}
function recipeOwnedCredit(itemId:number,inventory:Map<number,number>,catalog:any){
  const info=itemInfo(catalog,itemId),children=(Array.isArray(info?.from)?info.from:[]).map((x:any)=>Number(x)).filter(Boolean);
  if(!children.length)return 0;
  let credit=0;
  for(const childId of children){
    const have=Number(inventory.get(childId)||0);
    if(have>0){
      inventory.set(childId,have-1);
      if(have-1<=0)inventory.delete(childId);
      credit+=Number(itemInfo(catalog,childId)?.gold?.total||0);
    }else{
      credit+=recipeOwnedCredit(childId,inventory,catalog);
    }
  }
  return credit;
}
function purchaseCashCost(event:any,itemEvents:any[],catalog:any){
  const info=itemInfo(catalog,event?.itemId),total=Number(info?.gold?.total||0);
  if(!(total>0))return{cashCost:0,totalCost:0,componentCredit:0,method:"catalog_unavailable"};
  const inventory=inventoryCountsAt(itemEvents,Math.max(0,Number(event?.tMs||0)-1)),componentCredit=Math.max(0,recipeOwnedCredit(Number(event.itemId),new Map(inventory),catalog));
  return{cashCost:Math.max(0,total-componentCredit),totalCost:total,componentCredit,method:"recipe_owned_component_credit"};
}
function unresolvedItemUndoEvents(events:any[]){
  return [...(events||[])].filter((e:any)=>e.type==="ITEM_UNDO"&&Number(e.beforeId||0)===0&&Number(e.afterId||0)===0);
}
function purchaseGroups(itemEvents:any[],catalog:any){
  const sorted=committedPurchaseEvents(itemEvents),unresolvedUndos=unresolvedItemUndoEvents(itemEvents),groups:any[]=[];
  for(const e of sorted){
    let g=groups[groups.length-1];
    if(!g||Number(e.tMs)-Number(g.lastMs)>60000){g={startMs:e.tMs,lastMs:e.tMs,startMin:e.tMin,lastMin:e.tMin,items:[],spent:0,spentLowerBound:0,spentUpperBound:0,spendMethod:"recipe_owned_component_credit",committedPurchases:0,spendApproximate:false,unresolvedUndoCount:0,spendEstimateCaveats:[]};groups.push(g);}
    g.lastMs=e.tMs;g.lastMin=e.tMin;g.committedPurchases++;
    const info=itemInfo(catalog,e.itemId),cost=purchaseCashCost(e,itemEvents,catalog);
    g.items.push({itemId:e.itemId,name:text(info?.name)||String(e.itemId),cost:cost.cashCost,totalCost:cost.totalCost,componentCredit:cost.componentCredit,major:isMajorItem(info)});
    g.spent+=Number(cost.cashCost||0);g.spentLowerBound+=Number(cost.cashCost||0);g.spentUpperBound+=Number(cost.cashCost||0);
  }
  for(const g of groups){
    const unresolved=unresolvedUndos.filter((u:any)=>Number(u.tMs)>=Number(g.startMs)-5000&&Number(u.tMs)<=Number(g.lastMs)+60000);
    if(unresolved.length){g.spendApproximate=true;g.unresolvedUndoCount=unresolved.length;g.spentLowerBound=null;g.spendEstimateCaveats.push("riot_zero_id_item_undo_unresolvable");g.spendEstimateCaveat=g.spendEstimateCaveats.join("|");}
  }
  return groups;
}
function committedItemPurchaseCount(events:any[],itemId:number){
  return committedPurchaseEvents(events).filter((e:any)=>Number(e.itemId)===Number(itemId)).length;
}
function majorOwnershipMilestones(events:any[],catalog:any,limit=2){
  const sorted=[...(events||[])].sort((a:any,b:any)=>Number(a.tMs)-Number(b.tMs)),committed=committedPurchaseEvents(sorted),milestones:any[]=[];
  for(const e of committed){
    const info=itemInfo(catalog,e.itemId);if(!isMajorItem(info))continue;
    const inv=inventoryCountsAt(sorted,Number(e.tMs));
    let ownedMajorCount=0;
    for(const [id,count] of inv.entries())if(isMajorItem(itemInfo(catalog,id)))ownedMajorCount+=Number(count||0);
    if(ownedMajorCount<=milestones.length)continue;
    milestones.push({slot:milestones.length+1,time:e.tMin,tMs:e.tMs,itemId:e.itemId,name:text(info?.name)||String(e.itemId),cost:Number(info?.gold?.total||0),combineCost:Number(info?.gold?.base||0),components:Array.isArray(info?.from)?info.from.map((x:any)=>Number(x)).filter(Boolean):[],ownedMajorCount,committedPurchase:true});
    if(milestones.length>=limit)break;
  }
  return milestones;
}
function majorItemReadiness(major:any,itemEvents:any[],frames:any[],participantId:number,catalog:any){
  if(!major)return null;
  const info=itemInfo(catalog,major.itemId),combineCost=Number(info?.gold?.base||major.combineCost||0),components=(Array.isArray(info?.from)?info.from:major.components||[]).map((x:any)=>Number(x)).filter(Boolean);
  const base:any={eligible:false,itemId:major.itemId,itemName:major.name||text(info?.name)||String(major.itemId),purchaseMin:Number(major.time),combineCost,components,ingredientsReadyMin:null,affordableMin:null,delayMin:null,delayed:false,reason:null,definition:"supported first-major completion readiness: direct recipe components must be simultaneously present in the reconstructed item ledger, then a pre-purchase timeline frame must show current gold covering the remaining combine cost"};
  if(!(combineCost>0)||!components.length){base.reason="recipe_or_combine_cost_unavailable";return base;}
  const need=new Map<number,number>();for(const id of components)need.set(id,(need.get(id)||0)+1);
  let ingredientsReadyMs:any=null,affordable:any=null;
  for(const fr of [...(frames||[])].sort((a:any,b:any)=>Number(a?.timestamp||0)-Number(b?.timestamp||0))){
    const ts=Number(fr?.timestamp||0);if(ts>=Number(major.tMs))break;
    const inv=inventoryCountsAt(itemEvents,ts);
    const ready=[...need.entries()].every(([id,count])=>(inv.get(id)||0)>=count);
    if(!ready)continue;
    if(ingredientsReadyMs==null)ingredientsReadyMs=ts;
    const me=frameStats(fr,participantId);
    if(me&&hasNum(me.currentGold)&&Number(me.currentGold)>=combineCost){affordable={tMs:ts,currentGold:Number(me.currentGold)};break;}
  }
  if(ingredientsReadyMs==null){base.reason="direct_components_not_simultaneously_observed";return base;}
  base.ingredientsReadyMin=Number(ingredientsReadyMs)/60000;
  if(!affordable){base.reason="no_supported_affordability_frame";return base;}
  base.eligible=true;base.affordableMin=affordable.tMs/60000;base.currentGoldAtAffordable=affordable.currentGold;base.delayMin=Math.max(0,Number(major.time)-base.affordableMin);base.delayed=base.delayMin>=1.5;base.reason=null;
  return base;
}
function participantFullGameMetrics(match:any,p:any){
  if(!p)return null;
  const ps=Array.isArray(match?.info?.participants)?match.info.participants:[],mins=Math.max(1,Number(match?.info?.gameDuration||0)/60),seconds=Math.max(1,Number(match?.info?.gameDuration||0));
  const team=ps.filter((x:any)=>x.teamId===p.teamId),teamKills=team.reduce((sum:number,x:any)=>sum+Number(x.kills||0),0);
  const teamDamage=team.reduce((sum:number,x:any)=>sum+Number(x.totalDamageDealtToChampions||0),0),teamGold=team.reduce((sum:number,x:any)=>sum+Number(x.goldEarned||0),0),teamVision=team.reduce((sum:number,x:any)=>sum+Number(x.visionScore||0),0);
  const damageShare=pct(Number(p.totalDamageDealtToChampions||0),teamDamage),goldShare=pct(Number(p.goldEarned||0),teamGold),visionShare=pct(Number(p.visionScore||0),teamVision),ch=p?.challenges&&typeof p.challenges==="object"?p.challenges:{};
  const wardsPlaced=Number(p.wardsPlaced||0),wardsKilled=Number(p.wardsKilled||0),controlWardsPlaced=hasNum(ch.controlWardsPlaced)?Number(ch.controlWardsPlaced):Number(p.detectorWardsPlaced||0);
  const rankIn=(key:string)=>1+team.filter((x:any)=>Number(x[key]||0)>Number(p[key]||0)).length;
  const hadAfkTeammate=Number(ch.hadAfkTeammate||0)>0,earlySurrender=!!p.gameEndedInEarlySurrender||!!p.teamEarlySurrendered;
  return{
    kills:Number(p.kills||0),deaths:Number(p.deaths||0),assists:Number(p.assists||0),kda:Number(p.deaths||0)>0?(Number(p.kills||0)+Number(p.assists||0))/Number(p.deaths):Number(p.kills||0)+Number(p.assists||0),
    csMin:(Number(p.totalMinionsKilled||0)+Number(p.neutralMinionsKilled||0))/mins,dpm:Number(p.totalDamageDealtToChampions||0)/mins,gpm:Number(p.goldEarned||0)/mins,vpm:Number(p.visionScore||0)/mins,
    kp:pct(Number(p.kills||0)+Number(p.assists||0),teamKills),damageShare,goldShare,visionShare,damageEfficiencyPp:hasNum(damageShare)&&hasNum(goldShare)?Number(damageShare)-Number(goldShare):null,
    laneCs10:hasNum(ch.laneMinionsFirst10Minutes)?Number(ch.laneMinionsFirst10Minutes):null,deadTimePct:pct(Number(p.totalTimeSpentDead||0),seconds),
    turretDamagePerMin:Number(p.damageDealtToTurrets||0)/mins,structureDamagePerMin:Number(p.damageDealtToBuildings||0)/mins,epicDamagePerMin:Number(p.damageDealtToEpicMonsters||0)/mins,
    visionActionsPerMin:(wardsPlaced+wardsKilled)/mins,wardsPlaced,wardsKilled,controlWardsPlaced,
    soloKills:hasNum(ch.soloKills)?Number(ch.soloKills):null,riotPlateSegments:hasNum(ch.turretPlatesTaken)?Number(ch.turretPlatesTaken):null,
    enemyJungleMonsters:hasNum(ch.enemyJungleMonsterKills)?Number(ch.enemyJungleMonsterKills):Number(p.totalEnemyJungleMinionsKilled||0),
    firstTurretParticipation:!!p.firstTowerKill||!!p.firstTowerAssist,hadAfkTeammate,earlySurrender,outcomeCompromised:hadAfkTeammate||earlySurrender,
    damageRank:rankIn("totalDamageDealtToChampions"),goldRank:rankIn("goldEarned"),visionRank:rankIn("visionScore")
  };
}
function timelineFacts(match:any,timeline:any,p:any,catalog:any,catalogContext:any=null){
  const itemCatalogExactPatch=catalogContext?.exact===true,itemMechanicsEligible=itemCatalogExactPatch&&!!catalog&&Object.keys(catalog||{}).length>0;
  const frames=Array.isArray(timeline?.info?.frames)?timeline.info.frames:[],pid=Number(p.participantId),opp=opponent(match,p),oppId=opp?Number(opp.participantId):null;
  const ps=Array.isArray(match?.info?.participants)?match.info.participants:[],byId=new Map<number,any>();for(const q of ps)byId.set(Number(q.participantId),q);
  const mapId=Number(match?.info?.mapId||0),teamId=Number(p.teamId),playerRoleEvidence=participantRoleEvidence(p),rr=playerRoleEvidence.role,homeLane=homeLaneForRole(rr),rules=gameRules(match);
  const laneOpponentIds=new Set<number>(),oppRoleEvidence=opp?participantRoleEvidence(opp):null,roleEconomyComparable=playerRoleEvidence.confidence==="high"&&!!oppId&&oppRoleEvidence?.confidence==="high",rolePeerId=roleEconomyComparable?oppId:null;
  let laneOppositionResolved=roleEconomyComparable,laneOppositionReason=playerRoleEvidence.confidence!=="high"?"player_role_not_high_confidence":!oppId?"same_role_opponent_unresolved":oppRoleEvidence?.confidence!=="high"?"same_role_opponent_not_high_confidence":null;
  if(laneOppositionResolved&&oppId)laneOpponentIds.add(oppId);
  if(rr==="ADC"||rr==="SUPPORT"){
    const partnerRole=rr==="ADC"?"SUPPORT":"ADC",lanePartnerOppCandidates=ps.filter((x:any)=>Number(x.teamId)!==teamId&&participantRoleEvidence(x).confidence==="high"&&participantRole(x)===partnerRole);
    if(lanePartnerOppCandidates.length===1&&laneOppositionResolved)laneOpponentIds.add(Number(lanePartnerOppCandidates[0].participantId));
    else if(laneOppositionResolved){laneOppositionResolved=false;laneOppositionReason=lanePartnerOppCandidates.length?"bot_lane_partner_ambiguous":"bot_lane_partner_not_high_confidence_or_unresolved";}
  }
  const out:any={goldDiff10:null,goldDiff15:null,goldDiff25:null,csDiff10:null,csDiff15:null,csDiff25:null,xpDiff10:null,xpDiff15:null,xpDiff25:null,levelDiff10:null,levelDiff15:null,levelDiff25:null,deathPositions:[],wards:[],wardKills:[],objectives:[],involvedKills:[],goldSeries:[],frameSamples:[],objectiveJoinRate:null,objectiveJoined:0,objectiveTeamTotal:0,objectiveContestPresenceRate:null,objectiveContestJoined:0,objectiveContestTotal:0,objectiveContestAbsent:0,earlyKp:null,earlyTeamKills:0,earlyPlayerKillInvolvements:0,impactTimeMin:null,impactType:null,opponentImpactTimeMin:null,opponentImpactType:null,impactDeltaVsOpponent:null,badDeaths:[],badDeathCount:0,tradedDeathCount:0,untradedDeathCount:0,highRiskUntradedDeathCount:0,deathTrades:[],deathConsequences:{measured:0,costly:0,severe:0,untradedCostly:0,economySamplesContaminated:0,costlyRate:null,avgGoldSwing:null,avgCsSwing:null,events:[]},deathRecovery:{deaths:0,opportunities:0,repeatDeaths:0,rate:null,highRiskRepeatDeaths:0,costlyRepeatDeaths:0,untradedRepeatDeaths:0,events:[]},opponentDeathRecovery:{deaths:0,opportunities:0,repeatDeaths:0,rate:null,events:[]},leadDeaths:[],leadDeathCount:0,highRiskLeadDeathCount:0,riskStateDeaths:{ahead:0,even:0,behind:0,highRiskAhead:0,highRiskEven:0,highRiskBehind:0,events:[]},objectiveDeathCount:0,objectiveDeathPct:null,preObjectiveDeaths:[],preObjectiveDeathCount:0,preObjectiveDeathPct:null,isolatedDeathCount:0,highUnspentGoldDeaths:0,overstays:[],overstayCount:0,greedyStayWindows:[],shopVisits:[],opponentShopVisits:[],firstResetSequence:null,earlyLeadWindow:{eligible:false,peakMin:null,peakGoldDiff:null,goldDiff15:null,goldSwingTo15:null,giveback:false,preserved:false,deathsAfterPeak:0,highRiskDeathsAfterPeak:0,deathTimes:[]},firstMajorItem:null,opponentFirstMajorItem:null,secondMajorItem:null,opponentSecondMajorItem:null,secondMajorItemDeltaVsOpponent:null,majorItemReadiness:null,opponentMajorItemReadiness:null,itemSpikeDeltaVsOpponent:null,itemSpikeWindow:{eligible:false,startMin:null,endMin:null,leadSec:null,killAssistImpacts:0,objectiveImpacts:0,totalImpacts:0,used:false,diedBeforeImpact:false,events:[]},phaseBehavior:{early:{deaths:0,highRiskDeaths:0,costlyDeaths:0,severeDeaths:0,killAssistImpacts:0,teamObjectives:0,objectiveJoins:0,fightClusters:0,firstAllyFightDeaths:0},mid:{deaths:0,highRiskDeaths:0,costlyDeaths:0,severeDeaths:0,killAssistImpacts:0,teamObjectives:0,objectiveJoins:0,fightClusters:0,firstAllyFightDeaths:0},late:{deaths:0,highRiskDeaths:0,costlyDeaths:0,severeDeaths:0,killAssistImpacts:0,teamObjectives:0,objectiveJoins:0,fightClusters:0,firstAllyFightDeaths:0}},roams:{attempts:0,successes:0,failures:0,neutral:0,events:[]},vision:{wardCount:0,wardKillCount:0,controlWardCount:0,controlWardPurchases:0,offensive:0,defensive:0,river:0,objectiveSetup:0,objectiveSetupClears:0,objectiveSetupRate:null,objectiveSetupDeltaVsOpponent:null,objectiveSetupRateDeltaVsOpponent:null,wardsPer30:null},visionMission:{actions:0,deaths:0,highRiskDeaths:0,untradedDeaths:0,unsupportedDeaths:0,objectiveSetupDeaths:0,deathRate:null,highRiskDeathRate:null,events:[]},opponentVision:{wardCount:0,controlWardCount:0,objectiveSetup:0,objectiveSetupRate:null},killConversion:{windows:0,converted:0,rate:null,events:[]},opponentKillConversion:{windows:0,converted:0,rate:null,events:[]},objectiveReadiness:{neutralTeamObjectives:0,joined:0,absent:0,contestedObjectives:0,contestedJoined:0,contestedAbsent:0,earlySetupJoins:0,eventFrameOnlyJoins:0,earlySetupJoinRate:null,earlySetupCoverageRate:null,recentShopAbsences:0,lateResetMisses:0,freshPurchaseJoins:0,events:[]},objectiveFamilyStats:{},laneDuel:{soloKillsVsRole:0,soloDeathsToRole:0,earlySoloKillsVsRole:0,earlySoloDeathsToRole:0,pre14SoloKillsVsRole:0,pre14SoloDeathsToRole:0,events:[]},structurePressure:{first20PlayerPlateInvolvement:0,first20OpponentPlateInvolvement:0,first20PlateInvolvementDelta:0,first20PlayerPlateLanePresenceSignals:0,first20OpponentPlateLanePresenceSignals:0,allGamePlayerPlateInvolvement:0,allGameOpponentPlateInvolvement:0,allGamePlateInvolvementDelta:0,allGamePlayerPlateLanePresenceSignals:0,allGameOpponentPlateLanePresenceSignals:0,directPlayerPlateCredits:0,directOpponentPlateCredits:0,unattributedPlateEvents:0,playerPlateByTier:{outer:0,inner:0,inhibitor:0,nexus:0,unknown:0},opponentPlateByTier:{outer:0,inner:0,inhibitor:0,nexus:0,unknown:0},earlyPlayerTurretInvolvement:0,earlyOpponentTurretInvolvement:0,soloKillWindows:0,soloKillStructureConversions:0,soloKillStructureConversionRate:null,attributionDefinition:"involvement requires direct event credit or <=2200-unit event-position proximity; same-lane frame evidence is retained separately as presence-only",events:[]},midRouting:{teamObjectives:0,objectiveJoins:0,objectiveJoinRate:null,contestedObjectives:0,contestedJoins:0,contestPresenceRate:null},closing25:{highRiskDeaths:0,costlyDeaths:0,severeDeaths:0},lanePressure:{earlyHomeLaneDeaths:0,earlyClassifiedHomeLaneDeaths:0,earlyUnclassifiedHomeLaneDeaths:0,earlyOutsidePressureDeaths:0,earlyOutsidePressureShare:null,pre14HomeLaneDeaths:0,pre14ClassifiedHomeLaneDeaths:0,pre14UnclassifiedHomeLaneDeaths:0,pre14OutsidePressureDeaths:0,outsidePressureShare:null,laneOppositionResolved,laneOppositionReason,events:[]},sideLaneRisk:{macroTransitionSideLaneDeaths:0,postLaneSideLaneDeaths:0,post15SideLaneDeaths:0,macroTransitionMin:Number(rules.macroTransitionMin??rules.postLaneStartMin??14),postLaneStartMin:Number(rules.postLaneStartMin??rules.macroTransitionMin??14),isolatedSideLaneDeaths:0,preNeutralObjectiveSideLaneDeaths:0,highRiskSideLaneDeaths:0,events:[]},postImpactRisk:{deathsWithin30s:0,highRiskDeathsWithin30s:0,untradedDeathsWithin30s:0,highRiskUntradedDeathsWithin30s:0,ratePerImpact:null,events:[]},fightProfile:{present:0,active:0,attended:0,proximityOnly:0,teamFightClusters:0,positionSupportedTeamFightClusters:0,trackedAbsentTeamFights:0,firstAllyDeaths:0,diedBeforeContribution:0,survived:0,highUnspentFightSamples:0,itemDisadvantageFightSamples:0,goldDeficitFightSamples:0,outnumberedFightSamples:0,highUnspentStarts:0,itemDisadvantageStarts:0,goldDeficitStarts:0,unspentAndBehindStarts:0,outnumberedStarts:0,lostOutnumberedStarts:0,rolePeerFightStarts:0,roleLevelDisadvantageStarts:0,firstAllyDeathRate:null,diedBeforeContributionRate:null,survivalRate:null,highUnspentStartRate:null,itemDisadvantageStartRate:null,goldDeficitStartRate:null,outnumberedStartRate:null,outnumberedLossRate:null,roleLevelDisadvantageRate:null,definition:"present includes supported proximity; active/attended requires player death or tracked kill/assist contribution; contribution/survival rates use active fights, while fight-state rates use metric-specific supported active-fight opportunities. Fight locations are map-relative coordinate heuristics. trackedAbsentTeamFights counts only team-involved multi-kill clusters with supported coordinates/player position; absence events also measure a bounded ~90s cross-map compensation window. Join-vs-skip labels are replay triage, never proof that attendance was correct.",events:[],absenceEvents:[]},phaseRules:rules,roleQuestContext:roleQuestContext(rules,rr),timelineAvailable:!!frames.length};
  const gameDurationSec=Number(match?.info?.gameDuration||0);
  for(const minute of[10,15]){
    if(gameDurationSec<minute*60)continue;
    const fr=frameNearMinute(frames,minute,45000),a=frameStats(fr,pid),b=rolePeerId?frameStats(fr,rolePeerId):null;
    if(a&&b){out["goldDiff"+minute]=(a.gold!=null&&b.gold!=null)?a.gold-b.gold:null;out["csDiff"+minute]=a.cs-b.cs;out["xpDiff"+minute]=(a.xp!=null&&b.xp!=null)?a.xp-b.xp:null;out["levelDiff"+minute]=(a.level!=null&&b.level!=null)?a.level-b.level:null;}
  }
  const reaches25=gameDurationSec>=25*60,fr25=reaches25?frameNearMinute(frames,25,45000):null,a25=frameStats(fr25,pid),b25=rolePeerId?frameStats(fr25,rolePeerId):null;
  if(a25&&b25){out.goldDiff25=(a25.gold!=null&&b25.gold!=null)?a25.gold-b25.gold:null;out.csDiff25=a25.cs-b25.cs;out.xpDiff25=(a25.xp!=null&&b25.xp!=null)?a25.xp-b25.xp:null;out.levelDiff25=(a25.level!=null&&b25.level!=null)?a25.level-b25.level:null;}

  const itemEventsByPid:any[]=[],itemEventsByOpp:any[]=[],allObjectives:any[]=[],ownObjectiveEvents:any[]=[],oppObjectiveEvents:any[]=[],deathEvents:any[]=[],involved:any[]=[],oppInvolved:any[]=[],oppWards:any[]=[],allChampionKills:any[]=[],earlyRoleGoldSamples:any[]=[];
  for(const fr of frames){
    const mine=frameStats(fr,pid),frameMinute=Number(fr?.timestamp||0)/60000,rolePeerFrame=rolePeerId?frameStats(fr,rolePeerId):null;
    if(rules.lane15Comparable!==false&&mine&&rolePeerFrame&&frameMinute>=3&&frameMinute<15&&hasNum(mine.gold)&&hasNum(rolePeerFrame.gold))earlyRoleGoldSamples.push({time:frameMinute,goldDiff:Number(mine.gold)-Number(rolePeerFrame.gold)});
    if(mine){const sample={time:frameMinute,totalGold:mine.gold,currentGold:mine.currentGold,cs:mine.cs,xp:mine.xp,level:mine.level,position:mine.position,zone:zoneFor(mapId,mine.position,teamId)};out.frameSamples.push(sample);if(mine.gold!=null)out.goldSeries.push({minute:sample.time,totalGold:mine.gold,currentGold:mine.currentGold});}
    for(const e of(Array.isArray(fr?.events)?fr.events:[])){
      const pxy=xy(e.position),tMs=Number(e.timestamp||0),tMin=tMs/60000;
      if(e.type==="CHAMPION_KILL"){
        const killer=byId.get(Number(e.killerId||0)),victim=byId.get(Number(e.victimId||0));
        const ev={tMs,tMin,...(pxy||{}),killerId:Number(e.killerId||0),victimId:Number(e.victimId||0),killerTeam:Number(killer?.teamId||0)||null,victimTeam:Number(victim?.teamId||0)||null,assistingIds:Array.isArray(e.assistingParticipantIds)?e.assistingParticipantIds.map(Number):[],playerContribution:playerInKill(e,pid),opponentContribution:rolePeerId?playerInKill(e,rolePeerId):false};
        allChampionKills.push(ev);
        if(rolePeerId&&ev.assistingIds.length===0){
          const duelFrame=frameAtMs(frames,tMs),duelMe=frameStats(duelFrame,pid),duelOpp=frameStats(duelFrame,rolePeerId);
          const duelGoldDiff=duelMe&&duelOpp&&hasNum(duelMe.gold)&&hasNum(duelOpp.gold)?Number(duelMe.gold)-Number(duelOpp.gold):null,duelCsDiff=duelMe&&duelOpp?Number(duelMe.cs)-Number(duelOpp.cs):null;
          const early=tMin<Number(rules.earlyEndMin),pre14=tMin<=14,conversionEligibleTo15=rules.key==="standard_sr_2026"&&tMin<=14;
          const goldSwingTo15=conversionEligibleTo15&&hasNum(out.goldDiff15)&&hasNum(duelGoldDiff)?Number(out.goldDiff15)-Number(duelGoldDiff):null,csSwingTo15=conversionEligibleTo15&&hasNum(out.csDiff15)&&hasNum(duelCsDiff)?Number(out.csDiff15)-Number(duelCsDiff):null;
          if(ev.killerId===pid&&ev.victimId===rolePeerId){
            out.laneDuel.soloKillsVsRole++;if(early)out.laneDuel.earlySoloKillsVsRole++;if(pre14)out.laneDuel.pre14SoloKillsVsRole++;
            out.laneDuel.events.push({time:tMin,result:"solo_kill",early,pre14,conversionEligibleTo15,goldDiffAtEvent:duelGoldDiff,csDiffAtEvent:duelCsDiff,goldSwingTo15,csSwingTo15,convertedBy15:hasNum(goldSwingTo15)?Number(goldSwingTo15)>=200:null,...(pxy||{})});
          }else if(ev.killerId===rolePeerId&&ev.victimId===pid){
            out.laneDuel.soloDeathsToRole++;if(early)out.laneDuel.earlySoloDeathsToRole++;if(pre14)out.laneDuel.pre14SoloDeathsToRole++;
            out.laneDuel.events.push({time:tMin,result:"solo_death",early,pre14,conversionEligibleTo15,goldDiffAtEvent:duelGoldDiff,csDiffAtEvent:duelCsDiff,goldSwingTo15,csSwingTo15,...(pxy||{})});
          }
        }
        if(Number(e.victimId)===pid){
          deathEvents.push(ev);out.deathPositions.push({time:tMin,...(pxy||{}),zone:deathArea(mapId,pxy,teamId)});
          if(tMin<Number(rules.earlyEndMin)&&["TOP","MID","ADC","SUPPORT"].includes(rr)){
            const deathFrame=frameAtMs(frames,tMs),deathState=frameStats(deathFrame,pid),deathPos=pxy||deathState?.position,deathZone=zoneFor(mapId,deathPos,teamId);
            if(deathZone===homeLane){
              out.lanePressure.earlyHomeLaneDeaths++;if(tMin<=14)out.lanePressure.pre14HomeLaneDeaths++;
              const attackers=[ev.killerId,...ev.assistingIds].filter((id:any)=>Number(id)>0);
              if(laneOppositionResolved){
                out.lanePressure.earlyClassifiedHomeLaneDeaths++;if(tMin<=14)out.lanePressure.pre14ClassifiedHomeLaneDeaths++;
                const outsideIds=attackers.filter((id:any)=>!laneOpponentIds.has(Number(id)));
                const outsideRoles=[...new Set(outsideIds.map((id:any)=>participantRole(byId.get(Number(id)))).filter((x:any)=>x&&x!=="GENERIC"))];
                const outsidePressure=outsideIds.length>0;
                if(outsidePressure){out.lanePressure.earlyOutsidePressureDeaths++;if(tMin<=14)out.lanePressure.pre14OutsidePressureDeaths++;}
                out.lanePressure.events.push({time:tMin,early:true,pre14:tMin<=14,classificationEligible:true,outsidePressure,attackerCount:attackers.length,outsideRoles,killerRole:participantRole(killer),assisted:ev.assistingIds.length>0,...(pxy||{})});
              }else{
                out.lanePressure.earlyUnclassifiedHomeLaneDeaths++;if(tMin<=14)out.lanePressure.pre14UnclassifiedHomeLaneDeaths++;
                out.lanePressure.events.push({time:tMin,early:true,pre14:tMin<=14,classificationEligible:false,outsidePressure:null,classificationReason:laneOppositionReason,attackerCount:attackers.length,outsideRoles:[],killerRole:participantRole(killer),assisted:ev.assistingIds.length>0,...(pxy||{})});
              }
            }
          }
        }
        if(ev.playerContribution){involved.push(ev);out.involvedKills.push({time:tMin,...(pxy||{}),killerId:e.killerId,victimId:e.victimId});}
        if(ev.opponentContribution)oppInvolved.push(ev);
      }else if(["ELITE_MONSTER_KILL","BUILDING_KILL","TURRET_PLATE_DESTROYED"].includes(String(e.type))){
        const owner=objectiveOwnerTeam(e,byId),obj={tMs,tMin,type:text(e.type),monsterType:text(e.monsterType),monsterSubType:text(e.monsterSubType),buildingType:text(e.buildingType),towerType:text(e.towerType),laneType:text(e.laneType),ownerTeam:owner,killerId:Number(e.killerId||0)||null,killerTeamId:Number(e.killerTeamId||0)||null,victimTeamId:Number(e.teamId||0)||null,...(pxy||{})};
        allObjectives.push(obj);out.objectives.push(obj);if(owner===teamId)ownObjectiveEvents.push(obj);if(opp&&owner===Number(opp.teamId))oppObjectiveEvents.push(obj);
      }else if(e.type==="WARD_PLACED"&&Number(e.creatorId)===pid){
        const inferred=pxy||frameStats(frameNearestMs(frames,tMs,35000),pid)?.position||null,territory=wardTerritory(teamId,inferred),w={time:tMin,tMs,...(inferred||{}),wardType:text(e.wardType),territory,positionEvidence:pxy?"event_position":inferred?"nearest_player_frame_35s":"unavailable"};
        out.wards.push(w);out.vision.wardCount++;if(text(e.wardType).toUpperCase().includes("CONTROL"))out.vision.controlWardCount++;if(territory==="offensive")out.vision.offensive++;else if(territory==="defensive")out.vision.defensive++;else if(territory==="river")out.vision.river++;
      }else if(e.type==="WARD_PLACED"&&rolePeerId&&Number(e.creatorId)===rolePeerId){
        const inferred=pxy||frameStats(frameNearestMs(frames,tMs,35000),rolePeerId)?.position||null,w={time:tMin,tMs,...(inferred||{}),wardType:text(e.wardType),positionEvidence:pxy?"event_position":inferred?"nearest_player_frame_35s":"unavailable"};
        oppWards.push(w);out.opponentVision.wardCount++;if(text(e.wardType).toUpperCase().includes("CONTROL"))out.opponentVision.controlWardCount++;
      }else if(e.type==="WARD_KILL"&&Number(e.killerId)===pid){
        const inferred=pxy||frameStats(frameNearestMs(frames,tMs,35000),pid)?.position||null;
        out.wardKills.push({time:tMin,tMs,...(inferred||{}),wardType:text(e.wardType),positionEvidence:pxy?"event_position":inferred?"nearest_player_frame_35s":"unavailable"});out.vision.wardKillCount++;
      }
      else if(["ITEM_PURCHASED","ITEM_SOLD","ITEM_DESTROYED","ITEM_UNDO"].includes(String(e.type))){
        const ev={type:String(e.type),tMs,tMin,itemId:Number(e.itemId||0),beforeId:Number(e.beforeId||0),afterId:Number(e.afterId||0)};
        if(Number(e.participantId)===pid)itemEventsByPid.push(ev);
        if(rolePeerId&&Number(e.participantId)===rolePeerId)itemEventsByOpp.push(ev);
      }
    }
  }
  const neutralObjectives=allObjectives.filter((o:any)=>isNeutralObjectiveEvent(o)),neutralOwnObjectives=neutralObjectives.filter((o:any)=>Number(o.ownerTeam)===teamId),neutralOppObjectives=opp?neutralObjectives.filter((o:any)=>Number(o.ownerTeam)===Number(opp.teamId)):[],neutralWindows=neutralObjectiveWindows(neutralObjectives),neutralOwnWindows=neutralWindows.filter((w:any)=>Number(w.ownerCounts?.[String(teamId)]||0)>0),neutralOppWindows=opp?neutralWindows.filter((w:any)=>Number(w.ownerCounts?.[String(Number(opp.teamId))]||0)>0):[],allyParticipantIds=ps.filter((x:any)=>Number(x.teamId)===teamId).map((x:any)=>Number(x.participantId)).filter(Number.isFinite),objectiveContestEvidence=new Map<any,any>();
  for(const w of neutralWindows){
    const alliedPresentIds=objectiveWindowParticipantsNear(frames,allyParticipantIds,w,2500),teamSecured=Number(w.ownerCounts?.[String(teamId)]||0)>0;
    objectiveContestEvidence.set(w,{teamContested:teamSecured||alliedPresentIds.length>0,teamSecured,alliedPresentIds,alliedPresentCount:alliedPresentIds.length,playerPresent:alliedPresentIds.includes(pid)});
  }
  const neutralContestedWindows=neutralWindows.filter((w:any)=>objectiveContestEvidence.get(w)?.teamContested),structureEvents=allObjectives.filter((o:any)=>isStructureEvent(o)),plateEvents=structureEvents.filter((o:any)=>o.type==="TURRET_PLATE_DESTROYED");
  const playerPlateEvidence=(o:any)=>structureInvolvementEvidence(o,frames,pid,teamId,mapId),oppPlateEvidence=(o:any)=>rolePeerId?structureInvolvementEvidence(o,frames,rolePeerId,Number(opp?.teamId||0),mapId):null;
  const playerPlateInvolved=(o:any)=>!!structureStrongInvolvementEvidence(o,frames,pid,teamId,mapId),oppPlateInvolved=(o:any)=>!!(rolePeerId&&structureStrongInvolvementEvidence(o,frames,rolePeerId,Number(opp?.teamId||0),mapId));
  const playerPlateLanePresence=(o:any)=>playerPlateEvidence(o)==="timeline_lane_presence",oppPlateLanePresence=(o:any)=>!!(rolePeerId&&oppPlateEvidence(o)==="timeline_lane_presence");
  out.structurePressure.first20PlayerPlateInvolvement=plateEvents.filter((o:any)=>Number(o.tMin)<=20&&playerPlateInvolved(o)).length;
  out.structurePressure.first20OpponentPlateInvolvement=rolePeerId?plateEvents.filter((o:any)=>Number(o.tMin)<=20&&oppPlateInvolved(o)).length:0;
  out.structurePressure.first20PlayerPlateLanePresenceSignals=plateEvents.filter((o:any)=>Number(o.tMin)<=20&&playerPlateLanePresence(o)).length;
  out.structurePressure.first20OpponentPlateLanePresenceSignals=rolePeerId?plateEvents.filter((o:any)=>Number(o.tMin)<=20&&oppPlateLanePresence(o)).length:0;
  out.structurePressure.first20PlateInvolvementDelta=out.structurePressure.first20PlayerPlateInvolvement-out.structurePressure.first20OpponentPlateInvolvement;
  out.structurePressure.allGamePlayerPlateInvolvement=plateEvents.filter(playerPlateInvolved).length;
  out.structurePressure.allGameOpponentPlateInvolvement=rolePeerId?plateEvents.filter(oppPlateInvolved).length:0;
  out.structurePressure.allGamePlayerPlateLanePresenceSignals=plateEvents.filter(playerPlateLanePresence).length;
  out.structurePressure.allGameOpponentPlateLanePresenceSignals=rolePeerId?plateEvents.filter(oppPlateLanePresence).length:0;
  out.structurePressure.allGamePlateInvolvementDelta=out.structurePressure.allGamePlayerPlateInvolvement-out.structurePressure.allGameOpponentPlateInvolvement;
  out.structurePressure.directPlayerPlateCredits=plateEvents.filter((o:any)=>Number(o.killerId)===pid).length;
  out.structurePressure.directOpponentPlateCredits=rolePeerId?plateEvents.filter((o:any)=>Number(o.killerId)===rolePeerId).length:0;
  out.structurePressure.unattributedPlateEvents=plateEvents.filter((o:any)=>!Number(o.killerId||0)).length;
  for(const o of plateEvents){
    const tier=turretTier(o);
    if(playerPlateInvolved(o))out.structurePressure.playerPlateByTier[tier]=(out.structurePressure.playerPlateByTier[tier]||0)+1;
    if(oppPlateInvolved(o))out.structurePressure.opponentPlateByTier[tier]=(out.structurePressure.opponentPlateByTier[tier]||0)+1;
  }
  out.structurePressure.earlyPlayerTurretInvolvement=structureEvents.filter((o:any)=>o.type==="BUILDING_KILL"&&Number(o.tMin)<=20&&structureInvolvement(o,frames,pid,teamId,mapId)).length;
  out.structurePressure.earlyOpponentTurretInvolvement=rolePeerId?structureEvents.filter((o:any)=>o.type==="BUILDING_KILL"&&Number(o.tMin)<=20&&structureInvolvement(o,frames,rolePeerId,Number(opp?.teamId||0),mapId)).length:0;
  // Structure conversion follows the queue-aware early phase. The narrower ≤14m flag is reserved only for economy-to-@15 measurements.
  const earlySoloKills=(out.laneDuel.events||[]).filter((x:any)=>x.result==="solo_kill"&&x.early);
  for(const duel of earlySoloKills){
    const startMs=Number(duel.time)*60000,endMs=startMs+90000;
    const hit=structureEvents.find((o:any)=>Number(o.tMs)>=startMs&&Number(o.tMs)<=endMs&&structureInvolvement(o,frames,pid,teamId,mapId));
    const ev={killTime:Number(duel.time),converted:!!hit,structureType:hit?text(hit.type):null,buildingType:hit?text(hit.buildingType):null,towerType:hit?text(hit.towerType):null,turretTier:hit?turretTier(hit):null,laneType:hit?text(hit.laneType):null,attribution:hit?structureInvolvementEvidence(hit,frames,pid,teamId,mapId):null,secondsAfter:hit?Math.round((Number(hit.tMs)-startMs)/1000):null,goldSwingTo15:duel.goldSwingTo15,csSwingTo15:duel.csSwingTo15};
    out.structurePressure.events.push(ev);out.structurePressure.soloKillWindows++;if(hit)out.structurePressure.soloKillStructureConversions++;
  }
  if(out.structurePressure.soloKillWindows>0)out.structurePressure.soloKillStructureConversionRate=100*out.structurePressure.soloKillStructureConversions/out.structurePressure.soloKillWindows;
  const fightClusters:any[]=[];
  for(const ev of allChampionKills){
    let cluster=fightClusters[fightClusters.length-1];
    const prev=cluster?.events?.[cluster.events.length-1];
    const separatedByTime=!prev||ev.tMs-prev.tMs>25000;
    const separatedBySpace=prev&&hasNum(prev.x)&&hasNum(prev.y)&&hasNum(ev.x)&&hasNum(ev.y)&&dist2(prev,ev)>5000*5000;
    if(!cluster||separatedByTime||separatedBySpace){cluster={events:[]};fightClusters.push(cluster);}
    cluster.events.push(ev);
  }
  for(const cluster of fightClusters.filter((x:any)=>x.events.length>=2)){
    const events=cluster.events,first=events[0],last=events[events.length-1],fr=frameAtMs(frames,first.tMs),me=frameStats(fr,pid),them=rolePeerId?frameStats(fr,rolePeerId):null;
    const nearby=events.some((e:any)=>hasNum(e.x)&&hasNum(e.y)&&participantNearEvent(frames,pid,e,5000,35000));
    const playerDeath=events.find((e:any)=>Number(e.victimId)===pid),contributed=events.some((e:any)=>e.playerContribution),active=!!playerDeath||contributed,present=active||!!nearby,proximityOnly=present&&!active;
    const teamInvolved=events.some((e:any)=>Number(e.killerTeam)===teamId||Number(e.victimTeam)===teamId),positionEvidence=events.map((e:any)=>{if(!hasNum(e.x)||!hasNum(e.y))return null;const frame=frameNearestMs(frames,Number(e.tMs||0),35000),player=frameStats(frame,pid);return player?.position?{event:e,frame,player}:null;}).find(Boolean)||null,positionAnchor=positionEvidence?.event||null,positionFrame=positionEvidence?.frame||null,positionMe=positionEvidence?.player||null,positionSupported=teamInvolved&&!!positionAnchor&&!!positionMe?.position;
    const anchor=positionAnchor&&hasNum(positionAnchor.x)&&hasNum(positionAnchor.y)?{x:Number(positionAnchor.x),y:Number(positionAnchor.y)}:(hasNum(first.x)&&hasNum(first.y)?{x:Number(first.x),y:Number(first.y)}:me?.position);
    const fightZone=anchor?fightArea(mapId,anchor,teamId):"unknown";
    let alliesNear=null,enemiesNear=null,numbersDelta=null;
    if(anchor&&fr?.participantFrames){
      alliesNear=0;enemiesNear=0;
      for(const [id,q] of byId.entries()){
        const fs=frameStats(fr,id);if(!fs?.position)continue;
        if(dist2(anchor,fs.position)>4500*4500)continue;
        if(Number(q.teamId)===teamId)alliesNear++;else enemiesNear++;
      }
      numbersDelta=alliesNear-enemiesNear;
    }
    const teamFightKills=events.filter((e:any)=>Number(e.killerTeam)===teamId).length,enemyFightKills=events.filter((e:any)=>Number(e.killerTeam)&&Number(e.killerTeam)!==teamId).length,lostFight=enemyFightKills>teamFightKills;
    const playerDistanceToFight=positionMe?.position&&anchor?Math.sqrt(dist2(positionMe.position,anchor)):null;
    if(teamInvolved)out.fightProfile.teamFightClusters++;
    if(positionSupported)out.fightProfile.positionSupportedTeamFightClusters++;
    if(positionSupported&&!present){
      const postTargetMs=Number(last.tMs||first.tMs)+75000,postFrame=frameNearestMs(frames,postTargetMs,35000),postMe=frameStats(postFrame,pid),postThem=rolePeerId?frameStats(postFrame,rolePeerId):null;
      const startGoldDiff=me&&them&&hasNum(me.gold)&&hasNum(them.gold)?Number(me.gold)-Number(them.gold):null,endGoldDiff=postMe&&postThem&&hasNum(postMe.gold)&&hasNum(postThem.gold)?Number(postMe.gold)-Number(postThem.gold):null;
      const startCsDiff=me&&them?Number(me.cs)-Number(them.cs):null,endCsDiff=postMe&&postThem?Number(postMe.cs)-Number(postThem.cs):null;
      const crossMapGoldSwingVsPeer=hasNum(startGoldDiff)&&hasNum(endGoldDiff)?Number(endGoldDiff)-Number(startGoldDiff):null,crossMapCsSwingVsPeer=hasNum(startCsDiff)&&hasNum(endCsDiff)?Number(endCsDiff)-Number(startCsDiff):null;
      const tradeEndMs=Number(last.tMs||first.tMs)+90000,playerStructureGains=structureEvents.filter((o:any)=>Number(o.tMs)>=Number(first.tMs)&&Number(o.tMs)<=tradeEndMs&&structureInvolvement(o,frames,pid,teamId,mapId)).length;
      const playerNeutralObjectiveGains=ownObjectiveEvents.filter((o:any)=>Number(o.tMs)>=Number(first.tMs)&&Number(o.tMs)<=tradeEndMs&&isNeutralObjectiveEvent(o)&&participantNearEvent(frames,pid,o,2500,35000)).length;
      const crossMapTradeSupported=playerStructureGains>0||playerNeutralObjectiveGains>0||(hasNum(crossMapGoldSwingVsPeer)&&Number(crossMapGoldSwingVsPeer)>=250)||(hasNum(crossMapCsSwingVsPeer)&&Number(crossMapCsSwingVsPeer)>=6);
      const joinReachable=hasNum(playerDistanceToFight)&&Number(playerDistanceToFight)<=6500,joinReviewPriority=lostFight&&!crossMapTradeSupported&&joinReachable&&(numbersDelta==null||Number(numbersDelta)>=-1)?"high":lostFight&&!crossMapTradeSupported?"medium":"context";
      const decisionReview=crossMapTradeSupported?"cross_map_trade_supported":teamFightKills>enemyFightKills?"team_won_without_player":joinReviewPriority==="high"?"join_review_high":lostFight?"join_review_context":"no_clear_join_claim";
      out.fightProfile.trackedAbsentTeamFights++;
      out.fightProfile.absenceEvents.push({startMin:first.tMin,endMin:last.tMin,kills:events.length,fightZone,fightPosition:anchor?{x:Number(anchor.x),y:Number(anchor.y)}:null,positionEvidenceDeltaSec:Math.abs(Number(positionFrame?.timestamp||0)-Number(positionAnchor?.tMs||0))/1000,playerPosition:{x:Number(positionMe.position.x),y:Number(positionMe.position.y)},playerDistanceToFight:hasNum(playerDistanceToFight)?Math.round(Number(playerDistanceToFight)):null,alliesNear,enemiesNear,numbersDelta,teamFightKills,enemyFightKills,lostFight,crossMapGoldSwingVsPeer,crossMapCsSwingVsPeer,playerStructureGains,playerNeutralObjectiveGains,crossMapTradeSupported,joinReachable,joinReviewPriority,decisionReview,tradeWindowSec:90,definition:"team-involved multi-kill cluster with event coordinates and a player position frame within 35s; no tracked player death/contribution and no <=5000 proximity evidence. Cross-map compensation looks for a supported structure/objective gain or a +250g/+6CS direct-role swing within ~90s. This is replay triage, not proof that joining or skipping was correct."});
    }
    if(!present)continue;
    const alliedDeaths=events.filter((e:any)=>Number(e.victimTeam)===teamId).sort((a:any,b:any)=>a.tMs-b.tMs);
    const firstAllyDeath=active&&!!playerDeath&&alliedDeaths.length>0&&Number(alliedDeaths[0].victimId)===pid;
    const contributionBeforeDeath=contributed&&(!playerDeath||events.some((e:any)=>e.playerContribution&&e.tMs<=playerDeath.tMs));
    const diedBeforeContribution=active&&!!playerDeath&&!contributionBeforeDeath;
    out.fightProfile.present++;
    if(proximityOnly)out.fightProfile.proximityOnly++;
    if(active){
      out.fightProfile.active++;out.fightProfile.attended++;
      if(firstAllyDeath)out.fightProfile.firstAllyDeaths++;
      if(diedBeforeContribution)out.fightProfile.diedBeforeContribution++;
      if(!playerDeath)out.fightProfile.survived++;
    }
    const goldDiffAtStart=me&&them&&hasNum(me.gold)&&hasNum(them.gold)?Number(me.gold)-Number(them.gold):null,levelDiffAtStart=me&&them&&hasNum(me.level)&&hasNum(them.level)?Number(me.level)-Number(them.level):null;
    const rolePeerNear=!!(anchor&&them?.position&&dist2(anchor,them.position)<=5000*5000),roleLevelDisadvantage=rolePeerNear&&hasNum(levelDiffAtStart)&&Number(levelDiffAtStart)<=-1;
    const outnumberedAtFirstKill=hasNum(numbersDelta)&&Number(numbersDelta)<=-2;
    if(active&&hasNum(numbersDelta))out.fightProfile.outnumberedFightSamples++;if(active&&outnumberedAtFirstKill){out.fightProfile.outnumberedStarts++;if(lostFight)out.fightProfile.lostOutnumberedStarts++;}
    if(active&&rolePeerNear){out.fightProfile.rolePeerFightStarts++;if(roleLevelDisadvantage)out.fightProfile.roleLevelDisadvantageStarts++;}
    out.fightProfile.events.push({startMin:first.tMin,endMin:last.tMin,kills:events.length,fightZone,fightPosition:anchor?{x:Number(anchor.x),y:Number(anchor.y)}:null,present,active,proximityOnly,playerDied:!!playerDeath,firstAllyDeath,diedBeforeContribution,contributed,survived:active&&!playerDeath,currentGoldAtStart:me?.currentGold??null,goldDiffAtStart,levelDiffAtStart,alliesNear,enemiesNear,numbersDelta,outnumberedAtFirstKill:active&&outnumberedAtFirstKill,teamFightKills,enemyFightKills,lostFight,rolePeerNear:active&&rolePeerNear,roleLevelDisadvantage:active&&roleLevelDisadvantage});
  }
  if(out.fightProfile.active>0){
    out.fightProfile.firstAllyDeathRate=100*out.fightProfile.firstAllyDeaths/out.fightProfile.active;
    out.fightProfile.diedBeforeContributionRate=100*out.fightProfile.diedBeforeContribution/out.fightProfile.active;
    out.fightProfile.survivalRate=100*out.fightProfile.survived/out.fightProfile.active;
    out.fightProfile.outnumberedStartRate=out.fightProfile.outnumberedFightSamples?100*out.fightProfile.outnumberedStarts/out.fightProfile.outnumberedFightSamples:null;
    out.fightProfile.outnumberedLossRate=out.fightProfile.outnumberedStarts?100*out.fightProfile.lostOutnumberedStarts/out.fightProfile.outnumberedStarts:null;
    out.fightProfile.roleLevelDisadvantageRate=out.fightProfile.rolePeerFightStarts?100*out.fightProfile.roleLevelDisadvantageStarts/out.fightProfile.rolePeerFightStarts:null;
  }
  for(const ev of out.fightProfile.events){if(!ev.active)continue;const ph=out.phaseBehavior[gamePhaseKey(ev.startMin,rules)];ph.fightClusters++;if(ev.firstAllyDeath)ph.firstAllyFightDeaths++;}
  out.itemLedgerQuality={unresolvedUndoEvents:unresolvedItemUndoEvents(itemEventsByPid).length,opponentUnresolvedUndoEvents:unresolvedItemUndoEvents(itemEventsByOpp).length,source:"riot_timeline",zeroIdUndoPolicy:"flag_approximate_do_not_guess",itemCatalogExactPatch,itemMechanicsEligible,itemCatalogPolicy:itemMechanicsEligible?"exact_patch_required_satisfied":"fallback_catalog_display_only_item_mechanics_withheld"};
  const markCatalogFallback=(visits:any[])=>{if(itemMechanicsEligible)return visits;for(const v of visits||[]){v.spendApproximate=true;v.spentLowerBound=null;v.spendEstimateCaveats=Array.isArray(v.spendEstimateCaveats)?v.spendEstimateCaveats:[];if(!v.spendEstimateCaveats.includes("item_catalog_patch_fallback"))v.spendEstimateCaveats.push("item_catalog_patch_fallback");v.spendEstimateCaveat=v.spendEstimateCaveats.join("|");}return visits;};
  out.shopVisits=markCatalogFallback(applyDynamicShopSpendBounds(purchaseGroups(itemEventsByPid,catalog),out.roleQuestContext));
  out.opponentShopVisits=rolePeerId?markCatalogFallback(applyDynamicShopSpendBounds(purchaseGroups(itemEventsByOpp,catalog),roleQuestContext(rules,participantRole(opp)))):[];
  const firstReturnShop=firstMeaningfulReturnShop(out.shopVisits,frames,pid,mapId,teamId),opponentFirstReturnShop=rolePeerId?firstMeaningfulReturnShop(out.opponentShopVisits,frames,rolePeerId,mapId,Number(opp?.teamId||0)):null;
  if(firstReturnShop){
    const resetBeforeTargetMs=Number(firstReturnShop.startMs)-30000,resetAfterTargetMs=Number(firstReturnShop.lastMs)+60000;
    const beforeFrameCandidate=frameNearestMs(frames,resetBeforeTargetMs,35000),afterFrameCandidate=frameNearestMs(frames,resetAfterTargetMs,35000);
    const beforeCandidateMs=Number(beforeFrameCandidate?.timestamp||0)||null,afterCandidateMs=Number(afterFrameCandidate?.timestamp||0)||null;
    const beforeFrame=beforeCandidateMs&&beforeCandidateMs<Number(firstReturnShop.startMs)?beforeFrameCandidate:null,afterFrame=afterCandidateMs&&afterCandidateMs>Number(firstReturnShop.lastMs)?afterFrameCandidate:null;
    const me0=frameStats(beforeFrame,pid),opp0=rolePeerId?frameStats(beforeFrame,rolePeerId):null,me1=frameStats(afterFrame,pid),opp1=rolePeerId?frameStats(afterFrame,rolePeerId):null;
    const goldBefore=me0&&opp0&&hasNum(me0.gold)&&hasNum(opp0.gold)?Number(me0.gold)-Number(opp0.gold):null,goldAfter=me1&&opp1&&hasNum(me1.gold)&&hasNum(opp1.gold)?Number(me1.gold)-Number(opp1.gold):null;
    const csBefore=me0&&opp0?Number(me0.cs)-Number(opp0.cs):null,csAfter=me1&&opp1?Number(me1.cs)-Number(opp1.cs):null;
    const goldSwing=hasNum(goldBefore)&&hasNum(goldAfter)?Number(goldAfter)-Number(goldBefore):null,csSwing=hasNum(csBefore)&&hasNum(csAfter)?Number(csAfter)-Number(csBefore):null;
    const beforeMs=Number(beforeFrame?.timestamp||0)||null,afterMs=Number(afterFrame?.timestamp||0)||null,deathInWindow=!!(beforeMs&&afterMs)&&deathEvents.some((d:any)=>Number(d.tMs)>beforeMs&&Number(d.tMs)<=afterMs);
    const measured=hasNum(goldSwing)||hasNum(csSwing),economyLoss=!deathInWindow&&((hasNum(csSwing)&&Number(csSwing)<=-6)||(hasNum(goldSwing)&&Number(goldSwing)<=-350)),economyGain=!deathInWindow&&hasNum(csSwing)&&hasNum(goldSwing)&&Number(csSwing)>=4&&Number(goldSwing)>=150;
    out.firstResetSequence={time:Number(firstReturnShop.startMin),beforeSampleTargetSec:-30,afterSampleTargetSec:60,beforeSampleMs:beforeMs,afterSampleMs:afterMs,beforeSampleDeltaSec:beforeMs?Math.round((Number(firstReturnShop.startMs)-beforeMs)/1000):null,afterSampleDeltaSec:afterMs?Math.round((afterMs-Number(firstReturnShop.lastMs))/1000):null,sampleWindowBounded:!!beforeMs&&!!afterMs,spent:Number(firstReturnShop.spent||0),spentLowerBound:hasNum(firstReturnShop.spentLowerBound)?Number(firstReturnShop.spentLowerBound):null,spentUpperBound:hasNum(firstReturnShop.spentUpperBound)?Number(firstReturnShop.spentUpperBound):Number(firstReturnShop.spent||0),spendMethod:firstReturnShop.spendMethod||"recipe_owned_component_credit",committedPurchases:Number(firstReturnShop.committedPurchases||0),spendApproximate:!!firstReturnShop.spendApproximate,spendEstimateCaveat:firstReturnShop.spendEstimateCaveat||null,unresolvedUndoCount:Number(firstReturnShop.unresolvedUndoCount||0),items:(firstReturnShop.items||[]).slice(0,6),opponentTime:opponentFirstReturnShop?Number(opponentFirstReturnShop.startMin):null,timingDeltaVsOpponent:opponentFirstReturnShop?Number(firstReturnShop.startMin)-Number(opponentFirstReturnShop.startMin):null,goldDiffBefore:goldBefore,goldDiffAfter:goldAfter,goldSwingAfter:goldSwing,csDiffBefore:csBefore,csDiffAfter:csAfter,csSwingAfter:csSwing,measured,deathInWindow,economyLoss,economyGain,evidenceWindowEndMin:afterMs?afterMs/60000:null,definition:"first committed ≥250g recipe-aware purchase group by 12m after the player has demonstrably left base; ITEM_UNDO transactions are excluded; direct-role economy uses supported frames targeted ~30s before shop and ~60s after shop, each within a 35s tolerance, and is suppressed when a death occurs inside that bounded comparison window"};
  }
  const myMajorSequence=itemMechanicsEligible?majorOwnershipMilestones(itemEventsByPid,catalog,2):[],oppMajorSequence=itemMechanicsEligible?majorOwnershipMilestones(itemEventsByOpp,catalog,2):[];
  out.firstMajorItem=myMajorSequence[0]||null;out.secondMajorItem=myMajorSequence[1]||null;out.opponentFirstMajorItem=oppMajorSequence[0]||null;out.opponentSecondMajorItem=oppMajorSequence[1]||null;
  if(out.secondMajorItem&&out.opponentSecondMajorItem)out.secondMajorItemDeltaVsOpponent=Number(out.secondMajorItem.time)-Number(out.opponentSecondMajorItem.time);
  const controlWardIds=new Set<number>([2055]);for(const [id,info] of Object.entries(catalog||{}) as any)if(text(info?.name).toLowerCase()==="control ward")controlWardIds.add(Number(id));
  out.vision.controlWardPurchases=[...controlWardIds].reduce((n,id)=>n+committedItemPurchaseCount(itemEventsByPid,id),0);
  out.majorItemReadiness=majorItemReadiness(out.firstMajorItem,itemEventsByPid,frames,pid,catalog);
  out.opponentMajorItemReadiness=rolePeerId?majorItemReadiness(out.opponentFirstMajorItem,itemEventsByOpp,frames,rolePeerId,catalog):null;
  if(out.firstMajorItem&&out.opponentFirstMajorItem)out.itemSpikeDeltaVsOpponent=out.firstMajorItem.time-out.opponentFirstMajorItem.time;
  if(out.majorItemReadiness?.eligible&&out.opponentMajorItemReadiness?.eligible&&hasNum(out.majorItemReadiness.delayMin)&&hasNum(out.opponentMajorItemReadiness.delayMin))out.majorItemReadiness.delayDeltaVsOpponent=Number(out.majorItemReadiness.delayMin)-Number(out.opponentMajorItemReadiness.delayMin);
  for(const duel of (out.laneDuel?.events||[]).filter((x:any)=>x.result==="solo_kill"&&x.early)){
    const killMs=Number(duel.time||0)*60000,nextShop=out.shopVisits.find((v:any)=>Number(v.startMs)>killMs)||null;
    const deathBeforeShop=deathEvents.find((d:any)=>Number(d.tMs)>killMs&&(!nextShop||Number(d.tMs)<Number(nextShop.startMs)))||null;
    duel.nextShopDelaySec=nextShop?Math.max(0,Math.round((Number(nextShop.startMs)-killMs)/1000)):null;
    duel.nextShopSpent=nextShop?Number(nextShop.spent||0):null;
    duel.diedBeforeNextShop=!!deathBeforeShop;
    duel.deathBeforeNextShopSec=deathBeforeShop?Math.max(0,Math.round((Number(deathBeforeShop.tMs)-killMs)/1000)):null;
  }
  for(const window of neutralWindows){
    const familyRaw=text(window.objectiveType||window.family||"neutral objective").toUpperCase(),memberSubtypes=(window.members||[]).map((x:any)=>text(x?.monsterSubType).toUpperCase()),family=familyRaw==="RIFTHERALD"?"HERALD":familyRaw==="BARON_NASHOR"?"BARON":familyRaw==="HORDE"?"VOID_GRUBS":familyRaw==="DRAGON"&&memberSubtypes.some((x:any)=>x.includes("ELDER"))?"ELDER_DRAGON":familyRaw;
    const fam=out.objectiveFamilyStats[family]||{encounters:0,teamEncounters:0,enemyEncounters:0,teamUnitsSecured:0,enemyUnitsSecured:0,joinedTeamEncounters:0,teamJoinRate:null,contestedEncounters:0,joinedContestedEncounters:0,contestPresenceRate:null};
    const enemyTeamId=Number(teamId)===100?200:Number(teamId)===200?100:null,ownUnits=Number(window.ownerCounts?.[String(teamId)]||0),enemyUnits=enemyTeamId?Number(window.ownerCounts?.[String(enemyTeamId)]||0):0,contest=objectiveContestEvidence.get(window)||{},present=!!contest.playerPresent;
    fam.encounters++;fam.teamUnitsSecured+=ownUnits;fam.enemyUnitsSecured+=enemyUnits;
    if(ownUnits>0){fam.teamEncounters++;if(present)fam.joinedTeamEncounters++;}
    if(enemyUnits>0)fam.enemyEncounters++;
    if(contest.teamContested){fam.contestedEncounters++;if(present)fam.joinedContestedEncounters++;}
    fam.teamJoinRate=fam.teamEncounters?100*fam.joinedTeamEncounters/fam.teamEncounters:null;
    fam.contestPresenceRate=fam.contestedEncounters?100*fam.joinedContestedEncounters/fam.contestedEncounters:null;
    out.objectiveFamilyStats[family]=fam;
  }
  // Preserve the historical team-secured presence metric as outcome context.
  out.objectiveReadiness.neutralTeamObjectives=neutralOwnWindows.length;
  out.objectiveReadiness.joined=neutralOwnWindows.filter((w:any)=>objectiveContestEvidence.get(w)?.playerPresent).length;
  out.objectiveReadiness.absent=Math.max(0,out.objectiveReadiness.neutralTeamObjectives-out.objectiveReadiness.joined);
  // Coaching/readiness uses team-contested windows: team-secured objectives are always included,
  // while lost objectives count only when at least one allied champion is supported near the encounter.
  for(const window of neutralContestedWindows){
    const contest=objectiveContestEvidence.get(window)||{},present=!!contest.playerPresent,priorSetupFrame=objectiveWindowSetupFrame(frames,pid,window);
    out.objectiveReadiness.contestedObjectives++;
    if(present)out.objectiveReadiness.contestedJoined++;else out.objectiveReadiness.contestedAbsent++;
    const setupLeadSec=priorSetupFrame?Math.max(0,Math.round((Number(window.startMs)-Number(priorSetupFrame.timestamp||0))/1000)):null;
    const earlySetup=present&&!!priorSetupFrame,eventFrameOnlyJoin=present&&!earlySetup;
    if(earlySetup)out.objectiveReadiness.earlySetupJoins++;
    if(eventFrameOnlyJoin)out.objectiveReadiness.eventFrameOnlyJoins++;
    const priorVisits=out.shopVisits.filter((v:any)=>Number(v.lastMs)<=Number(window.startMs)),lastVisit=priorVisits[priorVisits.length-1]||null;
    const secondsSinceShop=lastVisit?Math.round((Number(window.startMs)-Number(lastVisit.lastMs))/1000):null;
    const recentDeath=deathEvents.some((d:any)=>Number(d.tMs)<=Number(window.startMs)&&Number(d.tMs)>=Number(window.startMs)-75000);
    // Purchase timing proves only that shopping ended recently. It does not prove the reset caused the absence.
    const recentShopAbsence=!present&&!recentDeath&&secondsSinceShop!=null&&secondsSinceShop>=0&&secondsSinceShop<=60,lateResetMiss=recentShopAbsence,freshPurchaseJoin=present&&secondsSinceShop!=null&&secondsSinceShop>=0&&secondsSinceShop<=120;
    if(recentShopAbsence){out.objectiveReadiness.recentShopAbsences++;out.objectiveReadiness.lateResetMisses++;} // lateResetMisses is a compatibility alias.
    if(freshPurchaseJoin)out.objectiveReadiness.freshPurchaseJoins++;
    const atStart=frameStats(frameAtMs(frames,Number(window.startMs)),pid),enemyTeamId=Number(teamId)===100?200:Number(teamId)===200?100:null,teamUnitsSecured=Number(window.ownerCounts?.[String(teamId)]||0),enemyUnitsSecured=enemyTeamId?Number(window.ownerCounts?.[String(enemyTeamId)]||0):0;
    out.objectiveReadiness.events.push({time:Number(window.startMin),endTime:Number(window.endMin),objectiveType:text(window.objectiveType||window.family||"neutral objective"),rawEventCount:Number(window.count||1),scope:"team_contested",present,teamSecured:teamUnitsSecured>0,enemySecured:enemyUnitsSecured>0,alliedPresentCount:Number(contest.alliedPresentCount||0),earlySetup,eventFrameOnlyJoin,setupLeadSec,setupEvidence:earlySetup?"prior_position_frame_45_105s":null,secondsSinceShop,currentGold:atStart?.currentGold??null,recentDeath,recentShopAbsence,lateResetMiss,freshPurchaseJoin});
  }
  if(out.objectiveReadiness.contestedJoined>0)out.objectiveReadiness.earlySetupJoinRate=100*out.objectiveReadiness.earlySetupJoins/out.objectiveReadiness.contestedJoined;
  if(out.objectiveReadiness.contestedObjectives>0)out.objectiveReadiness.earlySetupCoverageRate=100*out.objectiveReadiness.earlySetupJoins/out.objectiveReadiness.contestedObjectives;

  for(const ev of out.fightProfile.events){
    if(!ev.active)continue;
    const highUnspentKnown=hasNum(ev.currentGoldAtStart),goldDeficitKnown=hasNum(ev.goldDiffAtStart),itemStateKnown=roleEconomyComparable&&itemMechanicsEligible;
    ev.highUnspent=highUnspentKnown?Number(ev.currentGoldAtStart)>=1000:null;
    ev.goldDeficit=goldDeficitKnown?Number(ev.goldDiffAtStart)<=-600:null;
    ev.playerMajorReady=itemStateKnown?!!out.firstMajorItem&&Number(out.firstMajorItem.time)<=Number(ev.startMin):null;
    ev.opponentMajorReady=itemStateKnown?!!out.opponentFirstMajorItem&&Number(out.opponentFirstMajorItem.time)<=Number(ev.startMin):null;
    ev.itemDisadvantage=itemStateKnown?ev.opponentMajorReady===true&&ev.playerMajorReady!==true:null;
    if(highUnspentKnown)out.fightProfile.highUnspentFightSamples++;
    if(goldDeficitKnown)out.fightProfile.goldDeficitFightSamples++;
    if(itemStateKnown)out.fightProfile.itemDisadvantageFightSamples++;
    if(ev.highUnspent===true)out.fightProfile.highUnspentStarts++;
    if(ev.goldDeficit===true)out.fightProfile.goldDeficitStarts++;
    if(ev.itemDisadvantage===true)out.fightProfile.itemDisadvantageStarts++;
    if(ev.highUnspent===true&&ev.goldDeficit===true)out.fightProfile.unspentAndBehindStarts++;
  }
  out.fightProfile.highUnspentStartRate=out.fightProfile.highUnspentFightSamples?100*out.fightProfile.highUnspentStarts/out.fightProfile.highUnspentFightSamples:null;
  out.fightProfile.itemDisadvantageStartRate=out.fightProfile.itemDisadvantageFightSamples?100*out.fightProfile.itemDisadvantageStarts/out.fightProfile.itemDisadvantageFightSamples:null;
  out.fightProfile.goldDeficitStartRate=out.fightProfile.goldDeficitFightSamples?100*out.fightProfile.goldDeficitStarts/out.fightProfile.goldDeficitFightSamples:null;
  const duration=Math.max(1,Number(match?.info?.gameDuration||0)/60);out.vision.wardsPer30=out.vision.wardCount/duration*30;
  for(const window of neutralOwnWindows){
    out.objectiveTeamTotal++;out.phaseBehavior[gamePhaseKey(window.startMin,rules)].teamObjectives++;
    const near=!!objectiveContestEvidence.get(window)?.playerPresent;
    if(Number(window.startMin)>=Number(rules.midRoutingStartMin)&&Number(window.startMin)<Number(rules.midRoutingEndMin)){out.midRouting.teamObjectives++;if(near)out.midRouting.objectiveJoins++;}
    if(near){out.objectiveJoined++;out.phaseBehavior[gamePhaseKey(window.startMin,rules)].objectiveJoins++;if(out.impactTimeMin==null||Number(window.startMin)<out.impactTimeMin){out.impactTimeMin=Number(window.startMin);out.impactType="neutral_objective";}}
  }
  for(const window of neutralContestedWindows){
    const near=!!objectiveContestEvidence.get(window)?.playerPresent;
    out.objectiveContestTotal++;if(near)out.objectiveContestJoined++;else out.objectiveContestAbsent++;
    if(Number(window.startMin)>=Number(rules.midRoutingStartMin)&&Number(window.startMin)<Number(rules.midRoutingEndMin)){out.midRouting.contestedObjectives++;if(near)out.midRouting.contestedJoins++;}
  }
  if(out.objectiveTeamTotal>0)out.objectiveJoinRate=100*out.objectiveJoined/out.objectiveTeamTotal;
  if(out.objectiveContestTotal>0)out.objectiveContestPresenceRate=100*out.objectiveContestJoined/out.objectiveContestTotal;
  if(out.midRouting.teamObjectives>0)out.midRouting.objectiveJoinRate=100*out.midRouting.objectiveJoins/out.midRouting.teamObjectives;
  if(out.midRouting.contestedObjectives>0)out.midRouting.contestPresenceRate=100*out.midRouting.contestedJoins/out.midRouting.contestedObjectives;
  for(const window of neutralOppWindows){
    const near=rolePeerId?objectiveWindowNear(frames,rolePeerId,window,2500):false;
    if(near&&(out.opponentImpactTimeMin==null||Number(window.startMin)<out.opponentImpactTimeMin)){out.opponentImpactTimeMin=Number(window.startMin);out.opponentImpactType="neutral_objective";}
  }
  let teamEarly=0,playerEarly=0;
  for(const fr of frames){for(const e of(Array.isArray(fr?.events)?fr.events:[])){if(e.type!=="CHAMPION_KILL"||Number(e.timestamp||0)>Number(rules.earlyKpEndMin)*60*1000)continue;const killer=byId.get(Number(e.killerId));if(!killer||Number(killer.teamId)!==teamId)continue;teamEarly++;if(playerInKill(e,pid))playerEarly++;}}
  out.earlyTeamKills=teamEarly;out.earlyPlayerKillInvolvements=playerEarly;
  if(teamEarly>0)out.earlyKp=100*playerEarly/teamEarly;
  for(const ev of involved){out.phaseBehavior[gamePhaseKey(ev.tMin,rules)].killAssistImpacts++;}
  // Post-kill conversion accepts neutral objectives or structures, but individual coaching requires supported presence/involvement.
  const conversionEvidence=(events:any[],whoId:number,whoTeam:number)=>events.map((o:any)=>{
    const playerSupportEvidence=isNeutralObjectiveEvent(o)?(participantNearEvent(frames,whoId,o,2800)?"event_position_proximity":null):structureStrongInvolvementEvidence(o,frames,whoId,whoTeam,mapId);
    return{...o,playerSupported:!!playerSupportEvidence,playerSupportEvidence};
  });
  out.killConversion=killConversionWindows(involved,conversionEvidence(ownObjectiveEvents,pid,teamId));
  if(rolePeerId)out.opponentKillConversion=killConversionWindows(oppInvolved,conversionEvidence(oppObjectiveEvents,Number(rolePeerId),Number(opp?.teamId||0)));
  if(out.firstMajorItem&&out.opponentFirstMajorItem){
    const startMin=Number(out.firstMajorItem.time),endMin=Number(out.opponentFirstMajorItem.time),leadSec=Math.round((endMin-startMin)*60);
    if(Number.isFinite(startMin)&&Number.isFinite(endMin)&&leadSec>=45){
      out.itemSpikeWindow.eligible=true;out.itemSpikeWindow.startMin=startMin;out.itemSpikeWindow.endMin=endMin;out.itemSpikeWindow.leadSec=leadSec;
      const killImpacts=involved.filter((ev:any)=>Number(ev.tMin)>=startMin&&Number(ev.tMin)<endMin);
      for(const ev of killImpacts)out.itemSpikeWindow.events.push({time:ev.tMin,type:"kill_or_assist"});
      out.itemSpikeWindow.killAssistImpacts=killImpacts.length;
      for(const obj of conversionEvidence(ownObjectiveEvents,pid,teamId)){
        if(Number(obj.tMin)<startMin||Number(obj.tMin)>=endMin||obj.playerSupported!==true)continue;
        out.itemSpikeWindow.objectiveImpacts++;
        out.itemSpikeWindow.events.push({time:obj.tMin,type:"objective",objectiveType:text(obj.monsterType||obj.monsterSubType||obj.buildingType||obj.type),supportEvidence:obj.playerSupportEvidence||"supported"});
      }
      out.itemSpikeWindow.events.sort((a:any,b:any)=>Number(a.time)-Number(b.time));
      out.itemSpikeWindow.totalImpacts=out.itemSpikeWindow.killAssistImpacts+out.itemSpikeWindow.objectiveImpacts;
      out.itemSpikeWindow.used=out.itemSpikeWindow.totalImpacts>0;
      const firstImpactTime=out.itemSpikeWindow.events[0]?.time??null;
      const deathInWindow=deathEvents.find((d:any)=>Number(d.tMin)>=startMin&&Number(d.tMin)<endMin);
      out.itemSpikeWindow.diedBeforeImpact=!!deathInWindow&&(!hasNum(firstImpactTime)||Number(deathInWindow.tMin)<Number(firstImpactTime));
    }
  }

  for(const ev of involved){if(out.impactTimeMin==null||ev.tMin<out.impactTimeMin){out.impactTimeMin=ev.tMin;out.impactType="kill_or_assist";}}
  for(const ev of oppInvolved){if(out.opponentImpactTimeMin==null||ev.tMin<out.opponentImpactTimeMin){out.opponentImpactTimeMin=ev.tMin;out.opponentImpactType="kill_or_assist";}}
  if(hasNum(out.impactTimeMin)&&hasNum(out.opponentImpactTimeMin))out.impactDeltaVsOpponent=Number(out.impactTimeMin)-Number(out.opponentImpactTimeMin);
  const contestedNeutralEvent=(o:any)=>neutralContestedWindows.some((w:any)=>Array.isArray(w.members)&&w.members.includes(o));
  for(const d of deathEvents){
    const deathPhase=gamePhaseKey(d.tMin,rules);out.phaseBehavior[deathPhase].deaths++;
    const fr=frameAtMs(frames,d.tMs),me=frameStats(fr,pid),pos=(d.x!=null&&d.y!=null)?{x:d.x,y:d.y}:me?.position;let alliesNear=0,enemiesNear=0,nearestAlly=Infinity;
    if(pos&&fr?.participantFrames){for(const [id,q] of byId.entries()){if(id===pid)continue;const fs=frameStats(fr,id);if(!fs?.position)continue;const dd=dist2(pos,fs.position);if(Number(q.teamId)===teamId){nearestAlly=Math.min(nearestAlly,dd);if(dd<=3000*3000)alliesNear++;}else if(dd<=3000*3000)enemiesNear++;}}
    const isolated=!Number.isFinite(nearestAlly)||nearestAlly>3000*3000,sum=pos?Number(pos.x)+Number(pos.y):null,deep=sum==null?false:(teamId===100?sum>19000:sum<11000),outnumbered=enemiesNear>=alliesNear+2;
    const deathZoneNow=deathArea(mapId,pos,teamId);
    const nextEnemyObj=neutralObjectives.find((o:any)=>o.ownerTeam&&o.ownerTeam!==teamId&&o.tMs>d.tMs&&o.tMs<=d.tMs+75000&&contestedNeutralEvent(o)),enemyObjSoon=!!nextEnemyObj,objectiveContext=neutralObjectives.some((o:any)=>Math.abs(o.tMs-d.tMs)<=45000&&(o.x==null||pos==null||dist2(pos,o)<=3500*3500));
    const nextEnemyStructure=structureEvents.find((o:any)=>{
      if(!(o.ownerTeam&&o.ownerTeam!==teamId&&o.tMs>d.tMs&&o.tMs<=d.tMs+75000))return false;
      if(pos&&hasNum(o.x)&&hasNum(o.y)&&dist2(pos,o)<=5000*5000)return true;
      const eventLane=structureEventLane(o);return !!eventLane&&eventLane===deathZoneNow;
    }),enemyStructureSoon=!!nextEnemyStructure;
    const nextNeutralObj=neutralObjectives.find((o:any)=>o.tMs>d.tMs&&o.tMs<=d.tMs+90000&&contestedNeutralEvent(o));
    const tradeKill=allChampionKills.find((k:any)=>{
      if(Number(k.tMs)<=Number(d.tMs)||Number(k.tMs)>Number(d.tMs)+15000||Number(k.killerTeam)!==teamId||Number(k.victimTeam)===teamId)return false;
      if(pos&&hasNum(k.x)&&hasNum(k.y))return dist2(pos,k)<=3500*3500;
      return false;
    });
    const traded=!!tradeKill,tradeDelaySec=tradeKill?Math.round((Number(tradeKill.tMs)-Number(d.tMs))/1000):null;
    const them=rolePeerId?frameStats(fr,rolePeerId):null,goldDiffAtDeath=me&&them&&hasNum(me.gold)&&hasNum(them.gold)?Number(me.gold)-Number(them.gold):null,csDiffAtDeath=me&&them?Number(me.cs)-Number(them.cs):null;
    const consequenceTargetMs=Number(d.tMs)+60000,afterFrCandidate=frameNearestMs(frames,consequenceTargetMs,35000),afterSampleMs=Number(afterFrCandidate?.timestamp||0)||null;
    const interveningDeath=afterSampleMs?deathEvents.find((x:any)=>Number(x.tMs)>Number(d.tMs)&&Number(x.tMs)<=afterSampleMs):null,economyWindowContaminatedByRepeatDeath=!!interveningDeath;
    if(roleEconomyComparable&&economyWindowContaminatedByRepeatDeath)out.deathConsequences.economySamplesContaminated++;
    const afterFr=economyWindowContaminatedByRepeatDeath?null:afterFrCandidate,afterMe=frameStats(afterFr,pid),afterThem=rolePeerId?frameStats(afterFr,rolePeerId):null;
    const goldDiffAfter=afterMe&&afterThem&&hasNum(afterMe.gold)&&hasNum(afterThem.gold)?Number(afterMe.gold)-Number(afterThem.gold):null,csDiffAfter=afterMe&&afterThem?Number(afterMe.cs)-Number(afterThem.cs):null;
    const goldSwingAfter=hasNum(goldDiffAtDeath)&&hasNum(goldDiffAfter)?Number(goldDiffAfter)-Number(goldDiffAtDeath):null,csSwingAfter=hasNum(csDiffAtDeath)&&hasNum(csDiffAfter)?Number(csDiffAfter)-Number(csDiffAtDeath):null;
    const currentGold=Number(me?.currentGold||0),highUnspent=currentGold>=1000;let score=0;const tags:string[]=[];
    if(isolated){score++;tags.push("isolated");}if(deep){score++;tags.push("deep_enemy_side");}if(outnumbered){score++;tags.push("outnumbered");}if(enemyObjSoon){score+=2;tags.push("enemy_contested_objective_after");out.preObjectiveDeathCount++;out.preObjectiveDeaths.push({time:d.tMin,secondsBeforeObjective:Math.round((nextEnemyObj.tMs-d.tMs)/1000),objectiveType:nextEnemyObj.monsterType||nextEnemyObj.monsterSubType||nextEnemyObj.type,currentGold,scope:"team_contested"});}if(enemyStructureSoon){score+=1;tags.push("enemy_structure_after");}if(highUnspent){score++;tags.push("high_unspent_gold");}if(objectiveContext){out.objectiveDeathCount++;tags.push("objective_context");}
    if(isolated)out.isolatedDeathCount++;
    const bad=score>=2,wasMateriallyAhead=roleEconomyComparable&&hasNum(goldDiffAtDeath)&&Number(goldDiffAtDeath)>=500;
    const deathZone=deathZoneNow,macroTransitionMin=Number(rules.macroTransitionMin??rules.postLaneStartMin??14),isMacroTransitionSideLane=Number(d.tMin)>=macroTransitionMin&&(deathZone==="top lane"||deathZone==="bot lane"),isolatedSideLane=isMacroTransitionSideLane&&alliesNear===0,preNeutralObjectiveSideLane=isolatedSideLane&&!!nextNeutralObj;
    if(isMacroTransitionSideLane){
      out.sideLaneRisk.macroTransitionSideLaneDeaths++;
      out.sideLaneRisk.postLaneSideLaneDeaths++; // compatibility alias only; this does not assert that lane phase literally ended.
      if(Number(d.tMin)>=15)out.sideLaneRisk.post15SideLaneDeaths++;
      if(isolatedSideLane)out.sideLaneRisk.isolatedSideLaneDeaths++;
      if(preNeutralObjectiveSideLane)out.sideLaneRisk.preNeutralObjectiveSideLaneDeaths++;
      if(bad)out.sideLaneRisk.highRiskSideLaneDeaths++;
      out.sideLaneRisk.events.push({time:d.tMin,zone:deathZone,isolated:isolatedSideLane,highRisk:bad,traded,alliesNear,enemiesNear,neutralObjectiveSoon:!!nextNeutralObj,secondsBeforeNeutralObjective:nextNeutralObj?Math.round((Number(nextNeutralObj.tMs)-Number(d.tMs))/1000):null,neutralObjectiveType:nextNeutralObj?text(nextNeutralObj.monsterType||nextNeutralObj.monsterSubType||"neutral objective"):null,goldDiffAtDeath,currentGold});
    }
    const roleEconomyState=!roleEconomyComparable||!hasNum(goldDiffAtDeath)?"unknown":Number(goldDiffAtDeath)>=500?"ahead":Number(goldDiffAtDeath)<=-500?"behind":"even";
    if(roleEconomyState!=="unknown"){
      out.riskStateDeaths[roleEconomyState]++;
      if(bad)out.riskStateDeaths["highRisk"+roleEconomyState[0].toUpperCase()+roleEconomyState.slice(1)]++;
      out.riskStateDeaths.events.push({time:d.tMin,state:roleEconomyState,goldDiffAtDeath,highRisk:bad,traded,currentGold,zone:deathArea(mapId,pos,teamId),tags,enemyObjectiveAfter:enemyObjSoon,goldSwingAfter});
    }
    const recentVisionAction=[...out.wards.map((w:any)=>({...w,action:"placed"})),...out.wardKills.map((w:any)=>({...w,action:"cleared"}))]
      .filter((v:any)=>Number(v.tMs)<=Number(d.tMs)&&Number(d.tMs)-Number(v.tMs)<=20000&&pos&&hasNum(v.x)&&hasNum(v.y)&&dist2(pos,v)<=2500*2500)
      .sort((a:any,b:any)=>Number(b.tMs)-Number(a.tMs))[0]||null;
    if(recentVisionAction){
      const visionObjectiveSetup=neutralObjectives.some((o:any)=>o.x!=null&&o.y!=null&&Number(o.tMs)>=Number(recentVisionAction.tMs)&&Number(o.tMs)-Number(recentVisionAction.tMs)<=90000&&dist2(recentVisionAction,o)<=3500*3500);
      const unsupportedVisionAction=alliesNear===0;
      out.visionMission.deaths++;
      if(bad)out.visionMission.highRiskDeaths++;
      if(!traded)out.visionMission.untradedDeaths++;
      if(unsupportedVisionAction)out.visionMission.unsupportedDeaths++;
      if(visionObjectiveSetup)out.visionMission.objectiveSetupDeaths++;
      tags.push("vision_action_before_death");
      out.visionMission.events.push({time:d.tMin,action:recentVisionAction.action,actionTime:recentVisionAction.time,secondsAfterAction:Math.round((Number(d.tMs)-Number(recentVisionAction.tMs))/1000),wardType:text(recentVisionAction.wardType),territory:text(recentVisionAction.territory)||null,objectiveSetup:visionObjectiveSetup,highRisk:bad,traded,unsupported:unsupportedVisionAction,alliesNear,enemiesNear,zone:deathArea(mapId,pos,teamId)});
    }
    const recentOwnImpact=[...involved].filter((x:any)=>Number(x.tMs)<=Number(d.tMs)&&Number(d.tMs)-Number(x.tMs)<=30000).sort((a:any,b:any)=>Number(b.tMs)-Number(a.tMs))[0]||null;
    if(recentOwnImpact){
      out.postImpactRisk.deathsWithin30s++;
      if(bad)out.postImpactRisk.highRiskDeathsWithin30s++;
      if(!traded)out.postImpactRisk.untradedDeathsWithin30s++;
      if(bad&&!traded)out.postImpactRisk.highRiskUntradedDeathsWithin30s++;
      out.postImpactRisk.events.push({impactTime:recentOwnImpact.tMin,deathTime:d.tMin,secondsAfterImpact:Math.round((Number(d.tMs)-Number(recentOwnImpact.tMs))/1000),highRisk:bad,traded,zone:deathArea(mapId,pos,teamId),goldDiffAtDeath,currentGold,enemyObjectiveAfter:enemyObjSoon});
    }
    const consequenceSignals:string[]=[];
    if(roleEconomyComparable&&hasNum(goldSwingAfter)&&Number(goldSwingAfter)<=-300)consequenceSignals.push("role_gold_swing");
    if(roleEconomyComparable&&hasNum(csSwingAfter)&&Number(csSwingAfter)<=-6)consequenceSignals.push("role_cs_swing");
    if(enemyObjSoon)consequenceSignals.push("enemy_objective_after");
    if(enemyStructureSoon)consequenceSignals.push("enemy_structure_after");
    const consequenceMeasured=(roleEconomyComparable&&(hasNum(goldSwingAfter)||hasNum(csSwingAfter)))||enemyObjSoon||enemyStructureSoon,costlyDeath=consequenceSignals.length>=1,severeCostDeath=consequenceSignals.length>=2;
    if(consequenceMeasured){
      out.deathConsequences.measured++;
      if(costlyDeath){out.deathConsequences.costly++;out.phaseBehavior[deathPhase].costlyDeaths++;}
      if(severeCostDeath){out.deathConsequences.severe++;out.phaseBehavior[deathPhase].severeDeaths++;}
      if(costlyDeath&&!traded)out.deathConsequences.untradedCostly++;
      out.deathConsequences.events.push({time:d.tMin,roleEconomyComparable,goldDiffAtDeath,csDiffAtDeath,goldDiffAfter,csDiffAfter,goldSwingAfter,csSwingAfter,economySampleTargetSec:60,economySampleMs:afterSampleMs,economyWindowContaminatedByRepeatDeath,interveningDeathTime:interveningDeath?Number(interveningDeath.tMin):null,enemyObjectiveAfter:enemyObjSoon,enemyStructureAfter:enemyStructureSoon,structureAttribution:enemyStructureSoon?(hasNum(nextEnemyStructure?.x)&&hasNum(nextEnemyStructure?.y)?"nearby_event_position":"same_lane_metadata"):null,traded,highRisk:bad,costly:costlyDeath,severe:severeCostDeath,signals:consequenceSignals,zone:deathZoneNow});
    }
    if(traded)out.tradedDeathCount++;else out.untradedDeathCount++;
    if(bad&&!traded)out.highRiskUntradedDeathCount++;
    out.deathTrades.push({time:d.tMin,traded,tradeDelaySec,highRisk:bad,zone:deathArea(mapId,pos,teamId)});
    if(highUnspent)out.highUnspentGoldDeaths++;
    if(wasMateriallyAhead){
      out.leadDeathCount++;if(bad)out.highRiskLeadDeathCount++;
      out.leadDeaths.push({time:d.tMin,goldDiffAtDeath,goldDiffAfter,goldSwingAfter,currentGold,highRisk:bad,tags,zone:deathArea(mapId,pos,teamId),enemyObjectiveAfter:enemyObjSoon});
    }
    if(bad){out.phaseBehavior[deathPhase].highRiskDeaths++;out.badDeathCount++;out.badDeaths.push({time:d.tMin,x:d.x??null,y:d.y??null,zone:deathArea(mapId,pos,teamId),fightZone:fightArea(mapId,pos,teamId),score,tags,alliesNear,enemiesNear,currentGold,goldDiffAtDeath,goldSwingAfter,traded,tradeDelaySec});}
    if(bad&&(highUnspent||(deep&&isolated))){out.overstayCount++;out.overstays.push({time:d.tMin,currentGold,tags});}
  }
  if(rules.lane15Comparable!==false&&hasNum(out.goldDiff15)&&earlyRoleGoldSamples.length){
    const peak=earlyRoleGoldSamples.reduce((best:any,x:any)=>Number(x.goldDiff)>Number(best.goldDiff)?x:best,earlyRoleGoldSamples[0]);
    if(peak&&Number(peak.goldDiff)>=500){
      const swing=Number(out.goldDiff15)-Number(peak.goldDiff),afterPeakDeaths=deathEvents.filter((d:any)=>Number(d.tMin)>Number(peak.time)&&Number(d.tMin)<=15),afterPeakHighRisk=(out.badDeaths||[]).filter((d:any)=>Number(d.time)>Number(peak.time)&&Number(d.time)<=15);
      out.earlyLeadWindow={eligible:true,peakMin:Number(peak.time),peakGoldDiff:Number(peak.goldDiff),goldDiff15:Number(out.goldDiff15),goldSwingTo15:swing,giveback:swing<=-500,preserved:swing>=-250,deathsAfterPeak:afterPeakDeaths.length,highRiskDeathsAfterPeak:afterPeakHighRisk.length,deathTimes:afterPeakDeaths.map((d:any)=>Number(d.tMin))};
    }
  }
  if(deathEvents.length){out.objectiveDeathPct=100*out.objectiveDeathCount/deathEvents.length;out.preObjectiveDeathPct=100*out.preObjectiveDeathCount/deathEvents.length;}
  const ownRepeat=repeatDeathSummary(deathEvents),oppDeathEvents=rolePeerId?allChampionKills.filter((x:any)=>Number(x.victimId)===rolePeerId):[],oppRepeat=repeatDeathSummary(oppDeathEvents);
  const ownRepeatEvents=ownRepeat.events.map((x:any)=>{
    const bad=(out.badDeaths||[]).find((b:any)=>Math.abs(Number(b.time)-Number(x.secondMin))<0.02),cost=(out.deathConsequences?.events||[]).find((d:any)=>Math.abs(Number(d.time)-Number(x.secondMin))<0.02),trade=(out.deathTrades||[]).find((d:any)=>Math.abs(Number(d.time)-Number(x.secondMin))<0.02);
    return{...x,highRisk:!!bad,costly:!!cost?.costly,severe:!!cost?.severe,traded:!!trade?.traded,phase:gamePhaseKey(x.secondMin,rules)};
  });
  out.deathRecovery={deaths:ownRepeat.deaths,opportunities:ownRepeat.opportunities,repeatDeaths:ownRepeat.repeatDeaths,rate:ownRepeat.rate,highRiskRepeatDeaths:ownRepeatEvents.filter((x:any)=>x.highRisk).length,costlyRepeatDeaths:ownRepeatEvents.filter((x:any)=>x.costly).length,untradedRepeatDeaths:ownRepeatEvents.filter((x:any)=>!x.traded).length,events:ownRepeatEvents};
  out.opponentDeathRecovery=oppRepeat;
  if(involved.length>0)out.postImpactRisk.ratePerImpact=100*out.postImpactRisk.deathsWithin30s/involved.length;
  out.visionMission.actions=Number(out.vision.wardCount||0)+Number(out.vision.wardKillCount||0);
  if(out.visionMission.actions>0)out.visionMission.deathRate=100*out.visionMission.deaths/out.visionMission.actions;
  if(out.visionMission.deaths>0)out.visionMission.highRiskDeathRate=100*out.visionMission.highRiskDeaths/out.visionMission.deaths;
  if(out.deathConsequences.measured>0){
    out.deathConsequences.costlyRate=100*out.deathConsequences.costly/out.deathConsequences.measured;
    const trustedEconomyEvents=(out.deathConsequences.events||[]).filter((x:any)=>x.roleEconomyComparable===true);
    out.deathConsequences.avgGoldSwing=avg(trustedEconomyEvents.map((x:any)=>x.goldSwingAfter));
    out.deathConsequences.avgCsSwing=avg(trustedEconomyEvents.map((x:any)=>x.csSwingAfter));
  }
  out.closing25.highRiskDeaths=(out.badDeaths||[]).filter((x:any)=>Number(x.time)>=25).length;
  out.closing25.costlyDeaths=(out.deathConsequences.events||[]).filter((x:any)=>Number(x.time)>=25&&x.costly).length;
  out.closing25.severeDeaths=(out.deathConsequences.events||[]).filter((x:any)=>Number(x.time)>=25&&x.severe).length;

  const visits=out.shopVisits;
  for(let i=0;i<out.frameSamples.length;i++){const sm=out.frameSamples[i];if(sm.time<6||sm.time>22||Number(sm.currentGold||0)<1200||sm.zone==="base")continue;const next=visits.find((v:any)=>v.startMin>sm.time);if(!next||next.startMin-sm.time<=2)continue;const prev=out.greedyStayWindows[out.greedyStayWindows.length-1];if(prev&&sm.time-prev.startMin<2.5)continue;out.greedyStayWindows.push({startMin:sm.time,currentGold:sm.currentGold,nextShopMin:next.startMin,delayMin:next.startMin-sm.time});}
  for(const w of out.wards){w.objectiveSetup=neutralObjectives.some(o=>o.x!=null&&Math.abs(o.tMin-w.time)<=1.5&&o.tMin>=w.time&&dist2(w,o)<=3500*3500);if(w.objectiveSetup)out.vision.objectiveSetup++;}
  for(const w of oppWards){w.objectiveSetup=neutralObjectives.some(o=>o.x!=null&&Math.abs(o.tMin-w.time)<=1.5&&o.tMin>=w.time&&dist2(w,o)<=3500*3500);if(w.objectiveSetup)out.opponentVision.objectiveSetup++;}
  for(const w of out.wardKills){w.objectiveSetup=neutralObjectives.some(o=>o.x!=null&&o.y!=null&&Number(o.tMin)>=Number(w.time)&&Number(o.tMin)-Number(w.time)<=1.5&&dist2(w,o)<=3500*3500);if(w.objectiveSetup)out.vision.objectiveSetupClears++;}
  if(rolePeerId)out.vision.objectiveSetupDeltaVsOpponent=Number(out.vision.objectiveSetup||0)-Number(out.opponentVision.objectiveSetup||0);
  if(homeLane&&rr!=="JUNGLE"&&mapId===11){
    const roamEndMin=Number(rules.roamEndMin||20),samples=out.frameSamples.filter((x:any)=>x.time>=3&&x.time<roamEndMin&&x.zone!=="unknown");let i=1;
    while(i<samples.length){
      if(samples[i-1].zone===homeLane&&samples[i].zone!==homeLane&&samples[i].zone!=="base"){
        const startSample=samples[i],outside:any[]=[startSample];let j=i+1;while(j<samples.length&&samples[j].zone!==homeLane&&samples[j].zone!=="base"){outside.push(samples[j]);j++;}
        const endSample=samples[Math.min(j,samples.length-1)]||outside[outside.length-1];
        if(outside.length>=1&&(endSample.time-startSample.time)>=0.7){
          const st=startSample.time,et=endSample.time+0.5,windowStart=st-0.3,windowEnd=et;
          const playerImpacts=involved.filter((e:any)=>e.tMin>=windowStart&&e.tMin<=windowEnd);
          const playerDeaths=deathEvents.filter((e:any)=>e.tMin>=windowStart&&e.tMin<=windowEnd);
          const teamKills=allChampionKills.filter((e:any)=>e.tMin>=windowStart&&e.tMin<=windowEnd&&Number(e.killerTeam)===teamId);
          const roamNeutralObjectives=neutralObjectives.filter((e:any)=>e.tMin>=windowStart&&e.tMin<=windowEnd);
          const roamStructureEvents=structureEvents.filter((e:any)=>e.tMin>=windowStart&&e.tMin<=windowEnd);
          const objectiveEvents=roamNeutralObjectives.map((e:any)=>{
            const present=participantNearEvent(frames,pid,e,2800),won=Number(e.ownerTeam)===teamId;
            return{time:e.tMin,tMs:e.tMs,type:neutralObjectiveFamily(e),monsterType:e.monsterType,monsterSubType:e.monsterSubType,ownerTeam:e.ownerTeam,winner:won?"own":"enemy",present,...(hasNum(e.x)&&hasNum(e.y)?{x:e.x,y:e.y}:{})};
          });
          const structureEvidence=roamStructureEvents.map((e:any)=>{
            const won=Number(e.ownerTeam)===teamId,attribution=won?structureInvolvementEvidence(e,frames,pid,teamId,mapId):null,eventLane=structureEventLane(e);
            return{time:e.tMin,tMs:e.tMs,type:e.type,towerType:e.towerType,laneType:e.laneType,eventLane,turretTier:turretTier(e),ownerTeam:e.ownerTeam,winner:won?"own":"enemy",playerInvolved:!!attribution,attribution,...(hasNum(e.x)&&hasNum(e.y)?{x:e.x,y:e.y}:{})};
          });
          const objectivePresent=objectiveEvents.filter((e:any)=>e.winner==="own"&&e.present).length;
          const objectiveAway=objectiveEvents.filter((e:any)=>e.winner==="own"&&!e.present).length;
          const objectiveLost=objectiveEvents.filter((e:any)=>e.winner==="enemy").length;
          const structureInvolvements=structureEvidence.filter((e:any)=>e.winner==="own"&&e.playerInvolved).length;
          const platesGained=structureEvidence.filter((e:any)=>e.type==="TURRET_PLATE_DESTROYED"&&e.winner==="own"&&e.playerInvolved).length;
          const platesLost=structureEvidence.filter((e:any)=>e.type==="TURRET_PLATE_DESTROYED"&&e.winner==="enemy"&&e.eventLane===homeLane).length;
          const homeLaneStructuresLost=structureEvidence.filter((e:any)=>e.type==="BUILDING_KILL"&&e.winner==="enemy"&&e.eventLane===homeLane).length;
          const pathSamples=[samples[i-1],...outside,endSample].filter(Boolean),seenPathTimes=new Set<number>();
          const pathPoints=pathSamples.map((x:any)=>({time:Number(x.time),tMs:Math.round(Number(x.time)*60000),x:x.position?.x,y:x.position?.y,zone:x.zone})).filter((x:any)=>hasNum(x.x)&&hasNum(x.y)&&!seenPathTimes.has(x.tMs)&&!!seenPathTimes.add(x.tMs));
          const zoneCounts:any={};outside.forEach(x=>zoneCounts[x.zone]=(zoneCounts[x.zone]||0)+1);const target=Object.entries(zoneCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1]))[0]?.[0]||"map";
          const kill=playerImpacts[0]||null,death=playerDeaths[0]||null,obj=objectiveEvents.find((e:any)=>e.winner==="own"&&e.present)||null;
          let outcome="neutral";if(playerImpacts.length||objectivePresent||structureInvolvements)outcome="success";else if(playerDeaths.length)outcome="failure";
          const roam:any={
            startMin:st,endMin:endSample.time,durationMin:Math.max(0,endSample.time-st),targetZone:target,outcome,
            killOrAssist:playerImpacts.length>0,playerKillAssists:playerImpacts.length,teamKills:teamKills.length,
            objective:objectivePresent>0,objectivePresent,objectiveAway,teamObjectivesWithoutPlayer:objectiveAway,objectiveLost,enemyObjectivesDuringRoam:objectiveLost,objectives:objectiveEvents,
            death:playerDeaths.length>0,playerDeaths:playerDeaths.length,structureInvolvements,structureEvents:structureEvidence,
            platesGained,platesLost,homeLaneStructuresLost,pathPoints,evidenceVersion:"roam_window_v3"
          };
          if(rolePeerId){
            const sf=frameAtMs(frames,startSample.time*60000),ef=frameAtMs(frames,endSample.time*60000),m0=frameStats(sf,pid),o0=frameStats(sf,rolePeerId),m1=frameStats(ef,pid),o1=frameStats(ef,rolePeerId);
            if(m0&&o0&&m1&&o1)roam.laneCostCs=(m1.cs-o1.cs)-(m0.cs-o0.cs);
          }
          if(rr==="SUPPORT"){const alliedAdcCandidates=ps.filter((x:any)=>Number(x.teamId)===teamId&&participantRoleEvidence(x).confidence==="high"&&participantRole(x)==="ADC"),enemyAdcCandidates=ps.filter((x:any)=>Number(x.teamId)!==teamId&&participantRoleEvidence(x).confidence==="high"&&participantRole(x)==="ADC"),adc=alliedAdcCandidates.length===1?alliedAdcCandidates[0]:null,enemyAdc=enemyAdcCandidates.length===1?enemyAdcCandidates[0]:null;if(adc&&enemyAdc){const sf=frameAtMs(frames,startSample.time*60000),ef=frameAtMs(frames,endSample.time*60000),a0=frameStats(sf,adc.participantId),b0=frameStats(sf,enemyAdc.participantId),a1=frameStats(ef,adc.participantId),b1=frameStats(ef,enemyAdc.participantId);if(a0&&b0&&a1&&b1)roam.adcLaneCostCs=(a1.cs-b1.cs)-(a0.cs-b0.cs);}}
          roam.coachingLaneCostCs=rr==="SUPPORT"&&hasNum(roam.adcLaneCostCs)?Number(roam.adcLaneCostCs):hasNum(roam.laneCostCs)?Number(roam.laneCostCs):null;
          roam.laneCostBasis=rr==="SUPPORT"&&hasNum(roam.adcLaneCostCs)?"allied_adc_vs_enemy_adc":hasNum(roam.laneCostCs)?"player_vs_direct_role_peer":"unavailable";
          out.roams.events.push(roam);out.roams.attempts++;if(outcome==="success")out.roams.successes++;else if(outcome==="failure")out.roams.failures++;else out.roams.neutral++;
        }
        i=Math.max(j,i+1);
      }else i++;
    }
  }
  if(out.lanePressure.earlyClassifiedHomeLaneDeaths>0)out.lanePressure.earlyOutsidePressureShare=100*out.lanePressure.earlyOutsidePressureDeaths/out.lanePressure.earlyClassifiedHomeLaneDeaths;
  if(out.lanePressure.pre14ClassifiedHomeLaneDeaths>0)out.lanePressure.outsidePressureShare=100*out.lanePressure.pre14OutsidePressureDeaths/out.lanePressure.pre14ClassifiedHomeLaneDeaths;
  const totalDeaths=Number(p?.deaths??deathEvents.length);
  out.deathQuality={legacyBruisienator:legacyBruisienatorDqiCompatibility(out,totalDeaths),evidence:deathQualityEvidence(out,totalDeaths)};
  return out;
}
function gamePhaseKey(minute:any,rules:any=STANDARD_SR_2026_RULES){const m=Number(minute);return m<Number(rules?.earlyEndMin||14)?"early":m<Number(rules?.lateStartMin||20)?"mid":"late";}
function signedText(v:any,d=0){if(!hasNum(v))return"n/a";const n=Number(v);return(n>0?"+":"")+n.toFixed(d);}
function clampNumber(v:any,min:number,max:number){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
function legacyBruisienatorDqiCompatibility(out:any,totalDeaths:number){
  // Uploaded V21 formula:
  // 10 - badDeaths*1.4 - soloDeaths*0.8 - greedyDeaths*0.8 - facecheckDeaths*1.0 - deathsNearObjective*1.2.
  // Crucially, the supplied Analyze-Playstyle.ps1 only emits badDeaths; the other four fields are never populated.
  // Keep the exact effective pipeline result separate from a partial reconstruction of the apparent design intent.
  const bad=Number(out?.badDeathCount||0),isolated=Number(out?.isolatedDeathCount||0),greedyProxy=Number(out?.overstayCount||0),nearObjective=Number(out?.objectiveDeathCount||0);
  const effectivePipelineScore=clampNumber(10-bad*1.4,0,10);
  const reconstructedWithoutFacecheck=clampNumber(10-bad*1.4-isolated*0.8-greedyProxy*0.8-nearObjective*1.2,0,10);
  return{
    score:effectivePipelineScore,scale:"0-10",formula:"bruisienator_v21_source_formula",pipelineBehavior:"only_badDeaths_was_emitted",
    sourceFormula:{badDeaths:1.4,soloDeaths:0.8,greedyDeaths:0.8,facecheckDeaths:1.0,deathsNearObjective:1.2},
    effectivePipelineScore,reconstructedWithoutFacecheck,reconstructionPartial:true,totalDeaths,
    observed:{badDeaths:bad},intentProxies:{isolatedDeaths:isolated,greedyOverstayDeaths:greedyProxy,deathsNearObjective:nearObjective},
    missingSourceInputs:["soloDeaths","greedyDeaths","facecheckDeaths","deathsNearObjective"]
  };
}
function deathQualityEvidence(out:any,totalDeaths:number){
  const measured=Number(out?.deathConsequences?.measured||0),pct=(a:any,b:any)=>Number(b)>0?100*Number(a||0)/Number(b):null;
  return{
    deaths:totalDeaths,measuredConsequences:measured,consequenceCoveragePct:pct(measured,totalDeaths),economySamplesContaminated:Number(out?.deathConsequences?.economySamplesContaminated||0),
    highRiskDeaths:Number(out?.badDeathCount||0),highRiskRate:pct(out?.badDeathCount,totalDeaths),
    costlyDeaths:Number(out?.deathConsequences?.costly||0),costlyMeasuredRate:pct(out?.deathConsequences?.costly,measured),
    severeDeaths:Number(out?.deathConsequences?.severe||0),severeMeasuredRate:pct(out?.deathConsequences?.severe,measured),
    isolatedDeaths:Number(out?.isolatedDeathCount||0),preObjectiveDeaths:Number(out?.preObjectiveDeathCount||0),
    highUnspentDeaths:Number(out?.highUnspentGoldDeaths||0),highRiskLeadDeaths:Number(out?.highRiskLeadDeathCount||0),
    model:"transparent_evidence_v1"
  };
}
function gameJudgments(g:any){
  const items:any[]=[];
  const directPeerComparable=g?.directPeerComparable===true;
  const lane15Comparable=directPeerComparable&&g?.phaseRules?.lane15Comparable!==false,fixed15to25Comparable=directPeerComparable&&g?.phaseRules?.fixed15to25Comparable!==false,closing25Comparable=directPeerComparable&&g?.phaseRules?.closing25Comparable!==false;
  const add=(priority:number,category:string,title:string,evidence:string,action:string,tone:string="improve")=>items.push({priority,category,title,evidence,action,tone});
  if(directPeerComparable&&Number(g.laneDuel?.earlySoloDeathsToRole)>=1&&Number(g.laneDuel?.earlySoloDeathsToRole)>Number(g.laneDuel?.earlySoloKillsVsRole)){
    add(1,"laning","The direct lane duel went against you",String(g.laneDuel.earlySoloKillsVsRole||0)+" solo kill(s) versus "+String(g.laneDuel.earlySoloDeathsToRole||0)+" solo death(s) against the same-role opponent during the queue-aware early phase, excluding kills with assisting participants.","Review the exact trade/all-in that created the solo death: health/resource state, cooldowns, wave position and whether disengaging preserved more lane value.");
  }else if(directPeerComparable&&Number(g.laneDuel?.earlySoloKillsVsRole)>=1&&Number(g.laneDuel?.earlySoloKillsVsRole)>Number(g.laneDuel?.earlySoloDeathsToRole)){
    add(4,"laning","You won the clean direct-role duel",String(g.laneDuel.earlySoloKillsVsRole)+" solo kill(s) versus "+String(g.laneDuel.earlySoloDeathsToRole||0)+" solo death(s) against the same-role opponent during the queue-aware early phase.","Preserve the matchup-specific trade/all-in conditions that produced the advantage; distinguish those from plays that depended on outside pressure.","strength");
  }
  if(["TOP","MID","ADC","SUPPORT"].includes(String(g.role))&&Number(g.lanePressure?.earlyOutsidePressureDeaths)>=2){
    const roles=[...new Set((g.lanePressure.events||[]).filter((x:any)=>x?.classificationEligible===true).flatMap((x:any)=>x.outsideRoles||[]))].join(", ");
    const opposition=String(g.role)==="ADC"||String(g.role)==="SUPPORT"?"the ordinary enemy bot-lane duo":"the ordinary direct-role lane opponent";
    add(2,"map awareness","Repeated early lane deaths involved outside-role pressure",String(g.lanePressure.earlyOutsidePressureDeaths)+" classified early home-lane deaths involved at least one enemy beyond "+opposition+(roles?" ("+roles+")":"")+".","Review wave depth and information before the deaths: where was the enemy jungler or roamer last seen, which side was warded, and could the wave have been collected from a safer position?");
  }
  if(directPeerComparable&&Number(g.structurePressure?.soloKillWindows)>=1&&Number(g.structurePressure?.soloKillStructureConversions)===0&&["TOP","MID","ADC"].includes(String(g.role)))add(2,"lane conversion","You won the duel but did not convert it into supported structure pressure",String(g.structurePressure.soloKillWindows)+" early clean solo-kill window(s) produced no supported plate/turret involvement within 90 seconds.","After the kill, make the wave decision explicit: crash/deny safely, then take the available plate or reset. Do not stay for a plate if the wave or enemy reinforcement makes it unsafe.");
  const soloKillConversions=directPeerComparable?(g.laneDuel?.events||[]).filter((x:any)=>x.result==="solo_kill"&&x.conversionEligibleTo15&&hasNum(x.goldSwingTo15)):[];
  if(soloKillConversions.length){
    const avgKillGoldSwing=avg(soloKillConversions.map((x:any)=>x.goldSwingTo15)),avgKillCsSwing=avg(soloKillConversions.map((x:any)=>x.csSwingTo15));
    if(hasNum(avgKillGoldSwing)&&Number(avgKillGoldSwing)<=100)add(2,"lane conversion","The solo kill did not become durable lane economy","After "+soloKillConversions.length+" conversion-eligible early solo kill(s), your direct-role gold differential improved only "+signedText(avgKillGoldSwing,0)+"g by 15"+(hasNum(avgKillCsSwing)?" and "+signedText(avgKillCsSwing,1)+" CS":".")+".","Review the wave and reset immediately after the kill: crash/deny the correct wave, spend the gold, and avoid giving the opponent a free recovery window.");
    else if(hasNum(avgKillGoldSwing)&&Number(avgKillGoldSwing)>=350)add(4,"lane conversion","You converted the solo kill into lasting lane economy","After your conversion-eligible early solo kill(s), direct-role gold differential improved "+signedText(avgKillGoldSwing,0)+"g by 15 on average.","Preserve the post-kill wave/reset sequence that turns mechanics into a durable advantage.","strength");
  }
  const earlyLead=directPeerComparable?(g.earlyLeadWindow||{}):{};
  if(earlyLead.eligible&&earlyLead.giveback)add(1,"lane conversion","A meaningful early role lead was given back before 15","Your direct-role gold lead peaked at "+signedText(earlyLead.peakGoldDiff,0)+"g around "+Number(earlyLead.peakMin).toFixed(1)+"m and reached "+signedText(earlyLead.goldDiff15,0)+"g at 15 ("+signedText(earlyLead.goldSwingTo15,0)+"g swing). "+String(earlyLead.deathsAfterPeak||0)+" death(s) occurred after the peak before 15, including "+String(earlyLead.highRiskDeathsAfterPeak||0)+" high-risk death(s).","Review the sequence from the peak lead to 15: wave state, reset timing, movement and any death are context to test. Preserve the earned economy without assuming one event caused the whole swing.");
  else if(earlyLead.eligible&&earlyLead.preserved&&Number(earlyLead.goldDiff15)>=500)add(4,"lane conversion","You preserved a meaningful early role lead through 15","Your direct-role gold lead peaked at "+signedText(earlyLead.peakGoldDiff,0)+"g around "+Number(earlyLead.peakMin).toFixed(1)+"m and remained "+signedText(earlyLead.goldDiff15,0)+"g at 15.","Preserve the wave/reset/risk sequence that protects the early advantage, then convert it through the first macro-transition objective and purchase windows.","strength");
  if(lane15Comparable&&hasNum(g.goldDiff15)){
    if(Number(g.goldDiff15)<=-400)add(1,"laning","You reached 15 minutes materially behind your direct role opponent","At 15 minutes: "+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Review the first two recalls, waves conceded around fights, and trades that cost farm.");
    else if(Number(g.goldDiff15)>=400)add(3,"laning","You created a meaningful lane/economy lead","At 15 minutes: +"+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Use the next purchase/objective window to convert the lead instead of letting the game return to even.","strength");
  }
  if(closing25Comparable&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500&&!g.win){
    const lateHighRisk=Number(g.closing25?.highRiskDeaths||0),lateCostly=Number(g.closing25?.costlyDeaths||0);
    if(lateHighRisk+lateCostly>0)add(1,"closing","A 25-minute role advantage was not closed","You were "+signedText(g.goldDiff25,0)+"g versus the direct same-role opponent at 25 minutes, but lost; after 25, this game contains "+String(lateHighRisk)+" high-risk death(s) and "+String(lateCostly)+" costly death consequence event(s).","Treat late fights and objective approaches as lead-protection windows: arrive set up, spend first, and avoid giving the opponent a high-value opening death when your role matchup already holds an economy edge.");
    else add(2,"closing","A 25-minute role advantage did not become a win","You were "+signedText(g.goldDiff25,0)+"g versus the direct same-role opponent at 25 minutes but the game was lost. No recurring late high-risk/costly-death evidence is strong enough in this match to assign a specific cause.","Review the 25-minute onward sequence for conversion: objective setup, side-wave timing and whether the role advantage was translated into team-relevant pressure rather than assuming the loss came from a single mistake.");
  }else if(closing25Comparable&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500&&g.win&&Number(g.closing25?.highRiskDeaths||0)===0)add(4,"closing","You closed a 25-minute role advantage cleanly","You were "+signedText(g.goldDiff25,0)+"g versus the direct same-role opponent at 25 and won without a tracked late high-risk death.","Preserve the late-game objective/fight discipline that protects the role advantage through the finish.","strength");
  if(fixed15to25Comparable&&["ADC","MID","TOP"].includes(String(g.role))&&hasNum(g.csDiff15)&&hasNum(g.csDiff25)&&Number(g.midRouting?.teamObjectives||0)>=1){
    const csSwing=Number(g.csDiff25)-Number(g.csDiff15),midJoin=100*Number(g.midRouting.objectiveJoins||0)/Math.max(1,Number(g.midRouting.teamObjectives||0));
    if(csSwing<=-8&&midJoin<50)add(1,"mid routing","You lost role-relative farm without compensating objective presence","From 15→25 your CS differential versus the direct role opponent changed "+signedText(csSwing,0)+" CS, while you were near only "+Math.round(midJoin)+"% of "+String(g.midRouting.teamObjectives)+" tracked neutral-objective encounters in the 15–25 routing window.","Review the movement between waves and objectives: if you leave a side wave, the rotation needs to buy meaningful map presence; if the objective is not contestable, collect the safe resource instead.");
    else if(csSwing>=8&&midJoin>=60)add(4,"mid routing","You gained role-relative farm while still reaching objectives","From 15→25 your CS differential improved "+signedText(csSwing,0)+" CS and you were near "+Math.round(midJoin)+"% of tracked neutral-objective encounters in that routing window.","Preserve the routing pattern that collects side resources without making you late to important map events.","strength");
    else if(csSwing>=8&&Number(g.midRouting.teamObjectives)>=2&&midJoin<35)add(2,"mid routing","Farm gains came with low mid-game objective attendance","Your role-relative CS improved "+signedText(csSwing,0)+" from 15→25, but you were near only "+Math.round(midJoin)+"% of "+String(g.midRouting.teamObjectives)+" tracked neutral-objective encounters in that routing window.","Make the tradeoff intentional: keep taking side resources when the objective is safely conceded, but path earlier when your presence can change the contest.");
  }
  if(fixed15to25Comparable&&hasNum(g.goldDiff15)&&hasNum(g.goldDiff25)){
    const swing=Number(g.goldDiff25)-Number(g.goldDiff15);
    if(Number(g.goldDiff15)>=300&&swing<=-700)add(1,"mid game","A lane lead eroded sharply between 15 and 25","You were "+signedText(g.goldDiff15,0)+"g at 15 and "+signedText(g.goldDiff25,0)+"g at 25 versus the same-role opponent. The advantage fell by "+Math.abs(Math.round(swing))+"g.","Review the first rotations after lane: side-lane waves, reset timing and fights taken before the next item/objective window.");
    else if(Number(g.goldDiff15)<=-300&&swing>=700)add(4,"mid game","You recovered a substantial early deficit","You moved from "+signedText(g.goldDiff15,0)+"g at 15 to "+signedText(g.goldDiff25,0)+"g at 25 versus the same-role opponent.","Identify the safe farm, picks or objective sequence that created the recovery and repeat that low-variance pattern.","strength");
  }
  if(fixed15to25Comparable&&["ADC","MID","TOP"].includes(String(g.role))&&hasNum(g.csDiff15)&&hasNum(g.csDiff25)){
    const csSwing=Number(g.csDiff25)-Number(g.csDiff15);
    if(csSwing<=-15)add(2,"mid game","Role-relative farm dropped sharply after lane","Your CS differential versus the same-role opponent moved from "+signedText(g.csDiff15,0)+" at 15 to "+signedText(g.csDiff25,0)+" at 25 ("+signedText(csSwing,0)+" CS swing).","Review the 15–25 minute wave assignments: which safe side waves were skipped for grouping, low-value movement or fights that did not require you?");
    else if(csSwing>=15)add(4,"mid game","You gained substantial role-relative farm after lane","Your CS differential moved from "+signedText(g.csDiff15,0)+" at 15 to "+signedText(g.csDiff25,0)+" at 25 ("+signedText(csSwing,0)+" CS swing).","Preserve the routing that collects safe waves without making you late to important objectives or fights.","strength");
  }
  if(directPeerComparable&&Number(g.fightProfile?.itemDisadvantageStarts)>=1&&["ADC","MID","TOP","JUNGLE"].includes(String(g.role)))add(1,"fight readiness","You fought before matching the opponent's first major item",String(g.fightProfile.itemDisadvantageStarts)+" attended multi-kill fight(s) began after the same-role opponent had completed a major item while you had not.","If the fight is not forced, use the reset/item-completion window first; contesting on an item breakpoint disadvantage makes otherwise-even execution harder.");
  if(Number(g.fightProfile?.highUnspentStarts)>=2)add(1,"fight readiness","Repeated fights started with substantial unspent gold",String(g.fightProfile.highUnspentStarts)+" attended multi-kill fight(s) began while you were carrying at least 1000 unspent gold.","Convert stored gold into stats before the next contest whenever the map gives you a safe reset window.");
  if(directPeerComparable&&Number(g.fightProfile?.roleLevelDisadvantageStarts)>=2){
    add(1,"fight readiness","The same-role opponent entered repeated fights a level ahead",String(g.fightProfile.roleLevelDisadvantageStarts)+" actively involved fight cluster(s) had the actual same-role opponent nearby while you were at least one level lower.","Before taking the contest, check the nearby role opponent's level as well as items and numbers. If the fight is optional, collect the next safe XP breakpoint or trade the play elsewhere.");
  }
  if(Number(g.fightProfile?.outnumberedStarts)>=2){
    add(1,"fight selection","Repeated fights are occurring with a local numbers disadvantage",String(g.fightProfile.outnumberedStarts)+" actively involved fight cluster(s) had at least two fewer nearby allies than enemies at the first kill event; "+String(g.fightProfile.lostOutnumberedStarts||0)+" of those clusters ended with more enemy kills.","Before committing to a developing fight, count visible/nearby bodies and identify which teammate can actually arrive in the next few seconds; do not treat distant allies on the minimap as present.");
  }
  if(["ADC","MID","TOP"].includes(String(g.role))&&Number(g.fightProfile?.active??g.fightProfile?.attended??0)>=2){
    if(Number(g.fightProfile?.firstAllyDeaths)>=2)add(1,"teamfights","You are dying first in repeated multi-kill fights","You were the first allied death in "+String(g.fightProfile.firstAllyDeaths)+" of "+String(g.fightProfile.active??g.fightProfile.attended??0)+" active multi-kill fight clusters.","Delay entry until key enemy threat/CC is committed, preserve your escape route, and prioritize uninterrupted damage time over being the first body in range.");
    else if(Number(g.fightProfile?.diedBeforeContribution)>=2)add(1,"teamfights","You are being removed before contributing in fights","You died before a tracked kill/assist contribution in "+String(g.fightProfile.diedBeforeContribution)+" of "+String(g.fightProfile.active??g.fightProfile.attended??0)+" active multi-kill fights.","Review fight approach and initial positioning; entering one screen later can be worth more than arriving first.");
  }
  if(Number(g.killConversion?.windows)>=2){
    const supported=Number((g.killConversion?.playerSupportedConverted??g.killConversion?.converted)||0),teamOnlyContext=Number((g.killConversion?.teamConverted??g.killConversion?.converted)||0);
    if(supported===0&&teamOnlyContext===0)add(2,"conversion","Kill windows produced no tracked map conversion",String(g.killConversion.windows)+" player-involved kill windows had neither a player-supported nor a team-only tracked objective/structure conversion within 75 seconds.","After a won skirmish, check the nearest objective, structure and wave before chasing another kill or defaulting to a reset.");
    else if(Number(g.killConversion?.rate)>=67)add(4,"conversion","You were present for repeated post-kill conversions",String(supported)+" of "+String(g.killConversion.windows)+" player-involved kill windows were followed by a tracked objective/structure with supported player presence/involvement within 75 seconds.","Keep the immediate post-kill decision discipline: objective/structure first when the map allows it.","strength");
  }
  if(["SUPPORT","JUNGLE"].includes(String(g.role))&&Number(g.visionMission?.highRiskDeaths)>=1){
    const ex=(g.visionMission?.events||[]).filter((x:any)=>x.highRisk).slice(0,2).map((x:any)=>Number(x.time).toFixed(1)+"m · "+String(x.action)+" "+String(x.secondsAfterAction)+"s before death"+(x.unsupported?" · no ally within 3k":"")+(x.objectiveSetup?" · objective setup":"")).join("; ");
    add(1,"vision safety","A vision action was followed by a high-risk death",String(g.visionMission.highRiskDeaths)+" high-risk death(s) occurred within 20 seconds and 2,500 units of your own ward placement/clear"+(ex?": "+ex:".")+".","Change the route, not the need for vision: move with a teammate, use safer information first, and avoid entering the ward location alone when enemies can already occupy the area.");
  }
  if(Number(g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses)>=1)add(1,"objectives","Objective absence followed recent shopping",String(g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses)+" team-contested neutral objective(s) found you absent, not recently dead, within 60 seconds of a detected shop visit. This timing association does not prove the shop/reset caused the miss.","Review whether an earlier purchase deadline would create safer travel/setup time; judge it by whether the pattern repeats, not by assuming causation from one match.");
  if(Number(g.deathConsequences?.measured)>=2&&Number(g.deathConsequences?.severe)>=1){
    const ex=(g.deathConsequences?.events||[]).filter((x:any)=>x.severe).slice(0,2).map((x:any)=>Number(x.time).toFixed(1)+"m"+(hasNum(x.goldSwingAfter)?" · "+signedText(x.goldSwingAfter,0)+"g role swing":"")+(hasNum(x.csSwingAfter)?" · "+signedText(x.csSwingAfter,0)+" CS role swing":"")+(x.enemyObjectiveAfter?" · enemy objective":"")).join("; ");
    add(1,"death consequences","Several deaths produced measurable follow-on losses",String(g.deathConsequences.severe)+" death(s) had at least two consequence signals"+(ex?": "+ex:".")+".","Review the minute after these deaths: the priority is preventing the deaths that also lose waves, role economy and objectives, not merely reducing the death count.");
  }
  if(Number(g.deathRecovery?.repeatDeaths)>=2&&(Number(g.deathRecovery?.highRiskRepeatDeaths)>=1||Number(g.deathRecovery?.costlyRepeatDeaths)>=1)){
    const ex=(g.deathRecovery.events||[]).slice(0,3).map((x:any)=>Number(x.firstMin).toFixed(1)+"→"+Number(x.secondMin).toFixed(1)+"m ("+String(x.gapSec)+"s)"+(x.highRisk?" · high-risk":"")+(x.costly?" · costly":"")+(x.traded?" · traded":" · untraded")).join("; ");
    add(1,"death recovery","One death turned into another before recovery",String(g.deathRecovery.repeatDeaths)+" repeat death(s) occurred within four minutes of the previous death"+(ex?": "+ex:".")+".","After dying, make the next two waves/minutes deliberately low variance: spend, identify the safe resource, restore information, and avoid immediately re-entering the same contested area without a new advantage.");
  }
  if(Number(g.postImpactRisk?.highRiskUntradedDeathsWithin30s)>=1)add(1,"post-play discipline","You gave back value immediately after contributing to a successful play",String(g.postImpactRisk.highRiskUntradedDeathsWithin30s)+" death(s) occurred within 30 seconds after your own kill/assist contribution and were both high-risk and untraded.","After the first successful play, reassess instead of automatically continuing: check health, cooldowns, enemy reinforcements, spendable gold and whether the next chase has real value.");
  if(Number(g.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths)>=1)add(1,"side-lane timing","An isolated side-lane death came immediately before a neutral objective",String(g.sideLaneRisk.preNeutralObjectiveSideLaneDeaths)+" post-macro-transition top/bot-lane death(s) occurred with no ally within 3,000 units and a neutral objective event within 90 seconds.","Start the side-wave earlier or leave it earlier. Side-lane farm is valuable, but not when the timing removes you from the next neutral-objective window.");
  else if(Number(g.sideLaneRisk?.isolatedSideLaneDeaths)>=2)add(2,"side-lane timing","Repeated isolated side-lane deaths are reducing map pressure",String(g.sideLaneRisk.isolatedSideLaneDeaths)+" post-macro-transition top/bot-lane deaths occurred with no ally within 3,000 units.","Track missing opponents and the next map event before extending the side lane; pressure is useful only while you retain an exit window.");
  if(directPeerComparable&&Number(g.highRiskLeadDeathCount)>=1){
    const ex=(g.leadDeaths||[]).filter((x:any)=>x.highRisk).slice(0,2).map((x:any)=>Number(x.time).toFixed(1)+"m at "+signedText(x.goldDiffAtDeath,0)+"g vs role"+(hasNum(x.goldSwingAfter)?" → "+signedText(x.goldSwingAfter,0)+"g swing after":"")).join("; ");
    add(1,"lead protection","You gave the opponent a comeback window while materially ahead",String(g.highRiskLeadDeathCount)+" death(s) occurred while at least +500g versus the direct role opponent and also crossed the high-risk death threshold"+(ex?": "+ex:".")+".","When ahead, lower the acceptable risk of isolated/deep entries. Your job is to preserve the purchase/tempo advantage until it converts into objective or fight control.");
  }
  if(Number(g.preObjectiveDeathCount)>=1){
    const examples=(g.preObjectiveDeaths||[]).slice(0,2).map((x:any)=>Number(x.time).toFixed(1)+"m → "+String(x.objectiveType||"objective")+" "+String(x.secondsBeforeObjective)+"s later").join("; ");
    add(1,"objectives","You died shortly before an enemy objective conversion",String(g.preObjectiveDeathCount)+" death(s) were followed by an enemy objective within 75 seconds"+(examples?": "+examples:".")+".","Treat the minute before a likely objective as a survival/setup window: spend gold, move with information, and avoid unsupported fog entries.");
  }
  if(Number(g.badDeathCount)>=2){
    const top=(g.badDeaths||[]).slice(0,2).map((d:any)=>Number(d.time).toFixed(1)+"m ("+(d.tags||[]).join(", ")+(d.traded?" · traded "+String(d.tradeDelaySec??"?")+"s":" · untraded")+")").join("; ");
    add(1,"deaths","Several deaths have multiple avoidability signals",String(g.badDeathCount)+" deaths crossed the multi-signal threshold; "+String(g.highRiskUntradedDeathCount||0)+" were untraded"+(top?": "+top:".")+".","Before re-entering fog or enemy territory, check ally distance, current gold and the next objective timer. A return kill softens the cost but does not make a high-risk death automatically correct.");
  }else if(Number(g.badDeathCount)===0&&Number(g.deaths)>=1){
    add(4,"deaths","No death crossed the high-risk threshold",String(g.deaths)+" deaths occurred, but none had enough combined isolation/depth/objective/gold signals to label confidently avoidable.","Keep the same risk discipline while looking for more pressure.","strength");
  }
  if(directPeerComparable&&hasNum(g.impactDeltaVsOpponent)){
    if(Number(g.impactDeltaVsOpponent)>=3)add(2,"early impact","Your counterpart affected the map earlier","Your first tracked kill/assist/objective impact was at "+Number(g.impactTimeMin).toFixed(1)+"m versus "+Number(g.opponentImpactTimeMin).toFixed(1)+"m for the same-role opponent ("+signedText(g.impactDeltaVsOpponent,1)+"m later).","Check the first actionable window: wave priority, pathing and whether you could move earlier without sacrificing a high-value wave.");
    else if(Number(g.impactDeltaVsOpponent)<=-3)add(4,"early impact","You created meaningful map impact earlier than your counterpart","Your first tracked impact was at "+Number(g.impactTimeMin).toFixed(1)+"m versus "+Number(g.opponentImpactTimeMin).toFixed(1)+"m for the same-role opponent.","Preserve the setup that creates this early timing without forcing low-probability plays.","strength");
  }
  if(directPeerComparable&&g.itemSpikeWindow?.eligible){
    if(!g.itemSpikeWindow.used)add(g.itemSpikeWindow.diedBeforeImpact?1:2,"item spike","You earned an item window but did not use it before parity","Your first major item was completed "+Math.round(Number(g.itemSpikeWindow.leadSec||0))+" seconds before the direct role opponent, but no tracked kill/assist or nearby team-objective impact occurred before they completed theirs"+(g.itemSpikeWindow.diedBeforeImpact?"; you died before recording any such impact.":".") ,"Use the purchase lead deliberately: return to the map with a concrete wave/objective/fight plan while the opponent is still down the completion, rather than letting the temporary breakpoint expire.");
    else if(Number(g.itemSpikeWindow.totalImpacts)>=1)add(4,"item spike","You used the earlier major-item window","You had "+Math.round(Number(g.itemSpikeWindow.leadSec||0))+" seconds before the direct role opponent completed a major item and recorded "+String(g.itemSpikeWindow.totalImpacts)+" tracked impact(s) in that window.","Preserve the sequence that turns earlier shopping into immediate map pressure.","strength");
  }
  if(directPeerComparable&&g.firstResetSequence?.measured&&!g.firstResetSequence?.deathInWindow){
    const r=g.firstResetSequence;
    if(r.economyLoss)add(1,"resets","The first shop sequence gave up lane economy","Your first post-start shop was at "+Number(r.time).toFixed(1)+"m; by the next supported post-shop frame, direct-role differential moved "+(hasNum(r.goldSwingAfter)?signedText(r.goldSwingAfter,0)+"g":"n/a")+" and "+(hasNum(r.csSwingAfter)?signedText(r.csSwingAfter,1)+" CS":"n/a")+".","Review the wave immediately before leaving and the return path. The goal is not simply to recall earlier—it is to shop without donating the next wave/economy window.");
    else if(r.economyGain)add(4,"resets","Your first shop sequence preserved and improved lane economy","After the first meaningful shop at "+Number(r.time).toFixed(1)+"m, direct-role differential moved "+signedText(r.goldSwingAfter,0)+"g and "+signedText(r.csSwingAfter,1)+" CS by the next supported frame.","Preserve the wave preparation and return timing that lets the purchase happen without losing lane value.","strength");
  }
  if(g.majorItemReadiness?.eligible&&hasNum(g.majorItemReadiness?.delayMin)){
    const rr=g.majorItemReadiness;
    if(Number(rr.delayMin)>=1.5)add(1,"resets","A first-major completion stayed affordable before you bought it","After the direct recipe components were already observed, a supported timeline frame showed enough current gold for the remaining "+Math.round(Number(rr.combineCost||0))+"g combine cost at "+Number(rr.affordableMin).toFixed(1)+"m, but the completed item was not purchased until "+Number(rr.purchaseMin).toFixed(1)+"m ("+Number(rr.delayMin).toFixed(1)+"m later).","Treat completion affordability as a reset trigger: if wave/objective state permits, buy the completed item instead of carrying an already-fundable breakpoint through another sequence.");
    else if(Number(rr.delayMin)<=0.5)add(4,"resets","You converted first-major affordability into the purchase quickly","The first supported frame where the completed item was fundable was "+Number(rr.affordableMin).toFixed(1)+"m and the purchase followed at "+Number(rr.purchaseMin).toFixed(1)+"m.","Preserve the wave/reset setup that turns earned gold into completed power without a long delay.","strength");
  }
  if(directPeerComparable&&hasNum(g.itemSpikeDeltaVsOpponent)){
    if(Number(g.itemSpikeDeltaVsOpponent)>=1)add(1,"resets","Your first major item arrived later than your counterpart","You completed it "+Number(g.itemSpikeDeltaVsOpponent).toFixed(1)+" minutes after the same-role opponent.","Look for a cleaner reset once you are carrying enough gold for a completion; one extra wave is not always worth losing the purchase window.");
    else if(Number(g.itemSpikeDeltaVsOpponent)<=-1)add(3,"resets","You hit the first major item earlier than your counterpart","Your completion arrived "+Math.abs(Number(g.itemSpikeDeltaVsOpponent)).toFixed(1)+" minutes earlier.","Act on that temporary item advantage before the opponent completes theirs.","strength");
  }
  if(Number(g.greedyStayWindows?.length)>=1)add(2,"resets","You held a large amount of spendable gold for too long",String(g.greedyStayWindows.length)+" detected window(s) had at least 1200 current gold and more than two minutes until the next shop visit.","Reset when the map gives you a low-cost window, especially before objectives or a major item completion.");
  const costlyRoams=(g.roams?.events||[]).filter((r:any)=>hasNum(r.coachingLaneCostCs??r.laneCostCs)&&Number(r.coachingLaneCostCs??r.laneCostCs)<=-6);
  const emptyCostlyRoams=costlyRoams.filter((r:any)=>!r.killOrAssist&&!r.objective&&Number(r.structureInvolvements||0)===0);
  if(emptyCostlyRoams.length>=1){
    const basis=String(emptyCostlyRoams[0]?.laneCostBasis||"player_vs_direct_role_peer")==="allied_adc_vs_enemy_adc"?"allied ADC lane differential":"direct-role lane differential";
    add(1,"roaming","The roam result did not justify the lane cost",emptyCostlyRoams.length+" roam(s) lost at least 6 CS of "+basis+" without a tracked kill/assist, supported objective or structure return.","Push or secure the wave before leaving; cancel the move earlier when the target does not become actionable.");
  }
  if(Number(g.roams?.attempts)>=1){
    const rate=100*Number(g.roams.successes||0)/Math.max(1,Number(g.roams.attempts||0));
    if(rate<40)add(2,"roaming","Roam conversion was weak in this game",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a tracked kill/assist, supported objective or structure contribution.","Leave lane on pushed/covered waves and abort earlier when the target lane cannot follow.");
    else if(rate>=67)add(4,"roaming","Your roam windows converted well",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a tracked kill/assist, supported objective or structure contribution.","Keep the timing, then check the lane cost so the roam is not merely shifting resources.","strength");
  }
  const contestedObjectives=Number(g.objectiveContestTotal||0),contestedJoins=Number(g.objectiveContestJoined||0),priorSetupJoins=Number(g.objectiveReadiness?.earlySetupJoins||0);
  if(contestedObjectives>=3&&contestedJoins===0)add(2,"objectives","You were absent from every supported contested-objective window","0 of "+String(contestedObjectives)+" team-contested neutral-objective encounters had supported player presence.","Review the event list for the repeatable cause—reset timing, pre-objective death, or cross-map commitment—rather than treating objectives your team happened to secure as the denominator.");
  else if(contestedObjectives>=2&&contestedJoins===contestedObjectives&&priorSetupJoins>=1)add(4,"objectives","You were present for every supported contested-objective window",String(contestedJoins)+" of "+String(contestedObjectives)+" contested encounters had supported presence, including "+String(priorSetupJoins)+" prior-frame setup join(s).","Preserve the arrival timing; improve the quality of setup and fight execution rather than chasing a higher attendance percentage.","strength");
  if(directPeerComparable&&g.peer&&["ADC","MID","TOP"].includes(String(g.role))&&Number(g.peer.dpmDelta)<=-150)add(2,"fighting","Your same-role opponent converted more damage","You finished "+Math.round(Math.abs(Number(g.peer.dpmDelta)))+" DPM below the direct counterpart.","Check whether you were late to fights, under-itemized, or removed by an early death before your damage window.");
  if(["ADC","MID","TOP"].includes(String(g.role))&&hasNum(g.damageShare)&&hasNum(g.goldShare)){
    const efficiency=Number(g.damageShare)-Number(g.goldShare);
    if(efficiency<=-6)add(2,"resource conversion","Your damage share did not match your share of team gold","You used "+Number(g.goldShare).toFixed(0)+"% of team gold but produced "+Number(g.damageShare).toFixed(0)+"% of team champion damage.","Review fight arrival, target access and whether deaths are cutting off the damage window after resources have been invested in you.");
    else if(efficiency>=6)add(4,"resource conversion","You converted team resources efficiently","You used "+Number(g.goldShare).toFixed(0)+"% of team gold and produced "+Number(g.damageShare).toFixed(0)+"% of team champion damage.","Keep the positioning/fight selection that lets you create this much output per share of resources.","strength");
  }
  if(Number(g.damageRank)===1)add(4,"team impact","You led your team in champion damage","You ranked #1 of 5 teammates in champion damage this game.","Protect your uptime: unnecessary deaths are especially expensive when your team depends on your damage.","strength");
  return items.sort((a,b)=>a.priority-b.priority).slice(0,5);
}
function alliedSupportParticipant(match:any,p:any){
  if(!match||!p||participantRole(p)!=="ADC")return null;
  const ps=Array.isArray(match?.info?.participants)?match.info.participants:[],teamId=Number(p.teamId);
  const candidates=ps.filter((x:any)=>Number(x?.participantId)!==Number(p?.participantId)&&Number(x?.teamId)===teamId&&participantRoleEvidence(x).confidence==="high"&&participantRole(x)==="SUPPORT");
  return candidates.length===1?candidates[0]:null;
}
function game(row:any,puuid:string,catalog:any){
  const m=row?.match_json||{},ps=Array.isArray(m?.info?.participants)?m.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===puuid);if(!p)return null;
  const full=participantFullGameMetrics(m,p);if(!full)return null;
  const gv=text(m?.info?.gameVersion),pk=patchKey(gv),catalogMeta=pk?catalog?.resolution?.[pk]||null:null,gameCatalog=(pk&&catalog?.byPatch?.[pk])||catalog?.fallback||catalog||{};
  const roleEvidence=participantRoleEvidence(p),allySupport=alliedSupportParticipant(m,p),peerResolution=opponentResolution(m,p),opp=peerResolution.opponent,oppFull=participantFullGameMetrics(m,opp),facts=timelineFacts(m,row?.timeline_json,p,gameCatalog,catalogMeta);
  const directPeerComparable=!!oppFull&&roleEvidence.confidence==="high"&&peerResolution.opponentRoleConfidence==="high";
  const directPeerExclusionReason=!oppFull?(peerResolution.reason||"peer_missing"):roleEvidence.confidence!=="high"?"player_role_not_high_confidence":peerResolution.opponentRoleConfidence!=="high"?"opponent_role_not_high_confidence":null;
  const peer=directPeerComparable&&oppFull?{champion:text(opp?.championName||"Unknown"),role:participantRole(opp),rank:row?.peer_rank_json||null,directComparisonEligible:true,comparisonExclusionReason:null,csMinDelta:full.csMin-oppFull.csMin,dpmDelta:full.dpm-oppFull.dpm,gpmDelta:full.gpm-oppFull.gpm,vpmDelta:full.vpm-oppFull.vpm,kdaDelta:full.kda-oppFull.kda,deathsDelta:full.deaths-oppFull.deaths,kpDelta:hasNum(full.kp)&&hasNum(oppFull.kp)?Number(full.kp)-Number(oppFull.kp):null,opponent:{kda:oppFull.kda,csMin:oppFull.csMin,dpm:oppFull.dpm,gpm:oppFull.gpm,vpm:oppFull.vpm,kp:oppFull.kp,deaths:oppFull.deaths}}:null;
  const finalItems=[p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6].map((id:any)=>Number(id||0)).filter((id:number)=>id>0).map((id:number)=>({itemId:id,name:text(itemInfo(gameCatalog,id)?.name)||String(id)}));
  const out:any={matchId:text(m?.metadata?.matchId||row.match_id),gameStartTimestamp:Number(m?.info?.gameStartTimestamp||0),teamId:Number(p?.teamId||0)||null,gameVersion:gv||null,patchKey:pk,publicPatchKey:publicPatchKey(gv),itemCatalogVersion:catalogMeta?.version||catalog?.fallbackMeta?.version||null,itemCatalogExactPatch:catalogMeta?!!catalogMeta.exact:null,champion:text(p.championName||"Unknown"),championId:num(p.championId),allySupportChampion:allySupport?text(allySupport.championName||"Unknown"):null,allySupportChampionId:allySupport?num(allySupport.championId):null,allySupportResolved:!!allySupport,finalItems,role:roleEvidence.role,roleEvidence,peerResolution:{role:peerResolution.role,candidateCount:peerResolution.candidateCount,reason:peerResolution.reason,opponentRoleConfidence:peerResolution.opponentRoleConfidence||null,opponentRoleSource:peerResolution.opponentRoleSource||null,directPeerComparable,directPeerExclusionReason},directPeerComparable,rawRole:text(p.teamPosition||p.individualPosition||p.role),win:!!p.win,...full,durationMinutes:Math.max(1,Number(m?.info?.gameDuration||row?.game_duration_seconds||0)/60),mapId:Number(m?.info?.mapId||row.map_id||0)||null,queueId:Number(m?.info?.queueId||row.queue_id||0)||null,timelineAvailable:!!row.timeline_json,peer,...facts};
  out.judgments=gameJudgments(out);return out;
}
function baselineGame(row:any,puuid:string){
  const m=row?.match_json||{},ps=Array.isArray(m?.info?.participants)?m.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===puuid);if(!p)return null;
  const full=participantFullGameMetrics(m,p);if(!full)return null;
  const peerResolution=opponentResolution(m,p),opp=peerResolution.opponent,oppFull=opp?participantFullGameMetrics(m,opp):null;
  const gv=text(m?.info?.gameVersion),pk=patchKey(gv),roleEvidence=participantRoleEvidence(p),allySupport=alliedSupportParticipant(m,p);
  const directPeerComparable=!!oppFull&&roleEvidence.confidence==="high"&&peerResolution.opponentRoleConfidence==="high";
  const directPeerExclusionReason=directPeerComparable?null:!oppFull?"opponent_unresolved":roleEvidence.confidence!=="high"?"player_role_not_high_confidence":"opponent_role_not_high_confidence";
  const peer=directPeerComparable&&oppFull?{champion:text(opp?.championName||"Unknown"),role:participantRole(opp),rank:row?.peer_rank_json||null,directComparisonEligible:true,comparisonExclusionReason:null,csMinDelta:full.csMin-oppFull.csMin,dpmDelta:full.dpm-oppFull.dpm,gpmDelta:full.gpm-oppFull.gpm,vpmDelta:full.vpm-oppFull.vpm,kdaDelta:full.kda-oppFull.kda,deathsDelta:full.deaths-oppFull.deaths,kpDelta:hasNum(full.kp)&&hasNum(oppFull.kp)?Number(full.kp)-Number(oppFull.kp):null,opponent:{kda:oppFull.kda,csMin:oppFull.csMin,dpm:oppFull.dpm,gpm:oppFull.gpm,vpm:oppFull.vpm,kp:oppFull.kp,deaths:oppFull.deaths}}:null;
  const rules=gameRules(m);return{matchId:text(m?.metadata?.matchId||row.match_id),gameStartTimestamp:Number(m?.info?.gameStartTimestamp||0),gameVersion:gv||null,patchKey:pk,publicPatchKey:publicPatchKey(gv),champion:text(p.championName||"Unknown"),allySupportChampion:allySupport?text(allySupport.championName||"Unknown"):null,allySupportChampionId:allySupport?num(allySupport.championId):null,allySupportResolved:!!allySupport,role:roleEvidence.role,roleEvidence,peerResolution:{role:peerResolution.role,candidateCount:peerResolution.candidateCount,reason:peerResolution.reason,opponentRoleConfidence:peerResolution.opponentRoleConfidence||null,opponentRoleSource:peerResolution.opponentRoleSource||null,directPeerComparable,directPeerExclusionReason},directPeerComparable,peer,win:!!p.win,...full,durationMinutes:Math.max(1,Number(m?.info?.gameDuration||row?.game_duration_seconds||0)/60),mapId:Number(m?.info?.mapId||row.map_id||0)||null,queueId:Number(m?.info?.queueId||row.queue_id||0)||null,timelineAvailable:!!row.timeline_json,phaseRules:rules,goldDiff10:null,goldDiff15:null,goldDiff25:null,csDiff10:null,csDiff15:null,csDiff25:null,xpDiff10:null,xpDiff15:null,xpDiff25:null};
}
function annotateSessionContext(games:any[]){
  const ordered=[...(games||[])].filter((g:any)=>Number(g?.gameStartTimestamp||0)>0).sort((a:any,b:any)=>Number(a.gameStartTimestamp)-Number(b.gameStartTimestamp));
  let sessionId=0,sessionGame=0,prev:any=null;
  for(const g of ordered){
    const start=Number(g.gameStartTimestamp||0),prevStart=Number(prev?.gameStartTimestamp||0),prevEnd=prevStart+(Number(prev?.durationMinutes||0)*60000);
    const gapAfterPrevMin=prev?Math.max(0,(start-prevEnd)/60000):null;
    if(!prev||!hasNum(gapAfterPrevMin)||Number(gapAfterPrevMin)>90){sessionId++;sessionGame=1;}else sessionGame++;
    g.sessionContext={sessionId,sessionGameNumber:sessionGame,gapAfterPreviousMin:gapAfterPrevMin,previousWin:prev?!!prev.win:null,previousChampion:prev?.champion||null};
    prev=g;
  }
  return games;
}
function outcomeStreakSummary(games:any[]){
  let longestWin=0,longestLoss=0,curWin=0,curLoss=0;
  for(const g of games||[]){if(g?.win){curWin++;curLoss=0;longestWin=Math.max(longestWin,curWin);}else{curLoss++;curWin=0;longestLoss=Math.max(longestLoss,curLoss);}}
  const first=games?.[0],currentResult=first?(first.win?"win":"loss"):null;let currentLength=0;
  if(currentResult)for(const g of games||[]){if((g.win?"win":"loss")!==currentResult)break;currentLength++;}
  return{longestWin,longestLoss,currentResult,currentLength,sampleGames:(games||[]).length,definition:"Contiguous result streaks inside the eligible Last-20 sample; descriptive only."};
}
function highResourceDeepBehaviorContrast(games:any[],primaryRole:string){
  if(!["ADC","MID","TOP"].includes(primaryRole))return null;
  const timelineHighResource=(games||[]).filter((g:any)=>g?.timelineAvailable===true&&hasNum(g?.goldRank)&&Number(g.goldRank)<=2&&hasNum(g?.damageRank)),eligible=timelineHighResource.filter((g:any)=>g?.outcomeCompromised!==true);
  const group=(key:string,label:string,damageTop2:boolean)=>{
    const rows=eligible.filter((g:any)=>(Number(g.damageRank)<=2)===damageTop2);
    const eventRate=(eventFn:(g:any)=>number,oppFn:(g:any)=>number,gameEligible:(g:any)=>boolean=()=>true)=>{
      const xs=rows.filter(gameEligible),events=xs.reduce((n:number,g:any)=>n+Math.max(0,Number(eventFn(g)||0)),0),opportunities=xs.reduce((n:number,g:any)=>n+Math.max(0,Number(oppFn(g)||0)),0);
      return{basis:"event",value:opportunities>0?100*events/opportunities:null,events,opportunities,eligibleGames:xs.length};
    };
    const gameRate=(eventFn:(g:any)=>boolean,gameEligible:(g:any)=>boolean=()=>true)=>{
      const xs=rows.filter(gameEligible),events=xs.filter(eventFn).length;
      return{basis:"game",value:xs.length?100*events/xs.length:null,events,opportunities:xs.length,eligibleGames:xs.length};
    };
    const meanMetric=(fn:(g:any)=>any,gameEligible:(g:any)=>boolean=()=>true)=>{
      const xs=rows.filter((g:any)=>gameEligible(g)&&hasNum(fn(g))),vals=xs.map((g:any)=>Number(fn(g)));
      return{basis:"mean",value:vals.length?avg(vals):null,eligibleGames:xs.length};
    };
    const trustedResetEconomy=(g:any)=>g?.directPeerComparable===true&&g?.firstResetSequence?.measured===true&&g?.firstResetSequence?.deathInWindow!==true;
    const trustedResetTiming=(g:any)=>g?.directPeerComparable===true&&hasNum(g?.firstResetSequence?.timingDeltaVsOpponent);
    const trustedSpike=(g:any)=>g?.directPeerComparable===true&&g?.itemSpikeWindow?.eligible===true;
    return{
      key,label,games:rows.length,wins:rows.filter((g:any)=>g?.win===true).length,winRate:pct(rows.filter((g:any)=>g?.win===true).length,rows.length),
      preImpactDeathRate:eventRate(g=>Number(g?.fightProfile?.diedBeforeContribution||0),g=>Number(g?.fightProfile?.active??g?.fightProfile?.attended??0),g=>Number(g?.fightProfile?.active??g?.fightProfile?.attended??0)>0),
      highUnspentFightStartRate:eventRate(g=>Number(g?.fightProfile?.highUnspentStarts||0),g=>Number(g?.fightProfile?.active??g?.fightProfile?.attended??0),g=>Number(g?.fightProfile?.active??g?.fightProfile?.attended??0)>0),
      itemDisadvantageFightStartRate:eventRate(g=>Number(g?.fightProfile?.itemDisadvantageStarts||0),g=>Number(g?.fightProfile?.active??g?.fightProfile?.attended??0),g=>g?.directPeerComparable===true&&g?.itemLedgerQuality?.itemMechanicsEligible===true&&Number(g?.fightProfile?.active??g?.fightProfile?.attended??0)>0),
      trackedFightAbsenceRate:eventRate(g=>Number(g?.fightProfile?.trackedAbsentTeamFights||0),g=>Number(g?.fightProfile?.positionSupportedTeamFightClusters||0),g=>Number(g?.fightProfile?.positionSupportedTeamFightClusters||0)>0),
      resetEconomyLossRate:gameRate(g=>g?.firstResetSequence?.economyLoss===true,trustedResetEconomy),
      resetTimingDeltaVsPeerMin:meanMetric(g=>g?.firstResetSequence?.timingDeltaVsOpponent,trustedResetTiming),
      itemSpikeUtilizationRate:gameRate(g=>g?.itemSpikeWindow?.used===true,trustedSpike),
      itemSpikeDeathBeforeImpactRate:gameRate(g=>g?.itemSpikeWindow?.diedBeforeImpact===true,trustedSpike),
      deadTimePct:meanMetric(g=>g?.deadTimePct),
      turretDamagePerMin:meanMetric(g=>g?.turretDamagePerMin)
    };
  };
  const converted=group("high_resource_high_damage","Top-2 gold + top-2 damage",true),lower=group("high_resource_lower_damage","Top-2 gold + lower damage",false);
  const usable=converted.games>=3&&lower.games>=3;
  return{usable,minimumEligibleGamesPerCohort:3,minimumEventOpportunitiesPerCohort:5,deepEligibleGames:eligible.length,excludedCompromisedDeepGames:Math.max(0,timelineHighResource.length-eligible.length),converted,lowerDamage:lower,definition:"Deep selected-role timeline comparison between clean high-resource games split by top-2 team champion-damage outcome. AFK/early-surrender outcomes are excluded. Metric rows retain their own eligible-game/opportunity denominators; event-rate rows require at least five opportunities per cohort in the frontend; trusted-peer metrics fail closed without a comparable direct role peer, and item-disadvantage fight starts additionally require exact-patch item mechanics. Descriptive association only."};
}
function longHorizonModel(allGames:any[],primaryRole:string){
  const history=[...(allGames||[])].sort((a:any,b:any)=>Number(b?.gameStartTimestamp||0)-Number(a?.gameStartTimestamp||0)).slice(0,ANALYSIS_HISTORY_TARGET_GAMES),recent=history.slice(0,20),prior=history.slice(20,40),older=history.slice(40);
  const metric=(sample:any[],fn:(g:any)=>any)=>{const rows=finiteGames(sample,fn);return{value:meanField(rows,fn),n:rows.length};};
  const per30=(sample:any[],fn:(g:any)=>any)=>{const rows=(sample||[]).filter((g:any)=>hasNum(fn(g))&&hasNum(g?.durationMinutes)&&Number(g.durationMinutes)>0),events=rows.reduce((n:number,g:any)=>n+Number(fn(g)),0),minutes=rows.reduce((n:number,g:any)=>n+Number(g.durationMinutes),0);return{value:minutes>0?30*events/minutes:null,n:rows.length,events,minutes};};
  const boolRate=(sample:any[],fn:(g:any)=>boolean)=>{const rows=(sample||[]).filter((g:any)=>g!=null),events=rows.filter(fn).length;return{value:pct(events,rows.length),n:rows.length,events};};
  const resourceOutputRate=(sample:any[])=>{const eligible=(sample||[]).filter((g:any)=>hasNum(g?.goldRank)&&Number(g.goldRank)<=2&&hasNum(g?.damageRank)),events=eligible.filter((g:any)=>Number(g.damageRank)<=2).length;return{value:pct(events,eligible.length),n:eligible.length,events};};
  const lowResourceDamageRate=(sample:any[])=>{const eligible=(sample||[]).filter((g:any)=>hasNum(g?.goldRank)&&Number(g.goldRank)>2&&hasNum(g?.damageRank)),events=eligible.filter((g:any)=>Number(g.damageRank)<=2).length;return{value:pct(events,eligible.length),n:eligible.length,events};};
  const pack=(sample:any[])=>{
    const plateRows=sample.filter((g:any)=>g?.phaseRules?.platesPermanent===true&&hasNum(g?.riotPlateSegments)),compromised=sample.filter((g:any)=>g?.outcomeCompromised===true),peerRows=sample.filter((g:any)=>g?.directPeerComparable===true&&g?.peer);
    return{games:sample.length,wins:sample.filter((g:any)=>g?.win).length,winRate:pct(sample.filter((g:any)=>g?.win).length,sample.length),directPeerComparableGames:peerRows.length,
      csMin:metric(sample,g=>g.csMin),laneCs10:metric(sample,g=>g.laneCs10),dpm:metric(sample,g=>g.dpm),gpm:metric(sample,g=>g.gpm),vpm:metric(sample,g=>g.vpm),
      peerCsMinDelta:metric(peerRows,g=>g.peer?.csMinDelta),peerDpmDelta:metric(peerRows,g=>g.peer?.dpmDelta),peerGpmDelta:metric(peerRows,g=>g.peer?.gpmDelta),peerVpmDelta:metric(peerRows,g=>g.peer?.vpmDelta),peerDeathsDelta:metric(peerRows,g=>g.peer?.deathsDelta),peerKpDelta:metric(peerRows,g=>g.peer?.kpDelta),
      deaths:metric(sample,g=>g.deaths),deadTimePct:metric(sample,g=>g.deadTimePct),damageEfficiencyPp:metric(sample,g=>g.damageEfficiencyPp),
      turretDamagePerMin:metric(sample,g=>g.turretDamagePerMin),epicDamagePerMin:metric(sample,g=>g.epicDamagePerMin),visionActionsPerMin:metric(sample,g=>g.visionActionsPerMin),visionShare:metric(sample,g=>g.visionShare),
      controlWardsPlaced:metric(sample,g=>g.controlWardsPlaced),soloKills:metric(sample,g=>g.soloKills),soloKillsPer30:per30(sample,g=>g.soloKills),enemyJungleMonsters:metric(sample,g=>g.enemyJungleMonsters),firstTurretParticipationRate:boolRate(sample,g=>g.firstTurretParticipation===true),visionLeaderRate:boolRate(sample,g=>Number(g.visionRank)===1),top2GoldToTop2DamageRate:resourceOutputRate(sample),lowResourceTop2DamageRate:lowResourceDamageRate(sample),damageTop2Rate:boolRate(sample,g=>Number(g.damageRank)<=2),damageLeaderRate:boolRate(sample,g=>Number(g.damageRank)===1),plateSegments:metric(plateRows,g=>g.riotPlateSegments),
      compromisedOutcomeGames:compromised.length,cleanOutcomeGames:sample.length-compromised.length};
  };
  const recentPack:any=pack(recent),priorPack:any=pack(prior),historyPack:any=pack(history);
  const trend=(key:string)=>{const a=recentPack?.[key],b=priorPack?.[key];return{recent:a?.value??null,prior:b?.value??null,recentN:Number(a?.n||0),priorN:Number(b?.n||0),delta:hasNum(a?.value)&&hasNum(b?.value)?Number(a.value)-Number(b.value):null};};
  const distFor=(sample:any[],fn:(g:any)=>any)=>distribution((sample||[]).map(fn).filter(hasNum).map(Number));
  const stability=(fn:(g:any)=>any)=>{
    const a:any=distFor(recent,fn),b:any=distFor(prior,fn),ai=hasNum(a?.q25)&&hasNum(a?.q75)?Number(a.q75)-Number(a.q25):null,bi=hasNum(b?.q25)&&hasNum(b?.q75)?Number(b.q75)-Number(b.q25):null;
    return{recentN:Number(a?.n||0),priorN:Number(b?.n||0),recentMedian:a?.median??null,priorMedian:b?.median??null,medianDelta:hasNum(a?.median)&&hasNum(b?.median)?Number(a.median)-Number(b.median):null,recentQ25:a?.q25??null,priorQ25:b?.q25??null,recentQ75:a?.q75??null,priorQ75:b?.q75??null,recentIqr:ai,priorIqr:bi,iqrDelta:hasNum(ai)&&hasNum(bi)?Number(ai)-Number(bi):null};
  };
  const values=(fn:(g:any)=>any)=>history.map(fn).filter(hasNum).map(Number),championCounts:any={};for(const g of history){const c=text(g?.champion)||"Unknown";championCounts[c]=(championCounts[c]||0)+1;}
  const sampleStats=(sample:any[],fn:(g:any)=>any)=>{const xs=(sample||[]).map(fn).filter(hasNum).map(Number);if(!xs.length)return{mean:null,n:0,sd:null};const mean=xs.reduce((a:number,b:number)=>a+b,0)/xs.length,variance=xs.length>1?xs.reduce((sum:number,x:number)=>sum+(x-mean)*(x-mean),0)/(xs.length-1):null;return{mean,n:xs.length,sd:variance==null?null:Math.sqrt(Math.max(0,variance))};};
  const championGroups=new Map<string,any[]>();for(const g of history){const champion=text(g?.champion)||"Unknown";if(!championGroups.has(champion))championGroups.set(champion,[]);championGroups.get(champion)!.push(g);}
  const championHistory=[...championGroups.entries()].map(([champion,list])=>{const clean=list.filter((g:any)=>g?.outcomeCompromised!==true),recentRows=recent.filter((g:any)=>(text(g?.champion)||"Unknown")===champion),priorRows=prior.filter((g:any)=>(text(g?.champion)||"Unknown")===champion);return{
    champion,games:list.length,historyShare:pct(list.length,history.length),wins:list.filter((g:any)=>g?.win===true).length,winRate:pct(list.filter((g:any)=>g?.win===true).length,list.length),cleanGames:clean.length,cleanWins:clean.filter((g:any)=>g?.win===true).length,cleanWinRate:pct(clean.filter((g:any)=>g?.win===true).length,clean.length),
    csMin:metric(list,g=>g.csMin),laneCs10:metric(list,g=>g.laneCs10),dpm:metric(list,g=>g.dpm),deaths:metric(list,g=>g.deaths),deadTimePct:metric(list,g=>g.deadTimePct),damageEfficiencyPp:metric(list,g=>g.damageEfficiencyPp),turretDamagePerMin:metric(list,g=>g.turretDamagePerMin),
    visionActionsPerMin:metric(list,g=>g.visionActionsPerMin),visionShare:metric(list,g=>g.visionShare),controlWardsPlaced:metric(list,g=>g.controlWardsPlaced),enemyJungleMonsters:metric(list,g=>g.enemyJungleMonsters),epicDamagePerMin:metric(list,g=>g.epicDamagePerMin),soloKills:metric(list,g=>g.soloKills),
    recentGames:recentRows.length,priorGames:priorRows.length,recentDpm:metric(recentRows,g=>g.dpm),priorDpm:metric(priorRows,g=>g.dpm),recentCsMin:metric(recentRows,g=>g.csMin),priorCsMin:metric(priorRows,g=>g.csMin)
  };}).sort((a:any,b:any)=>b.games-a.games||a.champion.localeCompare(b.champion)).slice(0,8);
  const cleanHistory=history.filter((g:any)=>g?.outcomeCompromised!==true),cleanWins=cleanHistory.filter((g:any)=>g?.win===true),cleanLosses=cleanHistory.filter((g:any)=>g?.win===false),useCleanOutcome=cleanWins.length>=5&&cleanLosses.length>=5,outcomeRows=useCleanOutcome?cleanHistory:history,outcomeWins=outcomeRows.filter((g:any)=>g?.win===true),outcomeLosses=outcomeRows.filter((g:any)=>g?.win===false);
  const longOutcomeMetric=(key:string,label:string,unit:string,inverse:boolean,fn:(g:any)=>any)=>({key,label,unit,inverse,wins:sampleStats(outcomeWins,fn),losses:sampleStats(outcomeLosses,fn)});
  const longOutcomeMetrics:any[]=[
    longOutcomeMetric("csMin","CS / min","csmin",false,g=>g.csMin),
    ...(["ADC","MID","TOP"].includes(primaryRole)?[longOutcomeMetric("laneCs10","Lane minions @10","num",false,g=>g.laneCs10)]:primaryRole==="SUPPORT"?[longOutcomeMetric("visionActionsPerMin","Vision actions / min","num",false,g=>g.visionActionsPerMin),longOutcomeMetric("visionShare","Team vision share","percent",false,g=>g.visionShare)]:primaryRole==="JUNGLE"?[longOutcomeMetric("enemyJungleMonsters","Enemy-jungle monsters / game","num",false,g=>g.enemyJungleMonsters),longOutcomeMetric("epicDamagePerMin","Epic damage / min","dpm",false,g=>g.epicDamagePerMin)]:[]),
    longOutcomeMetric("dpm","Damage / min","dpm",false,g=>g.dpm),
    longOutcomeMetric("deaths","Deaths / game","num",true,g=>g.deaths),
    longOutcomeMetric("deadTimePct","Death downtime","percent",true,g=>g.deadTimePct),
    longOutcomeMetric("damageEfficiencyPp","Damage share − gold share","percent",false,g=>g.damageEfficiencyPp),
    longOutcomeMetric("turretDamagePerMin","Turret damage / min","dpm",false,g=>g.turretDamagePerMin)
  ];
  const longOutcomeFingerprint={source:useCleanOutcome?"clean_outcomes":"all_outcomes_context_only",directionalEligible:useCleanOutcome,minPerSideForDirectional:5,games:outcomeRows.length,wins:outcomeWins.length,losses:outcomeLosses.length,cleanWins:cleanWins.length,cleanLosses:cleanLosses.length,excludedCompromised:useCleanOutcome?history.length-cleanHistory.length:0,metrics:longOutcomeMetrics,definition:"Match-level selected-role history split by final result. Directional interpretation requires at least five clean wins and five clean losses; otherwise all outcomes are shown as neutral context only."};
  const resourceOutputArchetypes=(()=>{
    const eligible=history.filter((g:any)=>hasNum(g?.goldRank)&&hasNum(g?.damageRank)),deadDist:any=distribution(eligible.map((g:any)=>g?.deadTimePct).filter(hasNum).map(Number)),turretDist:any=distribution(eligible.map((g:any)=>g?.turretDamagePerMin).filter(hasNum).map(Number));
    const deadMedian=hasNum(deadDist?.median)?Number(deadDist.median):null,turretMedian=hasNum(turretDist?.median)?Number(turretDist.median):null;
    const pack=(key:string,label:string,fn:(g:any)=>boolean)=>{
      const rows=eligible.filter(fn),wins=rows.filter((g:any)=>g?.win===true).length,cleanRows=rows.filter((g:any)=>g?.outcomeCompromised!==true),cleanWins=cleanRows.filter((g:any)=>g?.win===true).length,lowerDamage=rows.filter((g:any)=>Number(g.damageRank)>2),deadRows=lowerDamage.filter((g:any)=>hasNum(g?.deadTimePct)),turretRows=lowerDamage.filter((g:any)=>hasNum(g?.turretDamagePerMin));
      const highDead=hasNum(deadMedian)?deadRows.filter((g:any)=>Number(g.deadTimePct)>Number(deadMedian)).length:0,highTurret=hasNum(turretMedian)?turretRows.filter((g:any)=>Number(g.turretDamagePerMin)>Number(turretMedian)).length:0;
      const exemplarScore=(g:any)=>{
        const lower=Number(g.damageRank)>2;
        const dead=lower&&hasNum(deadMedian)&&hasNum(g?.deadTimePct)?Math.max(0,Number(g.deadTimePct)-Number(deadMedian)):0;
        const turret=lower&&hasNum(turretMedian)&&hasNum(g?.turretDamagePerMin)?Math.max(0,Number(g.turretDamagePerMin)-Number(turretMedian))/10:0;
        const rankGap=Math.abs(Number(g.goldRank)-Number(g.damageRank));
        return dead+turret+rankGap;
      };
      const examples=[...rows].sort((a:any,b:any)=>exemplarScore(b)-exemplarScore(a)||Number(b?.gameStartTimestamp||0)-Number(a?.gameStartTimestamp||0)).slice(0,8).map((g:any)=>({
        matchId:text(g?.matchId),gameStartTimestamp:Number(g?.gameStartTimestamp||0),champion:text(g?.champion)||"Unknown",win:g?.win===true,outcomeCompromised:g?.outcomeCompromised===true,
        goldRank:hasNum(g?.goldRank)?Number(g.goldRank):null,damageRank:hasNum(g?.damageRank)?Number(g.damageRank):null,goldShare:hasNum(g?.goldShare)?Number(g.goldShare):null,damageShare:hasNum(g?.damageShare)?Number(g.damageShare):null,damageEfficiencyPp:hasNum(g?.damageEfficiencyPp)?Number(g.damageEfficiencyPp):null,dpm:hasNum(g?.dpm)?Number(g.dpm):null,
        deadTimePct:hasNum(g?.deadTimePct)?Number(g.deadTimePct):null,turretDamagePerMin:hasNum(g?.turretDamagePerMin)?Number(g.turretDamagePerMin):null,
        timelineAvailable:g?.timelineAvailable===true,aboveOwnDeadTimeMedian:Number(g.damageRank)>2&&hasNum(deadMedian)&&hasNum(g?.deadTimePct)?Number(g.deadTimePct)>Number(deadMedian):null,
        aboveOwnTurretMedian:Number(g.damageRank)>2&&hasNum(turretMedian)&&hasNum(g?.turretDamagePerMin)?Number(g.turretDamagePerMin)>Number(turretMedian):null
      }));
      return{key,label,games:rows.length,share:pct(rows.length,eligible.length),wins,winRate:pct(wins,rows.length),cleanGames:cleanRows.length,cleanWins,cleanWinRate:pct(cleanWins,cleanRows.length),cleanAvgDamageEfficiencyPp:meanField(finiteGames(cleanRows,g=>g.damageEfficiencyPp),g=>g.damageEfficiencyPp),cleanAvgDeadTimePct:meanField(finiteGames(cleanRows,g=>g.deadTimePct),g=>g.deadTimePct),avgGoldShare:meanField(finiteGames(rows,g=>g.goldShare),g=>g.goldShare),avgDamageShare:meanField(finiteGames(rows,g=>g.damageShare),g=>g.damageShare),avgDamageEfficiencyPp:meanField(finiteGames(rows,g=>g.damageEfficiencyPp),g=>g.damageEfficiencyPp),avgDpm:meanField(finiteGames(rows,g=>g.dpm),g=>g.dpm),avgDeadTimePct:meanField(finiteGames(rows,g=>g.deadTimePct),g=>g.deadTimePct),avgTurretDamagePerMin:meanField(finiteGames(rows,g=>g.turretDamagePerMin),g=>g.turretDamagePerMin),aboveMedianDeadTimeGames:highDead,deadTimeComparableGames:deadRows.length,aboveMedianTurretPressureGames:highTurret,turretComparableGames:turretRows.length,examples};
    };
    return{eligibleGames:eligible.length,deadTimeMedian:deadMedian,turretDamagePerMinMedian:turretMedian,categories:[
      pack("high_resource_high_damage","Top-2 gold + top-2 damage",(g:any)=>Number(g.goldRank)<=2&&Number(g.damageRank)<=2),
      pack("high_resource_lower_damage","Top-2 gold + lower damage",(g:any)=>Number(g.goldRank)<=2&&Number(g.damageRank)>2),
      pack("lower_resource_high_damage","Lower gold + top-2 damage",(g:any)=>Number(g.goldRank)>2&&Number(g.damageRank)<=2),
      pack("lower_resource_lower_damage","Lower gold + lower damage",(g:any)=>Number(g.goldRank)>2&&Number(g.damageRank)>2)
    ],definition:"Exclusive team-relative gold/damage rank matrix. Death-downtime and turret-pressure overlaps use this selected-role history's own median and are descriptive, not causal. Each category includes up to eight bounded exemplars ranked by explanatory-context contrast, never by inferred causality."};
  })();
  return{roleMetricModel:"role_specific_match_history_v1",targetGames:ANALYSIS_HISTORY_TARGET_GAMES,sampleGames:history.length,deepTimelineGames:history.filter((g:any)=>g?.timelineAvailable===true).length,matchOnlyHistoryGames:history.filter((g:any)=>g?.timelineAvailable!==true).length,
    recent20:recentPack,previous20:priorPack,olderHistory:pack(older),summary:historyPack,resourceOutputArchetypes,championHistory,longOutcomeFingerprint,
    trend:{peerCsMinDelta:trend("peerCsMinDelta"),peerDpmDelta:trend("peerDpmDelta"),peerGpmDelta:trend("peerGpmDelta"),peerVpmDelta:trend("peerVpmDelta"),peerDeathsDelta:trend("peerDeathsDelta"),peerKpDelta:trend("peerKpDelta"),csMin:trend("csMin"),laneCs10:trend("laneCs10"),dpm:trend("dpm"),gpm:trend("gpm"),vpm:trend("vpm"),deaths:trend("deaths"),deadTimePct:trend("deadTimePct"),damageEfficiencyPp:trend("damageEfficiencyPp"),turretDamagePerMin:trend("turretDamagePerMin"),epicDamagePerMin:trend("epicDamagePerMin"),visionActionsPerMin:trend("visionActionsPerMin"),visionShare:trend("visionShare"),controlWardsPlaced:trend("controlWardsPlaced"),enemyJungleMonsters:trend("enemyJungleMonsters"),firstTurretParticipationRate:trend("firstTurretParticipationRate"),visionLeaderRate:trend("visionLeaderRate"),top2GoldToTop2DamageRate:trend("top2GoldToTop2DamageRate"),lowResourceTop2DamageRate:trend("lowResourceTop2DamageRate"),damageTop2Rate:trend("damageTop2Rate"),damageLeaderRate:trend("damageLeaderRate")},
    stabilityTrend:{peerCsMinDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.csMinDelta:null),peerDpmDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.dpmDelta:null),peerGpmDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.gpmDelta:null),peerVpmDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.vpmDelta:null),peerDeathsDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.deathsDelta:null),peerKpDelta:stability(g=>g?.directPeerComparable===true?g?.peer?.kpDelta:null),csMin:stability(g=>g.csMin),laneCs10:stability(g=>g.laneCs10),dpm:stability(g=>g.dpm),deaths:stability(g=>g.deaths),deadTimePct:stability(g=>g.deadTimePct),damageEfficiencyPp:stability(g=>g.damageEfficiencyPp),turretDamagePerMin:stability(g=>g.turretDamagePerMin),epicDamagePerMin:stability(g=>g.epicDamagePerMin),visionActionsPerMin:stability(g=>g.visionActionsPerMin),visionShare:stability(g=>g.visionShare),controlWardsPlaced:stability(g=>g.controlWardsPlaced),enemyJungleMonsters:stability(g=>g.enemyJungleMonsters),soloKills:stability(g=>g.soloKills)},
    consistency:{csMin:distribution(values(g=>g.csMin)),laneCs10:distribution(values(g=>g.laneCs10)),soloKills:distribution(values(g=>g.soloKills)),deaths:distribution(values(g=>g.deaths)),deadTimePct:distribution(values(g=>g.deadTimePct)),damageEfficiencyPp:distribution(values(g=>g.damageEfficiencyPp)),turretDamagePerMin:distribution(values(g=>g.turretDamagePerMin)),epicDamagePerMin:distribution(values(g=>g.epicDamagePerMin)),visionActionsPerMin:distribution(values(g=>g.visionActionsPerMin)),visionShare:distribution(values(g=>g.visionShare)),controlWardsPlaced:distribution(values(g=>g.controlWardsPlaced)),enemyJungleMonsters:distribution(values(g=>g.enemyJungleMonsters))},
    topChampions:Object.entries(championCounts).map(([champion,games])=>({champion,games:Number(games)})).sort((a:any,b:any)=>b.games-a.games||a.champion.localeCompare(b.champion)).slice(0,8),
    selectedRole:primaryRole,roleCounts:history.reduce((acc:any,g:any)=>{const k=text(g?.role)||"GENERIC";acc[k]=(acc[k]||0)+1;return acc;},{}),patches:[...new Set(history.map((g:any)=>g?.publicPatchKey||g?.patchKey).filter(Boolean))],
    metricSemantics:{peerAdjustedHistory:"Direction uses reviewed-player minus actual direct same-role opponent for each game. This controls each match against the counterpart faced and avoids treating falling raw DPM/CS at higher MMR as automatic decline.",peerDpmDelta:"Player DPM minus direct same-role opponent DPM; positive means more champion damage per minute than the actual counterpart in that match.",peerCsMinDelta:"Player CS/min minus direct same-role opponent CS/min; positive means more farm per minute than the actual counterpart.",peerGpmDelta:"Player GPM minus direct same-role opponent GPM.",peerVpmDelta:"Player vision/min minus direct same-role opponent vision/min; primarily used for Support.",peerDeathsDelta:"Player deaths minus direct same-role opponent deaths; lower is favorable.",peerKpDelta:"Player kill participation minus direct same-role opponent kill participation in percentage points.",damageEfficiencyPp:"Team champion-damage share minus team gold share in percentage points; descriptive, champion/composition sensitive.",deadTimePct:"Share of game duration spent dead; captures timing cost that raw death count misses.",laneCs10:"Riot challenge lane-minion count through 10 minutes; match-level and available without timeline.",soloKills:"Riot challenges.soloKills, shown per game; per-30 is supplied only as time-normalized context because per-minute values are numerically tiny and hard to read.",enemyJungleMonsters:"Riot enemy-jungle monster count, used only as Jungle counter-jungle pressure context; it does not prove safe or valuable invades.",firstTurretParticipationRate:"Share of games with Riot firstTowerKill or firstTowerAssist; descriptive structure involvement, not proof of lane dominance.",visionLeaderRate:"Share of games ranked first on the team in vision score; primarily useful for Support context.",visionShare:"Player vision score divided by team vision score. Used for Support burden/context alongside actions per minute; composition and game state sensitive.",top2GoldToTop2DamageRate:"Among games where the player finishes top-2 on their team in gold, the share that also finish top-2 in champion damage. Descriptive resource-to-output conversion for carry-lane context, not a universal efficiency grade.",lowResourceTop2DamageRate:"Among games where the player finishes outside the team top-2 in gold, the share that still finish top-2 in champion damage. Descriptive lower-resource punch-up context for carry lanes; champion role and game state can legitimately change what good looks like.",resourceOutputArchetypes:"Exclusive 2x2 team-relative gold/damage-rank matrix. Categories also expose average team gold share, team damage share and their percentage-point gap so ordinal rank cutoffs retain continuous magnitude context. Lower-damage groups report overlap with above-own-history-median death downtime and turret pressure; these overlaps are context, not causal explanations.",plateSegments:"Riot turretPlatesTaken challenge. In 2026 plates are permanent and extend beyond outer turrets, so this is all-game structure pressure, not a pre-14 lane-plate metric."},
    definition:"Up to the newest 100 selected-role games in the report's supported queue cohort. Last 20 keep deep timeline coaching; older games supply match-level trend and stability context."};
}
function sessionBehaviorModel(games:any[],primaryRole:string="GENERIC"){
  const first=games.filter((g:any)=>Number(g.sessionContext?.sessionGameNumber)===1),second=games.filter((g:any)=>Number(g.sessionContext?.sessionGameNumber)===2),late=games.filter((g:any)=>Number(g.sessionContext?.sessionGameNumber)>=3);
  const quickAfterLoss=games.filter((g:any)=>g.sessionContext?.previousWin===false&&hasNum(g.sessionContext?.gapAfterPreviousMin)&&Number(g.sessionContext.gapAfterPreviousMin)<=45);
  const quickAfterWin=games.filter((g:any)=>g.sessionContext?.previousWin===true&&hasNum(g.sessionContext?.gapAfterPreviousMin)&&Number(g.sessionContext.gapAfterPreviousMin)<=45);
  const pack=(xs:any[])=>{
    const peerRows=xs.filter((g:any)=>g.directPeerComparable===true&&g?.peer),lane15=finiteGames(peerRows.filter((g:any)=>g?.phaseRules?.lane15Comparable!==false),g=>g.goldDiff15),timeline=xs.filter((g:any)=>g.timelineAvailable===true);
    const kpGames=finiteGames(xs,g=>g?.kp),vpmGames=finiteGames(xs,g=>g?.vpm),peerDpmGames=finiteGames(peerRows,g=>g?.peer?.dpmDelta),peerCsMinGames=finiteGames(peerRows,g=>g?.peer?.csMinDelta),peerGpmGames=finiteGames(peerRows,g=>g?.peer?.gpmDelta),peerVpmGames=finiteGames(peerRows,g=>g?.peer?.vpmDelta),peerKpGames=finiteGames(peerRows,g=>g?.peer?.kpDelta),impactGames=finiteGames(peerRows,g=>g?.impactDeltaVsOpponent);
    return{
      games:xs.length,directPeerGames:peerRows.length,lane15Games:lane15.length,timelineGames:timeline.length,kpGames:kpGames.length,vpmGames:vpmGames.length,peerDpmGames:peerDpmGames.length,peerCsMinGames:peerCsMinGames.length,peerGpmGames:peerGpmGames.length,peerVpmGames:peerVpmGames.length,peerKpGames:peerKpGames.length,impactGames:impactGames.length,
      kp:meanField(kpGames,g=>g.kp),vpm:meanField(vpmGames,g=>g.vpm),goldDiff15:meanField(lane15,g=>g.goldDiff15),badDeaths:meanField(timeline,g=>g.badDeathCount),peerDpmDelta:meanField(peerDpmGames,g=>g.peer.dpmDelta),peerCsMinDelta:meanField(peerCsMinGames,g=>g.peer.csMinDelta),peerGpmDelta:meanField(peerGpmGames,g=>g.peer.gpmDelta),peerVpmDelta:meanField(peerVpmGames,g=>g.peer.vpmDelta),peerKpDelta:meanField(peerKpGames,g=>g.peer.kpDelta),impactDeltaVsOpponent:meanField(impactGames,g=>g.impactDeltaVsOpponent)
    };
  };
  const firstP=pack(first),secondP=pack(second),lateP=pack(late),lossP=pack(quickAfterLoss),winP=pack(quickAfterWin),pairReady=(a:any,b:any)=>Number(a?.games||0)>=2&&Number(b?.games||0)>=2;
  const metricReady=(a:any,b:any,field:string,min=2)=>pairReady(a,b)&&Number(a?.[field]||0)>=min&&Number(b?.[field]||0)>=min;
  const delta=(a:any,b:any,valueField:string,countField:string,min=2)=>metricReady(a,b,countField,min)&&hasNum(a?.[valueField])&&hasNum(b?.[valueField])?Number(a[valueField])-Number(b[valueField]):null;
  const game3PlusGoldDelta=delta(lateP,firstP,"goldDiff15","lane15Games"),game3PlusBadDeathDelta=delta(lateP,firstP,"badDeaths","timelineGames"),game3PlusPeerDpmDelta=delta(lateP,firstP,"peerDpmDelta","peerDpmGames"),game3PlusPeerCsMinDelta=delta(lateP,firstP,"peerCsMinDelta","peerCsMinGames"),game3PlusPeerGpmDelta=delta(lateP,firstP,"peerGpmDelta","peerGpmGames"),game3PlusPeerVpmDelta=delta(lateP,firstP,"peerVpmDelta","peerVpmGames"),game3PlusPeerKpDelta=delta(lateP,firstP,"peerKpDelta","peerKpGames"),game3PlusImpactDelta=delta(lateP,firstP,"impactDeltaVsOpponent","impactGames");
  const postLossGoldDelta=delta(lossP,winP,"goldDiff15","lane15Games"),postLossBadDeathDelta=delta(lossP,winP,"badDeaths","timelineGames"),postLossPeerDpmDelta=delta(lossP,winP,"peerDpmDelta","peerDpmGames"),postLossPeerCsMinDelta=delta(lossP,winP,"peerCsMinDelta","peerCsMinGames"),postLossPeerVpmDelta=delta(lossP,winP,"peerVpmDelta","peerVpmGames"),postLossPeerKpDelta=delta(lossP,winP,"peerKpDelta","peerKpGames");
  const signal=(label:string,value:any,threshold:number,inverse:boolean,a:any,b:any,countField:string)=>metricReady(a,b,countField,3)&&hasNum(value)?{label,delta:Number(value),threshold,inverse,normalized:(inverse?-1:1)*Number(value)/threshold,recentN:Number(a[countField]||0),baselineN:Number(b[countField]||0)}:null;
  const roleSignals=primaryRole==="SUPPORT"?[
      signal("Vision/min vs Support opponent",game3PlusPeerVpmDelta,.15,false,lateP,firstP,"peerVpmGames"),
      signal("Kill participation vs Support opponent",game3PlusPeerKpDelta,3,false,lateP,firstP,"peerKpGames"),
      signal("Risky deaths / game",game3PlusBadDeathDelta,.35,true,lateP,firstP,"timelineGames")
    ]:primaryRole==="JUNGLE"?[
      signal("CS/min vs Jungle opponent",game3PlusPeerCsMinDelta,.25,false,lateP,firstP,"peerCsMinGames"),
      signal("DPM vs Jungle opponent",game3PlusPeerDpmDelta,75,false,lateP,firstP,"peerDpmGames"),
      signal("First impact timing vs Jungle opponent",game3PlusImpactDelta,.75,true,lateP,firstP,"impactGames"),
      signal("Risky deaths / game",game3PlusBadDeathDelta,.35,true,lateP,firstP,"timelineGames")
    ]:[
      signal("CS/min vs role opponent",game3PlusPeerCsMinDelta,.25,false,lateP,firstP,"peerCsMinGames"),
      signal("DPM vs role opponent",game3PlusPeerDpmDelta,75,false,lateP,firstP,"peerDpmGames"),
      signal("Gold @15 vs role opponent",game3PlusGoldDelta,250,false,lateP,firstP,"lane15Games"),
      signal("Risky deaths / game",game3PlusBadDeathDelta,.35,true,lateP,firstP,"timelineGames")
    ];
  const supportedSignals=roleSignals.filter(Boolean) as any[];
  const score=supportedSignals.length?supportedSignals.reduce((n:number,x:any)=>n+Math.max(-3,Math.min(3,Number(x.normalized))),0)/supportedSignals.length:null;
  const strongPositiveSignals=supportedSignals.filter((x:any)=>Number(x.normalized)>=.6).length,strongNegativeSignals=supportedSignals.filter((x:any)=>Number(x.normalized)<=-.6).length;
  const allSmall=supportedSignals.length>0&&supportedSignals.every((x:any)=>Math.abs(Number(x.normalized))<.6);
  const status=supportedSignals.length<2?"insufficient":strongPositiveSignals>0&&strongNegativeSignals>0?"mixed":Number(score)<=-.6?"worse":Number(score)>=.6?"better":allSmall?"stable":"mixed";
  const headline=status==="worse"?"Performance is lower in game 3+ in this sample":status==="better"?"Performance is higher in game 3+ in this sample":status==="stable"?"No clear later-session performance change":status==="mixed"?"Later-session performance is mixed":"Not enough repeated session-position evidence yet";
  const answer={status,headline,score,strongPositiveSignals,strongNegativeSignals,supportedSignals,minimumMetricObservationsPerSide:3,comparison:"game 3+ versus session opener",definition:"Headline uses only role-relevant direct-opponent deltas plus timeline risk where available. Opposing strong component shifts are called mixed even when their average approximately cancels out. Raw DPM, CS/min and other scoreboard totals are deliberately excluded from the directional answer because opponent strength and MMR can change those totals."};
  return{
    firstGame:firstP,secondGame:secondP,game3Plus:lateP,quickAfterLoss:lossP,quickAfterWin:winP,answer,
    game3PlusGoldDelta,game3PlusBadDeathDelta,game3PlusPeerDpmDelta,game3PlusPeerCsMinDelta,game3PlusPeerGpmDelta,game3PlusPeerVpmDelta,game3PlusPeerKpDelta,game3PlusImpactDelta,
    postLossGoldDelta,postLossBadDeathDelta,postLossPeerDpmDelta,postLossPeerCsMinDelta,postLossPeerVpmDelta,postLossPeerKpDelta,
    samplePolicy:{minGamesPerComparedGroup:2,minGamesPerHeadlineMetricGroup:3,minTimelineGamesPerRiskGroup:2,minLane15GamesPerGoldGroup:2,minMetricGamesPerComparedGroup:2,thinGroupGames:3},
    definition:"Session continues while the gap after the previous game end is ≤90 minutes. Quick requeue comparison uses ≤45 minutes. Directional session reads use direct same-role-opponent deltas rather than raw output totals; the headline requires at least three valid observations per side for at least two role-relevant signals. Descriptive association only; it does not diagnose fatigue or tilt."
  };
}
function meanField(games:any[],fn:(g:any)=>any){return avg(games.map(fn));}
function finiteGames(games:any[],fn:(g:any)=>any){return games.filter(g=>hasNum(fn(g)));}
function coachingModel(games:any[],summary:any,lifetime:any,primaryRole:string,playerRank:any=null,baselineContext:any=null){
  const recentFocus:any[]=[],highlights:any[]=[],coaching:any[]=[];
  const sessionModel=sessionBehaviorModel(games);
  const decisionIntelligence=buildDecisionIntelligence(games,sessionModel,primaryRole);
  const conf=(n:number)=>n>=10?"high":n>=5?"medium":"low";
  const push=(arr:any[],category:string,title:string,evidence:string,action:string,confidence:string="medium",priority:number=2,comparison:string="")=>arr.push({category,title,evidence,action,confidence,priority,comparison,text:title+" — "+evidence+(action?" "+action:"")});
  const cleanOutcomeGames=games.filter(g=>g?.outcomeCompromised!==true),wins=cleanOutcomeGames.filter(g=>g.win),losses=cleanOutcomeGames.filter(g=>!g.win),validTimeline=games.filter(g=>g.timelineAvailable),directPeerGames=games.filter(g=>g.directPeerComparable===true),validDirectPeerTimeline=validTimeline.filter(g=>g.directPeerComparable===true),
    lane15ComparableGames=directPeerGames.filter(g=>g?.phaseRules?.lane15Comparable!==false),
    fixed15to25ComparableGames=directPeerGames.filter(g=>g?.phaseRules?.fixed15to25Comparable!==false),
    closing25ComparableGames=directPeerGames.filter(g=>g?.phaseRules?.closing25Comparable!==false),
    lane15=finiteGames(lane15ComparableGames,g=>g.goldDiff15),itemGames=finiteGames(directPeerGames,g=>g.itemSpikeDeltaVsOpponent),peerGames=directPeerGames.filter(g=>g.peer);
  const avgG15=meanField(lane15,g=>g.goldDiff15),avgC15=meanField(finiteGames(lane15ComparableGames,g=>g.csDiff15),g=>g.csDiff15),laneAhead=lane15.length?100*lane15.filter(g=>Number(g.goldDiff15)>0).length/lane15.length:null;
  const directPeerTimelineGames=validDirectPeerTimeline.length,roleSoloKills=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.soloKillsVsRole||0),0),roleSoloDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.soloDeathsToRole||0),0),earlyRoleSoloKills=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.earlySoloKillsVsRole||0),0),earlyRoleSoloDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.earlySoloDeathsToRole||0),0),earlyRoleSoloKillGames=validDirectPeerTimeline.filter((g:any)=>Number(g.laneDuel?.earlySoloKillsVsRole||0)>0).length,earlyRoleSoloDeathGames=validDirectPeerTimeline.filter((g:any)=>Number(g.laneDuel?.earlySoloDeathsToRole||0)>0).length,earlyRoleSoloEventGames=validDirectPeerTimeline.filter((g:any)=>Number(g.laneDuel?.earlySoloKillsVsRole||0)+Number(g.laneDuel?.earlySoloDeathsToRole||0)>0).length,earlyRoleSoloDeathPerGame=directPeerTimelineGames?earlyRoleSoloDeaths/directPeerTimelineGames:null,pre14RoleSoloKills=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.pre14SoloKillsVsRole||0),0),pre14RoleSoloDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.laneDuel?.pre14SoloDeathsToRole||0),0),pre14RoleSoloDeathPerGame=directPeerTimelineGames?pre14RoleSoloDeaths/directPeerTimelineGames:null;
  const soloKillConversionEvents=validDirectPeerTimeline.flatMap(g=>(g.laneDuel?.events||[]).filter((x:any)=>x.result==="solo_kill"&&x.conversionEligibleTo15&&hasNum(x.goldSwingTo15))),soloKillConvertedEvents=soloKillConversionEvents.filter((x:any)=>Number(x.goldSwingTo15)>=200);
  const soloKillConversionRate=soloKillConversionEvents.length?100*soloKillConvertedEvents.length/soloKillConversionEvents.length:null,avgSoloKillGoldSwingTo15=avg(soloKillConversionEvents.map((x:any)=>x.goldSwingTo15)),avgSoloKillCsSwingTo15=avg(soloKillConversionEvents.map((x:any)=>x.csSwingTo15));
  const soloKillResetEvents=validDirectPeerTimeline.flatMap(g=>(g.laneDuel?.events||[]).filter((x:any)=>x.result==="solo_kill"&&x.early&&hasNum(x.nextShopDelaySec))),soloKillDeathsBeforeShop=soloKillResetEvents.filter((x:any)=>x.diedBeforeNextShop).length;
  const soloKillDeathsBeforeShopRate=soloKillResetEvents.length?100*soloKillDeathsBeforeShop/soloKillResetEvents.length:null,avgSoloKillNextShopDelaySec=avg(soloKillResetEvents.map((x:any)=>x.nextShopDelaySec));
  const soloKillStructureWindows=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.soloKillWindows||0),0),soloKillStructureConversions=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.soloKillStructureConversions||0),0),soloKillStructureConversionRate=soloKillStructureWindows?100*soloKillStructureConversions/soloKillStructureWindows:null;
  const first20PlayerPlateInvolvement=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20PlayerPlateInvolvement||0),0),peerMatchedFirst20PlayerPlateInvolvement=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20PlayerPlateInvolvement||0),0),first20OpponentPlateInvolvement=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20OpponentPlateInvolvement||0),0),first20PlateInvolvementDelta=peerMatchedFirst20PlayerPlateInvolvement-first20OpponentPlateInvolvement,allGamePlayerPlateInvolvement=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGamePlayerPlateInvolvement||0),0),peerMatchedAllGamePlayerPlateInvolvement=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGamePlayerPlateInvolvement||0),0),allGameOpponentPlateInvolvement=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGameOpponentPlateInvolvement||0),0),allGamePlateInvolvementDelta=peerMatchedAllGamePlayerPlateInvolvement-allGameOpponentPlateInvolvement,directPlayerPlateCredits=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.directPlayerPlateCredits||0),0),unattributedPlateEvents=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.unattributedPlateEvents||0),0);
  const first20PlayerPlateLanePresenceSignals=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20PlayerPlateLanePresenceSignals||0),0),peerMatchedFirst20PlayerPlateLanePresenceSignals=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20PlayerPlateLanePresenceSignals||0),0),first20OpponentPlateLanePresenceSignals=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.first20OpponentPlateLanePresenceSignals||0),0),allGamePlayerPlateLanePresenceSignals=validTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGamePlayerPlateLanePresenceSignals||0),0),peerMatchedAllGamePlayerPlateLanePresenceSignals=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGamePlayerPlateLanePresenceSignals||0),0),allGameOpponentPlateLanePresenceSignals=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.structurePressure?.allGameOpponentPlateLanePresenceSignals||0),0);
  const earlyHomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.earlyHomeLaneDeaths||0),0),earlyHomeLaneDeathGames=validTimeline.filter((g:any)=>Number(g.lanePressure?.earlyHomeLaneDeaths||0)>0).length,earlyClassifiedHomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.earlyClassifiedHomeLaneDeaths||0),0),earlyClassifiedHomeLaneDeathGames=validTimeline.filter((g:any)=>Number(g.lanePressure?.earlyClassifiedHomeLaneDeaths||0)>0).length,earlyUnclassifiedHomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.earlyUnclassifiedHomeLaneDeaths||0),0),earlyOutsidePressureDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.earlyOutsidePressureDeaths||0),0),earlyOutsidePressureDeathGames=validTimeline.filter((g:any)=>Number(g.lanePressure?.earlyOutsidePressureDeaths||0)>0).length,earlyOutsidePressureShare=earlyClassifiedHomeLaneDeaths?100*earlyOutsidePressureDeaths/earlyClassifiedHomeLaneDeaths:null,pre14HomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14HomeLaneDeaths||0),0),pre14ClassifiedHomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14ClassifiedHomeLaneDeaths||0),0),pre14UnclassifiedHomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14UnclassifiedHomeLaneDeaths||0),0),pre14OutsidePressureDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14OutsidePressureDeaths||0),0),pre14OutsidePressureShare=pre14ClassifiedHomeLaneDeaths?100*pre14OutsidePressureDeaths/pre14ClassifiedHomeLaneDeaths:null;
  const laneLeads=lane15.filter(g=>g?.outcomeCompromised!==true&&Number(g.goldDiff15)>=250),laneDeficits=lane15.filter(g=>g?.outcomeCompromised!==true&&Number(g.goldDiff15)<=-250);
  const midgameGames=fixed15to25ComparableGames.filter(g=>hasNum(g.goldDiff15)&&hasNum(g.goldDiff25)),leadMidgame=midgameGames.filter(g=>Number(g.goldDiff15)>=250),deficitMidgame=midgameGames.filter(g=>Number(g.goldDiff15)<=-250);
  const avgSwing15to25=meanField(midgameGames,g=>Number(g.goldDiff25)-Number(g.goldDiff15)),leadSwing15to25=meanField(leadMidgame,g=>Number(g.goldDiff25)-Number(g.goldDiff15)),deficitSwing15to25=meanField(deficitMidgame,g=>Number(g.goldDiff25)-Number(g.goldDiff15));
  const midgameCsGames=["ADC","MID","TOP"].includes(primaryRole)?fixed15to25ComparableGames.filter(g=>hasNum(g.csDiff15)&&hasNum(g.csDiff25)):[],avgCsSwing15to25=meanField(midgameCsGames,g=>Number(g.csDiff25)-Number(g.csDiff15));
  const midRoutingGames=["ADC","MID","TOP"].includes(primaryRole)?fixed15to25ComparableGames.filter(g=>g.phaseRules?.midRoutingComparable!==false&&hasNum(g.csDiff15)&&hasNum(g.csDiff25)&&Number(g.midRouting?.contestedObjectives||0)>=1):[];
  const midRoutingRows=midRoutingGames.map((g:any)=>({csSwing:Number(g.csDiff25)-Number(g.csDiff15),objectiveJoinRate:100*Number(g.midRouting?.contestedJoins||0)/Math.max(1,Number(g.midRouting?.contestedObjectives||0)),teamObjectives:Number(g.midRouting?.contestedObjectives||0),securedObjectives:Number(g.midRouting?.teamObjectives||0),securedJoins:Number(g.midRouting?.objectiveJoins||0)}));
  const avgMidRoutingCsSwing=avg(midRoutingRows.map((x:any)=>x.csSwing)),midRoutingTeamObjectives=midRoutingGames.reduce((n,g)=>n+Number(g.midRouting?.contestedObjectives||0),0),midRoutingObjectiveJoins=midRoutingGames.reduce((n,g)=>n+Number(g.midRouting?.contestedJoins||0),0),pooledMidRoutingObjectiveJoinRate=midRoutingTeamObjectives?100*midRoutingObjectiveJoins/midRoutingTeamObjectives:null,meanGameMidRoutingObjectiveJoinRate=avg(midRoutingRows.map((x:any)=>x.objectiveJoinRate)),coachingMidRoutingObjectivePresenceRate=meanGameMidRoutingObjectiveJoinRate,securedMidRoutingObjectives=midRoutingGames.reduce((n,g)=>n+Number(g.midRouting?.teamObjectives||0),0),securedMidRoutingJoins=midRoutingGames.reduce((n,g)=>n+Number(g.midRouting?.objectiveJoins||0),0),securedMidRoutingPresenceRate=securedMidRoutingObjectives?100*securedMidRoutingJoins/securedMidRoutingObjectives:null,avgMidRoutingObjectiveJoinRate=pooledMidRoutingObjectiveJoinRate;
  const inefficientMidRoutingGames=midRoutingRows.filter((x:any)=>x.csSwing<=-8&&x.objectiveJoinRate<50).length,balancedMidRoutingGames=midRoutingRows.filter((x:any)=>x.csSwing>=8&&x.objectiveJoinRate>=60).length,sideFarmLowPresenceGames=midRoutingRows.filter((x:any)=>x.csSwing>=8&&x.teamObjectives>=2&&x.objectiveJoinRate<35).length;
  const laneLeadWr=laneLeads.length?100*laneLeads.filter(g=>g.win).length/laneLeads.length:null,laneDeficitWr=laneDeficits.length?100*laneDeficits.filter(g=>g.win).length/laneDeficits.length:null;
  const lead25Games=closing25ComparableGames.filter(g=>g?.outcomeCompromised!==true&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500),lead25Wins=lead25Games.filter(g=>g.win).length,lead25LossGames=lead25Games.filter(g=>!g.win),lead25Losses=lead25LossGames.length,lead25WinRate=lead25Games.length?100*lead25Wins/lead25Games.length:null;
  const lead25LossesWithLateRisk=lead25LossGames.filter(g=>Number(g.closing25?.highRiskDeaths||0)>0||Number(g.closing25?.costlyDeaths||0)>0).length,lead25LateRiskLossRate=lead25Losses?100*lead25LossesWithLateRisk/lead25Losses:null,lead25LateRiskPerLeadGameRate=lead25Games.length?100*lead25LossesWithLateRisk/lead25Games.length:null;
  const lateHighRiskDeathsInLead25Losses=lead25LossGames.reduce((n,g)=>n+Number(g.closing25?.highRiskDeaths||0),0),lateCostlyDeathsInLead25Losses=lead25LossGames.reduce((n,g)=>n+Number(g.closing25?.costlyDeaths||0),0);
  const deficit25Games=closing25ComparableGames.filter(g=>g?.outcomeCompromised!==true&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)<=-500),deficit25Wins=deficit25Games.filter(g=>g.win).length,deficit25WinRate=deficit25Games.length?100*deficit25Wins/deficit25Games.length:null;

  const badPer=meanField(validTimeline,g=>g.badDeathCount),totalTimelineDeaths=validTimeline.reduce((n,g)=>n+Number(g.deaths||0),0),classifiedTimelineDeaths=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.deaths??g.deathPositions?.length??0),0),isolatedDeaths=validTimeline.reduce((n,g)=>n+Number(g.isolatedDeathCount||0),0),avgLegacyBruisienatorDqi=meanField(finiteGames(validTimeline,g=>g.deathQuality?.legacyBruisienator?.effectivePipelineScore),g=>g.deathQuality?.legacyBruisienator?.effectivePipelineScore),avgLegacyBruisienatorIntentReconstruction=meanField(finiteGames(validTimeline,g=>g.deathQuality?.legacyBruisienator?.reconstructedWithoutFacecheck),g=>g.deathQuality?.legacyBruisienator?.reconstructedWithoutFacecheck),tradedDeaths=validTimeline.reduce((n,g)=>n+Number(g.tradedDeathCount||0),0),highRiskUntradedDeaths=validTimeline.reduce((n,g)=>n+Number(g.highRiskUntradedDeathCount||0),0),deathTradeRate=classifiedTimelineDeaths?100*tradedDeaths/classifiedTimelineDeaths:null,highRiskUntradedPerGame=validTimeline.length?highRiskUntradedDeaths/validTimeline.length:null,leadDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.leadDeathCount||0),0),highRiskLeadDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.highRiskLeadDeathCount||0),0),highRiskLeadDeathsPerGame=directPeerTimelineGames?highRiskLeadDeaths/directPeerTimelineGames:null,
    aheadStateDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.ahead||0),0),evenStateDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.even||0),0),behindStateDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.behind||0),0),
    highRiskAheadStateDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskAhead||0),0),highRiskEvenStateDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskEven||0),0),highRiskBehindDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskBehind||0),0),
    highRiskBehindDeathRate=behindStateDeaths?100*highRiskBehindDeaths/behindStateDeaths:null,highRiskBehindDeathsPerGame=directPeerTimelineGames?highRiskBehindDeaths/directPeerTimelineGames:null,objectiveContextDeaths=validTimeline.reduce((n,g)=>n+Number(g.objectiveDeathCount||0),0),objDeathPct=classifiedTimelineDeaths?100*objectiveContextDeaths/classifiedTimelineDeaths:null,meanGameObjectiveDeathPct=meanField(finiteGames(validTimeline,g=>g.objectiveDeathPct),g=>g.objectiveDeathPct),preObjDeaths=validTimeline.reduce((n,g)=>n+Number(g.preObjectiveDeathCount||0),0),preObjDeathPct=classifiedTimelineDeaths?100*preObjDeaths/classifiedTimelineDeaths:null,preObjectiveDeathsPerTimelineGame=validTimeline.length?preObjDeaths/validTimeline.length:null,meanGamePreObjectiveDeathPct=meanField(finiteGames(validTimeline,g=>g.preObjectiveDeathPct),g=>g.preObjectiveDeathPct),unspent=validTimeline.reduce((n,g)=>n+Number(g.highUnspentGoldDeaths||0),0);
  const repeatDeathOpportunities=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.opportunities||0),0),repeatDeaths=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.repeatDeaths||0),0),highRiskRepeatDeaths=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.highRiskRepeatDeaths||0),0),costlyRepeatDeaths=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.costlyRepeatDeaths||0),0),untradedRepeatDeaths=validTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.untradedRepeatDeaths||0),0),repeatDeathRate=repeatDeathOpportunities?100*repeatDeaths/repeatDeathOpportunities:null,repeatDeathsPerTimelineGame=validTimeline.length?repeatDeaths/validTimeline.length:null;
  const peerMatchedRepeatDeathOpportunities=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.opportunities||0),0),peerMatchedRepeatDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.deathRecovery?.repeatDeaths||0),0),peerMatchedRepeatDeathRate=peerMatchedRepeatDeathOpportunities?100*peerMatchedRepeatDeaths/peerMatchedRepeatDeathOpportunities:null,opponentRepeatDeathOpportunities=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.opponentDeathRecovery?.opportunities||0),0),opponentRepeatDeaths=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.opponentDeathRecovery?.repeatDeaths||0),0),opponentRepeatDeathRate=opponentRepeatDeathOpportunities?100*opponentRepeatDeaths/opponentRepeatDeathOpportunities:null,repeatDeathRateDelta=hasNum(peerMatchedRepeatDeathRate)&&hasNum(opponentRepeatDeathRate)?Number(peerMatchedRepeatDeathRate)-Number(opponentRepeatDeathRate):null;
  const measuredDeathConsequences=validTimeline.reduce((n,g)=>n+Number(g.deathConsequences?.measured||0),0),costlyDeathEvents=validTimeline.reduce((n,g)=>n+Number(g.deathConsequences?.costly||0),0),severeDeathEvents=validTimeline.reduce((n,g)=>n+Number(g.deathConsequences?.severe||0),0),untradedCostlyDeathEvents=validTimeline.reduce((n,g)=>n+Number(g.deathConsequences?.untradedCostly||0),0),contaminatedDeathEconomySamples=validTimeline.reduce((n,g)=>n+Number(g.deathConsequences?.economySamplesContaminated||0),0);
  const deathConsequenceCoveragePct=totalTimelineDeaths?100*measuredDeathConsequences/totalTimelineDeaths:null,costlyDeathRate=measuredDeathConsequences?100*costlyDeathEvents/measuredDeathConsequences:null,costlyDeathsPerTimelineGame=validTimeline.length?costlyDeathEvents/validTimeline.length:null,severeDeathsPerTimelineGame=validTimeline.length?severeDeathEvents/validTimeline.length:null;
  const trustedDeathEconomyEvents=validTimeline.flatMap(g=>(g.deathConsequences?.events||[]).filter((x:any)=>x.roleEconomyComparable===true)),avgGoldSwingAfterDeath=avg(trustedDeathEconomyEvents.map((x:any)=>x.goldSwingAfter)),avgCsSwingAfterDeath=avg(trustedDeathEconomyEvents.map((x:any)=>x.csSwingAfter));
  const playerImpactEvents=validTimeline.reduce((n,g)=>n+Number(g.involvedKills?.length||0),0),postImpactDeaths=validTimeline.reduce((n,g)=>n+Number(g.postImpactRisk?.deathsWithin30s||0),0),highRiskPostImpactDeaths=validTimeline.reduce((n,g)=>n+Number(g.postImpactRisk?.highRiskDeathsWithin30s||0),0),untradedPostImpactDeaths=validTimeline.reduce((n,g)=>n+Number(g.postImpactRisk?.untradedDeathsWithin30s||0),0),highRiskUntradedPostImpactDeaths=validTimeline.reduce((n,g)=>n+Number(g.postImpactRisk?.highRiskUntradedDeathsWithin30s||0),0);
  const postImpactDeathRate=playerImpactEvents?100*postImpactDeaths/playerImpactEvents:null,highRiskUntradedPostImpactPerGame=validTimeline.length?highRiskUntradedPostImpactDeaths/validTimeline.length:null;
  const macroTransitionSideLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.sideLaneRisk?.macroTransitionSideLaneDeaths??g.sideLaneRisk?.postLaneSideLaneDeaths??g.sideLaneRisk?.post15SideLaneDeaths??0),0),postLaneSideLaneDeaths=macroTransitionSideLaneDeaths,post15SideLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.sideLaneRisk?.post15SideLaneDeaths||0),0),isolatedSideLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.sideLaneRisk?.isolatedSideLaneDeaths||0),0),preNeutralObjectiveSideLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths||0),0),highRiskSideLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.sideLaneRisk?.highRiskSideLaneDeaths||0),0);
  const isolatedSideLaneDeathRate=macroTransitionSideLaneDeaths?100*isolatedSideLaneDeaths/macroTransitionSideLaneDeaths:null,preNeutralObjectiveSideLaneDeathsPerGame=validTimeline.length?preNeutralObjectiveSideLaneDeaths/validTimeline.length:null;
  const badDeathZoneCounts:any={};for(const g of validTimeline){for(const d of(g.badDeaths||[])){const z=text(d.zone)||"unknown";badDeathZoneCounts[z]=(badDeathZoneCounts[z]||0)+1;}}
  const badDeathZoneEntries=Object.entries(badDeathZoneCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1])),topBadDeathZone=badDeathZoneEntries[0]?.[0]||null,topBadDeathZoneCount=Number(badDeathZoneEntries[0]?.[1]||0),totalBadDeaths=badDeathZoneEntries.reduce((n:number,x:any)=>n+Number(x[1]||0),0),topBadDeathZonePct=totalBadDeaths?100*topBadDeathZoneCount/totalBadDeaths:null;
  const objectiveTeamEncounters=validTimeline.reduce((n,g)=>n+Number(g.objectiveTeamTotal||0),0),objectiveJoinedEncounters=validTimeline.reduce((n,g)=>n+Number(g.objectiveJoined||0),0),teamSecuredObjectiveJoinRate=objectiveTeamEncounters?100*objectiveJoinedEncounters/objectiveTeamEncounters:null,meanGameObjectiveJoinRate=meanField(finiteGames(validTimeline,g=>g.objectiveJoinRate),g=>g.objectiveJoinRate),objectiveContestEncounters=validTimeline.reduce((n,g)=>n+Number(g.objectiveContestTotal||0),0),objectiveContestJoinedEncounters=validTimeline.reduce((n,g)=>n+Number(g.objectiveContestJoined||0),0),objJoin=objectiveContestEncounters?100*objectiveContestJoinedEncounters/objectiveContestEncounters:null,meanGameObjectiveContestPresenceRate=meanField(finiteGames(validTimeline,g=>g.objectiveContestPresenceRate),g=>g.objectiveContestPresenceRate),objectiveCoachingPresenceRate=meanGameObjectiveContestPresenceRate,earlyTeamKills=validTimeline.reduce((n,g)=>n+Number(g.earlyTeamKills||0),0),earlyPlayerKillInvolvements=validTimeline.reduce((n,g)=>n+Number(g.earlyPlayerKillInvolvements||0),0),earlyKp=earlyTeamKills?100*earlyPlayerKillInvolvements/earlyTeamKills:null,meanGameEarlyKp=meanField(finiteGames(validTimeline,g=>g.earlyKp),g=>g.earlyKp);
  const roamAttempts=validTimeline.reduce((n,g)=>n+Number(g.roams?.attempts||0),0),roamSuccess=validTimeline.reduce((n,g)=>n+Number(g.roams?.successes||0),0),roamFail=validTimeline.reduce((n,g)=>n+Number(g.roams?.failures||0),0),roamRate=roamAttempts?100*roamSuccess/roamAttempts:null;
  const roamAttemptGames=validTimeline.filter(g=>Number(g.roams?.attempts||0)>0).length;
  const roamEvents=validTimeline.flatMap(g=>g.roams?.events||[]),roamLaneCostEvents=roamEvents.filter((r:any)=>hasNum(r.coachingLaneCostCs??r.laneCostCs)),avgRoamLaneCostCs=avg(roamLaneCostEvents.map((r:any)=>Number(r.coachingLaneCostCs??r.laneCostCs))),costlyRoams=roamLaneCostEvents.filter((r:any)=>Number(r.coachingLaneCostCs??r.laneCostCs)<=-6),emptyCostlyRoams=costlyRoams.filter((r:any)=>!r.killOrAssist&&!r.objective&&Number(r.structureInvolvements||0)===0);
  const roamLaneMovementGameValues=validTimeline.map((g:any)=>{const xs=(g.roams?.events||[]).map((r:any)=>r.coachingLaneCostCs??r.laneCostCs).filter(hasNum).map(Number);return xs.length?avg(xs):null;}).filter(hasNum),roamLaneCostMeasuredGames=roamLaneMovementGameValues.length,meanGameRoamLaneMovementCs=avg(roamLaneMovementGameValues),emptyCostlyRoamGames=validTimeline.filter((g:any)=>(g.roams?.events||[]).some((r:any)=>hasNum(r.coachingLaneCostCs??r.laneCostCs)&&Number(r.coachingLaneCostCs??r.laneCostCs)<=-6&&!r.killOrAssist&&!r.objective&&Number(r.structureInvolvements||0)===0)).length;
  const roamPlayerKillAssists=roamEvents.reduce((n:number,r:any)=>n+Number((r.playerKillAssists??(r.killOrAssist?1:0))||0),0),roamPlayerDeaths=roamEvents.reduce((n:number,r:any)=>n+Number((r.playerDeaths??(r.death?1:0))||0),0),roamTeamKills=roamEvents.reduce((n:number,r:any)=>n+Number(r.teamKills||0),0),roamObjectivePresent=roamEvents.reduce((n:number,r:any)=>n+Number((r.objectivePresent??(r.objective?1:0))||0),0),roamObjectiveAway=roamEvents.reduce((n:number,r:any)=>n+Number(r.objectiveAway||0),0),roamObjectiveLost=roamEvents.reduce((n:number,r:any)=>n+Number(r.objectiveLost||0),0),roamStructureInvolvements=roamEvents.reduce((n:number,r:any)=>n+Number(r.structureInvolvements||0),0),roamPlatesGained=roamEvents.reduce((n:number,r:any)=>n+Number(r.platesGained||0),0),roamPlatesLost=roamEvents.reduce((n:number,r:any)=>n+Number(r.platesLost||0),0),roamHomeLaneStructuresLost=roamEvents.reduce((n:number,r:any)=>n+Number(r.homeLaneStructuresLost||0),0);
  const supportRoamAdcCostEvents=primaryRole==="SUPPORT"?roamEvents.filter((r:any)=>hasNum(r.adcLaneCostCs)):[],avgSupportRoamAdcLaneCostCs=avg(supportRoamAdcCostEvents.map((r:any)=>r.adcLaneCostCs)),supportRoamAdcHarmfulEvents=primaryRole==="SUPPORT"?supportRoamAdcCostEvents.filter((r:any)=>Number(r.adcLaneCostCs)<=-6):[],supportRoamsHurtingAdc=supportRoamAdcHarmfulEvents.length,supportRoamAdcEmptyCostlyEvents=primaryRole==="SUPPORT"?supportRoamAdcHarmfulEvents.filter((r:any)=>!r.killOrAssist&&!r.objective&&Number(r.structureInvolvements||0)===0):[];
  const supportRoamAdcLaneMovementGameValues=primaryRole==="SUPPORT"?validTimeline.map((g:any)=>{const xs=(g.roams?.events||[]).map((r:any)=>r?.adcLaneCostCs).filter(hasNum).map(Number);return xs.length?avg(xs):null;}).filter(hasNum):[];
  const supportRoamAdcLaneMovementGames=supportRoamAdcLaneMovementGameValues.length,meanGameSupportRoamAdcLaneMovementCs=avg(supportRoamAdcLaneMovementGameValues),supportRoamAdcLaneMovementWindows=supportRoamAdcCostEvents.length;
  const supportRoamsHurtingAdcGames=primaryRole==="SUPPORT"?validTimeline.filter((g:any)=>(g.roams?.events||[]).some((r:any)=>hasNum(r.adcLaneCostCs)&&Number(r.adcLaneCostCs)<=-6)).length:0,supportRoamAdcEmptyCostlyGames=primaryRole==="SUPPORT"?validTimeline.filter((g:any)=>(g.roams?.events||[]).some((r:any)=>hasNum(r.adcLaneCostCs)&&Number(r.adcLaneCostCs)<=-6&&!r.killOrAssist&&!r.objective&&Number(r.structureInvolvements||0)===0)).length:0;
  const itemSpikeEligibleGames=validDirectPeerTimeline.filter(g=>g.itemSpikeWindow?.eligible),itemSpikeEligibleWindows=itemSpikeEligibleGames.length,itemSpikeUtilizedWindows=itemSpikeEligibleGames.filter(g=>g.itemSpikeWindow?.used).length,itemSpikeDeathsBeforeImpact=itemSpikeEligibleGames.filter(g=>g.itemSpikeWindow?.diedBeforeImpact).length,itemSpikeUtilizationRate=itemSpikeEligibleWindows?100*itemSpikeUtilizedWindows/itemSpikeEligibleWindows:null,avgItemSpikeLeadSec=meanField(itemSpikeEligibleGames,g=>g.itemSpikeWindow?.leadSec);
  const earlyLeadGames=validDirectPeerTimeline.filter(g=>g?.phaseRules?.lane15Comparable!==false&&g.earlyLeadWindow?.eligible),earlyLeadGivebackGames=earlyLeadGames.filter(g=>g.earlyLeadWindow?.giveback),earlyLeadPreservedGames=earlyLeadGames.filter(g=>g.earlyLeadWindow?.preserved),earlyLeadGivebackRate=earlyLeadGames.length?100*earlyLeadGivebackGames.length/earlyLeadGames.length:null;
  const avgEarlyLeadPeakGold=meanField(earlyLeadGames,g=>g.earlyLeadWindow?.peakGoldDiff),avgEarlyLeadGoldSwingTo15=meanField(earlyLeadGames,g=>g.earlyLeadWindow?.goldSwingTo15),avgEarlyLeadLostGold=meanField(earlyLeadGames,g=>Math.max(0,-Number(g.earlyLeadWindow?.goldSwingTo15||0))),earlyLeadGivebackDeaths=earlyLeadGivebackGames.reduce((n,g)=>n+Number(g.earlyLeadWindow?.deathsAfterPeak||0),0),earlyLeadGivebackHighRiskDeaths=earlyLeadGivebackGames.reduce((n,g)=>n+Number(g.earlyLeadWindow?.highRiskDeathsAfterPeak||0),0);
  const firstResetObservedGames=validTimeline.filter(g=>g.firstResetSequence),firstResetMeasuredGames=validDirectPeerTimeline.filter(g=>g.firstResetSequence?.measured),firstResetApproximateSpendGames=firstResetObservedGames.filter(g=>g.firstResetSequence?.spendApproximate),firstResetCleanGames=firstResetMeasuredGames.filter(g=>!g.firstResetSequence?.deathInWindow),firstResetLossGames=firstResetCleanGames.filter(g=>g.firstResetSequence?.economyLoss),firstResetGainGames=firstResetCleanGames.filter(g=>g.firstResetSequence?.economyGain),firstResetLossRate=firstResetCleanGames.length?100*firstResetLossGames.length/firstResetCleanGames.length:null,avgFirstResetGoldSwing=meanField(firstResetCleanGames,g=>g.firstResetSequence?.goldSwingAfter),avgFirstResetCsSwing=meanField(firstResetCleanGames,g=>g.firstResetSequence?.csSwingAfter),firstResetPeerGames=firstResetMeasuredGames.filter(g=>hasNum(g.firstResetSequence?.timingDeltaVsOpponent)),avgFirstResetTimingDelta=meanField(firstResetPeerGames,g=>g.firstResetSequence?.timingDeltaVsOpponent);
  const majorReadinessGames=validTimeline.filter(g=>g.majorItemReadiness?.eligible&&hasNum(g.majorItemReadiness?.delayMin)),delayedMajorCompletionGames=majorReadinessGames.filter(g=>Number(g.majorItemReadiness.delayMin)>=1.5),avgMajorCompletionDelayMin=meanField(majorReadinessGames,g=>g.majorItemReadiness?.delayMin);
  const majorReadinessPeerGames=majorReadinessGames.filter(g=>g.directPeerComparable===true&&g.opponentMajorItemReadiness?.eligible&&hasNum(g.opponentMajorItemReadiness?.delayMin)),avgMajorCompletionDelayVsPeerMin=meanField(majorReadinessPeerGames,g=>Number(g.majorItemReadiness.delayMin)-Number(g.opponentMajorItemReadiness.delayMin));
  const itemDelta=meanField(itemGames,g=>g.itemSpikeDeltaVsOpponent),secondMajorGames=finiteGames(validTimeline,g=>g.secondMajorItem?.time),avgSecondMajorTime=meanField(secondMajorGames,g=>g.secondMajorItem?.time),secondMajorPeerGames=finiteGames(validDirectPeerTimeline,g=>g.secondMajorItemDeltaVsOpponent),avgSecondMajorDeltaVsOpponent=meanField(secondMajorPeerGames,g=>g.secondMajorItemDeltaVsOpponent),greedy=validTimeline.reduce((n,g)=>n+Number(g.greedyStayWindows?.length||0),0),greedyStayGames=validTimeline.filter(g=>Number(g.greedyStayWindows?.length||0)>0).length,greedyStaysPerTimelineGame=validTimeline.length?greedy/validTimeline.length:null,peerCsGames=finiteGames(peerGames,g=>g.peer?.csMinDelta),peerDpmGames=finiteGames(peerGames,g=>g.peer?.dpmDelta),peerVpmGames=finiteGames(peerGames,g=>g.peer?.vpmDelta),peerCs=meanField(peerCsGames,g=>g.peer.csMinDelta),peerDpm=meanField(peerDpmGames,g=>g.peer.dpmDelta),peerVpm=meanField(peerVpmGames,g=>g.peer.vpmDelta),topDamage=games.filter(g=>Number(g.damageRank)===1).length;
  const impactGames=finiteGames(validDirectPeerTimeline,g=>g.impactDeltaVsOpponent),avgImpactDelta=meanField(impactGames,g=>g.impactDeltaVsOpponent),impactEarlierPct=impactGames.length?100*impactGames.filter(g=>Number(g.impactDeltaVsOpponent)<0).length/impactGames.length:null;
  const resourceGames=games.filter(g=>hasNum(g.damageShare)&&hasNum(g.goldShare)),damageGoldEfficiency=meanField(resourceGames,g=>Number(g.damageShare)-Number(g.goldShare)),avgDamageShare=meanField(resourceGames,g=>g.damageShare),avgGoldShare=meanField(resourceGames,g=>g.goldShare);
  const fightPresenceSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.present??g.fightProfile?.attended??0),0),fightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.active??g.fightProfile?.attended??0),0),fightProximityOnlySamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.proximityOnly||0),0),firstAllyFightDeaths=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.firstAllyDeaths||0),0),preContributionFightDeaths=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.diedBeforeContribution||0),0),survivedFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.survived||0),0);
  const firstAllyFightDeathRate=fightSamples?100*firstAllyFightDeaths/fightSamples:null,preContributionFightDeathRate=fightSamples?100*preContributionFightDeaths/fightSamples:null,fightSurvivalRate=fightSamples?100*survivedFightSamples/fightSamples:null;
  const highUnspentFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.highUnspentFightSamples||0),0),itemDisadvantageFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.itemDisadvantageFightSamples||0),0),goldDeficitFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.goldDeficitFightSamples||0),0),outnumberedFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.outnumberedFightSamples||0),0);
  const highUnspentFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.highUnspentStarts||0),0),itemDisadvantageFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.itemDisadvantageStarts||0),0),goldDeficitFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.goldDeficitStarts||0),0),unspentAndBehindFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.unspentAndBehindStarts||0),0);
  const outnumberedFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.outnumberedStarts||0),0),lostOutnumberedFights=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.lostOutnumberedStarts||0),0);
  const rolePeerFightSamples=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.fightProfile?.rolePeerFightStarts||0),0),roleLevelDisadvantageFightStarts=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.fightProfile?.roleLevelDisadvantageStarts||0),0),roleLevelDisadvantageFightRate=rolePeerFightSamples?100*roleLevelDisadvantageFightStarts/rolePeerFightSamples:null;
  const outnumberedFightStartRate=outnumberedFightSamples?100*outnumberedFightStarts/outnumberedFightSamples:null,outnumberedFightLossRate=outnumberedFightStarts?100*lostOutnumberedFights/outnumberedFightStarts:null;
  const highUnspentFightRate=highUnspentFightSamples?100*highUnspentFightStarts/highUnspentFightSamples:null,itemDisadvantageFightRate=itemDisadvantageFightSamples?100*itemDisadvantageFightStarts/itemDisadvantageFightSamples:null,goldDeficitFightRate=goldDeficitFightSamples?100*goldDeficitFightStarts/goldDeficitFightSamples:null;
  const visionSetupGames=finiteGames(validDirectPeerTimeline,g=>g.vision?.objectiveSetupDeltaVsOpponent),avgObjectiveSetupDelta=meanField(visionSetupGames,g=>g.vision.objectiveSetupDeltaVsOpponent),objectiveSetupOutperformPct=visionSetupGames.length?100*visionSetupGames.filter(g=>Number(g.vision.objectiveSetupDeltaVsOpponent)>0).length/visionSetupGames.length:null;
  const visionActions=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.actions||0),0),visionActionDeaths=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.deaths||0),0),highRiskVisionActionDeaths=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.highRiskDeaths||0),0),untradedVisionActionDeaths=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.untradedDeaths||0),0),unsupportedVisionActionDeaths=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.unsupportedDeaths||0),0),objectiveSetupVisionActionDeaths=validTimeline.reduce((n,g)=>n+Number(g.visionMission?.objectiveSetupDeaths||0),0);
  const visionActionDeathRate=visionActions?100*visionActionDeaths/visionActions:null,highRiskVisionActionDeathRate=visionActionDeaths?100*highRiskVisionActionDeaths/visionActionDeaths:null,highRiskVisionActionDeathsPerGame=validTimeline.length?highRiskVisionActionDeaths/validTimeline.length:null;
  const visionActionGames=validTimeline.filter(g=>Number(g.visionMission?.actions||0)>0).length;
  const visionWardTotal=validTimeline.reduce((n,g)=>n+Number(g.vision?.wardCount||0),0),visionControlWardPurchases=validTimeline.reduce((n,g)=>n+Number(g.vision?.controlWardPurchases||0),0),visionSetupTotal=validTimeline.reduce((n,g)=>n+Number(g.vision?.objectiveSetup||0),0),visionSetupClears=validTimeline.reduce((n,g)=>n+Number(g.vision?.objectiveSetupClears||0),0),peerMatchedVisionWardTotal=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.vision?.wardCount||0),0),peerMatchedVisionSetupTotal=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.vision?.objectiveSetup||0),0),opponentVisionWardTotal=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.opponentVision?.wardCount||0),0),opponentVisionSetupTotal=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.opponentVision?.objectiveSetup||0),0);
  const objectiveFamilySummary:any={};for(const g of validTimeline){for(const [family,row] of Object.entries(g.objectiveFamilyStats||{}) as any){const dst=objectiveFamilySummary[family]||{encounters:0,teamEncounters:0,enemyEncounters:0,teamUnitsSecured:0,enemyUnitsSecured:0,joinedTeamEncounters:0,teamJoinRate:null,contestedEncounters:0,joinedContestedEncounters:0,contestPresenceRate:null};for(const k of["encounters","teamEncounters","enemyEncounters","teamUnitsSecured","enemyUnitsSecured","joinedTeamEncounters","contestedEncounters","joinedContestedEncounters"])dst[k]+=Number(row?.[k]||0);dst.teamJoinRate=dst.teamEncounters?100*dst.joinedTeamEncounters/dst.teamEncounters:null;dst.contestPresenceRate=dst.contestedEncounters?100*dst.joinedContestedEncounters/dst.contestedEncounters:null;objectiveFamilySummary[family]=dst;}}
  const objectiveSetupWardRate=visionWardTotal?100*visionSetupTotal/visionWardTotal:null,peerMatchedObjectiveSetupWardRate=peerMatchedVisionWardTotal?100*peerMatchedVisionSetupTotal/peerMatchedVisionWardTotal:null,opponentObjectiveSetupWardRate=opponentVisionWardTotal?100*opponentVisionSetupTotal/opponentVisionWardTotal:null,objectiveSetupWardRateDelta=hasNum(peerMatchedObjectiveSetupWardRate)&&hasNum(opponentObjectiveSetupWardRate)?Number(peerMatchedObjectiveSetupWardRate)-Number(opponentObjectiveSetupWardRate):null;
  const killConversionWindowsCount=validTimeline.reduce((n,g)=>n+Number(g.killConversion?.windows||0),0),killConversions=validTimeline.reduce((n,g)=>n+Number((g.killConversion?.playerSupportedConverted??g.killConversion?.converted)||0),0),teamKillConversions=validTimeline.reduce((n,g)=>n+Number((g.killConversion?.teamConverted??g.killConversion?.converted)||0),0),peerMatchedKillConversionWindows=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.killConversion?.windows||0),0),peerMatchedKillConversions=validDirectPeerTimeline.reduce((n,g)=>n+Number((g.killConversion?.playerSupportedConverted??g.killConversion?.converted)||0),0),oppKillConversionWindows=validDirectPeerTimeline.reduce((n,g)=>n+Number(g.opponentKillConversion?.windows||0),0),oppKillConversions=validDirectPeerTimeline.reduce((n,g)=>n+Number((g.opponentKillConversion?.playerSupportedConverted??g.opponentKillConversion?.converted)||0),0),oppTeamKillConversions=validDirectPeerTimeline.reduce((n,g)=>n+Number((g.opponentKillConversion?.teamConverted??g.opponentKillConversion?.converted)||0),0);
  const securedNeutralObjectiveEvents=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.neutralTeamObjectives||0),0),securedNeutralObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.joined||0),0),neutralObjectiveEvents=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.contestedObjectives||0),0),neutralObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.contestedJoined||0),0),earlySetupObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.earlySetupJoins||0),0),eventFrameOnlyObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.eventFrameOnlyJoins||0),0),absentNeutralObjectives=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.contestedAbsent||0),0),recentShopObjectiveAbsences=validTimeline.reduce((n,g)=>n+Number((g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses)??0),0),lateResetObjectiveMisses=recentShopObjectiveAbsences,freshPurchaseObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.freshPurchaseJoins||0),0);
  const earlySetupObjectiveJoinRate=neutralObjectiveJoins?100*earlySetupObjectiveJoins/neutralObjectiveJoins:null,meanGameEarlySetupObjectiveJoinRate=meanField(finiteGames(validTimeline,g=>g.objectiveReadiness?.earlySetupJoinRate),g=>g.objectiveReadiness?.earlySetupJoinRate),objectiveSetupCoachingRate=meanGameEarlySetupObjectiveJoinRate,earlySetupObjectiveCoverageRate=neutralObjectiveEvents?100*earlySetupObjectiveJoins/neutralObjectiveEvents:null,recentShopObjectiveAbsenceRate=neutralObjectiveEvents?100*recentShopObjectiveAbsences/neutralObjectiveEvents:null,lateResetObjectiveMissRate=recentShopObjectiveAbsenceRate,freshPurchaseObjectiveJoinRate=neutralObjectiveEvents?100*freshPurchaseObjectiveJoins/neutralObjectiveEvents:null;
  const objectiveSetupGames=validTimeline.filter(g=>Number(g.objectiveReadiness?.contestedJoined||0)>0).length,objectiveContestGames=validTimeline.filter(g=>Number(g.objectiveReadiness?.contestedObjectives||0)>0).length,recentShopObjectiveAbsenceGames=validTimeline.filter(g=>Number((g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses)??0)>0).length,freshPurchaseObjectiveJoinGames=validTimeline.filter(g=>Number(g.objectiveReadiness?.freshPurchaseJoins||0)>0).length,preObjectiveDeathGames=validTimeline.filter(g=>Number(g.preObjectiveDeathCount||0)>0).length;
  const killConversionRate=killConversionWindowsCount?100*killConversions/killConversionWindowsCount:null,teamKillConversionRate=killConversionWindowsCount?100*teamKillConversions/killConversionWindowsCount:null,peerMatchedKillConversionRate=peerMatchedKillConversionWindows?100*peerMatchedKillConversions/peerMatchedKillConversionWindows:null,opponentKillConversionRate=oppKillConversionWindows?100*oppKillConversions/oppKillConversionWindows:null,opponentTeamKillConversionRate=oppKillConversionWindows?100*oppTeamKillConversions/oppKillConversionWindows:null,killConversionDelta=hasNum(peerMatchedKillConversionRate)&&hasNum(opponentKillConversionRate)?Number(peerMatchedKillConversionRate)-Number(opponentKillConversionRate):null;
  const outperform=(list:any[],fn:(g:any)=>any,invert=false)=>{const xs=list.filter(g=>hasNum(fn(g)));return xs.length?100*xs.filter(g=>invert?Number(fn(g))<0:Number(fn(g))>0).length/xs.length:null;};
  const peerGoldWin=outperform(lane15,g=>g.goldDiff15),peerCsWin=outperform(peerGames,g=>g.peer.csMinDelta),peerDpmWin=outperform(peerGames,g=>g.peer.dpmDelta),peerVpmWin=outperform(peerGames,g=>g.peer.vpmDelta),peerItemFaster=outperform(itemGames,g=>g.itemSpikeDeltaVsOpponent,true);
  const wl=(winList:any[],lossList:any[],fn:(g:any)=>any)=>{const w=finiteGames(winList,fn),l=finiteGames(lossList,fn);return{wins:meanField(w,fn),losses:meanField(l,fn),winsN:w.length,lossesN:l.length};};
  const laneWins=lane15ComparableGames.filter(g=>g?.outcomeCompromised!==true&&g.win),laneLosses=lane15ComparableGames.filter(g=>g?.outcomeCompromised!==true&&!g.win),laneWl=(fn:(g:any)=>any)=>wl(laneWins,laneLosses,fn);
  const pooledEventRate=(list:any[],numFn:(g:any)=>any,denFn:(g:any)=>any)=>{const denominator=list.reduce((n:number,g:any)=>n+Number(denFn(g)||0),0),numerator=list.reduce((n:number,g:any)=>n+Number(numFn(g)||0),0);return{rate:denominator?100*numerator/denominator:null,numerator,denominator,games:list.filter((g:any)=>Number(denFn(g)||0)>0).length,aggregation:"pooled_events"};};
  const pooledObjectivePresence=(list:any[])=>pooledEventRate(list,g=>g.objectiveContestJoined,g=>g.objectiveContestTotal);
  const pooledSecuredObjectivePresence=(list:any[])=>pooledEventRate(list,g=>g.objectiveJoined,g=>g.objectiveTeamTotal);
  const pooledEarlyKp=(list:any[])=>pooledEventRate(list,g=>g.earlyPlayerKillInvolvements,g=>g.earlyTeamKills);
  const winObjWins=pooledObjectivePresence(wins),winObjLosses=pooledObjectivePresence(losses),winSecuredObjWins=pooledSecuredObjectivePresence(wins),winSecuredObjLosses=pooledSecuredObjectivePresence(losses),winEarlyWins=pooledEarlyKp(wins),winEarlyLosses=pooledEarlyKp(losses),gameObjectivePresenceWl=wl(wins,losses,g=>g.timelineAvailable===true?g.objectiveContestPresenceRate:null);
  const winLoss={goldDiff15:laneWl(g=>g.goldDiff15),dpm:wl(wins,losses,g=>g.dpm),badDeaths:wl(wins,losses,g=>g.timelineAvailable===true?g.badDeathCount:null),earlyKp:{wins:winEarlyWins.rate,losses:winEarlyLosses.rate,winsEvidence:winEarlyWins,lossesEvidence:winEarlyLosses,aggregation:"pooled_events"},objectiveJoin:{wins:winObjWins.rate,losses:winObjLosses.rate,winsEvidence:winObjWins,lossesEvidence:winObjLosses,aggregation:"pooled_team_contested_events"},objectiveJoinGameMean:{...gameObjectivePresenceWl,aggregation:"mean_games"},securedObjectiveJoin:{wins:winSecuredObjWins.rate,losses:winSecuredObjLosses.rate,winsEvidence:winSecuredObjWins,lossesEvidence:winSecuredObjLosses,aggregation:"pooled_team_secured_events"},greedyStays:wl(wins,losses,g=>g.timelineAvailable===true?g.greedyStayWindows?.length:null),itemDelta:wl(wins,losses,g=>g.directPeerComparable===true?g.itemSpikeDeltaVsOpponent:null)};
  const phaseRisk:any={};
  for(const phase of["early","mid","late"]){
    const phaseGames=validTimeline.filter((g:any)=>(g.phaseRules?.phaseComparable!==false)&&phaseExposureMinutes(g.durationMinutes,phase,g.phaseRules||STANDARD_SR_2026_RULES)>0),exposureMinutes=phaseGames.reduce((n:number,g:any)=>n+phaseExposureMinutes(g.durationMinutes,phase,g.phaseRules||STANDARD_SR_2026_RULES),0);
    const total=(field:string)=>phaseGames.reduce((n:number,g:any)=>n+Number(g.phaseBehavior?.[phase]?.[field]||0),0);
    const deaths=total("deaths"),highRiskDeaths=total("highRiskDeaths"),costlyDeaths=total("costlyDeaths"),severeDeaths=total("severeDeaths"),killAssistImpacts=total("killAssistImpacts"),objectiveJoins=total("objectiveJoins"),fightClusters=total("fightClusters"),firstAllyFightDeaths=total("firstAllyFightDeaths"),per10=(n:number)=>exposureMinutes>0?10*n/exposureMinutes:null;
    phaseRisk[phase]={games:phaseGames.length,exposureMinutes,deaths,highRiskDeaths,costlyDeaths,severeDeaths,killAssistImpacts,objectiveJoins,fightClusters,firstAllyFightDeaths,highRiskDeathsPer10Min:per10(highRiskDeaths),costlyDeathsPer10Min:per10(costlyDeaths),severeDeathsPer10Min:per10(severeDeaths),highRiskDeathsPerGame:phaseGames.length?highRiskDeaths/phaseGames.length:null,costlyDeathsPerGame:phaseGames.length?costlyDeaths/phaseGames.length:null,severeDeathsPerGame:phaseGames.length?severeDeaths/phaseGames.length:null,firstAllyFightDeathRate:fightClusters?100*firstAllyFightDeaths/fightClusters:null};
  }
  const recent5=games.slice(0,5),prior15=games.slice(5,20);
  const trendMetric=(fn:(g:any)=>any)=>({recent:meanField(finiteGames(recent5,fn),fn),prior:meanField(finiteGames(prior15,fn),fn),recentN:finiteGames(recent5,fn).length,priorN:finiteGames(prior15,fn).length,aggregation:"mean_games"});
  const trendEventRate=(numFn:(g:any)=>any,denFn:(g:any)=>any)=>{const recent=pooledEventRate(recent5,numFn,denFn),prior=pooledEventRate(prior15,numFn,denFn);return{recent:recent.rate,prior:prior.rate,recentN:recent.games,priorN:prior.games,recentEvents:recent.denominator,priorEvents:prior.denominator,recentNumerator:recent.numerator,priorNumerator:prior.numerator,aggregation:"pooled_events"};};
  const trendGameMeanWithEvents=(valueFn:(g:any)=>any,eventFn:(g:any)=>any)=>{const build=(list:any[])=>{const valid=finiteGames(list,valueFn),events=list.reduce((n:number,g:any)=>n+Number(eventFn(g)||0),0);return{value:meanField(valid,valueFn),games:valid.length,events};},recent=build(recent5),prior=build(prior15);return{recent:recent.value,prior:prior.value,recentN:recent.games,priorN:prior.games,recentEvents:recent.events,priorEvents:prior.events,aggregation:"mean_games_with_event_coverage"};};
  const recentSupportAdcLaneCost=(g:any)=>{const xs=(g?.roams?.events||[]).map((x:any)=>x?.adcLaneCostCs).filter(hasNum).map(Number);return xs.length?avg(xs):null;},supportAdcLaneWindowCount=(g:any)=>(g?.roams?.events||[]).filter((x:any)=>hasNum(x?.adcLaneCostCs)).length;
  const recentTrend={
    csMin:trendMetric(g=>g.csMin),
    dpm:trendMetric(g=>g.dpm),
    kp:trendMetric(g=>g.kp),
    goldDiff15:trendMetric(g=>g.directPeerComparable===true&&g?.phaseRules?.lane15Comparable!==false?g.goldDiff15:null),
    peerCsMinDelta:trendMetric(g=>g.directPeerComparable===true?g.peer?.csMinDelta:null),
    peerDpmDelta:trendMetric(g=>g.directPeerComparable===true?g.peer?.dpmDelta:null),
    peerDeathsDelta:trendMetric(g=>g.directPeerComparable===true?g.peer?.deathsDelta:null),
    peerKpDelta:trendMetric(g=>g.directPeerComparable===true?g.peer?.kpDelta:null),
    impactDelta:trendMetric(g=>g.directPeerComparable===true?g.impactDeltaVsOpponent:null),
    itemDelta:trendMetric(g=>g.directPeerComparable===true?g.itemSpikeDeltaVsOpponent:null),
    badDeaths:trendMetric(g=>g.timelineAvailable===true?g.badDeathCount:null),
    preObjectiveSideLaneDeaths:trendMetric(g=>g.timelineAvailable===true?Number(g.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths||0):null),
    earlyLeadGiveback:trendEventRate(
      g=>g.directPeerComparable===true&&g?.phaseRules?.lane15Comparable!==false&&g.earlyLeadWindow?.eligible&&g.earlyLeadWindow?.giveback?1:0,
      g=>g.directPeerComparable===true&&g?.phaseRules?.lane15Comparable!==false&&g.earlyLeadWindow?.eligible?1:0
    ),
    roamConversion:trendEventRate(g=>g.roams?.successes,g=>g.roams?.attempts),
    supportAdcLaneCost:trendGameMeanWithEvents(recentSupportAdcLaneCost,supportAdcLaneWindowCount),
    visionActionDeath:trendEventRate(g=>g.visionMission?.deaths,g=>g.visionMission?.actions),
    objectiveSetup:trendGameMeanWithEvents(
      g=>Number(g.objectiveReadiness?.contestedJoined||0)>0?100*Number(g.objectiveReadiness?.earlySetupJoins||0)/Number(g.objectiveReadiness.contestedJoined):null,
      g=>g.objectiveReadiness?.contestedJoined
    ),
    objectiveJoin:trendGameMeanWithEvents(
      g=>Number(g.objectiveContestTotal||0)>0?100*Number(g.objectiveContestJoined||0)/Number(g.objectiveContestTotal):null,
      g=>g.objectiveContestTotal
    ),
    securedObjectiveJoin:trendEventRate(g=>g.objectiveJoined,g=>g.objectiveTeamTotal),
    earlyKp:trendEventRate(g=>g.earlyPlayerKillInvolvements,g=>g.earlyTeamKills)
  };
  const objectivePresenceEvidenceReady=neutralObjectiveEvents>=5&&objectiveContestGames>=3,objectivePresenceLow=["JUNGLE","SUPPORT"].includes(primaryRole)&&objectivePresenceEvidenceReady&&hasNum(objectiveCoachingPresenceRate)&&Number(objectiveCoachingPresenceRate)<50,objectiveRootCauses:any[]=[];
  if(neutralObjectiveJoins>=5&&objectiveSetupGames>=3&&hasNum(objectiveSetupCoachingRate)){
    const setupThreshold=["SUPPORT","JUNGLE","MID"].includes(primaryRole)?45:30;
    if(Number(objectiveSetupCoachingRate)<setupThreshold)push(recentFocus,"objective setup","You attend objectives, but setup is often reactive","Mean per-game prior-setup rate is "+Number(objectiveSetupCoachingRate).toFixed(0)+"% across "+objectiveSetupGames+" games; pooled encounter evidence is "+earlySetupObjectiveJoins+"/"+neutralObjectiveJoins+" joined encounters, with "+eventFrameOnlyObjectiveJoins+" event-frame-only joins.","Shift the preceding wave/reset/path decision earlier. The goal is to arrive with time to establish position and information, not merely to be present when the objective dies.","medium",2,"equal-weight per-game prior-position setup 45–105 seconds before team-contested objective joins with pooled encounter traceability");
    else if(Number(objectiveSetupCoachingRate)>=70)push(highlights,"objective setup","You are often established before neutral objectives","Mean per-game prior-setup rate is "+Number(objectiveSetupCoachingRate).toFixed(0)+"% across "+objectiveSetupGames+" games; pooled encounter evidence is "+earlySetupObjectiveJoins+"/"+neutralObjectiveJoins+".","Preserve the early arrival pattern and use the extra time for vision, angles and safer contest positioning.","medium",4,"equal-weight per-game prior-position setup 45–105 seconds before team-contested objective joins with pooled encounter traceability");
  }
  if(objectivePresenceLow){
    // Objective clues do not share a common numeric unit. Rank by evidence specificity first,
    // then by within-clue magnitude, rather than comparing percentages, counts and pp gaps as one "severity" scale.
    if(recentShopObjectiveAbsences>=2&&recentShopObjectiveAbsenceGames>=2)objectiveRootCauses.push({key:"recent_shop_absence",label:"recent-shop absence pattern",evidence:recentShopObjectiveAbsences+" objective absence(s) within 60s of a detected shop visit across "+recentShopObjectiveAbsenceGames+" games",evidenceClass:"timing_association",evidencePriority:1,magnitude:recentShopObjectiveAbsenceRate||0,interpretation:"association_not_proven_cause"});
    if(preObjDeaths>=2&&preObjectiveDeathGames>=2)objectiveRootCauses.push({key:"pre_objective_death",label:"death before the contest",evidence:preObjDeaths+" deaths across "+preObjectiveDeathGames+" games followed by an enemy-secured, team-contested neutral objective inside the evidence window",evidenceClass:"direct_event_sequence",evidencePriority:3,magnitude:preObjDeathPct||0});
    if(visionSetupGames.length>=5&&visionWardTotal>=20&&opponentVisionWardTotal>=20&&hasNum(objectiveSetupWardRateDelta)&&Number(objectiveSetupWardRateDelta)<=-10)objectiveRootCauses.push({key:"setup_vision",label:"setup-vision share",evidence:signedText(objectiveSetupWardRateDelta,0)+" pp setup-ward-rate delta vs role peers across "+visionSetupGames.length+" comparable games",evidenceClass:"peer_relative_gap",evidencePriority:2,magnitude:Math.abs(Number(objectiveSetupWardRateDelta))});
    objectiveRootCauses.sort((a:any,b:any)=>Number(b.evidencePriority||0)-Number(a.evidencePriority||0)||Number(b.magnitude||0)-Number(a.magnitude||0)||String(a.key).localeCompare(String(b.key)));
  }
  const objectivePrimaryCause=objectiveRootCauses[0]||null;

  if(["ADC","MID","TOP"].includes(primaryRole)&&soloKillResetEvents.length>=3){
    if(soloKillDeathsBeforeShop>=2&&Number(soloKillDeathsBeforeShopRate)>=35)push(recentFocus,"post-kill reset","Clean solo kills are sometimes lost before you bank them",soloKillDeathsBeforeShop+" of "+soloKillResetEvents.length+" measured early-phase solo kills were followed by your death before the next detected shop visit ("+Number(soloKillDeathsBeforeShopRate).toFixed(0)+"%). Average time to the next detected shop is "+(hasNum(avgSoloKillNextShopDelaySec)?Math.round(Number(avgSoloKillNextShopDelaySec))+"s":"n/a")+".","After the kill, make the wave/reset decision explicit: crash or deny what is safe, then bank the gold before taking another high-variance trade or rotation.","medium",1,"clean early-phase solo kill → next detected shop/death order");
    else if(soloKillResetEvents.length>=4&&soloKillDeathsBeforeShop===0)push(highlights,"post-kill reset","You consistently bank clean solo-kill advantages safely",soloKillResetEvents.length+" measured early-phase solo kills all reached the next detected shop visit without you dying first.","Preserve the post-kill wave and reset discipline; combine it with the @15 conversion metric to check whether those safe resets also create durable lane economy.","medium",4,"clean early-phase solo kill → next detected shop/death order");
  }
  if(["TOP","MID","ADC"].includes(primaryRole)&&soloKillStructureWindows>=4){
    if(Number(soloKillStructureConversionRate)<35)push(recentFocus,"lane conversion","Clean solo kills are not becoming enough structure pressure",soloKillStructureConversions+" of "+soloKillStructureWindows+" early-phase clean solo-kill windows ("+Number(soloKillStructureConversionRate).toFixed(0)+"%) are followed by supported plate/turret involvement within 90 seconds.","After winning the duel, prioritize the wave first and take structure value only when the crash/timing is safe; otherwise bank the kill gold. The goal is deliberate conversion, not greed for every plate.",conf(soloKillStructureWindows),2,"supported plate/turret involvement within 90s of clean early-phase role-opponent solo kill");
    else if(Number(soloKillStructureConversionRate)>=65)push(highlights,"lane conversion","You frequently turn clean solo kills into structure pressure",soloKillStructureConversions+" of "+soloKillStructureWindows+" early-phase clean solo-kill windows ("+Number(soloKillStructureConversionRate).toFixed(0)+"%) produce supported turret/plate pressure within 90 seconds.","Preserve the post-kill wave control that lets you cash the duel without overstaying.","medium",4,"supported plate/turret involvement within 90s of clean early-phase role-opponent solo kill");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&soloKillConversionEvents.length>=3){
    if((hasNum(soloKillConversionRate)&&Number(soloKillConversionRate)<50)||(hasNum(avgSoloKillGoldSwingTo15)&&Number(avgSoloKillGoldSwingTo15)<150))push(recentFocus,"lane conversion","Clean solo kills are not becoming enough lane economy",soloKillConvertedEvents.length+" of "+soloKillConversionEvents.length+" conversion-eligible early solo kills improved direct-role gold differential by at least 200g by 15; average swing is "+(hasNum(avgSoloKillGoldSwingTo15)?signedText(avgSoloKillGoldSwingTo15,0)+"g":"n/a")+(hasNum(avgSoloKillCsSwingTo15)?" and "+signedText(avgSoloKillCsSwingTo15,1)+" CS":"")+".","Review the 30–90 seconds after the solo kill: wave crash/deny, recall timing and return path are where the mechanical win becomes—or fails to become—a lasting lead.",conf(soloKillConversionEvents.length),1,"standard-SR conversion-eligible early duel state → true @15 checkpoint");
    else if(hasNum(soloKillConversionRate)&&Number(soloKillConversionRate)>=75&&hasNum(avgSoloKillGoldSwingTo15)&&Number(avgSoloKillGoldSwingTo15)>=300)push(highlights,"lane conversion","You reliably convert clean solo kills into durable lane economy",soloKillConvertedEvents.length+" of "+soloKillConversionEvents.length+" conversion-eligible early solo kills create at least +200g of additional direct-role differential by 15; average swing is "+signedText(avgSoloKillGoldSwingTo15,0)+"g.","Preserve the post-kill wave/reset pattern; the next question is whether that lead survives the 15→25 transition.","medium",4,"standard-SR conversion-eligible early duel state → true @15 checkpoint");
  }
  if(["TOP","MID","ADC","SUPPORT"].includes(primaryRole)&&earlyClassifiedHomeLaneDeaths>=4&&earlyClassifiedHomeLaneDeathGames>=3&&earlyOutsidePressureDeaths>=3&&earlyOutsidePressureDeathGames>=2&&Number(earlyOutsidePressureShare)>=60)push(recentFocus,"map awareness","Most classified early home-lane deaths involve outside pressure",earlyOutsidePressureDeaths+" of "+earlyClassifiedHomeLaneDeaths+" classified early-phase home-lane deaths across "+earlyClassifiedHomeLaneDeathGames+" affected games ("+Math.round(Number(earlyOutsidePressureShare))+"%) involved at least one enemy beyond ordinary lane opposition, with outside pressure appearing in "+earlyOutsidePressureDeathGames+" games."+(earlyUnclassifiedHomeLaneDeaths?" "+earlyUnclassifiedHomeLaneDeaths+" additional home-lane death(s) were excluded because ordinary lane opposition could not be resolved.":""),"Treat this separately from ordinary lane mechanics: tighten wave depth when enemy positions are unknown, place vision before the vulnerable wave arrives, and track likely jungle/roam timing before committing to trades.",conf(earlyClassifiedHomeLaneDeathGames),1,"queue-aware early-phase home-lane death participants repeated across games; only deaths with resolvable ordinary lane opposition enter the rate");
  if(["ADC","MID","TOP"].includes(primaryRole)&&directPeerTimelineGames>=5&&earlyRoleSoloDeaths>=3&&earlyRoleSoloDeathGames>=2&&earlyRoleSoloDeaths>=earlyRoleSoloKills+2)push(recentFocus,"laning","Clean 1v1 lane deaths to your direct counterpart recur across games",earlyRoleSoloKills+" early solo kill(s) versus "+earlyRoleSoloDeaths+" early solo death(s) against the same-role opponent, with solo deaths appearing in "+earlyRoleSoloDeathGames+" of "+directPeerTimelineGames+" timeline-complete games with a trusted direct peer. Kills with assisting participants are excluded.","Prioritize matchup-specific review: identify which cooldown/resource/wave conditions precede the solo deaths and define a clear disengage threshold for those states.",conf(earlyRoleSoloDeathGames),1,"clean queue-aware early-phase solo kills/deaths repeated across actual same-role opponent games");
  else if(["ADC","MID","TOP"].includes(primaryRole)&&directPeerTimelineGames>=5&&earlyRoleSoloKills>=3&&earlyRoleSoloKillGames>=2&&earlyRoleSoloKills>=earlyRoleSoloDeaths+2)push(highlights,"laning","Direct 1v1 lane duels are a repeated strength",earlyRoleSoloKills+" early solo kill(s) versus "+earlyRoleSoloDeaths+" early solo death(s) against the same-role opponent, with solo kills appearing in "+earlyRoleSoloKillGames+" of "+directPeerTimelineGames+" timeline-complete games with a trusted direct peer, excluding assisted kills.","Preserve the matchup-specific trade discipline that creates these clean advantages; the next step is converting them into wave, reset and objective value.",conf(earlyRoleSoloKillGames),4,"clean queue-aware early-phase solo kills/deaths repeated across actual same-role opponent games");
  if(["ADC","MID","TOP"].includes(primaryRole)&&lane15.length>=5){
    if(Number(avgG15)<=-250)push(recentFocus,"laning","Early-lane economy is the clearest leak","Across "+lane15.length+" comparable games you average "+Math.round(Number(avgG15))+" gold and "+Math.round(Number(avgC15||0))+" CS versus the same-role opponent at 15; you are ahead in only "+Math.round(Number(laneAhead||0))+"% of them.","Prioritize wave access and lower-cost trades before 15 minutes; this is a direct opponent comparison, not a generic benchmark.",conf(lane15.length),1,"same-role opponents");
    else if(Number(avgG15)>=250)push(highlights,"laning","You are consistently creating lane economy","You average +"+Math.round(Number(avgG15))+" gold versus the same-role opponent at 15 across "+lane15.length+" games.","The next improvement lever is converting that lead into earlier objectives and cleaner resets.",conf(lane15.length),3,"same-role opponents");
    if(earlyLeadGames.length>=4&&earlyLeadGivebackGames.length>=2&&Number(earlyLeadGivebackRate)>=50)push(recentFocus,"lane conversion","Early role leads are repeatedly bleeding out before 15",earlyLeadGivebackGames.length+" of "+earlyLeadGames.length+" games where you reached at least +500g versus the direct role opponent before 15 lost at least 500g of that differential by the 15-minute checkpoint ("+Number(earlyLeadGivebackRate).toFixed(0)+"%). Average peak was "+signedText(avgEarlyLeadPeakGold,0)+"g and average loss from peak to 15 was "+Math.round(Number(avgEarlyLeadLostGold||0))+"g; the give-back games contain "+earlyLeadGivebackDeaths+" death(s) after the peak, "+earlyLeadGivebackHighRiskDeaths+" high-risk.","Review the peak→15 segment rather than only the final lane score: protect the next wave/reset, lower risk after earning the advantage, and check whether movement away from lane is actually buying value. Deaths are context, not assumed causes.",conf(earlyLeadGames.length),1,"per-game peak direct-role gold lead before 15 → true @15 checkpoint");
    else if(earlyLeadGames.length>=5&&Number(earlyLeadGivebackRate)<=20&&hasNum(avgEarlyLeadGoldSwingTo15)&&Number(avgEarlyLeadGoldSwingTo15)>=-250)push(highlights,"lane conversion","You usually preserve meaningful early role leads through 15",earlyLeadPreservedGames.length+" of "+earlyLeadGames.length+" ≥+500g pre-15 lead opportunities preserve all but 250g of the peak through 15; only "+earlyLeadGivebackGames.length+" lose at least 500g.","Preserve the wave/reset/risk sequence that keeps earned lane economy intact, then use the 15→25 model to judge the next conversion step.","medium",4,"per-game peak direct-role gold lead before 15 → true @15 checkpoint");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&laneLeads.length>=4&&Number(laneLeadWr)<50)push(recentFocus,"conversion","Lane leads are not becoming enough wins","When you are at least +250g versus the direct role opponent at 15, you win only "+Math.round(Number(laneLeadWr))+"% of those "+laneLeads.length+" games.","After creating the lead, spend it before the next neutral objective and avoid low-value side fights that give shutdown/tempo back.",conf(laneLeads.length),1,"lead-to-win conversion");
  else if(["ADC","MID","TOP"].includes(primaryRole)&&laneLeads.length>=4&&Number(laneLeadWr)>=65)push(highlights,"conversion","You convert lane leads into wins well","You win "+Math.round(Number(laneLeadWr))+"% of the "+laneLeads.length+" games where you are at least +250g versus your role opponent at 15.","Keep repeating the post-15 macro choices that turn the advantage into objectives and map control.",conf(laneLeads.length),3,"lead-to-win conversion");
  if(["ADC","MID","TOP"].includes(primaryRole)&&laneDeficits.length>=4&&Number(laneDeficitWr)>=45)push(highlights,"recovery","You recover from lane deficits unusually often in this sample","You still win "+Math.round(Number(laneDeficitWr))+"% of "+laneDeficits.length+" games where you are at least 250g behind the role opponent at 15.","Preserve the low-variance recovery habits rather than forcing desperate fights when behind.",conf(laneDeficits.length),4,"deficit-to-win recovery");
  if(["ADC","MID","TOP"].includes(primaryRole)&&lead25Games.length>=4){
    if(Number(lead25WinRate)<55&&lead25Losses>=2){
      if(lead25LossesWithLateRisk>=2)push(recentFocus,"closing","Late risk is recurring in losses from 25-minute role advantages",lead25Wins+" wins from "+lead25Games.length+" games where you are at least +500g versus the direct role opponent at 25 ("+Number(lead25WinRate).toFixed(0)+"%); "+lead25LossesWithLateRisk+" of "+lead25Losses+" losses contain a late high-risk or costly-death event, totaling "+lateHighRiskDeathsInLead25Losses+" high-risk and "+lateCostlyDeathsInLead25Losses+" costly late-death events.","When the role matchup is ahead at 25, make late objective setup and first-death prevention the priority. Preserve the advantage long enough for it to influence the team fight or objective instead of reopening the game through avoidable late risk.",conf(lead25Games.length),1,"final result after ≥+500g same-role gold differential @25, with late death evidence");
      else push(recentFocus,"closing","25-minute role advantages are not closing often enough",lead25Wins+" wins from "+lead25Games.length+" games where you are at least +500g versus the direct role opponent at 25 ("+Number(lead25WinRate).toFixed(0)+"%). The available late-death evidence does not support assigning one recurring cause.","Review the 25+ minute conversion sequence across these losses: objective setup, side-wave timing, reset timing and whether your role advantage is present for the decisive map event.",conf(lead25Games.length),2,"final result after ≥+500g same-role gold differential @25");
    }else if(Number(lead25WinRate)>=75)push(highlights,"closing","You usually close games when the role matchup is ahead at 25",lead25Wins+" wins from "+lead25Games.length+" games where you are at least +500g versus the direct role opponent at 25 ("+Number(lead25WinRate).toFixed(0)+"%).","Preserve the late-game decisions that turn the role-relative advantage into objectives and fight control.","medium",4,"final result after ≥+500g same-role gold differential @25");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&deficit25Games.length>=4&&Number(deficit25WinRate)>=40)push(highlights,"late recovery","You still recover some games from a 25-minute role deficit",deficit25Wins+" wins from "+deficit25Games.length+" games where you are at least 500g behind the direct role opponent at 25 ("+Number(deficit25WinRate).toFixed(0)+"%).","Preserve the low-variance late recovery patterns that keep the game playable while the role matchup is behind.","medium",4,"final result after ≤-500g same-role gold differential @25");
  if(["ADC","MID","TOP"].includes(primaryRole)&&midRoutingGames.length>=4){
    if(inefficientMidRoutingGames>=2)push(recentFocus,"mid routing","Mid-game movement is losing both farm and objective presence",inefficientMidRoutingGames+" of "+midRoutingGames.length+" comparable primary-role games lose at least 8 CS of direct-role differential from 15→25 while also showing under 50% presence at tracked neutral-objective encounters in that routing window. Across the sample, CS swing is "+(hasNum(avgMidRoutingCsSwing)?signedText(avgMidRoutingCsSwing,1):"n/a")+" and objective presence is "+(hasNum(coachingMidRoutingObjectivePresenceRate)?Number(coachingMidRoutingObjectivePresenceRate).toFixed(0)+"%":"n/a")+".","Audit 15–25 minute pathing decision by decision: either collect the safe wave or arrive early enough for the objective movement to create value; avoid spending the window moving without securing either.","medium",1,"same-role CS swing plus 15–25 team-contested objective attendance");
    else if(balancedMidRoutingGames>=Math.max(3,Math.ceil(midRoutingGames.length*0.5)))push(highlights,"mid routing","You often collect mid-game farm without abandoning objective presence",balancedMidRoutingGames+" of "+midRoutingGames.length+" comparable games gain at least 8 CS of role-relative farm from 15→25 while maintaining at least 60% tracked objective presence.","Preserve the routing sequence that lets you catch side resources and still arrive for valuable map events.","medium",4,"same-role CS swing plus 15–25 team-contested objective attendance");
    if(sideFarmLowPresenceGames>=2)push(recentFocus,"mid routing","Some side-lane gains come with very low objective attendance",sideFarmLowPresenceGames+" of "+midRoutingGames.length+" comparable games gain at least 8 CS versus the role opponent but show under 35% presence across at least two tracked neutral-objective encounters from 15–25.","Keep the farm when the objective is intentionally conceded; otherwise start the rotation earlier so resource collection does not become accidental absence.","medium",2,"same-role CS gain versus 15–25 neutral-objective attendance");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&midgameCsGames.length>=4&&hasNum(avgCsSwing15to25)){
    if(Number(avgCsSwing15to25)<=-8)push(recentFocus,"mid game","Mid-game routing is losing role-relative farm","Across "+midgameCsGames.length+" comparable games, your CS differential versus the same-role opponent worsens by "+Math.abs(Number(avgCsSwing15to25)).toFixed(1)+" CS on average from 15 to 25 minutes.","Audit the waves you skip between 15 and 25: collect safe side waves before grouping, and distinguish required objective movement from movement that only shadows teammates.",conf(midgameCsGames.length),2,"same-role CS differential from 15→25");
    else if(Number(avgCsSwing15to25)>=8)push(highlights,"mid game","Your 15→25 farm routing gains ground on the role opponent","Across "+midgameCsGames.length+" comparable games, you improve direct-role CS differential by "+Number(avgCsSwing15to25).toFixed(1)+" CS on average from 15 to 25.","Keep the routing, while verifying that the extra waves do not make you late to high-value objective/fight windows.",conf(midgameCsGames.length),4,"same-role CS differential from 15→25");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&leadMidgame.length>=4&&Number(leadSwing15to25)<=-500)push(recentFocus,"mid game","Leads are eroding between 15 and 25","In "+leadMidgame.length+" games where you are at least +250g at 15, your direct-role gold differential falls by "+Math.abs(Math.round(Number(leadSwing15to25)))+"g on average by 25.","Treat the first 15→25 macro rotation as a decision window: collect safe side waves, buy before objectives, and avoid low-value fights that hand tempo back.",conf(leadMidgame.length),1,"same-role gold differential from 15→25");
  else if(["ADC","MID","TOP"].includes(primaryRole)&&leadMidgame.length>=4&&Number(leadSwing15to25)>=250)push(highlights,"mid game","You tend to extend lane leads through the first rotations","When at least +250g at 15, you add another "+Math.round(Number(leadSwing15to25))+"g versus the role opponent by 25 on average across "+leadMidgame.length+" games.","Keep the side-lane/reset/objective sequence that preserves and compounds the advantage.",conf(leadMidgame.length),4,"same-role gold differential from 15→25");
  if(["ADC","MID","TOP"].includes(primaryRole)&&deficitMidgame.length>=4&&Number(deficitSwing15to25)>=500)push(highlights,"mid game","Your mid-game recovery is a real strength","From games at least 250g behind at 15, you recover "+Math.round(Number(deficitSwing15to25))+"g of direct-role differential by 25 on average.","Preserve the low-risk recovery pattern rather than forcing early comeback fights.","medium",4,"same-role gold differential from 15→25");
  if(impactGames.length>=5&&["JUNGLE","SUPPORT","MID"].includes(primaryRole)){
    if(Number(avgImpactDelta)>=1.5)push(recentFocus,"early impact","First map impact trails your direct role opponent","Across "+impactGames.length+" comparable games, your first tracked impact comes "+Number(avgImpactDelta).toFixed(1)+" minutes later on average, and you act first in "+Math.round(Number(impactEarlierPct||0))+"% of games.","Review the first move window—lane priority, jungle path, river setup or recall timing—rather than trying to compensate with later forced plays.",conf(impactGames.length),1,"first kill/assist/objective impact vs same-role opponent");
    else if(Number(avgImpactDelta)<=-1.5)push(highlights,"early impact","You tend to influence the map before your counterpart","Across "+impactGames.length+" comparable games, your first tracked impact comes "+Math.abs(Number(avgImpactDelta)).toFixed(1)+" minutes earlier on average.","Preserve the early setup while checking that the move does not cost too much lane economy.","medium",4,"first kill/assist/objective impact vs same-role opponent");
  }
  if(itemSpikeEligibleWindows>=4){
    if(Number(itemSpikeUtilizationRate)<50)push(recentFocus,"item spike","Earlier item completions are not turning into enough immediate impact",itemSpikeUtilizedWindows+" of "+itemSpikeEligibleWindows+" measurable first-major-item advantage windows produced a tracked kill/assist or nearby team-objective impact before the direct role opponent completed theirs; "+itemSpikeDeathsBeforeImpact+" ended with your death before any such impact.","Treat the earlier completion as a temporary deadline: leave base with a specific lane, objective or fight to pressure before the opponent reaches item parity.",conf(itemSpikeEligibleWindows),1,"first-major-item completion advantage window vs direct role opponent");
    else if(Number(itemSpikeUtilizationRate)>=75)push(highlights,"item spike","You reliably use earlier major-item windows",itemSpikeUtilizedWindows+" of "+itemSpikeEligibleWindows+" measurable earlier-item windows ("+Number(itemSpikeUtilizationRate).toFixed(0)+"%) produced tracked impact before role-opponent item parity.","Keep converting the purchase timing into immediate map pressure rather than merely owning the item earlier.","medium",4,"first-major-item completion advantage window vs direct role opponent");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&firstResetCleanGames.length>=4&&hasNum(firstResetLossRate)){
    if(Number(firstResetLossRate)>=50)push(recentFocus,"resets","First shop sequences are repeatedly losing lane economy",firstResetLossGames.length+" of "+firstResetCleanGames.length+" clean measured first-shop sequences ("+Number(firstResetLossRate).toFixed(0)+"%) lose at least 6 CS or 350g of direct-role differential by the next supported frame. Average swing: "+(hasNum(avgFirstResetGoldSwing)?signedText(avgFirstResetGoldSwing,0)+"g":"n/a")+" and "+(hasNum(avgFirstResetCsSwing)?signedText(avgFirstResetCsSwing,1)+" CS":"n/a")+".","Review wave preparation before the first meaningful shop and the return path. Do not optimize for an earlier recall timestamp by itself; optimize for spending without surrendering the next lane-economy window.",conf(firstResetCleanGames.length),1,"first post-start shop sequence vs direct-role economy");
    else if(firstResetCleanGames.length>=5&&Number(firstResetLossRate)<=20&&hasNum(avgFirstResetCsSwing)&&Number(avgFirstResetCsSwing)>=0)push(highlights,"resets","Your first shop sequencing is usually clean",firstResetGainGames.length+" positive and "+firstResetLossGames.length+" losing sequences across "+firstResetCleanGames.length+" clean measured games; average CS swing is "+signedText(avgFirstResetCsSwing,1)+".","Preserve the wave preparation and return timing; this is an early-game consistency strength.","medium",4,"first post-start shop sequence vs direct-role economy");
  }
  if(majorReadinessGames.length>=4&&hasNum(avgMajorCompletionDelayMin)){
    if(Number(avgMajorCompletionDelayMin)>=1.0&&delayedMajorCompletionGames.length>=2)push(recentFocus,"resets","Fundable first-major completions are being delayed","Across "+majorReadinessGames.length+" supported games, the first completed major item was bought "+Number(avgMajorCompletionDelayMin).toFixed(1)+" minutes after the first supported frame where its direct recipe was ready and the remaining combine cost was already covered; "+delayedMajorCompletionGames.length+" games had a delay of at least 1.5 minutes.","Use completed-item affordability as a reset checkpoint. Preserve wave/objective safety, but stop defaulting to one more sequence when the breakpoint is already fundable.",conf(majorReadinessGames.length),1,"recipe-aware current-gold threshold → actual completion purchase");
    else if(majorReadinessGames.length>=5&&Number(avgMajorCompletionDelayMin)<=0.5)push(highlights,"resets","You cash first-major completion windows quickly","Across "+majorReadinessGames.length+" supported games, the completed first major item followed its first supported affordability frame after only "+Number(avgMajorCompletionDelayMin).toFixed(1)+" minutes on average.","Preserve the recall/wave setup that converts gold into completed power promptly.","medium",4,"recipe-aware current-gold threshold → actual completion purchase");
  }
  if(itemGames.length>=4){
    if(Number(itemDelta)>=0.75)push(recentFocus,"resets","Major item timing is slower than your direct opponent","Your first major completed item lands "+Number(itemDelta).toFixed(1)+" minutes later on average across "+itemGames.length+" games; you are faster in only "+Math.round(Number(peerItemFaster||0))+"% of comparable games.","Look for earlier high-value recalls after accumulating gold; avoid staying for one extra wave when it delays a completed item.",conf(itemGames.length),1,"same-role major-item timing");
    else if(Number(itemDelta)<=-0.75)push(highlights,"resets","You usually hit the first major item before your counterpart","Your first major completed item arrives "+Math.abs(Number(itemDelta)).toFixed(1)+" minutes earlier on average across "+itemGames.length+" games.","Use that purchase window deliberately: contest the next wave, objective or fight while the opponent is still down a completion.",conf(itemGames.length),3,"same-role major-item timing");
  }
  if(validTimeline.length>=5&&behindStateDeaths>=4&&highRiskBehindDeaths>=3&&Number(highRiskBehindDeathRate)>=50)push(recentFocus,"risk when behind","High-risk deaths are compounding direct-role deficits",highRiskBehindDeaths+" of "+behindStateDeaths+" deaths taken while at least 500g behind the direct role opponent crossed the high-risk threshold ("+Number(highRiskBehindDeathRate).toFixed(0)+"%).","When your role matchup is behind, lower variance first: collect safe waves/camps, trade cross-map, and avoid isolated/deep entries that make the opponent's existing lead easier to convert.",conf(behindStateDeaths),1,"death quality while ≥500g behind the same-role opponent");
  else if(validTimeline.length>=5&&behindStateDeaths>=4&&Number(highRiskBehindDeathRate)<=25)push(highlights,"risk when behind","You show restraint when the direct role matchup is behind",highRiskBehindDeaths+" of "+behindStateDeaths+" deaths while at least 500g behind crossed the high-risk threshold ("+Number(highRiskBehindDeathRate).toFixed(0)+"%).","Keep the low-variance recovery discipline; the next improvement lever is finding safe resource and cross-map opportunities rather than forcing equal fights.","medium",4,"death quality while ≥500g behind the same-role opponent");
  if(repeatDeathOpportunities>=8&&repeatDeaths>=3&&(highRiskRepeatDeaths>=2||costlyRepeatDeaths>=2)){
    const peerPart=hasNum(opponentRepeatDeathRate)?" versus "+Number(opponentRepeatDeathRate).toFixed(0)+"% for the actual same-role opponents' equivalent repeat-death opportunities":"";
    push(recentFocus,"death recovery","Rapid repeat deaths are compounding mistakes",repeatDeaths+" of "+repeatDeathOpportunities+" death-to-next-death opportunities ("+Number(repeatDeathRate||0).toFixed(0)+"%) become another death within four minutes"+peerPart+"; "+highRiskRepeatDeaths+" repeat deaths are high-risk and "+costlyRepeatDeaths+" have measurable costly aftermath.","Treat the post-death window as a recovery protocol: spend, route to the safest guaranteed resource, rebuild information, and do not immediately contest the same area unless the state has materially changed.",conf(repeatDeathOpportunities),1,"second death within 4m of previous death, compared with direct role opponents");
  }else if(repeatDeathOpportunities>=8&&Number(repeatDeathRate)<=15&&(!hasNum(opponentRepeatDeathRate)||Number(repeatDeathRate)<=Number(opponentRepeatDeathRate))){
    push(highlights,"death recovery","You rarely turn one death into a second quick death",repeatDeaths+" of "+repeatDeathOpportunities+" opportunities ("+Number(repeatDeathRate||0).toFixed(0)+"%) become another death within four minutes"+(hasNum(opponentRepeatDeathRate)?" versus "+Number(opponentRepeatDeathRate).toFixed(0)+"% for direct role opponents":"")+".","Preserve the post-death reset discipline that prevents one mistake from becoming a sequence.","medium",4,"second death within 4m of previous death, compared with direct role opponents");
  }
  if(measuredDeathConsequences>=6&&severeDeathEvents>=3)push(recentFocus,"death consequences","The most expensive deaths are repeatedly losing additional map value",severeDeathEvents+" deaths show at least two follow-on consequence signals across "+measuredDeathConsequences+" measured deaths. Average direct-role change after measured deaths is "+(hasNum(avgGoldSwingAfterDeath)?signedText(avgGoldSwingAfterDeath,0)+"g":"n/a")+" and "+(hasNum(avgCsSwingAfterDeath)?signedText(avgCsSwingAfterDeath,1)+" CS":"n/a")+".","Prioritize eliminating the deaths with the largest aftermath: protect waves, reset before objective windows, and avoid entries that give the opponent both the kill and the next map resource.",conf(measuredDeathConsequences),1,"next supported timeline state + enemy objective conversion after each death");
  if(validTimeline.length>=5&&highRiskUntradedPostImpactDeaths>=3)push(recentFocus,"post-play discipline","Successful plays are too often followed by an immediate give-back",highRiskUntradedPostImpactDeaths+" high-risk untraded deaths occurred within 30 seconds after your own kill/assist contribution across "+validTimeline.length+" timeline-complete games.","Build a reset checkpoint after the first win in a skirmish: if the next target is not free, stop, spend/secure the objective, and make the opponent take the next risk.","medium",1,"death within 30s of own kill/assist contribution + high-risk + untraded");
  else if(playerImpactEvents>=12&&postImpactDeaths===0)push(highlights,"post-play discipline","You preserve value well after successful plays",playerImpactEvents+" tracked kill/assist contributions produced no death within the following 30 seconds.","Preserve the discipline of ending the play when the next chase is not clearly favorable.","medium",4,"death within 30s of own kill/assist contribution");
  if(validTimeline.length>=5&&preNeutralObjectiveSideLaneDeaths>=2)push(recentFocus,"side-lane timing","Side-lane deaths are colliding with neutral-objective windows",preNeutralObjectiveSideLaneDeaths+" isolated post-macro-transition side-lane deaths occurred within 90 seconds before a tracked neutral objective across "+validTimeline.length+" timeline-complete games.","Move the side-lane collection window earlier: push/collect, then leave enough time to reset and reconnect before the objective. If the objective is intentionally conceded, the death still removes the value of the side-lane trade.","medium",1,"post-macro-transition top/bot-lane death + no ally within 3k + team-contested neutral objective within 90s");
  else if(macroTransitionSideLaneDeaths>=5&&hasNum(isolatedSideLaneDeathRate)&&Number(isolatedSideLaneDeathRate)>=60)push(recentFocus,"side-lane timing","Most post-macro-transition side-lane deaths happen without nearby support",isolatedSideLaneDeaths+" of "+macroTransitionSideLaneDeaths+" post-macro-transition top/bot-lane deaths ("+Number(isolatedSideLaneDeathRate).toFixed(0)+"%) occur with no ally within 3,000 units.","Treat deep side-lane collection as a timed risk: track missing enemies, preserve an escape path, and leave before the map collapses onto you.","medium",2,"post-macro-transition side-lane death proximity");
  if(validTimeline.length>=5&&highRiskLeadDeaths>=3)push(recentFocus,"lead protection","Deaths while ahead are giving back earned advantages",highRiskLeadDeaths+" high-risk deaths occurred while you were at least +500g versus the direct role opponent across "+validTimeline.length+" timeline-complete games.","When you are ahead, make your risk threshold stricter: spend first, move with information, and force the opponent to take the risky play instead.",conf(validTimeline.length),1,"same-role gold advantage at death + multi-signal death quality");
  if(validTimeline.length>=5&&highRiskUntradedDeaths>=3)push(recentFocus,"deaths","High-risk deaths are frequently going untraded",highRiskUntradedDeaths+" high-risk deaths in the timeline sample received no nearby allied return kill within 15 seconds ("+Number(highRiskUntradedPerGame).toFixed(1)+" per game).","Reduce the entries that give the opponent free tempo. If you must take risk, prefer positions where teammates can immediately punish the enemy commitment.",conf(validTimeline.length),1,"nearby allied return kill within 15 seconds after death");
  if(validTimeline.length>=5&&(Number(badPer)>=0.8||Number(objDeathPct)>=25||unspent>=3))push(recentFocus,"deaths","Death quality is costing map tempo","The analyzer flags "+Number(badPer||0).toFixed(1)+" high-risk deaths per timeline game; "+Number(objDeathPct||0).toFixed(0)+"% of deaths occur in objective context, and "+unspent+" deaths happened with at least 1000 unspent gold.","Before major objectives, reset earlier and avoid entering deep/outnumbered positions without nearby teammates.",conf(validTimeline.length),1,"multi-signal timeline evidence");
  if(validTimeline.length>=5&&preObjDeaths>=3)push(recentFocus,"objectives","Deaths before enemy objective conversions recur",preObjDeaths+" deaths in the Last-20 timeline sample were followed by an enemy objective within 75 seconds ("+Number(preObjDeathPct||0).toFixed(0)+"% of deaths in comparable games).","Make the pre-objective minute a hard discipline window: recall earlier, move with teammates/vision, and do not face-check merely to establish setup.",conf(validTimeline.length),1,"death timestamp → enemy objective within 75 seconds");
  if(totalBadDeaths>=3&&topBadDeathZone&&Number(topBadDeathZonePct)>=50){
    const zoneAction=topBadDeathZone==="enemy jungle"?"Enter enemy jungle only with lane priority, teammate proximity or confirmed information; do not turn missing information into a forced invade.":topBadDeathZone==="river"?"Set river vision before walking into fog and move through contested river with teammates when an objective is approaching.":topBadDeathZone==="top lane"||topBadDeathZone==="mid lane"||topBadDeathZone==="bot lane"?"Respect side-lane depth and missing opponents; collect the wave without extending past the information your team actually has.":"Use the repeated location as a review cue: check what information and nearby support you had before committing.";
    push(recentFocus,"positioning","High-risk deaths cluster in "+topBadDeathZone,topBadDeathZoneCount+" of "+totalBadDeaths+" flagged high-risk deaths ("+Math.round(Number(topBadDeathZonePct))+"%) occur in "+topBadDeathZone+".",zoneAction,conf(totalBadDeaths),1,"spatial cluster of multi-signal high-risk deaths");
  }
  else if(validTimeline.length>=5&&Number(badPer)<0.35)push(highlights,"deaths","Your risk discipline is strong","Only "+Number(badPer||0).toFixed(1)+" deaths per timeline game meet the multi-signal bad-death heuristic.","Keep the same discipline while increasing pressure from your strongest windows.",conf(validTimeline.length),4,"multi-signal timeline evidence");
  if(Number(winLoss.badDeaths.winsN||0)>=4&&Number(winLoss.badDeaths.lossesN||0)>=4&&hasNum(winLoss.badDeaths.wins)&&hasNum(winLoss.badDeaths.losses)&&Number(winLoss.badDeaths.losses)-Number(winLoss.badDeaths.wins)>=0.5)push(recentFocus,"deaths","Avoidable-risk deaths distinguish your losses from your wins","Across "+winLoss.badDeaths.lossesN+" timeline-complete losses versus "+winLoss.badDeaths.winsN+" timeline-complete wins, you average "+Number(winLoss.badDeaths.losses).toFixed(1)+" flagged high-risk deaths in losses versus "+Number(winLoss.badDeaths.wins).toFixed(1)+" in wins.","Treat this as a controllable consistency lever: when a game starts going badly, reduce isolated/deep entries instead of trying to force recovery immediately.",conf(Math.min(Number(winLoss.badDeaths.winsN),Number(winLoss.badDeaths.lossesN))),1,"timeline-complete wins vs losses in your own sample");
  if(objectivePresenceLow){
    const causeText=objectiveRootCauses.length?objectiveRootCauses.map((x:any)=>x.evidence).join("; "):"no single shop/death/vision association crossed its evidence threshold";
    const action=objectivePrimaryCause?.key==="recent_shop_absence"
      ?"Test an earlier purchase deadline first: finish shopping with enough travel/setup time, then check whether recent-shop absences actually decline."
      :objectivePrimaryCause?.key==="pre_objective_death"
        ?"Treat the pre-objective minute as a survival/setup window: move through information and teammates rather than contesting fog alone."
        :objectivePrimaryCause?.key==="setup_vision"
          ?"Start the vision cycle 60–90 seconds earlier, then preserve enough wards/information for the actual objective approach."
          :"Review pathing from the preceding wave/camp: the current data does not pin the absences on shopping, deaths or setup vision, so arrival timing is the remaining hypothesis.";
    push(recentFocus,"objectives",objectivePrimaryCause?"Low objective presence has a supported setup diagnosis":"Low objective presence has no single supported cause yet","Mean per-game presence is "+Number(objectiveCoachingPresenceRate).toFixed(0)+"% across "+objectiveContestGames+" games ("+neutralObjectiveJoins+"/"+neutralObjectiveEvents+" pooled joined encounters); "+causeText+".",action,conf(objectiveContestGames),1,"team-contested objective presence + reset/death/vision root-cause evidence");
  }else if(["JUNGLE","SUPPORT"].includes(primaryRole)&&objectivePresenceEvidenceReady&&hasNum(objectiveCoachingPresenceRate)&&Number(objectiveCoachingPresenceRate)>=70)push(highlights,"objectives","Objective presence is a strength","Mean per-game presence is "+Number(objectiveCoachingPresenceRate).toFixed(0)+"% across "+objectiveContestGames+" games; pooled encounter evidence is "+neutralObjectiveJoins+"/"+neutralObjectiveEvents+" joined.","Preserve this while improving the quality of the setup vision and pre-objective deaths.",conf(objectiveContestGames),4,"equal-weight per-game team-contested objective presence with pooled encounter traceability");
  if(Number(gameObjectivePresenceWl.winsN||0)>=4&&Number(gameObjectivePresenceWl.lossesN||0)>=4&&hasNum(gameObjectivePresenceWl.wins)&&hasNum(gameObjectivePresenceWl.losses)&&Number(gameObjectivePresenceWl.wins)-Number(gameObjectivePresenceWl.losses)>=15)push(recentFocus,"objectives","Objective attendance is strongly associated with your wins","Across "+gameObjectivePresenceWl.winsN+" wins and "+gameObjectivePresenceWl.lossesN+" losses with contested-objective evidence, mean per-game objective presence is "+Number(gameObjectivePresenceWl.wins).toFixed(0)+"% in wins versus "+Number(gameObjectivePresenceWl.losses).toFixed(0)+"% in losses.","Protect the setup sequence—recall, path, vision, arrive—because missing it is one of the clearest differences between your wins and losses.","medium",2,"equal-weight per-game team-contested objective presence in wins vs losses; association, not causation");
  if(["MID","SUPPORT","TOP"].includes(primaryRole)&&roamAttempts>=4&&roamAttemptGames>=3){
    if(Number(roamRate)<45)push(recentFocus,"roaming","Roams are not converting often enough",roamSuccess+"/"+roamAttempts+" detected departures inside the queue-specific roam window across "+roamAttemptGames+" games produced a kill/assist or supported objective/structure return, while "+roamFail+" ended in your death.","Roam on pushed waves and visible windows; cancel the move sooner when the target lane cannot follow.",conf(roamAttemptGames),2,"detected queue-specific roam windows across games");
    else if(Number(roamRate)>=65)push(highlights,"roaming","Your roams convert well",roamSuccess+"/"+roamAttempts+" detected departures inside the queue-specific roam window across "+roamAttemptGames+" games produced supported return.","Keep choosing these windows; the next check is whether the lane movement stays acceptable.",conf(roamAttemptGames),4,"detected queue-specific roam windows across games");
  }
  if(["MID","TOP"].includes(primaryRole)&&roamLaneCostEvents.length>=4&&roamLaneCostMeasuredGames>=3){
    if(emptyCostlyRoams.length>=2&&emptyCostlyRoamGames>=2)push(recentFocus,"roaming","Some roams are costing lane economy without returning value",emptyCostlyRoams.length+" detected roams across "+emptyCostlyRoamGames+" games lost at least 6 CS of direct-role differential and produced no kill/assist, supported objective or structure return.","Create the roam from a pushed/crashed wave; if the target does not open quickly, return before the opponent collects uncontested waves.",conf(emptyCostlyRoamGames),1,"direct-role CS movement during detected roam windows repeated across games");
    else if(hasNum(meanGameRoamLaneMovementCs)&&Number(meanGameRoamLaneMovementCs)<=-5)push(recentFocus,"roaming","Roams are converting at a high lane cost","Across "+roamLaneCostEvents.length+" measured roam windows in "+roamLaneCostMeasuredGames+" games, the mean of each game's average direct-role CS movement is "+signedText(meanGameRoamLaneMovementCs,1)+" CS while you are away.","Keep only the highest-value roam windows and protect the wave first; a successful play can still be economically expensive.",conf(roamLaneCostMeasuredGames),2,"game-weighted direct-role CS movement during measured roam windows across games");
    else if(hasNum(meanGameRoamLaneMovementCs)&&Number(meanGameRoamLaneMovementCs)>=-2&&Number(roamRate)>=60)push(highlights,"roaming","Your roam timing preserves lane economy","Across "+roamLaneCostEvents.length+" measured roam windows in "+roamLaneCostMeasuredGames+" games, the mean of each game's average lane movement is "+signedText(meanGameRoamLaneMovementCs,1)+" CS while roam conversion is "+Math.round(Number(roamRate))+"%.","Preserve the wave preparation that lets you move without donating lane resources.","medium",4,"game-weighted direct-role CS movement during measured roam windows across games");
  }
  if(primaryRole==="SUPPORT"&&supportRoamAdcEmptyCostlyEvents.length>=2&&supportRoamAdcEmptyCostlyGames>=2){
    push(recentFocus,"roaming","Some support roams are expensive for your ADC without supported return",supportRoamAdcEmptyCostlyEvents.length+" measured roam windows across "+supportRoamAdcEmptyCostlyGames+" games lost at least 6 CS of ADC-vs-ADC lane differential without a kill/assist, supported objective or structure return.","Prefer roam windows after your ADC can safely crash, reset or collect under tower; cancel earlier when the play does not become actionable.",conf(supportRoamAdcEmptyCostlyGames),1,"ADC lane movement during support roams with no supported return, repeated across games");
  }
  if(objectivePresenceEvidenceReady&&recentShopObjectiveAbsences>=2&&recentShopObjectiveAbsenceGames>=2)push(recentFocus,"objectives","Objective absences often follow recent shopping",recentShopObjectiveAbsences+" of "+neutralObjectiveEvents+" tracked team-contested neutral-objective encounters include recent-shop absence across "+recentShopObjectiveAbsenceGames+" games. This is an association, not proof the reset caused the miss.","Test an earlier shop/reset deadline: aim to finish purchases with enough travel/setup time, then review whether this recent-shop absence pattern falls.","medium",1,"recent shop timing + team-contested neutral-objective attendance repeated across games");
  else if(objectivePresenceEvidenceReady&&recentShopObjectiveAbsences===0&&freshPurchaseObjectiveJoins>=3&&freshPurchaseObjectiveJoinGames>=2)push(highlights,"objectives","Recent shopping still leaves you present for objectives",freshPurchaseObjectiveJoins+" tracked neutral-objective encounters across "+freshPurchaseObjectiveJoinGames+" games were attended within two minutes of a detected shop visit, with no recent-shop absence in the sample.","Preserve the purchase timing that lets you arrive with spent gold and setup time.","medium",4,"recent shop timing + team-contested neutral-objective attendance across games");
  if(killConversionWindowsCount>=5&&oppKillConversionWindows>=5&&hasNum(killConversionDelta)){
    if(Number(killConversionDelta)<=-15)push(recentFocus,"conversion","Post-kill conversion trails the opposing role","Your team converts "+Number(killConversionRate).toFixed(0)+"% of player-involved kill windows into a tracked objective/structure within 75 seconds versus "+Number(opponentKillConversionRate).toFixed(0)+"% after the opposing role's kill windows.","After a won skirmish, immediately scan for objective/structure/wave value before chasing or resetting; this is a team-context signal, not sole-player attribution.",conf(Math.min(killConversionWindowsCount,oppKillConversionWindows)),2,"player-involved kill windows vs same-role-opponent-involved kill windows");
    else if(Number(killConversionDelta)>=15&&Number(killConversionRate)>=55)push(highlights,"conversion","Your post-kill map conversion is strong","Your team converts "+Number(killConversionRate).toFixed(0)+"% of player-involved kill windows within 75 seconds versus "+Number(opponentKillConversionRate).toFixed(0)+"% after the opposing role's kill windows.","Keep turning skirmish wins into structures/objectives instead of extending low-value chases.","medium",4,"player-involved kill windows vs same-role-opponent-involved kill windows");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&visionActions>=12&&visionActionGames>=4){
    if(visionActionDeaths>=3&&(highRiskVisionActionDeaths>=2||unsupportedVisionActionDeaths>=2))push(recentFocus,"vision safety","Vision work is repeatedly ending in costly deaths",visionActionDeaths+" deaths followed "+visionActions+" tracked ward placements/clears across "+visionActionGames+" coaching games within the vision-action window; "+highRiskVisionActionDeaths+" were high-risk, "+unsupportedVisionActionDeaths+" had no ally within 3,000 units, and "+untradedVisionActionDeaths+" went untraded.","Keep contest-relevant vision, but change the setup sequence: establish teammate proximity, use safer information/abilities first, then place or clear the ward instead of walking into darkness alone.",conf(visionActionGames),1,"death within 20s and 2,500 units of own ward placement/clear across coaching games");
    else if(visionActions>=18&&visionActionDeaths===0)push(highlights,"vision safety","You are creating vision without paying with deaths",visionActions+" tracked ward placements/clears across "+visionActionGames+" coaching games produced no nearby death within the vision-action window.","Preserve the route discipline and teammate timing that lets you create information safely.","medium",4,"death within 20s and 2,500 units of own ward placement/clear");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&peerGames.length>=5&&Number(peerVpm)<=-0.15)push(recentFocus,"vision","You are giving up vision volume to the opposing role","Vision score is "+Math.abs(Number(peerVpm)).toFixed(2)+" per minute lower than the same-role opponent on average; you beat them on VPM in "+Math.round(Number(peerVpmWin||0))+"% of "+peerGames.length+" games.","Shift more wards into river/objective setup before the contest, not after contact starts.",conf(peerGames.length),2,"same-role opponents");
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&visionWardTotal>=20&&opponentVisionWardTotal>=20&&visionSetupGames.length>=5&&hasNum(objectiveSetupWardRateDelta)){
    if(Number(objectiveSetupWardRateDelta)<=-10)push(recentFocus,"vision","Ward volume is not translating into objective setup",Number(objectiveSetupWardRate).toFixed(0)+"% of your tracked wards are objective-setup wards versus "+Number(opponentObjectiveSetupWardRate).toFixed(0)+"% for the same-role opponents ("+signedText(objectiveSetupWardRateDelta,0)+" pp) across "+visionSetupGames.length+" trusted setup games.","Shift ward timing toward the 60–90 seconds before neutral objectives; vision placed after contact starts is less useful for choosing the fight.",conf(visionSetupGames.length),2,"objective-setup share of wards vs same-role opponents across trusted setup games");
    else if(Number(objectiveSetupWardRateDelta)>=10&&Number(objectiveSetupWardRate)>=20)push(highlights,"vision","Your wards are well aligned with objective setup",Number(objectiveSetupWardRate).toFixed(0)+"% of tracked wards contribute to objective setup versus "+Number(opponentObjectiveSetupWardRate).toFixed(0)+"% for the same-role opponents across "+visionSetupGames.length+" trusted setup games.","Keep the timing and use the information to avoid the pre-objective deaths/late entries the rest of the report tracks.","medium",4,"objective-setup share of wards vs same-role opponents");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&visionSetupGames.length>=5){
    if(Number(avgObjectiveSetupDelta)<=-0.5)push(recentFocus,"vision","Pre-objective vision setup trails the opposing role","You average "+Math.abs(Number(avgObjectiveSetupDelta)).toFixed(1)+" fewer wards near upcoming objectives than the same-role opponent across "+visionSetupGames.length+" timeline games; you place more setup wards in "+Math.round(Number(objectiveSetupOutperformPct||0))+"% of them.","Start the vision cycle before the contest: reset for wards, establish river/jungle information, then preserve enough wards for the objective approach.",conf(visionSetupGames.length),1,"objective-setup wards vs same-role opponent");
    else if(Number(avgObjectiveSetupDelta)>=0.5)push(highlights,"vision","You establish more pre-objective vision than your counterpart","You average +"+Number(avgObjectiveSetupDelta).toFixed(1)+" setup wards near upcoming objectives versus the same-role opponent across "+visionSetupGames.length+" games.","Preserve the early setup timing and focus next on keeping that vision alive/useful through the contest.","medium",4,"objective-setup wards vs same-role opponent");
  }
  if(peerGames.length>=5){
    if(Number(peerDpm)<=-100&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"fighting","Damage conversion trails your direct counterpart","You average "+Math.round(Math.abs(Number(peerDpm)))+" less champion damage per minute than the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Check whether farm leads are being converted into timely fights and whether deaths are removing you before damage windows.",conf(peerGames.length),2,"same-role opponents");
    if(Number(peerDpm)>=120&&["ADC","MID","TOP"].includes(primaryRole))push(highlights,"fighting","You outperform the direct counterpart in damage","You average +"+Math.round(Number(peerDpm))+" champion damage per minute versus the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Protect this strength by reducing deaths that occur before objectives.",conf(peerGames.length),4,"same-role opponents");
    if(Number(peerCs)<=-0.5&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"farming","Farm pace trails the actual lane peer","You average "+Math.abs(Number(peerCs)).toFixed(2)+" CS/min less than the same-role opponent and finish ahead on CS/min in only "+Math.round(Number(peerCsWin||0))+"% of comparable games.","Track the waves lost around recalls, roams and unnecessary mid-game grouping.",conf(peerGames.length),2,"same-role opponents");
  }
  if(rolePeerFightSamples>=5&&roleLevelDisadvantageFightStarts>=3&&Number(roleLevelDisadvantageFightRate)>=40)push(recentFocus,"fight readiness","Role-opponent level disadvantage recurs in shared fights",roleLevelDisadvantageFightStarts+" of "+rolePeerFightSamples+" attended fights where the actual same-role opponent was nearby ("+Number(roleLevelDisadvantageFightRate).toFixed(0)+"%) began with you at least one level lower.","Add level to the pre-fight readiness check alongside items, gold and local numbers; when the contest is optional, take the nearby XP/wave breakpoint first or trade the play elsewhere.",conf(rolePeerFightSamples),2,"same-role opponent nearby at first kill + role level differential");
  if(outnumberedFightSamples>=8&&outnumberedFightStarts>=3&&Number(outnumberedFightLossRate)>=60)push(recentFocus,"fight selection","Too many attended fights are already locally outnumbered",outnumberedFightStarts+" of "+outnumberedFightSamples+" locally-counted active fight clusters had at least two fewer nearby allies than enemies at the first kill event, and "+Number(outnumberedFightLossRate).toFixed(0)+"% of those clusters ended with more enemy kills.","Use a local numbers check before following or re-entering: who is within actual fight distance, who is showing elsewhere, and which side reaches the next body first?",conf(outnumberedFightSamples),1,"nearby ally/enemy counts at first kill in supported active fight clusters");
  if(highUnspentFightSamples>=8&&Number(highUnspentFightRate)>=30)push(recentFocus,"fight readiness","Too many fights begin before your gold is converted into stats",highUnspentFightStarts+" of "+highUnspentFightSamples+" current-gold-supported active multi-kill fights ("+Number(highUnspentFightRate).toFixed(0)+"%) begin while you are carrying at least 1000 unspent gold.","Create a reset deadline before the next likely contest; arriving with completed purchases is a controllable advantage even when the fight itself is mechanically difficult.",conf(highUnspentFightSamples),1,"current gold at fight-cluster start");
  if(["ADC","MID","TOP","JUNGLE"].includes(primaryRole)&&itemDisadvantageFightSamples>=8&&Number(itemDisadvantageFightRate)>=25)push(recentFocus,"fight readiness","You often contest after the direct opponent has completed a major item first",itemDisadvantageFightStarts+" of "+itemDisadvantageFightSamples+" exact-patch, direct-peer active multi-kill fights ("+Number(itemDisadvantageFightRate).toFixed(0)+"%) start after the same-role opponent has a first major completion and you do not.","Unless the objective is forced, delay or trade the play until your purchase closes the item breakpoint gap.",conf(itemDisadvantageFightSamples),1,"exact-patch first-major-item completion state at fight start");
  if(["ADC","MID","TOP"].includes(primaryRole)&&fightSamples>=8){
    if(Number(firstAllyFightDeathRate)>=35)push(recentFocus,"teamfights","You are too often the first allied death in fights","Across "+fightSamples+" active multi-kill fight clusters, you are the first allied death "+Number(firstAllyFightDeathRate).toFixed(0)+"% of the time.","Prioritize second-wave entry: wait for the first key enemy engage/CC to be committed, then use your resources on sustained damage rather than absorbing the opening burst.",conf(fightSamples),1,"order of allied deaths in active multi-kill fights");
    else if(Number(preContributionFightDeathRate)>=25)push(recentFocus,"teamfights","Too many fights end before you contribute","You die before a tracked kill/assist contribution in "+Number(preContributionFightDeathRate).toFixed(0)+"% of "+fightSamples+" active multi-kill fights.","Review approach angles and threat range before the fight begins; being present is not enough if the first enemy action removes you.",conf(fightSamples),1,"contribution timing inside active multi-kill fights");
    else if(Number(fightSurvivalRate)>=70&&Number(firstAllyFightDeathRate)<=15)push(highlights,"teamfights","Your fight survival/order is disciplined","You survive "+Number(fightSurvivalRate).toFixed(0)+"% of "+fightSamples+" active multi-kill fights and are first allied death only "+Number(firstAllyFightDeathRate).toFixed(0)+"% of the time.","Keep protecting uptime; this is especially valuable when your damage/resource share is high.",conf(fightSamples),4,"attended multi-kill fight clusters");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&resourceGames.length>=5&&hasNum(damageGoldEfficiency)){
    if(Number(damageGoldEfficiency)<=-4)push(recentFocus,"resource conversion","Resource conversion is below your team investment","Across "+resourceGames.length+" games you average "+Number(avgGoldShare).toFixed(1)+"% of team gold but "+Number(avgDamageShare).toFixed(1)+"% of team champion damage ("+signedText(damageGoldEfficiency,1)+" percentage points).","Focus on turning farm/item advantages into fight uptime: arrive on time, preserve positioning, and avoid deaths before the damage window.",conf(resourceGames.length),2,"own-team damage share versus gold share");
    else if(Number(damageGoldEfficiency)>=4)push(highlights,"resource conversion","You create strong damage output for your share of resources","Across "+resourceGames.length+" games you average "+Number(avgDamageShare).toFixed(1)+"% of team champion damage from "+Number(avgGoldShare).toFixed(1)+"% of team gold ("+signedText(damageGoldEfficiency,1)+" percentage points).","Protect this efficiency; do not give away uptime through avoidable deaths when your team is getting high output from your resources.",conf(resourceGames.length),4,"own-team damage share versus gold share");
  }
  if(Number(winLoss.earlyKp.winsEvidence?.games||0)>=4&&Number(winLoss.earlyKp.lossesEvidence?.games||0)>=4&&hasNum(winLoss.earlyKp.wins)&&hasNum(winLoss.earlyKp.losses)&&Number(winLoss.earlyKp.wins)-Number(winLoss.earlyKp.losses)>=15)push(recentFocus,"early impact","Early involvement is much higher in your wins","Across "+winLoss.earlyKp.winsEvidence.games+" wins and "+winLoss.earlyKp.lossesEvidence.games+" losses with supported early-team-kill windows, queue-aware early KP averages "+Number(winLoss.earlyKp.wins).toFixed(0)+"% in wins versus "+Number(winLoss.earlyKp.losses).toFixed(0)+"% in losses.","Look for repeatable early windows—rather than random aggression—that let you influence the map before the game state hardens.",conf(Math.min(Number(winLoss.earlyKp.winsEvidence.games),Number(winLoss.earlyKp.lossesEvidence.games))),2,"wins vs losses with supported early-kill denominator; association, not causation");
  const rankComparisons=peerGames.map((g:any)=>({g,comparison:rankComparisonForGame(g,playerRank)})),usableRankComparisons:any[]=rankComparisons.flatMap((x:any)=>x.comparison?[{g:x.g,comparison:x.comparison}]:[]),rankedPeerGames=usableRankComparisons.map((x:any)=>x.g);
  const rankContextExcludedGames=rankComparisons.filter((x:any)=>!x.comparison&&!!x.g?.peer?.rank).length,rankComparisonQueueCounts:any={};
  for(const x of usableRankComparisons){const q=text(x.comparison.queueType);rankComparisonQueueCounts[q]=(rankComparisonQueueCounts[q]||0)+1;}
  const higherRankGames=usableRankComparisons.filter((x:any)=>Number(x.comparison.peerBand)>Number(x.comparison.ownBand)).map((x:any)=>x.g);
  const sameRankGames=usableRankComparisons.filter((x:any)=>Number(x.comparison.peerBand)===Number(x.comparison.ownBand)).map((x:any)=>x.g);
  const lowerRankGames=usableRankComparisons.filter((x:any)=>Number(x.comparison.peerBand)<Number(x.comparison.ownBand)).map((x:any)=>x.g);
  const rankBandStats=(xs:any[])=>{const lane=finiteGames(xs.filter((g:any)=>g?.phaseRules?.lane15Comparable!==false),g=>g.goldDiff15),cs=finiteGames(xs,g=>g.peer?.csMinDelta),dpm=finiteGames(xs,g=>g.peer?.dpmDelta),vpm=finiteGames(xs,g=>g.peer?.vpmDelta),items=finiteGames(xs,g=>g.itemSpikeDeltaVsOpponent);return{games:xs.length,laneGames:lane.length,csMinGames:cs.length,dpmGames:dpm.length,vpmGames:vpm.length,avgGoldDiff15:meanField(lane,g=>g.goldDiff15),goldOutperformPct:outperform(lane,g=>g.goldDiff15),avgCsMinDelta:meanField(cs,g=>g.peer.csMinDelta),avgDpmDelta:meanField(dpm,g=>g.peer.dpmDelta),avgVpmDelta:meanField(vpm,g=>g.peer.vpmDelta),majorItemGames:items.length,avgMajorItemDeltaMin:meanField(items,g=>g.itemSpikeDeltaVsOpponent),majorItemFasterPct:outperform(items,g=>g.itemSpikeDeltaVsOpponent,true)};};
  const higherRankStats=rankBandStats(higherRankGames),sameRankStats=rankBandStats(sameRankGames),lowerRankStats=rankBandStats(lowerRankGames);
  const higherLane=finiteGames(higherRankGames.filter((g:any)=>g?.phaseRules?.lane15Comparable!==false),g=>g.goldDiff15),higherGold=higherRankStats.avgGoldDiff15,higherDpm=higherRankStats.avgDpmDelta,higherGoldWin=higherRankStats.goldOutperformPct,higherItemGames=Number(higherRankStats.majorItemGames||0),higherItemDelta=higherRankStats.avgMajorItemDeltaMin,higherItemFaster=higherRankStats.majorItemFasterPct;
  if(["ADC","MID","TOP"].includes(primaryRole)&&higherRankGames.length>=3&&higherLane.length>=3){
    if(Number(higherGold)<=-300)push(recentFocus,"rank pressure","Laning drops against higher-ranked direct opponents","Against "+higherLane.length+" same-role opponents ranked above you on the applicable Riot ranked ladder, you average "+Math.round(Number(higherGold))+"g at 15 and finish ahead on gold in "+Math.round(Number(higherGoldWin||0))+"% of them.","Use these games as the clearest practice set: review the first recall, wave loss and trade timing before 15 rather than treating all opponents as equivalent.",conf(higherLane.length),1,"actual higher-ranked same-role opponents");
    else if(Number(higherGold)>=100)push(highlights,"rank pressure","Your lane fundamentals hold up against higher-ranked peers","Against "+higherLane.length+" same-role opponents ranked above you on the applicable Riot ranked ladder, you average "+signedText(higherGold,0)+"g at 15.","The evidence suggests the next improvement is conversion/macro rather than simply surviving stronger lanes.",conf(higherLane.length),4,"actual higher-ranked same-role opponents");
  }
  if(higherItemGames>=3&&hasNum(higherItemDelta)){
    if(Number(higherItemDelta)>=0.75)push(recentFocus,"rank pressure","First-major timing slips against higher-ranked direct opponents","Across "+higherItemGames+" games with measurable first-major completions against same-role opponents ranked above you on the applicable Riot ranked ladder, your completed item arrives "+Number(higherItemDelta).toFixed(1)+" minutes later on average; you complete first in "+Number(higherItemFaster||0).toFixed(0)+"% of those games.","Review the recipe-aware affordability and reset sequence in this stronger-opponent subset. The benchmark is the actual opponent in the same match, not a static rank-table estimate.",conf(higherItemGames),1,"actual higher-ranked same-role opponents with measurable first-major completions");
    else if(Number(higherItemDelta)<=-0.5)push(highlights,"rank pressure","First-major timing holds up against higher-ranked direct opponents","Across "+higherItemGames+" measurable games against higher-ranked same-role opponents, your first major completes "+Math.abs(Number(higherItemDelta)).toFixed(1)+" minutes earlier on average and you complete first in "+Number(higherItemFaster||0).toFixed(0)+"% of them.","Preserve the reset discipline that creates the purchase lead, then use the temporary item advantage before the direct opponent completes theirs.",conf(higherItemGames),4,"actual higher-ranked same-role opponents with measurable first-major completions");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&lowerRankStats.laneGames>=3&&hasNum(lowerRankStats.avgGoldDiff15)){
    if(Number(lowerRankStats.avgGoldDiff15)<=-100)push(recentFocus,"rank pressure","Lower-ranked direct peers are not being converted into a lane advantage","Against "+lowerRankStats.laneGames+" same-role opponents in a lower tier/division band, you average "+signedText(lowerRankStats.avgGoldDiff15,0)+"g at 15 and finish ahead on gold in "+Number(lowerRankStats.goldOutperformPct||0).toFixed(0)+"% of them.","Treat these games as a consistency check: avoid giving away early waves/trades simply because the matchup appears easier on paper.",conf(lowerRankStats.laneGames),2,"actual lower-ranked same-role opponents at fetch-time rank snapshot");
    else if(Number(lowerRankStats.avgGoldDiff15)>=300)push(highlights,"rank pressure","You reliably punish lower-ranked direct peers in lane","Against "+lowerRankStats.laneGames+" lower-band same-role opponents you average "+signedText(lowerRankStats.avgGoldDiff15,0)+"g at 15.","Keep the early discipline, then judge the game by conversion rather than continuing to force lane advantages after the lead is already secured.",conf(lowerRankStats.laneGames),4,"actual lower-ranked same-role opponents at fetch-time rank snapshot");
  }
  const sessionMetricReady=(a:any,b:any,field:string)=>Number(a?.[field]||0)>=3&&Number(b?.[field]||0)>=3;
  if(sessionModel.firstGame.games>=3&&sessionModel.game3Plus.games>=3){
    const lateSignals:string[]=[];
    if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"timelineGames")&&hasNum(sessionModel.game3PlusBadDeathDelta)&&Number(sessionModel.game3PlusBadDeathDelta)>=0.5)lateSignals.push("+"+Number(sessionModel.game3PlusBadDeathDelta).toFixed(1)+" high-risk deaths/game");
    if(primaryRole==="SUPPORT"){
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerVpmGames")&&hasNum(sessionModel.game3PlusPeerVpmDelta)&&Number(sessionModel.game3PlusPeerVpmDelta)<=-0.15)lateSignals.push(Math.abs(Number(sessionModel.game3PlusPeerVpmDelta)).toFixed(2)+" lower vision/min vs opponent");
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerKpGames")&&hasNum(sessionModel.game3PlusPeerKpDelta)&&Number(sessionModel.game3PlusPeerKpDelta)<=-10)lateSignals.push(Math.abs(Number(sessionModel.game3PlusPeerKpDelta)).toFixed(0)+" pp lower KP vs opponent");
    }else if(primaryRole==="JUNGLE"){
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerCsMinGames")&&hasNum(sessionModel.game3PlusPeerCsMinDelta)&&Number(sessionModel.game3PlusPeerCsMinDelta)<=-0.3)lateSignals.push(Math.abs(Number(sessionModel.game3PlusPeerCsMinDelta)).toFixed(2)+" lower CS/min vs opponent");
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerKpGames")&&hasNum(sessionModel.game3PlusPeerKpDelta)&&Number(sessionModel.game3PlusPeerKpDelta)<=-10)lateSignals.push(Math.abs(Number(sessionModel.game3PlusPeerKpDelta)).toFixed(0)+" pp lower KP vs opponent");
    }else if(["ADC","MID","TOP"].includes(primaryRole)){
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"lane15Games")&&hasNum(sessionModel.game3PlusGoldDelta)&&Number(sessionModel.game3PlusGoldDelta)<=-300)lateSignals.push(Math.abs(Math.round(Number(sessionModel.game3PlusGoldDelta)))+"g worse gold@15");
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerDpmGames")&&hasNum(sessionModel.game3PlusPeerDpmDelta)&&Number(sessionModel.game3PlusPeerDpmDelta)<=-120)lateSignals.push(Math.abs(Math.round(Number(sessionModel.game3PlusPeerDpmDelta)))+" lower DPM vs opponent");
      if(sessionMetricReady(sessionModel.game3Plus,sessionModel.firstGame,"peerCsMinGames")&&hasNum(sessionModel.game3PlusPeerCsMinDelta)&&Number(sessionModel.game3PlusPeerCsMinDelta)<=-0.3)lateSignals.push(Math.abs(Number(sessionModel.game3PlusPeerCsMinDelta)).toFixed(2)+" lower CS/min vs opponent");
    }
    if(lateSignals.length)push(recentFocus,"session habits","Later-session role metrics are weaker in this sample",sessionModel.game3Plus.games+" primary-role games played as game 3+ of a session show "+lateSignals.join(", ")+" compared with "+sessionModel.firstGame.games+" session-opening games.","Use a deliberate checkpoint before game 3, then compare whether the same role-specific pattern persists in the next session sample. The timing association does not identify fatigue, focus or any other cause.","medium",2,"game 3+ of session vs session-opening primary-role games; descriptive association");
  }
  if(sessionModel.quickAfterLoss.games>=3&&sessionModel.quickAfterWin.games>=3){
    const postLossSignals:string[]=[];
    if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"timelineGames")&&hasNum(sessionModel.postLossBadDeathDelta)&&Number(sessionModel.postLossBadDeathDelta)>=0.5)postLossSignals.push("+"+Number(sessionModel.postLossBadDeathDelta).toFixed(1)+" high-risk deaths/game");
    if(primaryRole==="SUPPORT"){
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"peerVpmGames")&&hasNum(sessionModel.postLossPeerVpmDelta)&&Number(sessionModel.postLossPeerVpmDelta)<=-0.15)postLossSignals.push(Math.abs(Number(sessionModel.postLossPeerVpmDelta)).toFixed(2)+" lower vision/min vs opponent");
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"peerKpGames")&&hasNum(sessionModel.postLossPeerKpDelta)&&Number(sessionModel.postLossPeerKpDelta)<=-10)postLossSignals.push(Math.abs(Number(sessionModel.postLossPeerKpDelta)).toFixed(0)+" pp lower KP vs opponent");
    }else if(primaryRole==="JUNGLE"){
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"peerCsMinGames")&&hasNum(sessionModel.postLossPeerCsMinDelta)&&Number(sessionModel.postLossPeerCsMinDelta)<=-0.3)postLossSignals.push(Math.abs(Number(sessionModel.postLossPeerCsMinDelta)).toFixed(2)+" lower CS/min vs opponent");
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"peerKpGames")&&hasNum(sessionModel.postLossPeerKpDelta)&&Number(sessionModel.postLossPeerKpDelta)<=-10)postLossSignals.push(Math.abs(Number(sessionModel.postLossPeerKpDelta)).toFixed(0)+" pp lower KP vs opponent");
    }else if(["ADC","MID","TOP"].includes(primaryRole)){
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"lane15Games")&&hasNum(sessionModel.postLossGoldDelta)&&Number(sessionModel.postLossGoldDelta)<=-300)postLossSignals.push(Math.abs(Math.round(Number(sessionModel.postLossGoldDelta)))+"g worse gold@15");
      if(sessionMetricReady(sessionModel.quickAfterLoss,sessionModel.quickAfterWin,"peerCsMinGames")&&hasNum(sessionModel.postLossPeerCsMinDelta)&&Number(sessionModel.postLossPeerCsMinDelta)<=-0.3)postLossSignals.push(Math.abs(Number(sessionModel.postLossPeerCsMinDelta)).toFixed(2)+" lower CS/min vs opponent");
    }
    if(postLossSignals.length)push(recentFocus,"requeue habits","Quick post-loss requeues have weaker role metrics in this sample",sessionModel.quickAfterLoss.games+" quick post-loss requeues show "+postLossSignals.join(", ")+" compared with "+sessionModel.quickAfterWin.games+" quick requeues after wins.","Use a short review/reset before requeueing and check whether the same role-specific association persists over the next comparable sample. The prior result is not treated as the cause.","medium",2,"next primary-role game within 45m after loss vs after win; descriptive association");
  }
  const phaseCandidates=["early","mid","late"].map((key:any)=>({key,...phaseRisk[key]})).filter((x:any)=>x.games>=5&&Number(x.exposureMinutes||0)>=20&&hasNum(x.highRiskDeathsPer10Min)).sort((a:any,b:any)=>Number(b.highRiskDeathsPer10Min)-Number(a.highRiskDeathsPer10Min));
  if(phaseCandidates.length){
    const top=phaseCandidates[0],next=phaseCandidates[1]||null,gap=next?Number(top.highRiskDeathsPer10Min)-Number(next.highRiskDeathsPer10Min):Number(top.highRiskDeathsPer10Min);
    if(Number(top.highRiskDeathsPer10Min)>=0.35&&gap>=0.15){
      const phaseTitle=top.key==="early"?"early game":top.key==="mid"?"transition / first-major-objective phase":"late / Baron-era game";
      const phaseAction=top.key==="early"?"Review lane trades, wave depth and first-move information before the current early-phase boundary; reduce the specific decisions that create isolated/outnumbered deaths.":top.key==="mid"?"Audit the transition after lane and before the current late-phase objective boundary: wave collection, resets, first major items and objective approach.":"Treat Baron-era objective setup and fight entry as the priority: arrive with information, preserve your escape route, and avoid being the first resource-heavy target removed.";
      push(recentFocus,"phase discipline","Decision risk is concentrated in the "+phaseTitle,top.highRiskDeaths+" high-risk deaths across "+Number(top.exposureMinutes).toFixed(0)+" exposure-minutes ("+Number(top.highRiskDeathsPer10Min).toFixed(2)+" per 10m), at least "+gap.toFixed(2)+" per 10m above the next-highest phase.",phaseAction,conf(top.games),1,"high-risk deaths normalized by actual phase exposure; 2026 standard SR uses <14, 14–20, ≥20, while 2026 Swiftplay uses pre-Baron <12 and Baron-era ≥12");
    }
  }
  const costlyPhaseCandidates=["early","mid","late"].map((key:any)=>({key,...phaseRisk[key]})).filter((x:any)=>x.games>=5&&Number(x.exposureMinutes||0)>=20&&hasNum(x.costlyDeathsPer10Min)).sort((a:any,b:any)=>Number(b.costlyDeathsPer10Min)-Number(a.costlyDeathsPer10Min));
  if(costlyPhaseCandidates.length){
    const top=costlyPhaseCandidates[0],next=costlyPhaseCandidates[1]||null,gap=next?Number(top.costlyDeathsPer10Min)-Number(next.costlyDeathsPer10Min):Number(top.costlyDeathsPer10Min);
    if(Number(top.costlyDeathsPer10Min)>=0.3&&gap>=0.12){
      const label=top.key==="early"?"in the early phase":top.key==="mid"?"in the transition phase":"in the late / Baron-era phase";
      push(recentFocus,"phase consequences","The most expensive deaths cluster "+label,top.costlyDeaths+" costly deaths across "+Number(top.exposureMinutes).toFixed(0)+" exposure-minutes ("+Number(top.costlyDeathsPer10Min).toFixed(2)+" per 10m), materially above the other phases.","Prioritize replay review of these deaths first: this is where deaths most often also lose direct-role economy, structures or neutral objectives.","medium",2,"costly death consequences normalized by actual phase exposure");
    }
  }
  if(["ADC","MID","TOP","JUNGLE"].includes(primaryRole)&&recentTrend.peerCsMinDelta.recentN>=4&&recentTrend.peerCsMinDelta.priorN>=5&&hasNum(recentTrend.peerCsMinDelta.recent)&&hasNum(recentTrend.peerCsMinDelta.prior)){
    const d=Number(recentTrend.peerCsMinDelta.recent)-Number(recentTrend.peerCsMinDelta.prior);
    if(d<=-0.35)push(recentFocus,"recent trend","Recent farming relative to your role opponent has slipped","CS/min versus the direct role opponent is "+signedText(recentTrend.peerCsMinDelta.recent,2)+" in the latest five versus "+signedText(recentTrend.peerCsMinDelta.prior,2)+" in the preceding "+recentTrend.peerCsMinDelta.priorN+" games.","Check recalls, deaths, roaming and wave access in the latest games. This comparison is opponent-adjusted; it does not assume raw CS/min should rise as MMR rises.","medium",1,"latest 5 vs preceding Last-20 direct-role-opponent deltas");
    else if(d>=0.35)push(highlights,"recent trend","Recent farming relative to your role opponent is improving","CS/min versus the direct role opponent is "+signedText(recentTrend.peerCsMinDelta.recent,2)+" in the latest five versus "+signedText(recentTrend.peerCsMinDelta.prior,2)+" previously.","Identify the wave/recall habits behind the relative gain and keep them stable.","medium",4,"latest 5 vs preceding Last-20 direct-role-opponent deltas");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&recentTrend.goldDiff15.recentN>=4&&recentTrend.goldDiff15.priorN>=5&&hasNum(recentTrend.goldDiff15.recent)&&hasNum(recentTrend.goldDiff15.prior)){
    const d=Number(recentTrend.goldDiff15.recent)-Number(recentTrend.goldDiff15.prior);
    if(d<=-300)push(recentFocus,"recent trend","Your recent lane state has worsened","Gold differential at 15 versus the direct role opponent is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g in the preceding sample.","Review the latest games specifically for first-recall timing, early deaths and waves abandoned for low-value fights.","medium",1,"latest 5 vs preceding Last-20 direct-role lane states");
    else if(d>=300)push(highlights,"recent trend","Your recent lane state has improved","Gold differential at 15 versus the direct role opponent is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g previously.","Keep the recent early-game habits and focus next on conversion after 15.","medium",4,"latest 5 vs preceding Last-20 direct-role lane states");
  }
  if(recentTrend.badDeaths.recentN>=4&&recentTrend.badDeaths.priorN>=5&&hasNum(recentTrend.badDeaths.recent)&&hasNum(recentTrend.badDeaths.prior)){
    const d=Number(recentTrend.badDeaths.recent)-Number(recentTrend.badDeaths.prior);
    if(d>=0.6)push(recentFocus,"recent trend","High-risk deaths have increased recently","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Treat the change as a warning signal: reduce deep/isolated entries and spend gold before contest windows.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d<=-0.6)push(highlights,"recent trend","Your recent death quality is improving","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Preserve the safer positioning while keeping pressure high.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&recentTrend.peerDpmDelta.recentN>=4&&recentTrend.peerDpmDelta.priorN>=5&&hasNum(recentTrend.peerDpmDelta.recent)&&hasNum(recentTrend.peerDpmDelta.prior)){
    const d=Number(recentTrend.peerDpmDelta.recent)-Number(recentTrend.peerDpmDelta.prior);
    if(d<=-100)push(recentFocus,"recent trend","Recent damage relative to your role opponent has fallen","DPM versus the direct role opponent is "+signedText(recentTrend.peerDpmDelta.recent,0)+" in the latest five versus "+signedText(recentTrend.peerDpmDelta.prior,0)+" previously.","Check whether this follows weaker role economy, later item completions or deaths before major fights. Raw DPM is not used as the trend signal.","medium",2,"latest 5 vs preceding Last-20 direct-role-opponent deltas");
    else if(d>=100)push(highlights,"recent trend","Recent damage relative to your role opponent is improving","DPM versus the direct role opponent is "+signedText(recentTrend.peerDpmDelta.recent,0)+" in the latest five versus "+signedText(recentTrend.peerDpmDelta.prior,0)+" previously.","Keep the fight-entry and item-timing choices that are increasing relative uptime.","medium",4,"latest 5 vs preceding Last-20 direct-role-opponent deltas");
  }
  // Raw same-patch CS/min is retained in descriptive summaries only. Patch matching does not control opponent strength/MMR, so it is not promoted to a directional coaching finding.
  if(greedy>=4&&greedyStayGames>=3)push(recentFocus,"resets","High-gold stays appear repeatedly",greedy+" timeline windows across "+greedyStayGames+" coaching games show at least 1200 current gold followed by more than two minutes before the next detected shop visit.","When the map is quiet, cash the spike instead of carrying unspent power through another risky sequence.",conf(greedyStayGames),2,"timeline gold + shop events across games");
  if(wins.length>=4&&losses.length>=4&&hasNum(winLoss.greedyStays.wins)&&hasNum(winLoss.greedyStays.losses)&&Number(winLoss.greedyStays.losses)-Number(winLoss.greedyStays.wins)>=0.6)push(recentFocus,"resets","Greedy stays rise noticeably in losses","You average "+Number(winLoss.greedyStays.losses).toFixed(1)+" high-gold stay windows in losses versus "+Number(winLoss.greedyStays.wins).toFixed(1)+" in wins.","When behind, do not try to recover the deficit by staying indefinitely for one more wave; buy the power you already earned.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses in your own sample");
  if(["ADC","MID","TOP"].includes(primaryRole)&&topDamage>=Math.max(5,Math.ceil(games.length*0.4)))push(highlights,"team impact","You frequently lead your team in champion damage","You are #1 on your team in champion damage in "+topDamage+"/"+games.length+" games.","Make survival around your damage windows a priority because your team loses substantial output when you die first.",conf(games.length),4,"own-team rank each match");
  recentFocus.sort((a,b)=>a.priority-b.priority);highlights.sort((a,b)=>a.priority-b.priority);coaching.push(...recentFocus,...highlights);
  return{
    recentFocus,highlights,coaching,
    peerComparison:{sameRoleGames:peerGames.length,csMinGames:peerCsGames.length,dpmGames:peerDpmGames.length,vpmGames:peerVpmGames.length,rankedPeerGames:rankedPeerGames.length,rankContextExcludedGames,rankComparisonQueueCounts,higherRankPeerGames:higherRankGames.length,sameRankPeerGames:sameRankGames.length,lowerRankPeerGames:lowerRankGames.length,rankBands:{higher:higherRankStats,same:sameRankStats,lower:lowerRankStats,definition:"Tier/division band from a shared Riot ranked queue snapshot; Solo matches use Solo/Duo, Flex uses Flex, other supported queues use the first ladder both players share; LP differences within a division are ignored"},laneGames15:lane15.length,midgameComparableGames:midgameGames.length,avgGoldSwing15to25:avgSwing15to25,leadGames15to25:leadMidgame.length,avgLeadSwing15to25:leadSwing15to25,deficitGames15to25:deficitMidgame.length,avgDeficitSwing15to25:deficitSwing15to25,avgGoldDiff15:avgG15,avgCsDiff15:avgC15,laneAheadPct:laneAhead,gold15OutperformPct:peerGoldWin,avgCsMinDelta:peerCs,csMinOutperformPct:peerCsWin,avgDpmDelta:peerDpm,dpmOutperformPct:peerDpmWin,avgVpmDelta:peerVpm,vpmOutperformPct:peerVpmWin,visionSetupGames:visionSetupGames.length,avgObjectiveSetupDelta,objectiveSetupOutperformPct,visionWardTotal,visionSetupTotal,objectiveSetupWardRate,peerMatchedVisionWardTotal,peerMatchedVisionSetupTotal,peerMatchedObjectiveSetupWardRate,opponentVisionWardTotal,opponentVisionSetupTotal,opponentObjectiveSetupWardRate,objectiveSetupWardRateDelta,repeatDeathRate:repeatDeathRate,peerMatchedRepeatDeathRate,opponentRepeatDeathRate:opponentRepeatDeathRate,repeatDeathRateDelta:repeatDeathRateDelta,majorItemGames:itemGames.length,avgMajorItemDeltaMin:itemDelta,majorItemFasterPct:peerItemFaster,majorReadinessGames:majorReadinessGames.length,avgMajorCompletionDelayMin,delayedMajorCompletionGames:delayedMajorCompletionGames.length,majorReadinessPeerGames:majorReadinessPeerGames.length,avgMajorCompletionDelayVsPeerMin,itemSpikeEligibleWindows:itemSpikeEligibleWindows,itemSpikeUtilizedWindows:itemSpikeUtilizedWindows,itemSpikeUtilizationRate:itemSpikeUtilizationRate,itemSpikeDeathsBeforeImpact:itemSpikeDeathsBeforeImpact,avgItemSpikeLeadSec:avgItemSpikeLeadSec,impactGames:impactGames.length,avgImpactDeltaMin:avgImpactDelta,impactEarlierPct,higherRankAvgGoldDiff15:higherGold,higherRankGoldOutperformPct:higherGoldWin,higherRankAvgDpmDelta:higherDpm,higherRankMajorItemGames:higherItemGames,higherRankAvgMajorItemDeltaMin:higherItemDelta,higherRankMajorItemFasterPct:higherItemFaster,definition:"Same-role opponent from each analyzed match"},
    conversion:{laneLeadGames:laneLeads.length,laneLeadWinRate:laneLeadWr,laneDeficitGames:laneDeficits.length,laneDeficitWinRate:laneDeficitWr,lead25Games:lead25Games.length,lead25WinRate,deficit25Games:deficit25Games.length,deficit25WinRate,excludedCompromisedOutcomeGames:games.length-cleanOutcomeGames.length,outcomePolicy:"afk_or_early_surrender_excluded_from_final_result_conversion"},
    winLoss,recentTrend,sessionModel,decisionIntelligence,
    behaviorSummary:{
      timelineGames:validTimeline.length,
      directPeerTimelineGames,
      checkpointEligibility:{lane15Games:lane15ComparableGames.length,fixed15to25Games:fixed15to25ComparableGames.length,closing25Games:closing25ComparableGames.length},
      phaseRisk,
      midRouting:{games:midRoutingGames.length,avgCsSwing15to25:avgMidRoutingCsSwing,avgObjectiveJoinRate:avgMidRoutingObjectiveJoinRate,pooledObjectiveJoinRate:pooledMidRoutingObjectiveJoinRate,meanGameObjectiveJoinRate:meanGameMidRoutingObjectiveJoinRate,coachingObjectivePresenceRate:coachingMidRoutingObjectivePresenceRate,teamObjectiveEvents:midRoutingTeamObjectives,joinedObjectiveEvents:midRoutingObjectiveJoins,securedTeamObjectiveEvents:securedMidRoutingObjectives,securedJoinedObjectiveEvents:securedMidRoutingJoins,securedObjectivePresenceRate:securedMidRoutingPresenceRate,presenceBasis:"team_contested",inefficientGames:inefficientMidRoutingGames,balancedGames:balancedMidRoutingGames,sideFarmLowPresenceGames},
      closing25:{leadGames:lead25Games.length,leadWins:lead25Wins,leadLosses:lead25Losses,leadWinRate:lead25WinRate,leadLossesWithLateRisk:lead25LossesWithLateRisk,leadLateRiskLossRate:lead25LateRiskLossRate,leadLateRiskPerLeadGameRate:lead25LateRiskPerLeadGameRate,lateHighRiskDeathsInLeadLosses:lateHighRiskDeathsInLead25Losses,lateCostlyDeathsInLeadLosses:lateCostlyDeathsInLead25Losses,deficitGames:deficit25Games.length,deficitWins:deficit25Wins,deficitWinRate:deficit25WinRate},
      earlyRoleSoloKills,earlyRoleSoloKillGames,earlyRoleSoloDeaths,earlyRoleSoloDeathGames,earlyRoleSoloEventGames,earlyRoleSoloDeathPerGame,pre14RoleSoloKills,pre14RoleSoloDeaths,pre14RoleSoloDeathPerGame,earlyHomeLaneDeaths,earlyHomeLaneDeathGames,earlyClassifiedHomeLaneDeaths,earlyClassifiedHomeLaneDeathGames,earlyUnclassifiedHomeLaneDeaths,earlyOutsidePressureDeaths,earlyOutsidePressureDeathGames,earlyOutsidePressureShare,pre14HomeLaneDeaths,pre14ClassifiedHomeLaneDeaths,pre14UnclassifiedHomeLaneDeaths,pre14OutsidePressureDeaths,pre14OutsidePressureShare,first20PlayerPlateInvolvement,peerMatchedFirst20PlayerPlateInvolvement,first20OpponentPlateInvolvement,first20PlateInvolvementDelta,first20PlayerPlateLanePresenceSignals,peerMatchedFirst20PlayerPlateLanePresenceSignals,first20OpponentPlateLanePresenceSignals,allGamePlayerPlateInvolvement,peerMatchedAllGamePlayerPlateInvolvement,allGameOpponentPlateInvolvement,allGamePlateInvolvementDelta,allGamePlayerPlateLanePresenceSignals,peerMatchedAllGamePlayerPlateLanePresenceSignals,allGameOpponentPlateLanePresenceSignals,directPlayerPlateCredits,unattributedPlateEvents,soloKillStructureWindows,soloKillStructureConversions,soloKillStructureConversionRate,soloKillConversionEvents:soloKillConversionEvents.length,soloKillConvertedEvents:soloKillConvertedEvents.length,soloKillConversionRate,avgSoloKillGoldSwingTo15,avgSoloKillCsSwingTo15,
      soloKillResetEvents:soloKillResetEvents.length,soloKillDeathsBeforeShop,soloKillDeathsBeforeShopRate,avgSoloKillNextShopDelaySec,
      earlyLeadGames:earlyLeadGames.length,earlyLeadGivebackGames:earlyLeadGivebackGames.length,earlyLeadPreservedGames:earlyLeadPreservedGames.length,earlyLeadGivebackRate,avgEarlyLeadPeakGold,avgEarlyLeadGoldSwingTo15,avgEarlyLeadLostGold,earlyLeadGivebackDeaths,earlyLeadGivebackHighRiskDeaths,
      majorReadinessGames:majorReadinessGames.length,delayedMajorCompletionGames:delayedMajorCompletionGames.length,avgMajorCompletionDelayMin,majorReadinessPeerGames:majorReadinessPeerGames.length,avgMajorCompletionDelayVsPeerMin,secondMajorGames:secondMajorGames.length,avgSecondMajorTime,secondMajorPeerGames:secondMajorPeerGames.length,avgSecondMajorDeltaVsOpponent,
      itemSpikeEligibleWindows,itemSpikeUtilizedWindows,itemSpikeUtilizationRate,itemSpikeDeathsBeforeImpact,avgItemSpikeLeadSec,
      badDeathsPerTimelineGame:badPer,totalTimelineDeaths,classifiedTimelineDeaths,objectiveContextDeaths,meanGameObjectiveDeathPct,meanGamePreObjectiveDeathPct,isolatedDeaths,avgLegacyBruisienatorDqi,avgLegacyBruisienatorIntentReconstruction,deathConsequenceCoveragePct,tradedDeaths,deathTradeRate,highRiskUntradedDeaths,highRiskUntradedPerGame,
      measuredDeathConsequences,costlyDeathEvents,severeDeathEvents,untradedCostlyDeathEvents,contaminatedDeathEconomySamples,costlyDeathRate,costlyDeathsPerTimelineGame,severeDeathsPerTimelineGame,avgGoldSwingAfterDeath,avgCsSwingAfterDeath,
      repeatDeathOpportunities,repeatDeaths,repeatDeathRate,repeatDeathsPerTimelineGame,highRiskRepeatDeaths,costlyRepeatDeaths,untradedRepeatDeaths,peerMatchedRepeatDeathOpportunities,peerMatchedRepeatDeaths,peerMatchedRepeatDeathRate,opponentRepeatDeathOpportunities,opponentRepeatDeaths,opponentRepeatDeathRate,repeatDeathRateDelta,
      leadDeaths,highRiskLeadDeaths,highRiskLeadDeathsPerGame,
      aheadStateDeaths,evenStateDeaths,behindStateDeaths,highRiskAheadStateDeaths,highRiskEvenStateDeaths,highRiskBehindDeaths,highRiskBehindDeathRate,highRiskBehindDeathsPerGame,
      macroTransitionSideLaneDeaths,postLaneSideLaneDeaths,post15SideLaneDeaths,isolatedSideLaneDeaths,isolatedSideLaneDeathRate,preNeutralObjectiveSideLaneDeaths,preNeutralObjectiveSideLaneDeathsPerGame,highRiskSideLaneDeaths,
      playerImpactEvents,postImpactDeaths,postImpactDeathRate,highRiskPostImpactDeaths,untradedPostImpactDeaths,highRiskUntradedPostImpactDeaths,highRiskUntradedPostImpactPerGame,
      badDeathZones:badDeathZoneCounts,topBadDeathZone,topBadDeathZonePct,
      objectiveDeathPct:objDeathPct,preObjectiveDeaths:preObjDeaths,preObjectiveDeathPct:preObjDeathPct,preObjectiveDeathsPerTimelineGame,objectiveJoinRate:objJoin,objectiveContestPresenceRate:objJoin,objectiveContestEncounters,objectiveContestJoinedEncounters,meanGameObjectiveContestPresenceRate,objectiveCoachingPresenceRate,teamSecuredObjectiveJoinRate,objectiveTeamEncounters,objectiveJoinedEncounters,meanGameObjectiveJoinRate,objectivePresenceBasis:"team_contested",earlyTeamKills,earlyPlayerKillInvolvements,earlyKp,meanGameEarlyKp,
      roamAttempts,roamAttemptGames,roamSuccessRate:roamRate,roamFailures:roamFail,roamLaneCostGames:roamLaneCostEvents.length,roamLaneCostMeasuredGames,avgRoamLaneCostCs,meanGameRoamLaneMovementCs,costlyRoams:costlyRoams.length,emptyCostlyRoams:emptyCostlyRoams.length,emptyCostlyRoamGames,roamPlayerKillAssists,roamPlayerDeaths,roamTeamKills,roamObjectivePresent,roamObjectiveAway,roamObjectiveLost,roamStructureInvolvements,roamPlatesGained,roamPlatesLost,roamHomeLaneStructuresLost,supportRoamAdcCostGames:supportRoamAdcCostEvents.length,supportRoamAdcLaneMovementWindows,supportRoamAdcLaneMovementGames,avgSupportRoamAdcLaneCostCs,meanGameSupportRoamAdcLaneMovementCs,supportRoamsHurtingAdc,supportRoamsHurtingAdcGames,supportRoamAdcEmptyCostlyWindows:supportRoamAdcEmptyCostlyEvents.length,supportRoamAdcEmptyCostlyGames,
      firstResetObservedGames:firstResetObservedGames.length,firstResetMeasuredGames:firstResetMeasuredGames.length,firstResetPeerGames:firstResetPeerGames.length,firstResetApproximateSpendGames:firstResetApproximateSpendGames.length,firstResetCleanGames:firstResetCleanGames.length,firstResetLossGames:firstResetLossGames.length,firstResetGainGames:firstResetGainGames.length,firstResetLossRate,avgFirstResetGoldSwing,avgFirstResetCsSwing,avgFirstResetTimingDelta,
      greedyStayWindows:greedy,greedyStayGames,greedyStaysPerTimelineGame,highUnspentGoldDeaths:unspent,
      avgDamageShare,avgGoldShare,damageGoldEfficiency,
      fightPresenceSamples,fightSamples,fightProximityOnlySamples,firstAllyFightDeaths,firstAllyFightDeathRate,preContributionFightDeaths,preContributionFightDeathRate,survivedFightSamples,fightSurvivalRate,fightSampleBasis:"active_involvement_only",fightStateSampleBasis:"metric_specific_supported_active_fights",
      highUnspentFightSamples,highUnspentFightStarts,highUnspentFightRate,itemDisadvantageFightSamples,itemDisadvantageFightStarts,itemDisadvantageFightRate,goldDeficitFightSamples,goldDeficitFightStarts,goldDeficitFightRate,outnumberedFightSamples,unspentAndBehindFightStarts,
      outnumberedFightStarts,outnumberedFightStartRate,lostOutnumberedFights,outnumberedFightLossRate,
      visionActions,visionActionGames,visionActionDeaths,visionActionDeathRate,highRiskVisionActionDeaths,highRiskVisionActionDeathRate,highRiskVisionActionDeathsPerGame,untradedVisionActionDeaths,unsupportedVisionActionDeaths,objectiveSetupVisionActionDeaths,
      visionWardTotal,visionControlWardPurchases,visionSetupTotal,visionSetupClears,objectiveSetupWardRate,peerMatchedVisionWardTotal,peerMatchedVisionSetupTotal,peerMatchedObjectiveSetupWardRate,opponentVisionWardTotal,opponentVisionSetupTotal,opponentObjectiveSetupWardRate,objectiveSetupWardRateDelta,
      killConversionWindows:killConversionWindowsCount,killConversions,killConversionRate,teamKillConversions,teamKillConversionRate,peerMatchedKillConversionWindows,peerMatchedKillConversions,peerMatchedKillConversionRate,
      opponentKillConversionWindows:oppKillConversionWindows,opponentKillConversions:oppKillConversions,opponentKillConversionRate,opponentTeamKillConversions:oppTeamKillConversions,opponentTeamKillConversionRate,killConversionDelta,
      neutralObjectiveEvents,neutralObjectiveJoins,securedNeutralObjectiveEvents,securedNeutralObjectiveJoins,earlySetupObjectiveJoins,eventFrameOnlyObjectiveJoins,absentNeutralObjectives,earlySetupObjectiveJoinRate,meanGameEarlySetupObjectiveJoinRate,objectiveSetupCoachingRate,earlySetupObjectiveCoverageRate,objectiveSetupGames,objectiveContestGames,recentShopObjectiveAbsences,recentShopObjectiveAbsenceGames,preObjectiveDeathGames,recentShopObjectiveAbsenceRate,lateResetObjectiveMisses,lateResetObjectiveMissRate,freshPurchaseObjectiveJoins,freshPurchaseObjectiveJoinGames,freshPurchaseObjectiveJoinRate,objectiveFamilySummary,
      objectiveDiagnosis:{presenceLow:objectivePresenceLow,presenceBasis:"team_contested",primaryExplanation:objectivePrimaryCause?.key||null,primaryCause:objectivePrimaryCause?.key||null,primaryCauseCompatibilityAlias:true,clues:objectiveRootCauses,causes:objectiveRootCauses}
    }
  };
}
function coachingThemeMeta(category:any){
  const c=text(category).toLowerCase();
  const groups:any={
    "early-lane":{label:"Early lane & matchup",cats:["laning","lane conversion","early impact","map awareness","farming","rank pressure","matchup"]},
    "death-risk":{label:"Risk & death discipline",cats:["deaths","death consequences","death recovery","lead protection","risk when behind","phase consequences","phase discipline","post-play discipline"]},
    "reset-power":{label:"Resets & power windows",cats:["resets","item spike","post-kill reset","fight readiness"]},
    "mid-routing":{label:"Mid-game routing",cats:["mid game","mid routing","side-lane timing"]},
    "objectives-closing":{label:"Objectives & closing",cats:["objectives","objective setup","conversion","closing"]},
    "teamfights":{label:"Teamfights & output",cats:["teamfights","fighting","fight selection","positioning","resource conversion","team impact"]},
    "consistency":{label:"Consistency & session habits",cats:["recent trend","trend","session habits","requeue habits"]},
    "recovery":{label:"Recovery play",cats:["recovery","late recovery"]},
    "vision":{label:"Vision",cats:["vision","vision safety"]},
    "roaming":{label:"Roaming",cats:["roaming"]}
  };
  for(const [key,v] of Object.entries(groups)as any)if(v.cats.includes(c))return{key,label:v.label};
  return{key:c.replace(/[^a-z0-9]+/g,"-")||"other",label:c?c.replace(/\b\w/g,(x:string)=>x.toUpperCase()):"Other"};
}
function coachingConfidenceWeight(v:any){const x=text(v).toLowerCase();return x==="high"?3:x==="medium"?2:1;}
function coachingEvidenceChannel(x:any){
  const comparison=text(x?.comparison).toLowerCase().replace(/\s+/g," ").trim();
  if(comparison)return comparison;
  return text(x?.title||x?.category).toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function synthesizePriorityThemes(insights:any[]){
  const grouped=new Map<string,any>();
  for(const x of insights||[]){
    if(!x||!text(x.action))continue;
    const meta=coachingThemeMeta(x.category),entry=grouped.get(meta.key)||{key:meta.key,label:meta.label,items:[]};
    entry.items.push(x);grouped.set(meta.key,entry);
  }
  const themes:any[]=[];
  for(const entry of grouped.values()){
    const items=[...entry.items].sort((a:any,b:any)=>Number(a.priority||9)-Number(b.priority||9)||coachingConfidenceWeight(b.confidence)-coachingConfidenceWeight(a.confidence));
    const rep=items[0],priority=Math.min(...items.map((x:any)=>Number(x.priority||9))),supportCount=items.length,repChannel=coachingEvidenceChannel(rep);
    const allChannels=[...new Set(items.map((x:any)=>coachingEvidenceChannel(x)).filter(Boolean))],independentChannels=allChannels.filter((x:any)=>x!==repChannel),independentSupportCount=independentChannels.length;
    const comparisons=[...new Set(items.map((x:any)=>text(x.comparison)).filter(Boolean))].slice(0,3);
    const supportingTitles=[...new Set(items.slice(1).map((x:any)=>text(x.title)).filter(Boolean))].slice(0,5);
    const score=(5-priority)*20+coachingConfidenceWeight(rep.confidence)*5+Math.min(5,1+independentSupportCount)*2;
    themes.push({key:entry.key,label:entry.label,category:entry.label,title:rep.title,evidence:rep.evidence,action:rep.action,confidence:rep.confidence,priority,comparison:comparisons.join(" · "),supportCount,independentSupportCount,evidenceChannels:allChannels.slice(0,5),supportingTitles,score});
  }
  return themes.sort((a:any,b:any)=>Number(b.score)-Number(a.score)||Number(a.priority)-Number(b.priority)||String(a.label).localeCompare(String(b.label)));
}
function opponentMatchupBehaviorModel(games:any[],summary:any,behaviorSummary:any,primaryRole:string,peerComparison:any=null){
  const groups=new Map<string,any[]>();
  for(const g of games||[]){
    const opponentChampion=text(g?.peer?.champion),roleName=text(g?.role);
    if(g?.directPeerComparable!==true||!opponentChampion||roleName!==primaryRole)continue;
    const key=roleName+"|"+opponentChampion;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(g);
  }
  const profiles:any[]=[],focus:any[]=[],highlights:any[]=[];
  const confidence=(n:number)=>n>=5?"medium":"low";
  const usualTrustedGold15=hasNum(peerComparison?.avgGoldDiff15)?Number(peerComparison.avgGoldDiff15):null,usualTrustedGold15Games=Number(peerComparison?.laneGames15||0);
  for(const [key,list] of groups.entries()){
    if(list.length<3)continue;
    const [roleName,opponentChampion]=key.split("|"),laneComparable=list.filter((g:any)=>g?.phaseRules?.lane15Comparable!==false),lane=finiteGames(laneComparable,g=>g.goldDiff15),cs15Games=finiteGames(laneComparable,g=>g.csDiff15),tl=list.filter(g=>g.timelineAvailable);
    const ownChampionCounts:any={};for(const g of list){const name=text(g.champion)||"Unknown";ownChampionCounts[name]=(ownChampionCounts[name]||0)+1;}
    const ownChampions=Object.entries(ownChampionCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).map(([champion,games])=>({champion,games:Number(games)}));
    const soloKills=list.reduce((n,g)=>n+Number(g.laneDuel?.earlySoloKillsVsRole||0),0),soloDeaths=list.reduce((n,g)=>n+Number(g.laneDuel?.earlySoloDeathsToRole||0),0),soloKillGames=list.filter((g:any)=>Number(g.laneDuel?.earlySoloKillsVsRole||0)>0).length,soloDeathGames=list.filter((g:any)=>Number(g.laneDuel?.earlySoloDeathsToRole||0)>0).length,soloEventGames=list.filter((g:any)=>Number(g.laneDuel?.earlySoloKillsVsRole||0)+Number(g.laneDuel?.earlySoloDeathsToRole||0)>0).length;
    const homeLaneDeaths=list.reduce((n,g)=>n+Number(g.lanePressure?.earlyHomeLaneDeaths||0),0),homeLaneDeathGames=list.filter((g:any)=>Number(g.lanePressure?.earlyHomeLaneDeaths||0)>0).length,classifiedHomeLaneDeaths=list.reduce((n,g)=>n+Number(g.lanePressure?.earlyClassifiedHomeLaneDeaths||0),0),classifiedHomeLaneDeathGames=list.filter((g:any)=>Number(g.lanePressure?.earlyClassifiedHomeLaneDeaths||0)>0).length,unclassifiedHomeLaneDeaths=list.reduce((n,g)=>n+Number(g.lanePressure?.earlyUnclassifiedHomeLaneDeaths||0),0),outsidePressureDeaths=list.reduce((n,g)=>n+Number(g.lanePressure?.earlyOutsidePressureDeaths||0),0),outsidePressureGames=list.filter((g:any)=>Number(g.lanePressure?.earlyOutsidePressureDeaths||0)>0).length,outsidePressureShare=classifiedHomeLaneDeaths?100*outsidePressureDeaths/classifiedHomeLaneDeaths:null;
    const dpmPeerGames=finiteGames(list,g=>g.peer?.dpmDelta),vpmPeerGames=finiteGames(list,g=>g.peer?.vpmDelta),impactGames=finiteGames(tl,g=>g.impactDeltaVsOpponent),itemGames=finiteGames(list,g=>g.itemSpikeDeltaVsOpponent),visionSetupGames=finiteGames(tl,g=>g.vision?.objectiveSetupDeltaVsOpponent);
    const p:any={
      opponentChampion,role:roleName,games:list.length,wins:list.filter(g=>g.win).length,winRate:pct(list.filter(g=>g.win).length,list.length),
      laneGames:lane.length,goldDiff15:meanField(lane,g=>g.goldDiff15),csDiff15Games:cs15Games.length,csDiff15:meanField(cs15Games,g=>g.csDiff15),
      badDeaths:meanField(tl,g=>g.badDeathCount),timelineGames:tl.length,dpmGames:dpmPeerGames.length,avgDpmDelta:meanField(dpmPeerGames,g=>g.peer.dpmDelta),
      vpmGames:vpmPeerGames.length,avgVpmDelta:meanField(vpmPeerGames,g=>g.peer.vpmDelta),
      impactGames:impactGames.length,avgImpactDelta:meanField(impactGames,g=>g.impactDeltaVsOpponent),
      itemGames:itemGames.length,avgItemDelta:meanField(itemGames,g=>g.itemSpikeDeltaVsOpponent),
      visionSetupGames:visionSetupGames.length,avgObjectiveSetupDelta:meanField(visionSetupGames,g=>g.vision?.objectiveSetupDeltaVsOpponent),
      earlySoloKills:soloKills,earlySoloKillGames:soloKillGames,earlySoloDeaths:soloDeaths,earlySoloDeathGames:soloDeathGames,earlySoloEventGames:soloEventGames,earlyHomeLaneDeaths:homeLaneDeaths,earlyHomeLaneDeathGames:homeLaneDeathGames,earlyClassifiedHomeLaneDeaths:classifiedHomeLaneDeaths,earlyClassifiedHomeLaneDeathGames:classifiedHomeLaneDeathGames,earlyUnclassifiedHomeLaneDeaths:unclassifiedHomeLaneDeaths,earlyOutsidePressureDeaths:outsidePressureDeaths,earlyOutsidePressureGames:outsidePressureGames,outsidePressureShare,ownChampions
    };
    profiles.push(p);
    const ownMix=ownChampions.slice(0,3).map((x:any)=>x.champion+" "+x.games+"g").join(", ");

    if(["ADC","MID","TOP"].includes(roleName)){
      if(lane.length>=3&&hasNum(p.goldDiff15)&&hasNum(usualTrustedGold15)&&usualTrustedGold15Games>=3&&Number(p.goldDiff15)-Number(usualTrustedGold15)<=-300){
        focus.push({category:"matchup",title:opponentChampion+" repeatedly suppresses your lane economy",evidence:"Across "+lane.length+" "+primaryRole+" games against "+opponentChampion+", you average "+signedText(p.goldDiff15,0)+"g at 15 versus "+signedText(usualTrustedGold15,0)+"g across "+usualTrustedGold15Games+" trusted direct-peer @15 games in your primary-role coaching sample. Own picks: "+ownMix+".",action:"Review these games together: identify which wave/trade/recall condition repeats before the deficit instead of treating each loss as unrelated.",confidence:confidence(lane.length),priority:2,comparison:"repeated same-role opponent champion vs your primary-role sample"});
      }
      if(soloDeaths>=2&&soloDeathGames>=2&&soloDeaths>=soloKills+2){
        focus.push({category:"matchup",title:"Direct 1v1 execution against "+opponentChampion+" is a repeated problem",evidence:soloKills+" clean early-phase solo kill(s) versus "+soloDeaths+" clean solo death(s) to the actual "+opponentChampion+" role opponent, with solo deaths occurring in "+soloDeathGames+" of "+list.length+" games; assisted kills are excluded.",action:"Build a matchup-specific rule from the replay set: which cooldown/resource/wave state makes the all-in unsafe, and what exact disengage condition should replace it?",confidence:confidence(soloDeathGames),priority:1,comparison:"clean queue-aware early-phase 1v1 events repeated across "+opponentChampion+" matchup games"});
      }else if(classifiedHomeLaneDeaths>=3&&classifiedHomeLaneDeathGames>=2&&outsidePressureDeaths>=2&&outsidePressureGames>=2&&hasNum(outsidePressureShare)&&Number(outsidePressureShare)>=60){
        const opposition=roleName==="ADC"||roleName==="SUPPORT"?"ordinary enemy bot-lane opposition":"the direct role lane opponent";
        focus.push({category:"map awareness",title:"The "+opponentChampion+" matchup losses are mostly outside pressure, not ordinary lane opposition",evidence:outsidePressureDeaths+" of "+classifiedHomeLaneDeaths+" classified early-phase home-lane deaths across "+classifiedHomeLaneDeathGames+" affected games involved an enemy beyond "+opposition+" ("+Math.round(Number(outsidePressureShare))+"%), with outside pressure repeating in "+outsidePressureGames+" games."+(unclassifiedHomeLaneDeaths?" "+unclassifiedHomeLaneDeaths+" additional death(s) were excluded because lane opposition was unresolved.":""),action:"Do not over-correct the champion matchup mechanically. Review wave depth, jungle/roam tracking and vision timing around the vulnerable waves instead.",confidence:confidence(outsidePressureGames),priority:2,comparison:"classified outside-pressure lane deaths repeated across "+opponentChampion+" matchups"});
      }
      if(lane.length>=3&&hasNum(p.goldDiff15)&&hasNum(usualTrustedGold15)&&usualTrustedGold15Games>=3&&Number(p.goldDiff15)-Number(usualTrustedGold15)>=300&&soloKills>=soloDeaths){
        highlights.push({category:"matchup",title:"You handle "+opponentChampion+" well in the current sample",evidence:"Across "+lane.length+" "+primaryRole+" games you average "+signedText(p.goldDiff15,0)+"g at 15, at least 300g better than your trusted direct-peer primary-role @15 baseline, with "+soloKills+" clean solo kill(s) versus "+soloDeaths+" solo death(s).",action:"Preserve the matchup-specific wave/trade conditions behind this advantage; do not generalize the result beyond the repeated sample.",confidence:confidence(lane.length),priority:4,comparison:"repeated same-role opponent champion vs your primary-role sample"});
      }
    }else{
      if(vpmPeerGames.length>=3&&hasNum(p.avgVpmDelta)&&Number(p.avgVpmDelta)<=-0.15){
        focus.push({category:"matchup",title:"Vision volume trails "+opponentChampion+" in repeated "+roleName+" matchups",evidence:"Across "+vpmPeerGames.length+" games, your VPM averages "+signedText(p.avgVpmDelta,2)+" versus this direct-role opponent champion.",action:"Review where the opposing role is gaining earlier safe access to river/objective information rather than treating this as a generic ward-count problem.",confidence:confidence(vpmPeerGames.length),priority:2,comparison:"repeated direct-role VPM versus "+opponentChampion});
      }else if(vpmPeerGames.length>=3&&hasNum(p.avgVpmDelta)&&Number(p.avgVpmDelta)>=0.15){
        highlights.push({category:"matchup",title:"You create more vision volume than "+opponentChampion,evidence:"Across "+vpmPeerGames.length+" games, your VPM advantage averages "+signedText(p.avgVpmDelta,2)+" versus this direct-role opponent champion.",action:"Preserve the timing and safe routes that create this vision edge; do not overextend simply to maintain the number.",confidence:confidence(vpmPeerGames.length),priority:4,comparison:"repeated direct-role VPM versus "+opponentChampion});
      }
      if(visionSetupGames.length>=3&&hasNum(p.avgObjectiveSetupDelta)&&Number(p.avgObjectiveSetupDelta)<=-0.5){
        focus.push({category:"matchup",title:"Pre-objective setup trails "+opponentChampion,evidence:"Across "+visionSetupGames.length+" peer-comparable timeline games, you average "+Math.abs(Number(p.avgObjectiveSetupDelta)).toFixed(1)+" fewer setup wards near upcoming objectives than "+opponentChampion+".",action:"Review the minute before the objective: reset timing, route choice and when the opposing role first gains uncontested setup access.",confidence:confidence(visionSetupGames.length),priority:2,comparison:"repeated objective-setup wards versus "+opponentChampion});
      }
      if(roleName==="JUNGLE"&&impactGames.length>=3&&hasNum(p.avgImpactDelta)&&Number(p.avgImpactDelta)>=1.5){
        focus.push({category:"matchup",title:"First impact arrives later against "+opponentChampion,evidence:"Across "+impactGames.length+" games, your first tracked impact arrives "+Number(p.avgImpactDelta).toFixed(1)+" minutes later than this enemy Jungler.",action:"Compare opening paths and first actionable windows across these games; identify where tempo is lost before the first supported impact.",confidence:confidence(impactGames.length),priority:2,comparison:"repeated first-impact timing versus "+opponentChampion});
      }
    }
  }
  profiles.sort((a,b)=>b.games-a.games||String(a.opponentChampion).localeCompare(String(b.opponentChampion)));
  return{profiles,focus,highlights};
}
function championBehaviorModel(games:any[],summary:any,behaviorSummary:any,primaryRole:string,peerComparison:any=null){
  const groups=new Map<string,any[]>();
  for(const g of games){
    const key=String(g.champion||"Unknown")+"|"+String(g.role||"GENERIC");
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(g);
  }
  const profiles:any[]=[],focus:any[]=[],highlights:any[]=[];
  const confidence=(n:number)=>n>=5?"medium":"low";
  const usualTrustedGold15=hasNum(peerComparison?.avgGoldDiff15)?Number(peerComparison.avgGoldDiff15):null,usualTrustedGold15Games=Number(peerComparison?.laneGames15||0);
  for(const [key,list] of groups.entries()){
    if(list.length<3)continue;
    const [champion,roleName]=key.split("|"),trustedPeer=list.filter(g=>g.directPeerComparable===true),lane=finiteGames(trustedPeer.filter(g=>g?.phaseRules?.lane15Comparable!==false),g=>g.goldDiff15),tl=list.filter(g=>g.timelineAvailable),items=finiteGames(trustedPeer,g=>g.itemSpikeDeltaVsOpponent),dpmGames=finiteGames(list,g=>g.dpm);
    const vpmGames=finiteGames(trustedPeer,g=>g.peer?.vpmDelta),visionSetupGames=finiteGames(tl.filter(g=>g.directPeerComparable===true),g=>g.vision?.objectiveSetupDeltaVsOpponent),impactGames=finiteGames(tl.filter(g=>g.directPeerComparable===true),g=>g.impactDeltaVsOpponent);
    const roamAttempts=list.reduce((n,g)=>n+Number(g.roams?.attempts||0),0),roamSuccesses=list.reduce((n,g)=>n+Number(g.roams?.successes||0),0),roamAttemptGames=list.filter((g:any)=>Number(g.roams?.attempts||0)>0).length,supportCostEvents=list.flatMap((g:any)=>(g.roams?.events||[]).filter((x:any)=>hasNum(x?.adcLaneCostCs))),supportAdcLaneMovementGameValues=list.map((g:any)=>{const xs=(g.roams?.events||[]).map((x:any)=>x?.adcLaneCostCs).filter(hasNum).map(Number);return xs.length?avg(xs):null;}).filter(hasNum);
    const p:any={
      champion,role:roleName,games:list.length,wins:list.filter(g=>g.win).length,winRate:pct(list.filter(g=>g.win).length,list.length),
      csMin:meanField(list,g=>g.csMin),dpm:meanField(dpmGames,g=>g.dpm),kp:meanField(list,g=>g.kp),
      peerGames:trustedPeer.length,laneGames:lane.length,goldDiff15:meanField(lane,g=>g.goldDiff15),badDeaths:meanField(tl,g=>g.badDeathCount),
      timelineGames:tl.length,dpmGames:dpmGames.length,itemGames:items.length,itemDelta:meanField(items,g=>g.itemSpikeDeltaVsOpponent),
      vpmGames:vpmGames.length,avgVpmDelta:meanField(vpmGames,g=>g.peer?.vpmDelta),
      visionSetupGames:visionSetupGames.length,avgObjectiveSetupDelta:meanField(visionSetupGames,g=>g.vision?.objectiveSetupDeltaVsOpponent),
      impactGames:impactGames.length,avgImpactDelta:meanField(impactGames,g=>g.impactDeltaVsOpponent),
      roamAttempts,roamAttemptGames,roamSuccesses,roamSuccessRate:roamAttempts?100*roamSuccesses/roamAttempts:null,
      supportAdcCostEvents:supportCostEvents.length,supportAdcLaneMovementGames:supportAdcLaneMovementGameValues.length,avgSupportAdcLaneCostCs:meanField(supportCostEvents,(x:any)=>x.adcLaneCostCs),meanGameSupportAdcLaneMovementCs:avg(supportAdcLaneMovementGameValues)
    };
    profiles.push(p);
    if(roleName!==primaryRole)continue;

    if(["ADC","MID","TOP"].includes(roleName)){
      if(lane.length>=3&&hasNum(p.goldDiff15)&&hasNum(usualTrustedGold15)&&usualTrustedGold15Games>=3&&Number(p.goldDiff15)-Number(usualTrustedGold15)<=-300){
        focus.push({category:"champion",title:champion+" lane state is below your usual "+primaryRole+" level",evidence:"Across "+lane.length+" "+champion+" "+primaryRole+" games you average "+signedText(p.goldDiff15,0)+"g at 15 versus "+signedText(usualTrustedGold15,0)+"g across "+usualTrustedGold15Games+" trusted direct-peer @15 games in the Last-20 role sample.",action:"Review the champion-specific first waves, trade pattern and first recall rather than assuming the problem is your general laning.",confidence:confidence(lane.length),priority:2,comparison:"champion-role sample vs your Last-20 primary-role sample"});
      }
      if(dpmGames.length>=3&&hasNum(p.dpm)&&hasNum(summary.dpm)&&Number(p.dpm)-Number(summary.dpm)>=150){
        highlights.push({category:"champion",title:champion+" is a high-output pick in your current sample",evidence:"DPM averages "+Math.round(Number(p.dpm))+" across "+dpmGames.length+" measurable DPM games versus "+Math.round(Number(summary.dpm))+" across the Last-20 role sample.",action:"Preserve the fight positioning and resource conversion that make this pick productive; do not infer mastery from win rate alone.",confidence:confidence(dpmGames.length),priority:4,comparison:"champion-role DPM sample vs your Last-20 primary-role sample"});
      }
    }
    if(tl.length>=3&&hasNum(p.badDeaths)&&hasNum(behaviorSummary?.badDeathsPerTimelineGame)&&Number(p.badDeaths)-Number(behaviorSummary.badDeathsPerTimelineGame)>=0.7){
      focus.push({category:"champion",title:champion+" games contain more high-risk deaths",evidence:"This champion averages "+Number(p.badDeaths).toFixed(1)+" flagged high-risk deaths per timeline game versus "+Number(behaviorSummary.badDeathsPerTimelineGame).toFixed(1)+" overall.",action:"Check whether this champion's range, engage pattern or pathing is pulling you into repeatable risk states.",confidence:confidence(tl.length),priority:2,comparison:"champion-role sample vs your Last-20 primary-role sample"});
    }
    if(items.length>=3&&hasNum(p.itemDelta)&&Number(p.itemDelta)>=1){
      focus.push({category:"champion",title:champion+" reaches the first major item late versus its direct peers",evidence:"Across "+items.length+" comparable games, your first major item is "+Number(p.itemDelta).toFixed(1)+" minutes later than the same-role opponent on average.",action:"Check whether this champion's early recall/resource plan is delaying the first complete item.",confidence:confidence(items.length),priority:2,comparison:"same-role opponents in "+champion+" games"});
    }
    if(["SUPPORT","JUNGLE"].includes(roleName)){
      if(vpmGames.length>=3&&hasNum(p.avgVpmDelta)&&Number(p.avgVpmDelta)<=-0.15){
        focus.push({category:"champion",title:champion+" gives up vision volume to the opposing "+roleName,evidence:"Across "+vpmGames.length+" direct-peer games, your vision score is "+Math.abs(Number(p.avgVpmDelta)).toFixed(2)+" per minute lower than the opposing "+roleName+" on average.",action:"Review whether this pick's movement windows are being used to establish information before the next contest rather than after contact starts.",confidence:confidence(vpmGames.length),priority:2,comparison:"champion-specific VPM vs same-role opponents"});
      }else if(vpmGames.length>=3&&hasNum(p.avgVpmDelta)&&Number(p.avgVpmDelta)>=0.15){
        highlights.push({category:"champion",title:champion+" creates strong vision volume versus direct peers",evidence:"Across "+vpmGames.length+" direct-peer games, your VPM advantage averages "+signedText(p.avgVpmDelta,2)+" versus the opposing "+roleName+".",action:"Preserve the movement windows that create this information without turning extra warding into unsafe entries.",confidence:confidence(vpmGames.length),priority:4,comparison:"champion-specific VPM vs same-role opponents"});
      }
      if(visionSetupGames.length>=3&&hasNum(p.avgObjectiveSetupDelta)&&Number(p.avgObjectiveSetupDelta)<=-0.5){
        focus.push({category:"champion",title:champion+" reaches objective setup with less vision than its role peer",evidence:"Across "+visionSetupGames.length+" peer-comparable timeline games, you average "+Math.abs(Number(p.avgObjectiveSetupDelta)).toFixed(1)+" fewer setup wards near upcoming objectives than the opposing "+roleName+".",action:"Start the vision cycle earlier on this pick and protect enough ward resources for the actual objective approach.",confidence:confidence(visionSetupGames.length),priority:2,comparison:"champion-specific objective-setup wards vs same-role opponents"});
      }
    }
    if(roleName==="JUNGLE"&&impactGames.length>=3&&hasNum(p.avgImpactDelta)){
      if(Number(p.avgImpactDelta)>=1.5)focus.push({category:"champion",title:champion+" reaches first tracked impact later than the enemy Jungler",evidence:"Across "+impactGames.length+" comparable games, first tracked impact arrives "+Number(p.avgImpactDelta).toFixed(1)+" minutes later than the direct Jungle opponent.",action:"Review the opening path and first actionable window on this champion; the goal is not forced ganks, but earlier supported impact when a real window exists.",confidence:confidence(impactGames.length),priority:2,comparison:"champion-specific first impact vs enemy Jungler"});
      else if(Number(p.avgImpactDelta)<=-1.5)highlights.push({category:"champion",title:champion+" reaches first tracked impact early",evidence:"Across "+impactGames.length+" comparable games, first tracked impact arrives "+Math.abs(Number(p.avgImpactDelta)).toFixed(1)+" minutes earlier than the enemy Jungler.",action:"Preserve the pathing/tempo that creates early impact without sacrificing the later objective setup the report measures separately.",confidence:confidence(impactGames.length),priority:4,comparison:"champion-specific first impact vs enemy Jungler"});
    }
    if(roleName==="SUPPORT"&&roamAttempts>=4&&roamAttemptGames>=3&&hasNum(p.roamSuccessRate)&&Number(p.roamSuccessRate)<45){
      const laneMovementReady=supportCostEvents.length>=4&&supportAdcLaneMovementGameValues.length>=3;
      focus.push({category:"champion",title:champion+" roams are converting poorly in the current sample",evidence:roamSuccesses+" of "+roamAttempts+" detected early roam departures across "+roamAttemptGames+" games produced supported return ("+Number(p.roamSuccessRate).toFixed(0)+"%)."+(laneMovementReady&&hasNum(p.meanGameSupportAdcLaneMovementCs)?" Game-weighted ADC-vs-ADC lane movement across "+supportAdcLaneMovementGameValues.length+" measured games averages "+signedText(p.meanGameSupportAdcLaneMovementCs,1)+" CS.":""),action:"Review whether the wave was secure before leaving and when the target play stopped being available; do not compensate by roaming more often.",confidence:confidence(roamAttemptGames),priority:2,comparison:"champion-specific supported roam return across games"});
    }
  }
  profiles.sort((a,b)=>b.games-a.games);
  return{profiles,focus,highlights};
}
function buildPracticeTargets(themes:any[],summary:any,behavior:any,peer:any,sessionModel:any){
  const out:any[]=[];
  const clampPct=(v:number)=>Math.max(0,Math.min(100,v));
  const titles=(t:any)=>[t?.title,...(Array.isArray(t?.supportingTitles)?t.supportingTitles:[])].map(text).join(" ").toLowerCase();
  const primaryRole=text(summary?.primaryRole).toUpperCase(),targetContext:any={coachingSummary:summary,behaviorSummary:behavior,peerComparison:peer,sessionBehavior:sessionModel};
  const targetValue=(path:string)=>String(path||"").split(".").reduce((v:any,k:string)=>v==null?null:v[k],targetContext);
  const samplePathsFor=(metricPath:string):string[]=>({
    "behaviorSummary.earlyLeadGivebackRate":["behaviorSummary.earlyLeadGames"],
    "coachingSummary.csMin":["coachingSummary.games"],
    "coachingSummary.goldDiff15":["peerComparison.laneGames15"],
    "peerComparison.avgGoldDiff15":["peerComparison.laneGames15"],
    "peerComparison.avgImpactDeltaMin":["peerComparison.impactGames"],
    "peerComparison.avgVpmDelta":["peerComparison.vpmGames"],
    "peerComparison.avgObjectiveSetupDelta":["peerComparison.visionSetupGames"],
    "peerComparison.objectiveSetupWardRateDelta":["peerComparison.visionSetupGames"],
    "peerComparison.higherRankAvgMajorItemDeltaMin":["peerComparison.higherRankMajorItemGames"],
    "peerComparison.rankBands.higher.avgGoldDiff15":["peerComparison.rankBands.higher.laneGames"],
    "peerComparison.rankBands.lower.avgGoldDiff15":["peerComparison.rankBands.lower.laneGames"],
    "behaviorSummary.highRiskUntradedPostImpactPerGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.highRiskBehindDeathsPerGame":["behaviorSummary.directPeerTimelineGames"],
    "behaviorSummary.highRiskLeadDeathsPerGame":["behaviorSummary.directPeerTimelineGames"],
    "behaviorSummary.repeatDeathRate":["behaviorSummary.repeatDeathOpportunities"],
    "behaviorSummary.repeatDeathsPerTimelineGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.costlyDeathsPerTimelineGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.badDeathsPerTimelineGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.firstResetLossRate":["behaviorSummary.firstResetCleanGames"],
    "behaviorSummary.greedyStaysPerTimelineGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.soloKillDeathsBeforeShopRate":["behaviorSummary.soloKillResetEvents"],
    "behaviorSummary.itemSpikeUtilizationRate":["behaviorSummary.itemSpikeEligibleWindows"],
    "behaviorSummary.highUnspentFightRate":["behaviorSummary.highUnspentFightSamples"],
    "behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.midRouting.avgCsSwing15to25":["behaviorSummary.midRouting.games"],
    "behaviorSummary.midRouting.avgObjectiveJoinRate":["behaviorSummary.midRouting.games"],
    "behaviorSummary.midRouting.coachingObjectivePresenceRate":["behaviorSummary.midRouting.games"],
    "behaviorSummary.recentShopObjectiveAbsenceRate":["behaviorSummary.neutralObjectiveEvents"],
    "behaviorSummary.preObjectiveDeathPct":["behaviorSummary.classifiedTimelineDeaths"],
    "behaviorSummary.preObjectiveDeathsPerTimelineGame":["behaviorSummary.timelineGames"],
    "behaviorSummary.objectiveSetupWardRate":["behaviorSummary.visionWardTotal"],
    "behaviorSummary.earlySetupObjectiveJoinRate":["behaviorSummary.neutralObjectiveJoins"],
    "behaviorSummary.objectiveSetupCoachingRate":["behaviorSummary.objectiveSetupGames"],
    "behaviorSummary.killConversionRate":["behaviorSummary.killConversionWindows"],
    "behaviorSummary.closing25.leadLateRiskLossRate":["behaviorSummary.closing25.leadLosses"],
    "behaviorSummary.closing25.leadLateRiskPerLeadGameRate":["behaviorSummary.closing25.leadGames"],
    "behaviorSummary.objectiveJoinRate":["behaviorSummary.neutralObjectiveEvents"],
    "behaviorSummary.objectiveCoachingPresenceRate":["behaviorSummary.objectiveContestGames"],
    "behaviorSummary.firstAllyFightDeathRate":["behaviorSummary.fightSamples"],
    "behaviorSummary.preContributionFightDeathRate":["behaviorSummary.fightSamples"],
    "behaviorSummary.damageGoldEfficiency":["coachingSummary.games"],
    "behaviorSummary.highRiskBehindDeathRate":["behaviorSummary.behindStateDeaths"],
    "behaviorSummary.visionActionDeathRate":["behaviorSummary.visionActions"],
    "behaviorSummary.roamSuccessRate":["behaviorSummary.roamAttempts"],
    "behaviorSummary.avgRoamLaneCostCs":["behaviorSummary.roamLaneCostGames"],
    "behaviorSummary.meanGameRoamLaneMovementCs":["behaviorSummary.roamLaneCostMeasuredGames"],
    "behaviorSummary.meanGameSupportRoamAdcLaneMovementCs":["behaviorSummary.supportRoamAdcLaneMovementGames"],
    "sessionBehavior.game3PlusGoldDelta":["sessionBehavior.firstGame.lane15Games","sessionBehavior.game3Plus.lane15Games"],
    "sessionBehavior.postLossGoldDelta":["sessionBehavior.quickAfterLoss.lane15Games","sessionBehavior.quickAfterWin.lane15Games"],
    "sessionBehavior.game3PlusPeerVpmDelta":["sessionBehavior.firstGame.peerVpmGames","sessionBehavior.game3Plus.peerVpmGames"],
    "sessionBehavior.postLossPeerVpmDelta":["sessionBehavior.quickAfterLoss.peerVpmGames","sessionBehavior.quickAfterWin.peerVpmGames"],
    "sessionBehavior.game3PlusPeerKpDelta":["sessionBehavior.firstGame.peerKpGames","sessionBehavior.game3Plus.peerKpGames"],
    "sessionBehavior.postLossPeerKpDelta":["sessionBehavior.quickAfterLoss.peerKpGames","sessionBehavior.quickAfterWin.peerKpGames"],
    "sessionBehavior.game3PlusPeerCsMinDelta":["sessionBehavior.firstGame.peerCsMinGames","sessionBehavior.game3Plus.peerCsMinGames"],
    "sessionBehavior.postLossPeerCsMinDelta":["sessionBehavior.quickAfterLoss.peerCsMinGames","sessionBehavior.quickAfterWin.peerCsMinGames"]
  } as Record<string,string[]>)[metricPath]||["coachingSummary.games"];
  const sampleRequirementsFor=(metricPath:string,minSample:number):any[]=>{
    const special:any={
      "behaviorSummary.roamSuccessRate":[{path:"behaviorSummary.roamAttempts",min:4},{path:"behaviorSummary.roamAttemptGames",min:3}],
      "behaviorSummary.avgRoamLaneCostCs":[{path:"behaviorSummary.roamLaneCostGames",min:4},{path:"behaviorSummary.roamLaneCostMeasuredGames",min:3}],
      "behaviorSummary.meanGameRoamLaneMovementCs":[{path:"behaviorSummary.roamLaneCostGames",min:4},{path:"behaviorSummary.roamLaneCostMeasuredGames",min:3}],
      "behaviorSummary.meanGameSupportRoamAdcLaneMovementCs":[{path:"behaviorSummary.supportRoamAdcLaneMovementWindows",min:4},{path:"behaviorSummary.supportRoamAdcLaneMovementGames",min:3}],
      "behaviorSummary.preObjectiveDeathPct":[{path:"behaviorSummary.classifiedTimelineDeaths",min:5},{path:"behaviorSummary.timelineGames",min:3}],
      "behaviorSummary.objectiveSetupWardRate":[{path:"behaviorSummary.visionWardTotal",min:12},{path:"peerComparison.visionSetupGames",min:5}],
      "behaviorSummary.visionActionDeathRate":[{path:"behaviorSummary.visionActions",min:12},{path:"behaviorSummary.visionActionGames",min:4}],
      "behaviorSummary.earlySetupObjectiveJoinRate":[{path:"behaviorSummary.neutralObjectiveJoins",min:5},{path:"behaviorSummary.objectiveSetupGames",min:3}],
      "behaviorSummary.objectiveSetupCoachingRate":[{path:"behaviorSummary.neutralObjectiveJoins",min:5},{path:"behaviorSummary.objectiveSetupGames",min:3}],
      "behaviorSummary.recentShopObjectiveAbsenceRate":[{path:"behaviorSummary.neutralObjectiveEvents",min:5},{path:"behaviorSummary.objectiveContestGames",min:3}],
      "behaviorSummary.objectiveJoinRate":[{path:"behaviorSummary.neutralObjectiveEvents",min:5},{path:"behaviorSummary.objectiveContestGames",min:3}],
      "behaviorSummary.objectiveCoachingPresenceRate":[{path:"behaviorSummary.neutralObjectiveEvents",min:5},{path:"behaviorSummary.objectiveContestGames",min:3}]
    };
    return special[metricPath]||samplePathsFor(metricPath).map(path=>({path,min:minSample}));
  };
  const add=(theme:any,label:string,metricPath:string,baseline:any,goal:any,direction:"higher"|"lower",unit:string,sampleSize:any,minSample:number,rationale:string)=>{
    if(out.length>=3||!hasNum(baseline)||!hasNum(goal)||Number(sampleSize||0)<minSample)return false;
    const requirementDefs=sampleRequirementsFor(metricPath,minSample),sampleRequirements=requirementDefs.map(req=>({path:req.path,min:Number(req.min||1),value:targetValue(req.path)}));
    if(sampleRequirements.some(req=>!hasNum(req.value)||Number(req.value)<Number(req.min)))return false;
    out.push({themeKey:text(theme?.key),themeLabel:text(theme?.label||theme?.category),label,metricPath,samplePaths:samplePathsFor(metricPath),sampleRequirements,baseline:Number(baseline),goal:Number(goal),direction,unit,sampleSize:Number(sampleSize||0),minSample,baseWindowGames:5,maxWindowGames:20,windowGames:5,windowPolicy:"minimum_5_extend_until_evidence_max_20",evidenceWindowBasis:"new_games_only",rationale,source:"self_relative_short_term"});
    return true;
  };
  for(const theme of themes||[]){
    if(out.length>=3)break;
    const key=text(theme?.key),tt=text(theme?.title).toLowerCase();let added=false;
    if(key==="early-lane"){
      const carryRole=["ADC","MID","TOP"].includes(primaryRole);
      if(/first.?major|major item|item timing/.test(tt)&&/higher.?rank/.test(tt)&&hasNum(peer?.higherRankAvgMajorItemDeltaMin)&&Number(peer.higherRankAvgMajorItemDeltaMin)>=0.75)added=add(theme,"First-major timing vs higher-ranked peer","peerComparison.higherRankAvgMajorItemDeltaMin",peer.higherRankAvgMajorItemDeltaMin,Math.max(0,Number(peer.higherRankAvgMajorItemDeltaMin)-0.5),"lower","minutes",peer?.higherRankMajorItemGames,3,"Test whether first-major completion timing against the actual higher-ranked direct-peer subset moves closer to parity.");
      if(!added&&/higher.?rank/.test(tt)&&/lane|laning|gold/.test(tt)&&carryRole&&hasNum(peer?.rankBands?.higher?.avgGoldDiff15))added=add(theme,"Gold @15 vs higher-ranked peers","peerComparison.rankBands.higher.avgGoldDiff15",peer.rankBands.higher.avgGoldDiff15,Number(peer.rankBands.higher.avgGoldDiff15)+150,"higher","gold",peer?.rankBands?.higher?.laneGames,3,"Move the exact higher-ranked direct-peer lane-gold comparison toward a more favorable @15 state.");
      if(!added&&/lower.?rank/.test(tt)&&/lane|laning|gold|peer/.test(tt)&&carryRole&&hasNum(peer?.rankBands?.lower?.avgGoldDiff15))added=add(theme,"Gold @15 vs lower-ranked peers","peerComparison.rankBands.lower.avgGoldDiff15",peer.rankBands.lower.avgGoldDiff15,Number(peer.rankBands.lower.avgGoldDiff15)+150,"higher","gold",peer?.rankBands?.lower?.laneGames,3,"Move the exact lower-ranked direct-peer lane-gold comparison toward a more favorable @15 state.");
      if(!added&&/impact|influence/.test(tt)&&hasNum(peer?.avgImpactDeltaMin)&&Number(peer.avgImpactDeltaMin)>=1.5)added=add(theme,"First-impact timing vs role peer","peerComparison.avgImpactDeltaMin",peer.avgImpactDeltaMin,Math.max(0,Number(peer.avgImpactDeltaMin)-1),"lower","minutes",peer?.impactGames,5,"Test whether the first supported kill/assist/objective impact moves closer to the direct role opponent's timing.");
      if(!added&&carryRole&&/lead|leak|give.?back|preserv/.test(tt)&&hasNum(behavior?.earlyLeadGivebackRate))added=add(theme,"Early-lead give-back rate","behaviorSummary.earlyLeadGivebackRate",behavior.earlyLeadGivebackRate,clampPct(Number(behavior.earlyLeadGivebackRate)-15),"lower","percent",behavior?.earlyLeadGames,4,"Test whether meaningful pre-15 direct-role leads are surviving to the 15-minute checkpoint more consistently.");
      if(!added&&["ADC","MID","TOP","JUNGLE"].includes(primaryRole)&&/farm|cs\/min/.test(tt)&&hasNum(summary?.csMin))added=add(theme,"CS / min","coachingSummary.csMin",summary.csMin,Number(summary.csMin)+0.3,"higher","cs_per_min",summary?.games,5,"A small self-relative farming increase is easier to practise and verify than a generic rank benchmark.");
      if(!added&&carryRole&&/lane|laning|gold|economy/.test(tt)&&!/higher.?rank|lower.?rank/.test(tt)&&hasNum(peer?.avgGoldDiff15))added=add(theme,"Gold differential @15","peerComparison.avgGoldDiff15",peer.avgGoldDiff15,Number(peer.avgGoldDiff15)+150,"higher","gold",peer?.laneGames15,5,"Move the trusted direct-role @15 lane state by about 150g without changing the comparison population.");
    }else if(key==="death-risk"){
      if(/post-play|give-back|successful play/.test(tt)&&hasNum(behavior?.highRiskUntradedPostImpactPerGame))added=add(theme,"High-risk post-play give-backs / game","behaviorSummary.highRiskUntradedPostImpactPerGame",behavior.highRiskUntradedPostImpactPerGame,Math.max(0,Number(behavior.highRiskUntradedPostImpactPerGame)-0.15),"lower","per_game",behavior?.timelineGames,5,"Measure whether successful plays are being preserved instead of immediately surrendered by a high-risk untraded follow-up death.");
      if(!added&&/behind|deficit/.test(tt)&&hasNum(behavior?.highRiskBehindDeathsPerGame))added=add(theme,"High-risk deaths while behind / game","behaviorSummary.highRiskBehindDeathsPerGame",behavior.highRiskBehindDeathsPerGame,Math.max(0,Number(behavior.highRiskBehindDeathsPerGame)-0.2),"lower","per_game",behavior?.directPeerTimelineGames,5,"Reduce the specific high-variance deaths that compound an existing direct-role deficit.");
      if(!added&&/lead|ahead|throw/.test(tt)&&hasNum(behavior?.highRiskLeadDeathsPerGame))added=add(theme,"High-risk deaths while ahead / game","behaviorSummary.highRiskLeadDeathsPerGame",behavior.highRiskLeadDeathsPerGame,Math.max(0,Number(behavior.highRiskLeadDeathsPerGame)-0.2),"lower","per_game",behavior?.directPeerTimelineGames,5,"Protect existing advantages by cutting one high-risk lead death roughly every five trusted direct-peer timeline games.");
      if(!added&&/repeat/.test(tt)&&hasNum(behavior?.repeatDeathsPerTimelineGame))added=add(theme,"Rapid repeat deaths / game","behaviorSummary.repeatDeathsPerTimelineGame",behavior.repeatDeathsPerTimelineGame,Math.max(0,Number(behavior.repeatDeathsPerTimelineGame)-0.2),"lower","per_game",behavior?.timelineGames,5,"Cut roughly one rapid repeat death per five timeline-complete coaching games; the metric remains measurable at zero even when no repeat-death opportunity occurs.");
      if(!added&&hasNum(behavior?.costlyDeathsPerTimelineGame))added=add(theme,"Costly deaths / game","behaviorSummary.costlyDeathsPerTimelineGame",behavior.costlyDeathsPerTimelineGame,Math.max(0,Number(behavior.costlyDeathsPerTimelineGame)-0.25),"lower","per_game",behavior?.timelineGames,5,"Prioritize deaths with measurable follow-on loss rather than chasing a prettier raw KDA.");
      if(!added&&hasNum(behavior?.badDeathsPerTimelineGame))added=add(theme,"High-risk deaths / game","behaviorSummary.badDeathsPerTimelineGame",behavior.badDeathsPerTimelineGame,Math.max(0,Number(behavior.badDeathsPerTimelineGame)-0.25),"lower","per_game",behavior?.timelineGames,5,"A modest reduction is measurable over a short practice block without demanding zero deaths.");
    }else if(key==="reset-power"){
      if(/first shop|shop sequence|reset sequence|first reset/.test(tt)&&hasNum(behavior?.firstResetLossRate))added=add(theme,"First-shop economy-loss rate","behaviorSummary.firstResetLossRate",behavior.firstResetLossRate,clampPct(Number(behavior.firstResetLossRate)-15),"lower","percent",behavior?.firstResetCleanGames,4,"Reduce first-shop sequences that surrender a wave-sized amount of direct-role economy.");
      if(/post-kill|solo kill|bank/.test(tt)&&hasNum(behavior?.soloKillDeathsBeforeShopRate))added=add(theme,"Deaths before next shop after solo kill","behaviorSummary.soloKillDeathsBeforeShopRate",behavior.soloKillDeathsBeforeShopRate,clampPct(Number(behavior.soloKillDeathsBeforeShopRate)-15),"lower","percent",behavior?.soloKillResetEvents,3,"Convert won duels into banked power instead of giving the advantage back before shopping.");
      if(!added&&/item|spike|power/.test(tt)&&hasNum(behavior?.itemSpikeUtilizationRate))added=add(theme,"Earlier-item windows used","behaviorSummary.itemSpikeUtilizationRate",behavior.itemSpikeUtilizationRate,clampPct(Number(behavior.itemSpikeUtilizationRate)+15),"higher","percent",behavior?.itemSpikeEligibleWindows,4,"Use more of the temporary first-major-item advantage before the opponent reaches parity.");
      if(!added&&/high.?gold|greedy|stay|spendable gold/.test(tt)&&hasNum(behavior?.greedyStaysPerTimelineGame))added=add(theme,"High-gold stays / game","behaviorSummary.greedyStaysPerTimelineGame",behavior.greedyStaysPerTimelineGame,Math.max(0,Number(behavior.greedyStaysPerTimelineGame)-0.2),"lower","per_game",behavior?.timelineGames,5,"Reduce high-gold stay windows by roughly one per five timeline-complete coaching games while keeping the metric measurable at zero.");
      if(!added&&/unspent|stored gold|1000g/.test(tt)&&hasNum(behavior?.highUnspentFightRate))added=add(theme,"Fight starts with ≥1000g unspent","behaviorSummary.highUnspentFightRate",behavior.highUnspentFightRate,clampPct(Number(behavior.highUnspentFightRate)-10),"lower","percent",behavior?.fightSamples,8,"Convert stored gold into combat stats before likely contest windows.");
    }else if(key==="mid-routing"){
      const m=behavior?.midRouting||{};
      if(/side-lane|side lane/.test(tt)&&hasNum(behavior?.preNeutralObjectiveSideLaneDeathsPerGame))added=add(theme,"Pre-objective side-lane deaths / game","behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame",behavior.preNeutralObjectiveSideLaneDeathsPerGame,Math.max(0,Number(behavior.preNeutralObjectiveSideLaneDeathsPerGame)-0.15),"lower","per_game",behavior?.timelineGames,5,"Measure whether side-lane pressure is ending earlier and reconnecting before the next neutral-objective window.");
      if(!added&&/farm|cs|wave/.test(tt)&&hasNum(m.avgCsSwing15to25)&&Number(m.avgCsSwing15to25)<0)added=add(theme,"CS swing 15→25","behaviorSummary.midRouting.avgCsSwing15to25",m.avgCsSwing15to25,Number(m.avgCsSwing15to25)+2,"higher","cs",m.games,4,"Keep more side-wave economy through the first rotations without abandoning objective presence.");
      if(!added&&/objective|presence|attendance|reconnect|routing|movement/.test(tt)&&hasNum(m.coachingObjectivePresenceRate??m.meanGameObjectiveJoinRate??m.avgObjectiveJoinRate)){const midPresence=m.coachingObjectivePresenceRate??m.meanGameObjectiveJoinRate??m.avgObjectiveJoinRate;added=add(theme,"Mid-routing objective presence","behaviorSummary.midRouting.coachingObjectivePresenceRate",midPresence,clampPct(Number(midPresence)+10),"higher","percent",m.games,4,"Improve the trade-off between collecting mid-game resources and arriving for team-contested neutral-objective action.");}
    }else if(key==="objectives-closing"){
      const closing=behavior?.closing25||{},diagnosis=behavior?.objectiveDiagnosis||{},cause=text(diagnosis?.primaryExplanation??diagnosis?.primaryCause);
      if(cause==="recent_shop_absence"&&hasNum(behavior?.recentShopObjectiveAbsenceRate??behavior?.lateResetObjectiveMissRate))added=add(theme,"Recent-shop objective absence rate","behaviorSummary.recentShopObjectiveAbsenceRate",behavior.recentShopObjectiveAbsenceRate??behavior.lateResetObjectiveMissRate,clampPct(Number(behavior.recentShopObjectiveAbsenceRate??behavior.lateResetObjectiveMissRate)-10),"lower","percent",behavior?.neutralObjectiveEvents,5,"Reduce the observed association between finishing a shop in the final minute and being absent at the next team-contested neutral-objective encounter.");
      if(!added&&cause==="pre_objective_death"&&hasNum(behavior?.preObjectiveDeathsPerTimelineGame))added=add(theme,"Pre-objective deaths / game","behaviorSummary.preObjectiveDeathsPerTimelineGame",behavior.preObjectiveDeathsPerTimelineGame,Math.max(0,Number(behavior.preObjectiveDeathsPerTimelineGame)-0.2),"lower","per_game",behavior?.timelineGames,5,"Target the supported pre-contest death pattern directly while keeping the practice metric measurable at zero when no such death occurs.");
      if(!added&&cause==="setup_vision"&&hasNum(peer?.objectiveSetupWardRateDelta)&&Number(peer.objectiveSetupWardRateDelta)<=-10)added=add(theme,"Objective-setup ward-share delta vs role peer","peerComparison.objectiveSetupWardRateDelta",peer.objectiveSetupWardRateDelta,Math.min(0,Number(peer.objectiveSetupWardRateDelta)+10),"higher","percentage_points",peer?.visionSetupGames,5,"Target the supported peer-relative setup-vision gap directly rather than substituting raw ward volume.");
      if(!added&&/setup|arrival/.test(tt)&&hasNum(behavior?.objectiveSetupCoachingRate))added=add(theme,"Prior objective setup","behaviorSummary.objectiveSetupCoachingRate",behavior.objectiveSetupCoachingRate,clampPct(Number(behavior.objectiveSetupCoachingRate)+10),"higher","percent",behavior?.objectiveSetupGames,3,"Increase the equal-weight per-game share of joined team-contested objectives where supported prior-position evidence already places you near the area 45–105 seconds before the event.");
      if(!added&&/conversion|kill/.test(tt)&&hasNum(behavior?.killConversionRate))added=add(theme,"Post-kill conversion","behaviorSummary.killConversionRate",behavior.killConversionRate,clampPct(Number(behavior.killConversionRate)+10),"higher","percent",behavior?.killConversionWindows,5,"Turn more won action into the next supported objective or structure window.");
      if(!added&&/closing|lead.?@?25|25-minute|late risk/.test(tt)&&hasNum(closing.leadLateRiskPerLeadGameRate))added=add(theme,"Lead@25 games lost with late risk","behaviorSummary.closing25.leadLateRiskPerLeadGameRate",closing.leadLateRiskPerLeadGameRate,clampPct(Number(closing.leadLateRiskPerLeadGameRate)-10),"lower","percent",closing?.leadGames,4,"Reduce the share of all games with a ≥+500g direct-role lead at 25 that still end in a loss containing late high-risk or costly-death evidence; zero remains measurable when every lead closes or no lead loss contains late risk.");
      if(!added&&/objective|presence|attendance|contest/.test(tt)&&hasNum(behavior?.objectiveCoachingPresenceRate))added=add(theme,"Objective presence","behaviorSummary.objectiveCoachingPresenceRate",behavior.objectiveCoachingPresenceRate,clampPct(Number(behavior.objectiveCoachingPresenceRate)+10),"higher","percent",behavior?.objectiveContestGames,3,"Raise the equal-weight per-game supported presence around team-contested neutral-objective encounters without relying on a population average.");
    }else if(key==="teamfights"){
      if(/first allied|first death|entry|position|survival/.test(tt)&&hasNum(behavior?.firstAllyFightDeathRate))added=add(theme,"First allied death rate","behaviorSummary.firstAllyFightDeathRate",behavior.firstAllyFightDeathRate,clampPct(Number(behavior.firstAllyFightDeathRate)-10),"lower","percent",behavior?.fightSamples,8,"Test whether later/safer fight entry is preserving uptime.");
      if(!added&&/before.*contribut|contribution|removed before|uptime/.test(tt)&&hasNum(behavior?.preContributionFightDeathRate))added=add(theme,"Died before contribution","behaviorSummary.preContributionFightDeathRate",behavior.preContributionFightDeathRate,clampPct(Number(behavior.preContributionFightDeathRate)-10),"lower","percent",behavior?.fightSamples,8,"Reduce fights where the player is removed before producing tracked combat impact.");
      if(!added&&["ADC","MID","TOP"].includes(primaryRole)&&/damage|resource|output|gold share/.test(tt)&&hasNum(behavior?.damageGoldEfficiency))added=add(theme,"Damage share − gold share","behaviorSummary.damageGoldEfficiency",behavior.damageGoldEfficiency,Number(behavior.damageGoldEfficiency)+2,"higher","percentage_points",summary?.games,5,"Improve output from the same share of team resources rather than simply demanding more farm.");
    }else if(key==="recovery"){
      if(hasNum(behavior?.highRiskBehindDeathsPerGame))added=add(theme,"High-risk deaths while behind / game","behaviorSummary.highRiskBehindDeathsPerGame",behavior.highRiskBehindDeathsPerGame,Math.max(0,Number(behavior.highRiskBehindDeathsPerGame)-0.2),"lower","per_game",behavior?.directPeerTimelineGames,5,"Measure whether recovery play is becoming lower variance when the direct role matchup is already behind; the per-game metric remains measurable when the unwanted death count reaches zero.");
    }else if(key==="vision"){
      if(/vision-action|ward placement|ward clear|vision.*death|unsafe vision/.test(tt)&&hasNum(behavior?.visionActionDeathRate)&&Number(behavior?.visionActions||0)>=12)added=add(theme,"Vision-action death rate","behaviorSummary.visionActionDeathRate",behavior.visionActionDeathRate,clampPct(Number(behavior.visionActionDeathRate)-5),"lower","percent",behavior?.visionActions,12,"Keep creating vision while making the route/team timing safer.");
      if(!added&&/giving up vision volume|vision volume trails|vision score/.test(tt)&&hasNum(peer?.avgVpmDelta)&&Number(peer.avgVpmDelta)<=-0.15)added=add(theme,"Vision/min delta vs role peer","peerComparison.avgVpmDelta",peer.avgVpmDelta,Math.min(0,Number(peer.avgVpmDelta)+0.15),"higher","vpm",peer?.vpmGames,5,"Narrow the direct-role vision/min gap without treating raw ward volume as a substitute for safe, useful information.");
      if(!added&&/ward volume.*objective setup|ward share/.test(tt)&&hasNum(peer?.objectiveSetupWardRateDelta)&&Number(peer.objectiveSetupWardRateDelta)<=-10)added=add(theme,"Objective-setup ward-share delta vs role peer","peerComparison.objectiveSetupWardRateDelta",peer.objectiveSetupWardRateDelta,Math.min(0,Number(peer.objectiveSetupWardRateDelta)+10),"higher","percentage_points",peer?.visionSetupGames,5,"Narrow the peer-relative share of wards that contribute to upcoming objective setup.");
      if(!added&&/pre-objective vision setup|setup trails|fewer wards/.test(tt)&&hasNum(peer?.avgObjectiveSetupDelta)&&Number(peer.avgObjectiveSetupDelta)<=-0.5)added=add(theme,"Objective-setup wards vs role peer","peerComparison.avgObjectiveSetupDelta",peer.avgObjectiveSetupDelta,Math.min(0,Number(peer.avgObjectiveSetupDelta)+0.5),"higher","wards",peer?.visionSetupGames,5,"Narrow the direct-role gap in wards established near upcoming objectives.");
    }else if(key==="roaming"){
      const laneIntent=/lane cost|lane economy|lane movement|expensive for|costing lane|adc/.test(tt);
      if(laneIntent&&primaryRole==="SUPPORT"&&hasNum(behavior?.meanGameSupportRoamAdcLaneMovementCs))added=add(theme,"ADC lane movement during roams","behaviorSummary.meanGameSupportRoamAdcLaneMovementCs",behavior.meanGameSupportRoamAdcLaneMovementCs,Number(behavior.meanGameSupportRoamAdcLaneMovementCs)+2,"higher","cs",behavior?.supportRoamAdcLaneMovementGames,3,"Improve the game-weighted ADC-vs-ADC lane movement during measured Support roam windows without treating the roam as sole cause.");
      if(!added&&laneIntent&&["MID","TOP"].includes(primaryRole)&&hasNum(behavior?.meanGameRoamLaneMovementCs))added=add(theme,"Roam lane movement","behaviorSummary.meanGameRoamLaneMovementCs",behavior.meanGameRoamLaneMovementCs,Number(behavior.meanGameRoamLaneMovementCs)+2,"higher","cs",behavior?.roamLaneCostMeasuredGames,3,"Improve the game-weighted role-relative lane movement across measured roaming games without forcing more roams.");
      if(!added&&!laneIntent&&/roam|convert|conversion|return/.test(tt)&&hasNum(behavior?.roamSuccessRate))added=add(theme,"Roam conversion","behaviorSummary.roamSuccessRate",behavior.roamSuccessRate,clampPct(Number(behavior.roamSuccessRate)+10),"higher","percent",behavior?.roamAttempts,4,"Improve the share of detected departures that return a kill/assist or objective across a multi-game sample.");
    }else if(key==="consistency"){
      const postLossIntent=/post.?loss|requeue/.test(tt),laterIntent=/later.?session|game 3|session habit/.test(tt);
      const laterFirst=()=> {
        if(primaryRole==="SUPPORT"){
          if(hasNum(sessionModel?.game3PlusPeerVpmDelta)&&Number(sessionModel.game3PlusPeerVpmDelta)<=-0.15)return add(theme,"Game 3+ vision/min vs opponent delta","sessionBehavior.game3PlusPeerVpmDelta",sessionModel.game3PlusPeerVpmDelta,Math.min(0,Number(sessionModel.game3PlusPeerVpmDelta)+0.15),"higher","vpm",Math.min(Number(sessionModel?.firstGame?.peerVpmGames||0),Number(sessionModel?.game3Plus?.peerVpmGames||0)),3,"Test whether later-session Support vision volume moves back toward the player's own session-opening level.");
          if(hasNum(sessionModel?.game3PlusPeerKpDelta)&&Number(sessionModel.game3PlusPeerKpDelta)<=-10)return add(theme,"Game 3+ KP vs opponent delta","sessionBehavior.game3PlusPeerKpDelta",sessionModel.game3PlusPeerKpDelta,Math.min(0,Number(sessionModel.game3PlusPeerKpDelta)+10),"higher","percentage_points",Math.min(Number(sessionModel?.firstGame?.peerKpGames||0),Number(sessionModel?.game3Plus?.peerKpGames||0)),3,"Test whether later-session Support involvement moves back toward the player's own session-opening level.");
        }else if(primaryRole==="JUNGLE"){
          if(hasNum(sessionModel?.game3PlusPeerCsMinDelta)&&Number(sessionModel.game3PlusPeerCsMinDelta)<=-0.3)return add(theme,"Game 3+ CS/min vs opponent delta","sessionBehavior.game3PlusPeerCsMinDelta",sessionModel.game3PlusPeerCsMinDelta,Math.min(0,Number(sessionModel.game3PlusPeerCsMinDelta)+0.3),"higher","cs_per_min",Math.min(Number(sessionModel?.firstGame?.peerCsMinGames||0),Number(sessionModel?.game3Plus?.peerCsMinGames||0)),3,"Test whether later-session Jungle farm pace moves back toward the player's own session-opening level.");
          if(hasNum(sessionModel?.game3PlusPeerKpDelta)&&Number(sessionModel.game3PlusPeerKpDelta)<=-10)return add(theme,"Game 3+ KP vs opponent delta","sessionBehavior.game3PlusPeerKpDelta",sessionModel.game3PlusPeerKpDelta,Math.min(0,Number(sessionModel.game3PlusPeerKpDelta)+10),"higher","percentage_points",Math.min(Number(sessionModel?.firstGame?.peerKpGames||0),Number(sessionModel?.game3Plus?.peerKpGames||0)),3,"Test whether later-session Jungle involvement moves back toward the player's own session-opening level.");
        }else if(["ADC","MID","TOP"].includes(primaryRole)){
          if(hasNum(sessionModel?.game3PlusGoldDelta)&&Number(sessionModel.game3PlusGoldDelta)<=-300)return add(theme,"Game 3+ gold@15 delta","sessionBehavior.game3PlusGoldDelta",sessionModel.game3PlusGoldDelta,Math.min(0,Number(sessionModel.game3PlusGoldDelta)+150),"higher","gold",Math.min(Number(sessionModel?.firstGame?.lane15Games||0),Number(sessionModel?.game3Plus?.lane15Games||0)),3,"Move later-session lane state closer to the player's own session-opening level.");
          if(hasNum(sessionModel?.game3PlusPeerCsMinDelta)&&Number(sessionModel.game3PlusPeerCsMinDelta)<=-0.3)return add(theme,"Game 3+ CS/min vs opponent delta","sessionBehavior.game3PlusPeerCsMinDelta",sessionModel.game3PlusPeerCsMinDelta,Math.min(0,Number(sessionModel.game3PlusPeerCsMinDelta)+0.3),"higher","cs_per_min",Math.min(Number(sessionModel?.firstGame?.peerCsMinGames||0),Number(sessionModel?.game3Plus?.peerCsMinGames||0)),3,"Test whether later-session farm pace moves back toward the player's own session-opening level.");
        }
        return false;
      };
      const postLossFirst=()=> {
        if(primaryRole==="SUPPORT"){
          if(hasNum(sessionModel?.postLossPeerVpmDelta)&&Number(sessionModel.postLossPeerVpmDelta)<=-0.15)return add(theme,"Quick post-loss vision/min vs opponent delta","sessionBehavior.postLossPeerVpmDelta",sessionModel.postLossPeerVpmDelta,Math.min(0,Number(sessionModel.postLossPeerVpmDelta)+0.15),"higher","vpm",Math.min(Number(sessionModel?.quickAfterLoss?.peerVpmGames||0),Number(sessionModel?.quickAfterWin?.peerVpmGames||0)),3,"Test whether Support vision volume after a quick post-loss requeue moves back toward the quick post-win comparison level.");
          if(hasNum(sessionModel?.postLossPeerKpDelta)&&Number(sessionModel.postLossPeerKpDelta)<=-10)return add(theme,"Quick post-loss KP vs opponent delta","sessionBehavior.postLossPeerKpDelta",sessionModel.postLossPeerKpDelta,Math.min(0,Number(sessionModel.postLossPeerKpDelta)+10),"higher","percentage_points",Math.min(Number(sessionModel?.quickAfterLoss?.peerKpGames||0),Number(sessionModel?.quickAfterWin?.peerKpGames||0)),3,"Test whether Support involvement after a quick post-loss requeue moves back toward the quick post-win comparison level.");
        }else if(primaryRole==="JUNGLE"){
          if(hasNum(sessionModel?.postLossPeerCsMinDelta)&&Number(sessionModel.postLossPeerCsMinDelta)<=-0.3)return add(theme,"Quick post-loss CS/min vs opponent delta","sessionBehavior.postLossPeerCsMinDelta",sessionModel.postLossPeerCsMinDelta,Math.min(0,Number(sessionModel.postLossPeerCsMinDelta)+0.3),"higher","cs_per_min",Math.min(Number(sessionModel?.quickAfterLoss?.peerCsMinGames||0),Number(sessionModel?.quickAfterWin?.peerCsMinGames||0)),3,"Test whether Jungle farm pace after a quick post-loss requeue moves back toward the quick post-win comparison level.");
          if(hasNum(sessionModel?.postLossPeerKpDelta)&&Number(sessionModel.postLossPeerKpDelta)<=-10)return add(theme,"Quick post-loss KP vs opponent delta","sessionBehavior.postLossPeerKpDelta",sessionModel.postLossPeerKpDelta,Math.min(0,Number(sessionModel.postLossPeerKpDelta)+10),"higher","percentage_points",Math.min(Number(sessionModel?.quickAfterLoss?.peerKpGames||0),Number(sessionModel?.quickAfterWin?.peerKpGames||0)),3,"Test whether Jungle involvement after a quick post-loss requeue moves back toward the quick post-win comparison level.");
        }else if(["ADC","MID","TOP"].includes(primaryRole)){
          if(hasNum(sessionModel?.postLossGoldDelta)&&Number(sessionModel.postLossGoldDelta)<=-300)return add(theme,"Quick post-loss requeue gold@15 delta","sessionBehavior.postLossGoldDelta",sessionModel.postLossGoldDelta,Math.min(0,Number(sessionModel.postLossGoldDelta)+150),"higher","gold",Math.min(Number(sessionModel?.quickAfterLoss?.lane15Games||0),Number(sessionModel?.quickAfterWin?.lane15Games||0)),3,"Test whether the quick post-loss lane-state gap narrows toward the quick post-win comparison level.");
          if(hasNum(sessionModel?.postLossPeerCsMinDelta)&&Number(sessionModel.postLossPeerCsMinDelta)<=-0.3)return add(theme,"Quick post-loss CS/min vs opponent delta","sessionBehavior.postLossPeerCsMinDelta",sessionModel.postLossPeerCsMinDelta,Math.min(0,Number(sessionModel.postLossPeerCsMinDelta)+0.3),"higher","cs_per_min",Math.min(Number(sessionModel?.quickAfterLoss?.peerCsMinGames||0),Number(sessionModel?.quickAfterWin?.peerCsMinGames||0)),3,"Test whether farm pace after a quick post-loss requeue moves back toward the quick post-win comparison level.");
        }
        return false;
      };
      added=postLossIntent?postLossFirst():laterIntent?laterFirst():false;
    }
  }
  return out;
}

function buildReplayReviewQueue(games:any[]){
  const candidates:any[]=[];
  const add=(g:any,score:number,category:string,minute:any,title:string,evidence:string,prompt:string,tab:string)=>{
    if(!g||!text(g.matchId)||!hasNum(minute))return;
    candidates.push({matchId:text(g.matchId),gameStartTimestamp:Number(g.gameStartTimestamp||0),champion:text(g.champion)||"Unknown",role:text(g.role)||"GENERIC",opponentChampion:text(g.peer?.champion)||null,minute:Number(minute),score,category,title,evidence,prompt,tab});
  };
  for(const g of games||[]){
    for(const ev of g.deathConsequences?.events||[]){
      if(!ev?.costly)continue;
      const bits:string[]=[];
      if(ev.roleEconomyComparable===true&&hasNum(ev.goldSwingAfter))bits.push(signedText(ev.goldSwingAfter,0)+"g direct-role swing");
      if(ev.roleEconomyComparable===true&&hasNum(ev.csSwingAfter))bits.push(signedText(ev.csSwingAfter,0)+" CS direct-role swing");
      if(ev.enemyObjectiveAfter)bits.push("enemy objective followed");
      if(ev.untraded===true||ev.traded===false)bits.push("untraded");
      add(g,ev.severe?122:108,"death consequences",ev.time,ev.severe?"Review this high-cost death first":"Review this costly death",bits.join(" · ")||"Measurable follow-on loss after death","Pause 10–15 seconds before the death: what information, safer route or reset would have preserved the next wave/objective?", "deaths");
    }
    for(const ev of g.directPeerComparable===true?(g.leadDeaths||[]):[]){
      if(!ev?.highRisk)continue;
      const bits=[hasNum(ev.goldDiffAtDeath)?signedText(ev.goldDiffAtDeath,0)+"g vs role at death":null,hasNum(ev.goldSwingAfter)?signedText(ev.goldSwingAfter,0)+"g role swing after":null,ev.enemyObjectiveAfter?"enemy objective followed":null].filter(Boolean).join(" · ");
      add(g,120,"lead protection",ev.time,"Review this death while ahead",bits||"High-risk death while materially ahead","Identify the lowest-risk line that keeps the existing lead: reset, wait for information, or move with teammates instead of giving a comeback window.","deaths");
    }
    const firstReset=g.firstResetSequence;
    if(g.directPeerComparable===true&&firstReset?.economyLoss&&!firstReset?.deathInWindow)add(g,103,"resets",firstReset.time,"Review this first-shop economy loss",(hasNum(firstReset.goldSwingAfter)?signedText(firstReset.goldSwingAfter,0)+"g role swing":"")+(hasNum(firstReset.csSwingAfter)?" · "+signedText(firstReset.csSwingAfter,1)+" CS role swing":""),"Review the wave state before the shop and the return path. What sequence lets you spend without conceding the next lane-economy window?","resets");
    const earlyLead=g.earlyLeadWindow;
    if(g.directPeerComparable===true&&g?.phaseRules?.lane15Comparable!==false&&earlyLead?.eligible&&earlyLead?.giveback)add(g,Number(earlyLead.highRiskDeathsAfterPeak||0)>0?111:99,"early lead",earlyLead.peakMin,"Review where this early lead started to unwind",signedText(earlyLead.peakGoldDiff,0)+"g role lead at "+Number(earlyLead.peakMin).toFixed(1)+"m → "+signedText(earlyLead.goldDiff15,0)+"g at 15 ("+signedText(earlyLead.goldSwingTo15,0)+"g)"+(Number(earlyLead.deathsAfterPeak||0)?" · "+String(earlyLead.deathsAfterPeak)+" death(s) after peak":""),"Review from the peak lead through 15. Mark the first avoidable loss of wave, reset timing, pathing or risk; do not assume the largest visible event caused the full economy swing.","macro");
    for(const ev of g.objectiveReadiness?.events||[]){
      if(!(ev?.recentShopAbsence??ev?.lateResetMiss))continue;
      add(g,114,"objective setup",ev.time,"Review this recent-shop objective absence",(ev.objectiveType||"neutral objective")+(hasNum(ev.secondsSinceShop)?" · shopped "+Math.round(Number(ev.secondsSinceShop))+"s before objective":"")+" · association, not proven cause","Reconstruct the minute before the objective: was the purchase timing actually too late, or did the wave/path decision after shopping make arrival impossible?","objectives");
    }
    for(const ev of g.sideLaneRisk?.events||[]){
      if(ev?.isolated!==true)continue;
      const beforeObj=ev?.neutralObjectiveSoon===true&&hasNum(ev?.secondsBeforeNeutralObjective);
      if(beforeObj){
        const evidence=[String(ev.zone||"side lane"),Math.round(Number(ev.secondsBeforeNeutralObjective))+"s before "+String(ev.neutralObjectiveType||"neutral objective"),hasNum(ev.goldDiffAtDeath)?signedText(ev.goldDiffAtDeath,0)+"g vs role":null,ev.highRisk?"high-risk":null].filter(Boolean).join(" · ");
        add(g,116,"mid routing",ev.time,"Review this isolated side-lane death before an objective",evidence,"Start the replay from the previous wave. When should the side-lane collection have ended so you could preserve the farm while still reconnecting safely before the objective window?","deaths");
      }else if(ev?.highRisk===true){
        const evidence=[String(ev.zone||"side lane"),"isolated",hasNum(ev.goldDiffAtDeath)?signedText(ev.goldDiffAtDeath,0)+"g vs role":null].filter(Boolean).join(" · ");
        add(g,94,"mid routing",ev.time,"Review this high-risk isolated side-lane death",evidence,"Identify the last safe exit timing. Which missing opponents, wave depth or next map event should have ended the side-lane extension earlier?","deaths");
      }
    }
    for(const ev of g.fightProfile?.events||[]){
      if(ev?.firstAllyDeath)add(g,112,"teamfights",ev.startMin,"Review this first-death fight entry",(ev.fightZone?String(ev.fightZone)+" · ":"")+(ev.kills||0)+"-kill fight cluster"+(ev.outnumberedAtFirstKill?" · started outnumbered":"")+(ev.itemDisadvantage?" · item disadvantage":"") ,"Watch only your first three seconds in the fight: could you enter second, preserve range, or wait for the first enemy threat/CC to be committed?","fights");
      else if(ev?.diedBeforeContribution)add(g,109,"teamfights",ev.startMin,"Review this pre-contribution death",(ev.fightZone?String(ev.fightZone)+" · ":"")+(ev.kills||0)+"-kill fight cluster · died before tracked kill/assist contribution","Check approach angle, threat range and initial positioning. What single positioning change would let you survive long enough to contribute?","fights");
      else if(ev?.outnumberedAtFirstKill&&ev?.lostFight)add(g,101,"fight selection",ev.startMin,"Review this outnumbered fight",(ev.fightZone?String(ev.fightZone)+" · ":"")+"Fight began "+String(Math.abs(Number(ev.numbersDelta||0)))+" nearby player(s) down and was lost","Find the last moment you could still disengage or trade elsewhere. What information should have stopped the commitment?","fights");
    }
    for(const ev of g.fightProfile?.absenceEvents||[]){
      const tradeBits=[ev?.fightZone?String(ev.fightZone):null,hasNum(ev?.crossMapGoldSwingVsPeer)?signedText(ev.crossMapGoldSwingVsPeer,0)+"g vs role over trade window":null,hasNum(ev?.crossMapCsSwingVsPeer)?signedText(ev.crossMapCsSwingVsPeer,1)+" CS vs role":null,Number(ev?.playerStructureGains||0)>0?String(ev.playerStructureGains)+" structure involvement":null,Number(ev?.playerNeutralObjectiveGains||0)>0?String(ev.playerNeutralObjectiveGains)+" neutral objective gain":null].filter(Boolean).join(" · ");
      if(ev?.joinReviewPriority==="high")add(g,106,"fight selection",ev.startMin,"Review this skipped teamfight",tradeBits+" · team fight kills "+String(ev.teamFightKills||0)+"-"+String(ev.enemyFightKills||0)+" · no supported cross-map compensation","Start 20 seconds before the first kill. Was the fight reachable with a safe route before commitment, or should the cross-map plan have produced a concrete objective/economy trade instead?","fights");
      else if(ev?.crossMapTradeSupported===true)add(g,82,"fight selection",ev.startMin,"Review this cross-map trade instead of joining",tradeBits+" · team fight kills "+String(ev.teamFightKills||0)+"-"+String(ev.enemyFightKills||0),"Check whether the measurable trade was actually secured because you stayed cross-map and whether joining would have required abandoning guaranteed value. Keep this as decision review, not an automatic praise/criticism.","fights");
    }
    for(const ev of g.directPeerComparable===true?(g.laneDuel?.events||[]):[]){
      if(ev?.result==="solo_death"&&ev?.early)add(g,106,"matchup",ev.time,"Review this clean 1v1 lane death",(g.peer?.champion?"vs "+g.peer.champion+" · ":"")+(hasNum(ev.goldDiffAtEvent)?signedText(ev.goldDiffAtEvent,0)+"g role state at death":"clean direct-role solo death"),"Review cooldowns, health/resources and wave position immediately before the all-in. Define the exact disengage condition for this matchup.","macro");
    }
    for(const ev of g.roams?.events||[]){
      const laneCost=hasNum(ev?.laneCostCs)?Number(ev.laneCostCs):hasNum(ev?.adcLaneCostCs)?Number(ev.adcLaneCostCs):null;
      if(ev?.outcome!=="success"&&hasNum(laneCost)&&Number(laneCost)<=-6)add(g,98,"roaming",ev.startMin,"Review this expensive failed roam",signedText(laneCost,1)+" CS of lane differential during the move · outcome "+String(ev.outcome||"neutral"),"Was the wave actually secured before leaving? Mark the moment the target play stopped being available and when you should have turned back.","roams");
    }
    for(const ev of g.visionMission?.events||[]){
      if(!ev?.highRisk)continue;
      add(g,98,"vision safety",ev.time,"Review this dangerous vision action",String(ev.action||"vision action")+" "+String(ev.secondsAfterAction??"?")+"s before death"+(ev.unsupported?" · no ally within 3k":"")+(ev.objectiveSetup?" · objective setup":""),"Keep the vision goal but change the route/timing: what safe information or teammate proximity was available before entering the ward location?","vision");
    }
    const spike=g.itemSpikeWindow||{};
    if(g.directPeerComparable===true&&spike.eligible&&spike.diedBeforeImpact)add(g,107,"item spike",spike.startMin,"Review this wasted item-spike window",Math.round(Number(spike.leadSec||0))+"s major-item lead · died before tracked impact","After completing the item first, identify the safest way to use the temporary power advantage without being removed before it matters.","resets");
    else if(g.directPeerComparable===true&&spike.eligible&&!spike.used)add(g,90,"item spike",spike.startMin,"Review this unused item-spike window",Math.round(Number(spike.leadSec||0))+"s major-item lead with no tracked kill/assist/objective impact","Look for a controlled way to turn the temporary purchase advantage into pressure before the opponent completes their item.","resets");
  }
  const byMoment=new Map<string,any>();
  for(const x of candidates.sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.gameStartTimestamp)-Number(a.gameStartTimestamp))){
    const key=x.matchId+"|"+Math.round(Number(x.minute)*2)/2;
    if(!byMoment.has(key))byMoment.set(key,x);
  }
  const selected:any[]=[],perMatch=new Map<string,number>();
  for(const x of [...byMoment.values()].sort((a,b)=>Number(b.score)-Number(a.score)||Number(b.gameStartTimestamp)-Number(a.gameStartTimestamp))){
    const n=perMatch.get(x.matchId)||0;if(n>=2)continue;
    selected.push(x);perMatch.set(x.matchId,n+1);if(selected.length>=10)break;
  }
  return selected.map((x:any,i:number)=>({...x,rank:i+1}));
}

function supportSynergyModel(allGames:any[],primaryRole:string){
  if(primaryRole!=="ADC")return{eligible:false,role:primaryRole,resolvedGames:0,unresolvedGames:0,supportChampions:[],pairings:[],bestSupportChampion:null,developingSupportChampion:null,definition:"ADC-only support-champion context for the reviewed account; hidden for other selected roles."};
  const history=(allGames||[]).filter((g:any)=>g?.role==="ADC"),resolved=history.filter((g:any)=>text(g?.allySupportChampion)),unresolved=Math.max(0,history.length-resolved.length);
  const wilsonLower=(wins:number,total:number,z=1.96)=>{if(!(total>0))return null;const p=wins/total,z2=z*z,den=1+z2/total,center=(p+z2/(2*total))/den,half=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/den;return 100*Math.max(0,center-half);};
  const pack=(rows:any[],extra:any={},rankFloor=5)=>{
    const clean=rows.filter((g:any)=>g?.outcomeCompromised!==true),cleanWins=clean.filter((g:any)=>g?.win===true).length,lane=finiteGames(rows.filter((g:any)=>g?.directPeerComparable===true),g=>g?.goldDiff15),cleanGames=clean.length;
    const sampleTier=cleanGames>=rankFloor?"established":cleanGames>=3?"developing":"thin";
    return{...extra,games:rows.length,wins:rows.filter((g:any)=>g?.win===true).length,rawWinRate:pct(rows.filter((g:any)=>g?.win===true).length,rows.length),cleanGames,cleanWins,cleanWinRate:pct(cleanWins,cleanGames),wilsonLower95:cleanGames?wilsonLower(cleanWins,cleanGames):null,rankingEligible:sampleTier==="established",sampleTier,rankFloor,avgKda:meanField(finiteGames(rows,g=>g?.kda),g=>g.kda),avgDpm:meanField(finiteGames(rows,g=>g?.dpm),g=>g.dpm),avgCsMin:meanField(finiteGames(rows,g=>g?.csMin),g=>g.csMin),avgDeaths:meanField(finiteGames(rows,g=>g?.deaths),g=>g.deaths),avgKp:meanField(finiteGames(rows,g=>g?.kp),g=>g.kp),laneGames:lane.length,avgGoldDiff15:meanField(lane,g=>g.goldDiff15),compromisedGames:rows.length-cleanGames};
  };
  const rankSort=(a:any,b:any)=>Number(b.rankingEligible)-Number(a.rankingEligible)||Number(b.sampleTier==="developing")-Number(a.sampleTier==="developing")||Number(b.wilsonLower95??-1)-Number(a.wilsonLower95??-1)||Number(b.cleanGames)-Number(a.cleanGames)||Number(b.games)-Number(a.games);
  const supportGroups=new Map<string,any[]>(),pairGroups=new Map<string,any[]>();
  for(const g of resolved){
    const support=text(g.allySupportChampion),own=text(g.champion)||"Unknown";
    if(!supportGroups.has(support))supportGroups.set(support,[]);supportGroups.get(support)!.push(g);
    const pairKey=own+"|"+support;if(!pairGroups.has(pairKey))pairGroups.set(pairKey,[]);pairGroups.get(pairKey)!.push(g);
  }
  const supportChampions=[...supportGroups.entries()].map(([supportChampion,rows])=>pack(rows,{supportChampion},5)).sort((a:any,b:any)=>rankSort(a,b)||String(a.supportChampion).localeCompare(String(b.supportChampion)));
  const pairings=[...pairGroups.entries()].map(([key,rows])=>{const [ownChampion,supportChampion]=key.split("|");return pack(rows,{ownChampion,supportChampion},3);}).sort((a:any,b:any)=>rankSort(a,b)||String(a.ownChampion).localeCompare(String(b.ownChampion))||String(a.supportChampion).localeCompare(String(b.supportChampion)));
  const bestSupportChampion=supportChampions.find((x:any)=>x.rankingEligible)||null,developingSupportChampion=supportChampions.find((x:any)=>x.sampleTier==="developing")||null;
  return{eligible:true,role:"ADC",historyGames:history.length,resolvedGames:resolved.length,unresolvedGames:unresolved,minimumCleanGamesForRanking:5,minimumCleanGamesForDevelopingSample:3,minimumCleanGamesForPairing:3,supportChampions,pairings,bestSupportChampion,developingSupportChampion,definition:"The reviewed account's selected-role ADC history grouped only by allied Support champion. All KDA, DPM, CS/min, KP, deaths and lane-gold metrics belong to the reviewed account. No teammate identity or teammate performance metric is stored or ranked. Final-result ranking excludes AFK/early-surrender outcomes, requires at least 5 clean outcomes and uses the 95% Wilson lower bound. Three-to-four clean games remain developing context; ADC × Support champion pairings use a separate 3-clean-game floor."};
}

function practiceTargetLineageKey(t:any){return [text(t?.metricPath),text(t?.direction),text(t?.unit)].join("|");}
function attachPracticeTargetLineage(currentReport:any,previousReport:any,previousSampleIds:any[]=[]){
  const currentTargets=Array.isArray(currentReport?.practiceTargets)?currentReport.practiceTargets:[],currentIds=(currentReport?.games||[]).map((g:any)=>text(g?.matchId)).filter(Boolean).slice(0,20),stamp=text(currentReport?.generatedAt)||now();
  const fresh=(t:any)=>({...t,targetKey:practiceTargetLineageKey(t),originMatchIds:currentIds,originGeneratedAt:stamp,originAnalyzerVersion:ANALYZER_VERSION,lineageRuns:1,evidenceWindowBasis:"new_games_only"});
  if(!currentTargets.length)return currentTargets;
  const prevTargets=Array.isArray(previousReport?.practiceTargets)?previousReport.practiceTargets:[],sameContext=!!previousReport&&
    role(previousReport?.dataQuality?.selectedRole||previousReport?.coachingSummary?.primaryRole||previousReport?.summary?.primaryRole)===role(currentReport?.dataQuality?.selectedRole||currentReport?.coachingSummary?.primaryRole||currentReport?.summary?.primaryRole)&&
    (!hasNum(previousReport?.dataQuality?.dominantQueueId)||!hasNum(currentReport?.dataQuality?.dominantQueueId)||Number(previousReport.dataQuality.dominantQueueId)===Number(currentReport.dataQuality.dominantQueueId))&&
    (!text(previousReport?.dataQuality?.currentPatchKey)||!text(currentReport?.dataQuality?.currentPatchKey)||text(previousReport.dataQuality.currentPatchKey)===text(currentReport.dataQuality.currentPatchKey))&&
    (!text(previousReport?.dataQuality?.currentMechanicsKey)||!text(currentReport?.dataQuality?.currentMechanicsKey)||text(previousReport.dataQuality.currentMechanicsKey)===text(currentReport.dataQuality.currentMechanicsKey));
  if(!sameContext||!prevTargets.length)return currentTargets.map(fresh);
  const previousIds=(Array.isArray(previousSampleIds)&&previousSampleIds.length?previousSampleIds:(previousReport?.games||[]).map((g:any)=>text(g?.matchId))).filter(Boolean).slice(0,20);
  const prevByKey=new Map(prevTargets.map((t:any)=>[text(t?.targetKey)||practiceTargetLineageKey(t),t]));
  return currentTargets.map((t:any)=>{
    const key=practiceTargetLineageKey(t),prev:any=prevByKey.get(key);
    if(!prev)return fresh(t);
    const originIds=(Array.isArray(prev?.originMatchIds)&&prev.originMatchIds.length?prev.originMatchIds:previousIds).map(text).filter(Boolean).slice(0,20),originSet=new Set(originIds),newGames=currentIds.filter((id:string)=>!originSet.has(id)).length,maxWindow=Math.max(5,Number(prev?.maxWindowGames||t?.maxWindowGames||20));
    if(newGames>=maxWindow)return fresh(t);
    return{
      ...t,
      baseline:hasNum(prev?.baseline)?Number(prev.baseline):t.baseline,
      goal:hasNum(prev?.goal)?Number(prev.goal):t.goal,
      sampleSize:hasNum(prev?.sampleSize)?Number(prev.sampleSize):t.sampleSize,
      minSample:hasNum(prev?.minSample)?Number(prev.minSample):t.minSample,
      samplePaths:Array.isArray(prev?.samplePaths)?prev.samplePaths:t.samplePaths,
      sampleRequirements:Array.isArray(prev?.sampleRequirements)?prev.sampleRequirements:t.sampleRequirements,
      rationale:text(prev?.rationale)||t.rationale,
      baseWindowGames:Math.max(1,Number(prev?.baseWindowGames||prev?.windowGames||t?.baseWindowGames||5)),
      maxWindowGames:maxWindow,
      windowGames:Math.max(1,Number(prev?.windowGames||t?.windowGames||5)),
      windowPolicy:text(prev?.windowPolicy)||text(t?.windowPolicy)||"minimum_5_extend_until_evidence_max_20",
      evidenceWindowBasis:"new_games_only",
      targetKey:key,
      originMatchIds:originIds,
      originGeneratedAt:text(prev?.originGeneratedAt)||text(previousReport?.generatedAt)||stamp,
      originAnalyzerVersion:text(prev?.originAnalyzerVersion)||text(previousReport?.analyzerVersion)||ANALYZER_VERSION,
      lineageRuns:Math.max(1,Number(prev?.lineageRuns||1))+1
    };
  });
}
function persistedReportProjection(rep:any){
  const games=(rep?.games||[]).map((g:any)=>{
    const{
      objectives,frameSamples,goldSeries,involvedKills,shopVisits,opponentShopVisits,
      ...keep
    }=g||{};
    return{
      ...keep,
      objectiveEventCount:Array.isArray(objectives)?objectives.length:Number(g?.objectiveEventCount||0),
      shopVisitCount:Array.isArray(shopVisits)?shopVisits.length:Number(g?.shopVisitCount||0),
      opponentShopVisitCount:Array.isArray(opponentShopVisits)?opponentShopVisits.length:Number(g?.opponentShopVisitCount||0)
    };
  });
  return{
    ...rep,
    games,
    storageProjection:{
      schema:"league_saved_report_compact_v1",
      omittedPerGame:["objectives","frameSamples","goldSeries","involvedKills","shopVisits","opponentShopVisits"],
      preservedAsCounts:["objectiveEventCount","shopVisitCount","opponentShopVisitCount"],
      note:"Raw calculation intermediates are omitted only from persisted reports; live analysis uses the full evidence model."
    }
  };
}
function report(profile:any,rows:any[],catalog:any,requestedRole:any=null){
  const selectedRole=role(requestedRole),
    cachedRows=[...(rows||[])].sort((a:any,b:any)=>cachedMatchStartMs(b)-cachedMatchStartMs(a)),summonersRiftRows=cachedRows.filter((r:any)=>Number(r?.match_json?.info?.mapId||r?.map_id||0)===11),
    durationEligibleRows=summonersRiftRows.filter((r:any)=>Number(r?.match_json?.info?.gameDuration||r?.game_duration_seconds||0)>=600),
    roleDurationRows=selectedRole==="GENERIC"?durationEligibleRows:durationEligibleRows.filter((r:any)=>cachedRowRole(r,profile?.puuid)===selectedRole),
    supportedQueueRows=roleDurationRows.filter((r:any)=>supportedLeagueQueue(r?.match_json?.info?.queueId||r?.queue_id).supported),
    unsupportedQueueRows=roleDurationRows.filter((r:any)=>!supportedLeagueQueue(r?.match_json?.info?.queueId||r?.queue_id).supported),
    excludedOtherRoleRows=Math.max(0,durationEligibleRows.length-roleDurationRows.length);
  const queueCounts=new Map<number,number>();
  for(const r of supportedQueueRows){const q=Number(r?.match_json?.info?.queueId||r?.queue_id||0);queueCounts.set(q,(queueCounts.get(q)||0)+1);}
  const queueSelection=selectRecentQueueCohort(supportedQueueRows,20),dominantQueueId=queueSelection.queueId;
  const eligibleRows=dominantQueueId==null?supportedQueueRows:supportedQueueRows.filter((r:any)=>Number(r?.match_json?.info?.queueId||r?.queue_id||0)===Number(dominantQueueId)),excludedOtherSupportedQueueRows=Math.max(0,supportedQueueRows.length-eligibleRows.length),ordered=eligibleRows,
    analyzedCandidates=ordered.map((r:any)=>({row:r,g:game(r,text(profile.puuid),catalog)})),
    ambiguousRoleCandidates=analyzedCandidates.filter((x:any)=>x.g?.roleEvidence?.confidence==="conflict"),
    missingRoleCandidates=analyzedCandidates.filter((x:any)=>x.g&&x.g.role==="GENERIC"&&x.g?.roleEvidence?.confidence!=="conflict"),
    allDeepCandidates=analyzedCandidates.filter((x:any)=>x.g&&x.g.role!=="GENERIC"),
    roleDeepCandidates=selectedRole==="GENERIC"?allDeepCandidates:allDeepCandidates.filter((x:any)=>x.g.role===selectedRole),
    timelineDeepCandidates=roleDeepCandidates.filter((x:any)=>x.g.timelineAvailable===true),
    noTimelineFallbackCandidates=roleDeepCandidates.filter((x:any)=>x.g.timelineAvailable!==true),
    chosenDeepCandidates=[...timelineDeepCandidates.slice(0,20),...noTimelineFallbackCandidates.slice(0,Math.max(0,20-timelineDeepCandidates.length))],
    games=chosenDeepCandidates.map((x:any)=>x.g),
    usedIds=new Set(chosenDeepCandidates.map((x:any)=>x.g.matchId)),
    baselineExtra=ordered.filter((r:any)=>!usedIds.has(text(r?.match_json?.metadata?.matchId||r?.match_id))).slice(0,Math.max(0,ANALYSIS_HISTORY_TARGET_GAMES-games.length)).map(r=>baselineGame(r,text(profile.puuid))).filter((g:any)=>g&&g.role!=="GENERIC"&&(selectedRole==="GENERIC"||g.role===selectedRole)),
    allGames=[...games,...baselineExtra],byRole:any={},byChampion:any={};
  const deepRoleScopeViolations=selectedRole==="GENERIC"?0:games.filter((g:any)=>g.role!==selectedRole).length,historyRoleScopeViolations=selectedRole==="GENERIC"?0:allGames.filter((g:any)=>g.role!==selectedRole).length;
  if(deepRoleScopeViolations||historyRoleScopeViolations)throw new Error("selected_role_scope_violation");
  annotateSessionContext(allGames);
  for(const g of games){byRole[g.role]=byRole[g.role]||{games:0,wins:0};byRole[g.role].games++;if(g.win)byRole[g.role].wins++;byChampion[g.champion]=byChampion[g.champion]||{games:0,wins:0};byChampion[g.champion].games++;if(g.win)byChampion[g.champion].wins++;}
  let primaryRole=selectedRole,primaryGames=selectedRole==="GENERIC"?0:games.length;if(primaryRole==="GENERIC"){for(const[k,v]of Object.entries(byRole)as any){if(Number(v.games)>primaryGames){primaryGames=Number(v.games);primaryRole=k;}}}
  const validTimeline=games.filter((g:any)=>g.timelineAvailable).length,coordinateGames=games.filter((g:any)=>(g.deathPositions?.length||0)+(g.wards?.length||0)+(g.objectives?.length||0)>0).length;
  const rulesProfileCounts:any={},roleQuestRevisionCounts:any={};for(const g of games){const key=text(g?.phaseRules?.key)||"unknown",rq=text(g?.roleQuestContext?.revision)||"unknown";rulesProfileCounts[key]=(rulesProfileCounts[key]||0)+1;roleQuestRevisionCounts[rq]=(roleQuestRevisionCounts[rq]||0)+1;}
  const makeSummary=(sample:any[])=>{
    const kills=sample.reduce((n:number,g:any)=>n+Number(g?.kills||0),0),deaths=sample.reduce((n:number,g:any)=>n+Number(g?.deaths||0),0),assists=sample.reduce((n:number,g:any)=>n+Number(g?.assists||0),0);
    return{games:sample.length,wins:sample.filter((g:any)=>g.win).length,winRate:pct(sample.filter((g:any)=>g.win).length,sample.length),csMin:avg(sample.map((g:any)=>g.csMin)),kp:avg(sample.map((g:any)=>g.kp)),dpm:avg(sample.map((g:any)=>g.dpm)),gpm:avg(sample.map((g:any)=>g.gpm)),vpm:avg(sample.map((g:any)=>g.vpm)),laneCs10:avg(sample.map((g:any)=>g.laneCs10)),deadTimePct:avg(sample.map((g:any)=>g.deadTimePct)),damageEfficiencyPp:avg(sample.map((g:any)=>g.damageEfficiencyPp)),turretDamagePerMin:avg(sample.map((g:any)=>g.turretDamagePerMin)),epicDamagePerMin:avg(sample.map((g:any)=>g.epicDamagePerMin)),visionActionsPerMin:avg(sample.map((g:any)=>g.visionActionsPerMin)),controlWardsPlaced:avg(sample.map((g:any)=>g.controlWardsPlaced)),soloKills:avg(sample.map((g:any)=>g.soloKills)),compromisedOutcomeGames:sample.filter((g:any)=>g.outcomeCompromised===true).length,avgKills:sample.length?kills/sample.length:null,avgDeaths:sample.length?deaths/sample.length:null,avgAssists:sample.length?assists/sample.length:null,kda:deaths>0?(kills+assists)/deaths:(kills+assists)>0?(kills+assists):null,goldDiff10:avg(sample.map((g:any)=>g.goldDiff10)),goldDiff15:avg(sample.map((g:any)=>g.goldDiff15)),goldDiff25:avg(sample.map((g:any)=>g.goldDiff25)),csDiff10:avg(sample.map((g:any)=>g.csDiff10)),csDiff15:avg(sample.map((g:any)=>g.csDiff15)),csDiff25:avg(sample.map((g:any)=>g.csDiff25)),xpDiff10:avg(sample.map((g:any)=>g.xpDiff10)),xpDiff15:avg(sample.map((g:any)=>g.xpDiff15)),xpDiff25:avg(sample.map((g:any)=>g.xpDiff25))};
  };
  const summary={...makeSummary(games),primaryRole,primaryRoleGames:primaryGames},historySummary=allGames.length>20?makeSummary(allGames):null,lifetime=historySummary,outcomeStreaks=outcomeStreakSummary(games);
  const coachingRoleGamesAll=games.filter((g:any)=>g.role===primaryRole),coachingAllGames=allGames.filter((g:any)=>g.role===primaryRole);
  const newestRoleGame=coachingRoleGamesAll[0]||null,currentMechanicsKey=newestRoleGame?[text(newestRoleGame?.phaseRules?.key)||"unknown",text(newestRoleGame?.roleQuestContext?.revision)||"unknown"].join("|"):null;
  const currentMechanicsKnown=!!newestRoleGame&&newestRoleGame?.phaseRules?.phaseComparable!==false&&newestRoleGame?.roleQuestContext?.known!==false&&text(newestRoleGame?.roleQuestContext?.revision)!=="2026_revision_unknown";
  const mechanicsCohortGames=currentMechanicsKey?coachingRoleGamesAll.filter((g:any)=>[text(g?.phaseRules?.key)||"unknown",text(g?.roleQuestContext?.revision)||"unknown"].join("|")===currentMechanicsKey):coachingRoleGamesAll;
  // Mechanics-sensitive coaching should not blend materially different role-quest/rules revisions when a verified usable current cohort exists.
  // Unknown revisions are evidence gaps, not mechanics identities: they can never trigger filtering by themselves.
  // If the verified current cohort is too small, retain the broader role sample but surface that fallback as lower-confidence data quality.
  const mechanicsCohortApplied=currentMechanicsKnown&&mechanicsCohortGames.length>=5&&mechanicsCohortGames.length<coachingRoleGamesAll.length,coachingGames=mechanicsCohortApplied?mechanicsCohortGames:coachingRoleGamesAll,mixedMechanicsFallback=!mechanicsCohortApplied&&mechanicsCohortGames.length<coachingRoleGamesAll.length,mechanicsCohortReason=mechanicsCohortApplied?"verified_current_mechanics":!currentMechanicsKnown&&currentMechanicsKey?"current_mechanics_unverified":mixedMechanicsFallback?"current_cohort_below_5":"single_compatible_cohort";
  const coachingSummary={...makeSummary(coachingGames),primaryRole,primaryRoleGames:coachingGames.length};
  const currentPatchKey=coachingRoleGamesAll.find((g:any)=>g.patchKey)?.patchKey||null,currentPublicPatchKey=coachingRoleGamesAll.find((g:any)=>g.patchKey)?.publicPatchKey||publicPatchKey(currentPatchKey),currentSampleIds=new Set(games.map((g:any)=>g.matchId));
  const currentPatchRoleGames=currentPatchKey?coachingGames.filter((g:any)=>g.patchKey===currentPatchKey):[],olderSamePatchRoleGames=currentPatchKey?coachingAllGames.filter((g:any)=>g.patchKey===currentPatchKey&&!currentSampleIds.has(g.matchId)):[];
  const crossPatchBaselineRoleGames=currentPatchKey?coachingAllGames.filter((g:any)=>g.patchKey&&g.patchKey!==currentPatchKey&&!currentSampleIds.has(g.matchId)):[];
  const patchCounts:any={};for(const g of allGames){if(g.patchKey)patchCounts[g.patchKey]=(patchCounts[g.patchKey]||0)+1;}
  const patchBaselineReady=!!currentPatchKey&&currentPatchRoleGames.length>=3&&olderSamePatchRoleGames.length>=5;
  const coachingLifetime=patchBaselineReady?{...makeSummary(olderSamePatchRoleGames),patchKey:currentPatchKey,baselineKind:"older_same_patch"}:null;
  const patchRecentSummary=currentPatchRoleGames.length?{...makeSummary(currentPatchRoleGames),patchKey:currentPatchKey,publicPatchKey:currentPublicPatchKey}:null;
  const baselineContext={patchKey:currentPatchKey,displayPatchKey:currentPublicPatchKey||currentPatchKey,recentGames:currentPatchRoleGames.length,olderGames:olderSamePatchRoleGames.length,recentSummary:patchRecentSummary,ready:patchBaselineReady};
  const cm=coachingModel(coachingGames,coachingSummary,coachingLifetime,primaryRole,profile.rank_snapshot||null,baselineContext);cm.sessionModel=sessionBehaviorModel(coachingAllGames,primaryRole);cm.decisionIntelligence=buildDecisionIntelligence(coachingGames,cm.sessionModel,primaryRole,coachingAllGames);const championModel=championBehaviorModel(coachingGames,coachingSummary,cm.behaviorSummary,primaryRole,cm.peerComparison),matchupModel=opponentMatchupBehaviorModel(coachingGames,coachingSummary,cm.behaviorSummary,primaryRole,cm.peerComparison);
  cm.recentFocus.push(...championModel.focus,...matchupModel.focus);cm.highlights.push(...championModel.highlights,...matchupModel.highlights);cm.recentFocus.sort((a:any,b:any)=>Number(a.priority||9)-Number(b.priority||9));cm.highlights.sort((a:any,b:any)=>Number(a.priority||9)-Number(b.priority||9));cm.coaching=[...cm.recentFocus,...cm.highlights];
  const priorityThemes=synthesizePriorityThemes(cm.recentFocus);
  const replayReviewQueue=buildReplayReviewQueue(coachingGames);
  const practiceTargets=buildPracticeTargets(priorityThemes,coachingSummary,cm.behaviorSummary,cm.peerComparison,cm.sessionModel);
  const externalBenchmarks=externalAdcBenchmarkSet(profile.rank_snapshot||null,dominantQueueId,primaryRole),longHorizon=longHorizonModel(allGames,primaryRole),supportSynergy=supportSynergyModel(allGames,primaryRole),highResourceBehaviorContrast=highResourceDeepBehaviorContrast(coachingGames,primaryRole);
  return{schemaVersion:"league-report-v2",analyzerVersion:ANALYZER_VERSION,generatedAt:now(),externalBenchmarks,longHorizon,supportSynergy,highResourceBehaviorContrast,historySummary,profile:{id:profile.id,displayName:profile.display_name,gameName:profile.game_name,tagLine:profile.tag_line,platformRegion:profile.platform_region,routingRegion:profile.routing_region,rank:profile.rank_snapshot||null},summary,lifetime,outcomeStreaks,coachingSummary,coachingLifetime,baselineContext,byRole,byChampion,championBehavior:championModel.profiles,matchupBehavior:matchupModel.profiles,recentFocus:cm.recentFocus,priorityThemes,practiceTargets,replayReviewQueue,overallHighlights:cm.highlights,coaching:cm.coaching,peerComparison:cm.peerComparison,conversion:cm.conversion,winLoss:cm.winLoss,recentTrend:cm.recentTrend,sessionBehavior:cm.sessionModel,decisionIntelligence:cm.decisionIntelligence,games,charts:{csMin:games.map((g:any)=>({matchId:g.matchId,value:g.csMin})),kp:games.map((g:any)=>({matchId:g.matchId,value:g.kp})),dpm:games.map((g:any)=>({matchId:g.matchId,value:g.dpm})),goldDiff15:games.map((g:any)=>({matchId:g.matchId,value:g.goldDiff15}))},hiddenCharts:[],benchmarks:{rankAbove:{definition:"Actual higher-ranked same-role opponents encountered",sample:cm.peerComparison.higherRankPeerGames,avgGoldDiff15:cm.peerComparison.higherRankAvgGoldDiff15,goldOutperformPct:cm.peerComparison.higherRankGoldOutperformPct,avgDpmDelta:cm.peerComparison.higherRankAvgDpmDelta,majorItemSample:cm.peerComparison.higherRankMajorItemGames,avgMajorItemDeltaMin:cm.peerComparison.higherRankAvgMajorItemDeltaMin,majorItemFasterPct:cm.peerComparison.higherRankMajorItemFasterPct},itemSpike:{peerDefinition:"same-role opponent",avgDeltaMin:cm.peerComparison.avgMajorItemDeltaMin,sample:cm.peerComparison.majorItemGames,higherRankDefinition:"actual higher-ranked same-role opponents encountered",higherRankSample:cm.peerComparison.higherRankMajorItemGames,higherRankAvgDeltaMin:cm.peerComparison.higherRankAvgMajorItemDeltaMin,higherRankFasterPct:cm.peerComparison.higherRankMajorItemFasterPct}},aggregateMaps:{wards:games.flatMap((g:any)=>g.wards||[]),deaths:games.flatMap((g:any)=>g.deathPositions||[])},advanced:{dqi:null,agor:null,objectivePresence:cm.behaviorSummary.objectiveCoachingPresenceRate,objectivePresencePooled:cm.behaviorSummary.objectiveJoinRate,objectivePresenceAggregation:"mean_games",objectivePresenceBasis:"team_contested",teamSecuredObjectivePresence:cm.behaviorSummary.teamSecuredObjectiveJoinRate,earlyKP:cm.behaviorSummary.earlyKp,firstImpact:{games:cm.peerComparison.impactGames,avgDeltaVsOpponentMin:cm.peerComparison.avgImpactDeltaMin,earlierPct:cm.peerComparison.impactEarlierPct},objectiveDeathPct:cm.behaviorSummary.objectiveDeathPct,preObjectiveDeaths:cm.behaviorSummary.preObjectiveDeaths,preObjectiveDeathPct:cm.behaviorSummary.preObjectiveDeathPct,roams:{attempts:cm.behaviorSummary.roamAttempts,successRate:cm.behaviorSummary.roamSuccessRate,measuredLaneCost:cm.behaviorSummary.roamLaneCostGames,avgLaneCostCs:cm.behaviorSummary.avgRoamLaneCostCs,costlyRoams:cm.behaviorSummary.costlyRoams,emptyCostlyRoams:cm.behaviorSummary.emptyCostlyRoams},recalls:{greedyStayWindows:cm.behaviorSummary.greedyStayWindows,majorReadinessGames:cm.behaviorSummary.majorReadinessGames,delayedMajorCompletionGames:cm.behaviorSummary.delayedMajorCompletionGames,avgMajorCompletionDelayMin:cm.behaviorSummary.avgMajorCompletionDelayMin,majorReadinessPeerGames:cm.behaviorSummary.majorReadinessPeerGames,avgMajorCompletionDelayVsPeerMin:cm.behaviorSummary.avgMajorCompletionDelayVsPeerMin},itemSpike:{avgDeltaVsOpponentMin:cm.peerComparison.avgMajorItemDeltaMin,higherRankGames:cm.peerComparison.higherRankMajorItemGames,higherRankAvgDeltaMin:cm.peerComparison.higherRankAvgMajorItemDeltaMin,higherRankFasterPct:cm.peerComparison.higherRankMajorItemFasterPct,eligibleWindows:cm.peerComparison.itemSpikeEligibleWindows,utilizedWindows:cm.peerComparison.itemSpikeUtilizedWindows,utilizationRate:cm.peerComparison.itemSpikeUtilizationRate,deathsBeforeImpact:cm.peerComparison.itemSpikeDeathsBeforeImpact,avgLeadSec:cm.peerComparison.avgItemSpikeLeadSec},visionSetup:{games:cm.peerComparison.visionSetupGames,avgDeltaVsOpponent:cm.peerComparison.avgObjectiveSetupDelta,outperformPct:cm.peerComparison.objectiveSetupOutperformPct},wardClassification:true,currentSourcePortRequired:false,judgmentModel:"evidence+peer+self-baseline-v2"},behaviorSummary:cm.behaviorSummary,dataQuality:{cacheReadStrategy:null as any,cachedGames:cachedRows.length,summonersRiftGames:summonersRiftRows.length,durationEligibleSummonersRiftGames:durationEligibleRows.length,eligibleSummonersRiftGames:eligibleRows.length,dominantQueueId,dominantQueueGames:eligibleRows.length,queueSelection,queueCounts:Object.fromEntries([...queueCounts.entries()].map(([k,v])=>[String(k),v])),rulesProfileCounts,roleQuestRevisionCounts,supportedQueueRows:supportedQueueRows.length,unsupportedQueueRowsExcluded:unsupportedQueueRows.length,unsupportedQueueIds:[...new Set(unsupportedQueueRows.map((r:any)=>Number(r?.match_json?.info?.queueId||r?.queue_id||0)).filter(Boolean))],dominantQueueFamily:dominantQueueId!=null?supportedLeagueQueue(dominantQueueId).family:null,roleQuestCompletionTimingObserved:false,roleQuestCheckpointNote:"Riot timeline state includes quest rewards after completion, but this analyzer does not infer an exact universal quest-completion timestamp; role-quest-sensitive checkpoint effects remain contextual.",lane15ComparableGames:Number(cm.behaviorSummary?.checkpointEligibility?.lane15Games||0),fixed15to25ComparableGames:Number(cm.behaviorSummary?.checkpointEligibility?.fixed15to25Games||0),closing25ComparableGames:Number(cm.behaviorSummary?.checkpointEligibility?.closing25Games||0),excludedOtherMaps:cachedRows.length-summonersRiftRows.length,excludedShortGames:summonersRiftRows.length-durationEligibleRows.length,excludedOtherQueues:roleDurationRows.length-eligibleRows.length,excludedUnsupportedQueues:unsupportedQueueRows.length,excludedOtherSupportedQueues:excludedOtherSupportedQueueRows,shortGameThresholdSeconds:600,selectedRole:primaryRole,excludedOtherRoles:Math.max(excludedOtherRoleRows,allDeepCandidates.length-roleDeepCandidates.length),excludedMissingRole:missingRoleCandidates.length,excludedAmbiguousRole:ambiguousRoleCandidates.length,eligibleDeepGamesBeforeLast20:timelineDeepCandidates.length,excludedBeyondLast20:Math.max(0,timelineDeepCandidates.length-games.filter((g:any)=>g.timelineAvailable===true).length),exclusionModel:"disjoint_metadata_stages_plus_hydrated_role_quality",fallbackPlayerRoleGames:games.filter((g:any)=>g?.roleEvidence?.confidence==="fallback").length,directPeerComparableGames:games.filter((g:any)=>g?.directPeerComparable===true).length,excludedLowConfidenceDirectPeerGames:games.filter((g:any)=>g?.peer&&!g?.directPeerComparable).length,ambiguousDirectPeerGames:games.filter((g:any)=>g?.peerResolution?.reason==="ambiguous_enemy_role").length,missingDirectPeerGames:games.filter((g:any)=>g?.peerResolution?.reason==="enemy_role_missing").length,fallbackDirectPeerRoleGames:games.filter((g:any)=>g?.peerResolution?.opponentRoleConfidence==="fallback").length,analyzedGames:games.length,validTimelineGames:validTimeline,validCoordinateGames:coordinateGames,missingTimelineGames:games.length-validTimeline,baselineGames:lifetime?allGames.length:0,historyGames:allGames.length,historyTargetGames:ANALYSIS_HISTORY_TARGET_GAMES,historyMatchOnlyGames:allGames.filter((g:any)=>g.timelineAvailable!==true).length,deepTimelineGames:games.filter((g:any)=>g.timelineAvailable===true).length,deepTimelineFallbackGames:games.filter((g:any)=>g.timelineAvailable!==true).length,deepRoleScopeViolations,historyRoleScopeViolations,roleScopeEnforced:selectedRole!=="GENERIC",coachingRoleGames:coachingGames.length,primaryRoleGamesInLast20:coachingRoleGamesAll.length,currentMechanicsKey,currentMechanicsKnown,mechanicsCohortGames:mechanicsCohortGames.length,mechanicsCohortApplied,mixedMechanicsFallback,mechanicsCohortReason,currentPatchKey,currentPublicPatchKey,currentPatchRoleGames:currentPatchRoleGames.length,olderSamePatchRoleGames:olderSamePatchRoleGames.length,crossPatchBaselineRoleGames:crossPatchBaselineRoleGames.length,patchCounts,patchBaselineReady,positionEvidenceModel:"nearest_timeline_frame_within_35s",positionEvidenceMaxDeltaMs:35000,wardEventPositions:games.reduce((n:any,g:any)=>n+(g?.wards||[]).filter((w:any)=>w?.positionEvidence==="event_position").length,0),wardFrameProjectedPositions:games.reduce((n:any,g:any)=>n+(g?.wards||[]).filter((w:any)=>w?.positionEvidence==="nearest_player_frame_35s").length,0),wardUnpositionedEvents:games.reduce((n:any,g:any)=>n+(g?.wards||[]).filter((w:any)=>w?.positionEvidence==="unavailable").length,0),unresolvedItemUndoEvents:games.reduce((n:any,g:any)=>n+Number(g?.itemLedgerQuality?.unresolvedUndoEvents||0),0),gamesWithUnresolvedItemUndo:games.filter((g:any)=>Number(g?.itemLedgerQuality?.unresolvedUndoEvents||0)>0).length,itemUndoQualityPolicy:"zero_id_undo_flagged_approximate_not_guessed",itemCatalogResolution:catalog?.resolution||{},itemCatalogExactPatches:Object.values(catalog?.resolution||{}).filter((x:any)=>x?.exact).length,itemCatalogFallbackPatches:Object.values(catalog?.resolution||{}).filter((x:any)=>x?.fallback).length,itemCatalogUnknownPatchGames:allGames.filter((g:any)=>!g.patchKey).length,coachingBaselineRoleGames:coachingLifetime?olderSamePatchRoleGames.length:0,peerComparableGames:cm.peerComparison.sameRoleGames,rankedPeerGames:cm.peerComparison.rankedPeerGames,rankContextExcludedGames:cm.peerComparison.rankContextExcludedGames,rankComparisonQueueCounts:cm.peerComparison.rankComparisonQueueCounts,higherRankPeerGames:cm.peerComparison.higherRankPeerGames},sourceStatus:{currentBruisienatorSourceAvailable:true,historicalAnalyzerRecovered:true,uploadedBruisienatorRevision:"V21_PHASE2_SAFE_STATS_ENRICH",note:"The uploaded Bruisienator source is available for parity auditing. V21 HTML defines a five-input DQI, but the supplied PowerShell pipeline emits only badDeaths; the compatibility score therefore reproduces that effective pipeline behavior and keeps the unpopulated source inputs explicit. Current death coaching uses transparent risk/consequence evidence rather than an invented replacement score. AGOR remains unavailable because no defensible recovered formula was found in the supplied files."}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method==="GET")return json(req,{ok:true,mode:"league-api-v1",analyzer_version:ANALYZER_VERSION,internal_slot:"retired-diagnostic-reuse",requires_session:false,public_workspace:true,server_riot_key_for_public:false,riot_configured:!!RIOT_KEY});
  if(req.method!=="POST")return json(req,{ok:false,error:"method_not_allowed"},405);
  let body:any={};try{body=await req.json();}catch{return json(req,{ok:false,error:"invalid_json"},400);}
  try{
    const{sb,viewer}=await accessContext(req,body),action=text(body.action||"health"),requestRiotKey=text(req.headers.get("x-riot-api-key")||body?.riot_api_key),allowServerRiotKey=viewer.anonymous!==true;
    if(action==="health")return json(req,{ok:true,analyzer_version:ANALYZER_VERSION,public_workspace:viewer.anonymous===true,riot_configured:!!(requestRiotKey||(allowServerRiotKey&&RIOT_KEY)),server_riot_key:allowServerRiotKey&&!!RIOT_KEY,player:viewer.display_name,site_scope:viewer.site_scope});
    if(action==="riot_test"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id);
      const resolved=await resolveProfile(sb,{...p,puuid:null},requestRiotKey,allowServerRiotKey);
      return json(req,{ok:true,profile_id:resolved.id,game_name:resolved.game_name,tag_line:resolved.tag_line,platform_region:resolved.platform_region,puuid_resolved:!!text(resolved.puuid)});
    }
    if(action==="profiles_list"){
      const{data,error}=await sb.from("league_profiles_v1").select("id,profile_key,display_name,game_name,tag_line,platform_region,routing_region,notes,puuid,last_resolved_at,rank_snapshot,updated_at").eq("owner_player_id",viewer.player_id).eq("site_scope",viewer.site_scope).order("updated_at",{ascending:false});
      if(error)throw error;return json(req,{ok:true,profiles:data||[]});
    }
    if(action==="profile_save"){
      const input=body.profile||{},directRequest=body.direct_request===true;
      const profileKey=directRequest?"recent-request":safeKey(input.profile_key||input.display_name||input.game_name),displayName=text(input.display_name||input.game_name||profileKey);
      if(!profileKey||!displayName)return json(req,{ok:false,error:"profile_name_required"},400);
      const plat=platform(input.platform_region);
      let existing:any=null,reuseExistingId="";
      if(directRequest){
        const{data,error}=await sb.from("league_profiles_v1").select("*").eq("owner_player_id",viewer.player_id).eq("site_scope",viewer.site_scope).eq("profile_key","recent-request").maybeSingle();
        if(error)throw error;existing=data||null;
      }else if(!text(input.id)&&text(input.game_name)&&text(input.tag_line)){
        const{data:candidates,error:candidateError}=await sb.from("league_profiles_v1").select("*").eq("owner_player_id",viewer.player_id).eq("site_scope",viewer.site_scope).limit(PUBLIC_MAX_PROFILES);
        if(candidateError)throw candidateError;
        const identityMatch=(candidates||[]).find((p:any)=>text(p.game_name).toLowerCase()===text(input.game_name).toLowerCase()&&text(p.tag_line).toLowerCase()===text(input.tag_line).toLowerCase()&&platform(p.platform_region)===plat)||null;
        if(identityMatch){existing=identityMatch;reuseExistingId=text(identityMatch.id);}
      }
      if(viewer.anonymous===true&&!text(input.id)&&!reuseExistingId&&!directRequest){
        const{count,error:countError}=await sb.from("league_profiles_v1").select("*",{count:"exact",head:true}).eq("owner_player_id",viewer.player_id).eq("site_scope",viewer.site_scope);
        if(countError)throw countError;
        if(Number(count||0)>=PUBLIC_MAX_PROFILES)return json(req,{ok:false,error:"public_workspace_profile_limit",limit:PUBLIC_MAX_PROFILES},429);
      }
      const identityChanged=!!(directRequest&&existing&&(
        text(existing.game_name).toLowerCase()!==text(input.game_name).toLowerCase()||
        text(existing.tag_line).toLowerCase()!==text(input.tag_line).toLowerCase()||
        platform(existing.platform_region)!==plat
      ));
      const patch:any={owner_player_id:viewer.player_id,owner_display_name:viewer.display_name,site_scope:viewer.site_scope,profile_key:profileKey,display_name:displayName.slice(0,120),game_name:text(input.game_name).slice(0,80)||null,tag_line:text(input.tag_line).slice(0,32)||null,platform_region:plat,routing_region:routeFor(plat),notes:text(input.notes).slice(0,500)||null,updated_at:now()};
      if(identityChanged)Object.assign(patch,{puuid:null,riot_account:null,last_resolved_at:null,rank_snapshot:null,ranked_fetched_at:null});
      let saved:any;
      const updateId=text(input.id)||reuseExistingId;
      if(updateId){const{data,error}=await sb.from("league_profiles_v1").update(patch).eq("id",updateId).eq("owner_player_id",viewer.player_id).select("*").maybeSingle();if(error||!data)throw error||Object.assign(new Error("profile_not_found"),{status:404});saved=data;}
      else{const{data,error}=await sb.from("league_profiles_v1").upsert(patch,{onConflict:"owner_player_id,site_scope,profile_key"}).select("*").single();if(error)throw error;saved=data;}
      if(identityChanged&&saved?.id){
        const profileId=text(saved.id);
        const deletes=await Promise.all([
          sb.from("league_analysis_runs_v1").delete().eq("profile_id",profileId).eq("owner_player_id",viewer.player_id),
          sb.from("league_fetch_runs_v1").delete().eq("profile_id",profileId).eq("owner_player_id",viewer.player_id),
          sb.from("league_match_cache_v1").delete().eq("profile_id",profileId).eq("owner_player_id",viewer.player_id)
        ]);
        const deleteError=deletes.find((x:any)=>x?.error)?.error;if(deleteError)throw deleteError;
      }
      if(((allowServerRiotKey&&RIOT_KEY)||requestRiotKey)&&saved.game_name&&saved.tag_line){try{saved=await resolveProfile(sb,saved,requestRiotKey,allowServerRiotKey);}catch(e:any){return json(req,{ok:true,profile:saved,resolve_warning:text(e?.message||e)});}}
      return json(req,{ok:true,profile:saved,direct_request:directRequest,identity_reset:identityChanged});
    }
    if(action==="profile_delete"){
      const profileId=text(body.profile_id);if(!profileId)return json(req,{ok:false,error:"profile_id_required"},400);
      const{data,error}=await sb.from("league_profiles_v1").delete().eq("id",profileId).eq("owner_player_id",viewer.player_id).select("id,display_name").maybeSingle();
      if(error)throw error;if(!data)return json(req,{ok:false,error:"profile_not_found"},404);
      return json(req,{ok:true,deleted_profile_id:data.id,deleted_profile_name:data.display_name});
    }
    if(action==="fetch_prepare"){
      let p=await getProfile(sb,viewer.player_id,body.profile_id);p=await resolveProfile(sb,p,requestRiotKey,allowServerRiotKey);
      const rank=await rankSnapshotFor(p,requestRiotKey,allowServerRiotKey);
      if(rank){
        const {data:ranked}=await sb.from("league_profiles_v1").update({rank_snapshot:rank,ranked_fetched_at:now(),updated_at:now()}).eq("id",p.id).select("*").maybeSingle();
        if(ranked)p=ranked;
      }
      const fetchLimit=viewer.anonymous===true?PUBLIC_MAX_FETCH_MATCHES:100,count=Math.max(1,Math.min(fetchLimit,Number(body.count||50))),rr=text(p.routing_region)||routeFor(p.platform_region);
      const ids=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/by-puuid/"+encodeURIComponent(p.puuid)+"/ids?start=0&count="+count,requestRiotKey,allowServerRiotKey),matchIds=Array.isArray(ids)?ids.map(text).filter(Boolean):[];
      const targetRole=role(body.target_role);
      const{data:cached}=matchIds.length?await sb.from("league_match_cache_v1").select("match_id").eq("profile_id",p.id).in("match_id",matchIds).not("match_json","is",null):{data:[]};
      // A complete match+timeline row is a cache hit regardless of peer-rank state.
      // Peer-rank work is deferred until selected-role + queue cohorting is known.
      const set=new Set((cached||[]).map((x:any)=>x.match_id));
      const{data:run,error}=await sb.from("league_fetch_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,status:"running",match_ids:matchIds,completed_count:set.size,total_count:matchIds.length,cache_hits:set.size,updated_at:now()}).select("*").single();
      if(error)throw error;return json(req,{ok:true,run_id:run.id,match_ids:matchIds,cached_match_ids:[...set],profile:p,target_role:targetRole==="GENERIC"?null:targetRole,fetch_plan:"scan_match_metadata_then_deep_selected_role_last20",peer_rank_plan:"selected_role_queue_cohort_after_deep_plan"});
    }
    if(action==="fetch_one"){
      const{data:run,error:re}=await sb.from("league_fetch_runs_v1").select("*").eq("id",text(body.run_id)).eq("owner_player_id",viewer.player_id).maybeSingle();if(re||!run)throw re||Object.assign(new Error("fetch_run_not_found"),{status:404});
      const fetchDepth=text(body.fetch_depth).toLowerCase()==="metadata"?"metadata":"deep",targetRole=role(body.target_role),id=text(body.match_id),runIds=Array.isArray(run.match_ids)?run.match_ids:[],idx=runIds.indexOf(id);if(idx<0)return json(req,{ok:false,error:"match_not_in_run"},400);
      const p=await getProfile(sb,viewer.player_id,run.profile_id),{data:old}=await sb.from("league_match_cache_v1").select("match_json,timeline_json,peer_rank_json,peer_rank_fetched_at,player_role,match_fetched_at,timeline_fetched_at,fetch_error").eq("profile_id",p.id).eq("match_id",id).maybeSingle();
      if(old?.match_json&&fetchDepth==="metadata"&&body.force!==true)return json(req,{ok:true,match_id:id,cache_hit:true,metadata_available:true,timeline_available:!!old?.timeline_json,fetch_depth:fetchDepth});
      if(old?.match_json&&old?.timeline_json&&fetchDepth==="deep"&&body.force!==true)return json(req,{ok:true,match_id:id,cache_hit:true,metadata_available:true,timeline_available:true,fetch_depth:fetchDepth});
      const rr=text(p.routing_region)||routeFor(p.platform_region),stamp=now();
      let m=old?.match_json||null,tl=old?.timeline_json||null,tlError=old?.fetch_error||null;
      if(!m||body.force===true)m=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id),requestRiotKey,allowServerRiotKey);
      const participants=Array.isArray(m?.info?.participants)?m.info.participants:[],me=participants.find((x:any)=>text(x?.puuid)===text(p.puuid)),playerRoleEvidence=me?participantRoleEvidence(me):null,playerRole=playerRoleEvidence?.role||"GENERIC";
      const analysisEligible=Number(m?.info?.mapId||0)===11&&Number(m?.info?.gameDuration||0)>=600&&supportedLeagueQueue(m?.info?.queueId).supported&&(targetRole==="GENERIC"||playerRole===targetRole)&&playerRoleEvidence?.confidence!=="conflict";
      if(fetchDepth==="deep"&&analysisEligible&&(!tl||body.force===true)){tlError=null;try{tl=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id)+"/timeline",requestRiotKey,allowServerRiotKey);}catch(e:any){tlError=text(e?.message||e).slice(0,500);}}
      const gs=Number(m?.info?.gameStartTimestamp||0),row={profile_id:p.id,match_id:id,owner_player_id:viewer.player_id,game_start_at:gs?new Date(gs).toISOString():null,map_id:num(m?.info?.mapId),queue_id:num(m?.info?.queueId),game_duration_seconds:num(m?.info?.gameDuration),player_role:playerRole,match_json:m,timeline_json:tl,peer_rank_json:old?.peer_rank_json||null,peer_rank_fetched_at:old?.peer_rank_fetched_at||null,match_fetched_at:old?.match_fetched_at||stamp,timeline_fetched_at:tl?(old?.timeline_fetched_at||stamp):(old?.timeline_fetched_at||null),fetch_error:fetchDepth==="deep"?tlError:(old?.fetch_error||null),updated_at:stamp};
      const{error}=await sb.from("league_match_cache_v1").upsert(row,{onConflict:"profile_id,match_id"});if(error)throw error;
      if(fetchDepth==="metadata"&&!old?.match_json)await sb.from("league_fetch_runs_v1").update({completed_count:Math.min(Number(run.total_count||0),Number(run.completed_count||0)+1),updated_at:stamp}).eq("id",run.id);
      return json(req,{ok:true,match_id:id,cache_hit:!!old?.match_json,metadata_available:!!m,timeline_available:!!tl,timeline_error:tlError,timeline_relevant:analysisEligible,fetch_depth:fetchDepth,player_role:playerRole});
    }
    if(action==="fetch_finish"){
      const runId=text(body.run_id),{data:run,error:runError}=await sb.from("league_fetch_runs_v1").select("*").eq("id",runId).eq("owner_player_id",viewer.player_id).maybeSingle();
      if(runError||!run)throw runError||Object.assign(new Error("fetch_run_not_found"),{status:404});
      const p=await getProfile(sb,viewer.player_id,run.profile_id),targetRole=role(body.target_role);
      let peerRankBackfilled=0,peerRankChecked=0,peerRankUnavailableCached=0,peerRankTargetCount=0,comparableCachedGames=0,queueComparableCachedGames=0,dominantQueueId:any=null;
      const runIds=Array.isArray(run.match_ids)?run.match_ids.map(text).filter(Boolean):[];
      const{data:cachedMeta,error:cacheError}=runIds.length?await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,player_role,timeline_fetched_at,fetch_error,peer_rank_json,peer_rank_fetched_at").eq("profile_id",p.id).in("match_id",runIds).not("match_json","is",null).order("game_start_at",{ascending:false}).limit(ANALYSIS_CACHE_METADATA_LIMIT):{data:[],error:null};
      if(cacheError)throw cacheError;
      const ordered=[...(cachedMeta||[])].sort((a:any,b:any)=>cachedMatchStartMs(b)-cachedMatchStartMs(a)),durationEligible=ordered.filter((r:any)=>Number(r?.map_id||0)===11&&Number(r?.game_duration_seconds||0)>=600),supportedEligible=durationEligible.filter((r:any)=>supportedLeagueQueue(r?.queue_id).supported),roleEligible=targetRole==="GENERIC"?supportedEligible:supportedEligible.filter((r:any)=>cachedRowRole(r,p.puuid)===targetRole);
      const queueSelection=selectRecentQueueCohort(roleEligible,20);dominantQueueId=queueSelection.queueId;
      const comparable=dominantQueueId==null?roleEligible:roleEligible.filter((r:any)=>Number(r?.queue_id||0)===Number(dominantQueueId));queueComparableCachedGames=comparable.length;
      const targets:any[]=[];
      for(const row of comparable){
        if(targets.length>=ANALYSIS_DEEP_TARGET_GAMES)break;
        if(row?.timeline_fetched_at){targets.push(row);continue;}
        // A timeline that already failed in this fetch run is not allowed to consume
        // a deep-evidence slot; continue into older comparable games instead.
        if(row?.fetch_error)continue;
        targets.push(row);
      }
      const timelineTargetIds=targets.filter((row:any)=>!row?.timeline_fetched_at).map((row:any)=>text(row.match_id)).filter(Boolean),timelineAvailableCount=targets.length-timelineTargetIds.length;
      comparableCachedGames=comparable.length;peerRankTargetCount=targets.length;
      const plan={dominant_queue_id:dominantQueueId,queue_selection_basis:"dominant_within_recent_selected_role_supported_window_tie_newest",queue_selection_window:20,target_role:targetRole==="GENERIC"?null:targetRole,selected_role_total_cached_games:targetRole==="GENERIC"?null:roleEligible.length,queue_comparable_cached_games:queueComparableCachedGames,selected_role_cached_games:targetRole==="GENERIC"?null:comparableCachedGames,comparable_cached_games:comparableCachedGames,history_scan_count:Number(run.total_count||0),metadata_cached_games:ordered.length,timeline_target_count:targets.length,timeline_available_count:timelineAvailableCount,timeline_missing_count:timelineTargetIds.length,timeline_target_ids:timelineTargetIds};
      if(body.plan_only===true)return json(req,{ok:true,run_id:run.id,plan_only:true,...plan});
      const rankNeeds=targets.filter((row:any)=>!row?.peer_rank_fetched_at||(row?.peer_rank_json&&row.peer_rank_json?.schema!=="rank_snapshot_v2")),rankNeedIds=rankNeeds.map((row:any)=>text(row.match_id)).filter(Boolean);
      let rankMatchById=new Map<string,any>();
      if(rankNeedIds.length){const{data:rankRows,error:rankRowsError}=await sb.from("league_match_cache_v1").select("match_id,match_json").eq("profile_id",p.id).in("match_id",rankNeedIds);if(rankRowsError)throw rankRowsError;rankMatchById=new Map((rankRows||[]).map((row:any)=>[text(row.match_id),row.match_json]));}
      for(const row of targets){
        if(row?.peer_rank_fetched_at&&row?.peer_rank_json?.schema==="rank_snapshot_v2")continue;
        if(row?.peer_rank_fetched_at&&!row?.peer_rank_json)continue;
        const matchJson=rankMatchById.get(text(row.match_id)),participants=Array.isArray(matchJson?.info?.participants)?matchJson.info.participants:[],me=participants.find((x:any)=>text(x?.puuid)===text(p.puuid)),playerRoleEvidence=me?participantRoleEvidence(me):null,peerResolution=me?opponentResolution(matchJson,me):null,directPeerComparable=playerRoleEvidence?.confidence==="high"&&peerResolution?.opponentRoleConfidence==="high"&&!!peerResolution?.opponent,opp=directPeerComparable?peerResolution?.opponent:null;
        const peerRank=opp?.puuid?await rankSnapshotFor({puuid:opp.puuid,platform_region:p.platform_region},requestRiotKey,allowServerRiotKey):null,stamp=now();
        const{error:updateError}=await sb.from("league_match_cache_v1").update({peer_rank_json:peerRank,peer_rank_fetched_at:stamp,updated_at:stamp}).eq("profile_id",p.id).eq("match_id",row.match_id);
        if(updateError)throw updateError;peerRankChecked++;if(peerRank?.schema==="rank_snapshot_v2")peerRankBackfilled++;else peerRankUnavailableCached++;
      }
      const{data,error}=await sb.from("league_fetch_runs_v1").update({status:"done",completed_at:now(),updated_at:now()}).eq("id",runId).eq("owner_player_id",viewer.player_id).select("*").maybeSingle();
      if(error||!data)throw error||Object.assign(new Error("fetch_run_not_found"),{status:404});
      let prunedMatches=0,prunedFetchRuns=0,pruneWarning:string|null=null;
      if(viewer.anonymous===true){try{prunedMatches=await trimAnonymousMatchCache(sb,p.id,viewer.player_id);prunedFetchRuns=await trimAnonymousRows(sb,"league_fetch_runs_v1",p.id,viewer.player_id,PUBLIC_MAX_FETCH_RUNS_PER_PROFILE,"created_at");}catch(e:any){pruneWarning=text(e?.message||e).slice(0,240);console.error("league-api-v1 anonymous fetch cleanup",pruneWarning);}}
      return json(req,{ok:true,run:data,...plan,peer_rank_target_count:peerRankTargetCount,peer_rank_checked:peerRankChecked,peer_rank_backfilled:peerRankBackfilled,peer_rank_unavailable_cached:peerRankUnavailableCached,peer_rank_selection_scope:"trusted_selected_role_queue_cohort",public_cache_pruned:prunedMatches,public_fetch_runs_pruned:prunedFetchRuns,public_prune_warning:pruneWarning,recommend_deeper_cache:comparableCachedGames<20&&Number(run.total_count||0)<PUBLIC_MAX_FETCH_MATCHES});
    }
    if(action==="cache_status"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),targetRole=role(body.target_role),{data:rows,error}=await sb.from("league_match_cache_v1").select("player_role,updated_at,game_start_at").eq("profile_id",p.id).order("updated_at",{ascending:false}).limit(PUBLIC_MAX_CACHED_MATCHES_PER_PROFILE);
      if(error)throw error;
      const cacheRows=Array.isArray(rows)?rows:[],roleCounts:any={ADC:0,SUPPORT:0,MID:0,JUNGLE:0,TOP:0,GENERIC:0};
      for(const row of cacheRows){const rr=role(row?.player_role);roleCounts[rr]=(roleCounts[rr]||0)+1;}
      const last=cacheRows[0]||null;
      return json(req,{ok:true,cached_games:cacheRows.length,role_counts:roleCounts,target_role:targetRole==="GENERIC"?null:targetRole,selected_role_cached_games:targetRole==="GENERIC"?null:Number(roleCounts[targetRole]||0),last_updated_at:last?.updated_at||null,last_game_at:last?.game_start_at||null});
    }
    if(action==="analyze_basic"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),targetRole=role(body.target_role);if(!text(p.puuid))return json(req,{ok:false,error:"profile_not_resolved"},400);
      // Stage 1: lightweight metadata chooses the same map/queue cohort without
      // transferring up to 100 large match + timeline JSON documents.
      const{data:metaRows,error:metaError}=await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,player_role,peer_rank_json,peer_rank_fetched_at,fetch_error").eq("profile_id",p.id).not("match_json","is",null).order("game_start_at",{ascending:false}).limit(ANALYSIS_CACHE_METADATA_LIMIT);
      if(metaError)throw metaError;
      const metaOrdered=[...(metaRows||[])].sort((a:any,b:any)=>cachedMatchStartMs(b)-cachedMatchStartMs(a)),metaEligible=metaOrdered.filter((r:any)=>Number(r?.map_id||0)===11&&Number(r?.game_duration_seconds||0)>=600&&supportedLeagueQueue(r?.queue_id).supported),roleEligible=targetRole==="GENERIC"?metaEligible:metaEligible.filter((r:any)=>cachedRowRole(r,p.puuid)===targetRole),queueSelection=selectRecentQueueCohort(roleEligible,20),dominantQueueId=queueSelection.queueId;
      const cohortMeta=(dominantQueueId==null?roleEligible:roleEligible.filter((r:any)=>Number(r?.queue_id||0)===Number(dominantQueueId))).slice(0,ANALYSIS_CACHE_METADATA_LIMIT);

      // Stage 2: fetch timelines in bounded recent batches only until twenty
      // role-usable deep-analysis games are available.
      const deepRows:any[]=[];let deepRoleUsable=0,consumedMeta=0;
      while(consumedMeta<cohortMeta.length&&deepRoleUsable<ANALYSIS_DEEP_TARGET_GAMES){
        const chunk=cohortMeta.slice(consumedMeta,consumedMeta+ANALYSIS_DEEP_BATCH_SIZE),ids=chunk.map((r:any)=>text(r.match_id)).filter(Boolean);
        if(!ids.length)break;
        const{data:chunkRows,error:chunkError}=await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,player_role,match_json,timeline_json,peer_rank_json,peer_rank_fetched_at,fetch_error").eq("profile_id",p.id).in("match_id",ids);
        if(chunkError)throw chunkError;
        const orderedChunk=orderRowsByIds(chunkRows||[],ids);deepRows.push(...orderedChunk);deepRoleUsable+=orderedChunk.filter((row:any)=>{const rr=cachedRowRole(row,p.puuid);return !!row?.timeline_json&&rr!=="GENERIC"&&(targetRole==="GENERIC"||rr===targetRole);}).length;consumedMeta+=chunk.length;
      }

      // Stage 3: historical baseline rows need match details for role/full-game
      // metrics but not timeline blobs. This preserves the old baseline depth
      // while removing its largest database/network payload.
      const baselineMeta=cohortMeta.slice(consumedMeta,consumedMeta+ANALYSIS_BASELINE_MAX_ROWS),baselineIds=baselineMeta.map((r:any)=>text(r.match_id)).filter(Boolean);
      let baselineRows:any[]=[];
      if(baselineIds.length){
        const{data:baseRows,error:baseError}=await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,player_role,match_json,peer_rank_json,peer_rank_fetched_at,fetch_error").eq("profile_id",p.id).in("match_id",baselineIds);
        if(baseError)throw baseError;baselineRows=orderRowsByIds(baseRows||[],baselineIds);
      }
      const rows=[...deepRows,...baselineRows];
      const patchKeys=[...new Set(rows.map((r:any)=>patchKey(r?.match_json?.info?.gameVersion)).filter(Boolean))] as string[];
      const [fallbackCatalog,...patchCatalogs]=await Promise.all([itemCatalogForPatch(null),...patchKeys.map((pk:string)=>itemCatalogForPatch(pk))]);
      const catalog:any={fallback:fallbackCatalog.data,fallbackMeta:fallbackCatalog,byPatch:{},resolution:{}};
      patchKeys.forEach((pk:string,i:number)=>{const resolved=patchCatalogs[i];catalog.byPatch[pk]=resolved?.data||fallbackCatalog.data;catalog.resolution[pk]={version:resolved?.version||fallbackCatalog.version||null,exact:!!resolved?.exact,fallback:!!resolved?.fallback};});
      const rep:any=report(p,rows,catalog,targetRole);
      rep.dataQuality=rep.dataQuality||{};
      rep.dataQuality.excludedOtherRoles=targetRole==="GENERIC"?Number(rep.dataQuality.excludedOtherRoles||0):Math.max(Number(rep.dataQuality.excludedOtherRoles||0),metaEligible.length-roleEligible.length);
      rep.dataQuality.selectedRoleEligibleGames=roleEligible.length;
      rep.dataQuality.cacheReadStrategy={kind:"metadata_role_then_queue_then_bounded_timelines_v3",metadataRows:metaOrdered.length,roleEligibleRows:roleEligible.length,cohortRows:cohortMeta.length,timelineRows:deepRows.length,timelineRoleUsable:deepRoleUsable,selectedRole:targetRole==="GENERIC"?rep?.summary?.primaryRole:targetRole,baselineRows:baselineRows.length,timelineTarget:ANALYSIS_DEEP_TARGET_GAMES,queueSelectionScope:"selected_role",avoidsHistoricalTimelinePayload:true};
      let previousPracticeReport:any=null,previousPracticeSampleIds:any[]=[];
      try{
        const{data:priorMeta,error:priorMetaError}=await sb.from("league_analysis_runs_v1").select("id,created_at,sample_match_ids,data_quality").eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).order("created_at",{ascending:false}).limit(25);
        if(priorMetaError)throw priorMetaError;
        const currentRole=role(rep?.dataQuality?.selectedRole||rep?.coachingSummary?.primaryRole||rep?.summary?.primaryRole),prior=(priorMeta||[]).find((x:any)=>role(x?.data_quality?.selectedRole)===currentRole)||null;
        if(prior){
          const{data:priorDetail,error:priorDetailError}=await sb.from("league_analysis_runs_v1").select("report_data").eq("id",prior.id).eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).maybeSingle();
          if(priorDetailError)throw priorDetailError;
          previousPracticeReport=priorDetail?.report_data||null;previousPracticeSampleIds=Array.isArray(prior.sample_match_ids)?prior.sample_match_ids:[];
        }
      }catch(e:any){console.error("league-api-v1 practice lineage lookup",text(e?.message||e).slice(0,240));}
      rep.practiceTargets=attachPracticeTargetLineage(rep,previousPracticeReport,previousPracticeSampleIds);
      const persistedRep=persistedReportProjection(rep);
      persistedRep.dataQuality={...(persistedRep.dataQuality||{}),storageProjection:persistedRep.storageProjection};
      const{data:run,error:se}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"web_behavior",analyzer_version:rep.analyzerVersion,sample_match_ids:rep.games.map((g:any)=>g.matchId),report_data:persistedRep,data_quality:persistedRep.dataQuality}).select("id,created_at").single();if(se)throw se;
      let prunedAnalyses=0,pruneWarning:string|null=null;
      if(viewer.anonymous===true){
        try{prunedAnalyses=await trimAnonymousRows(sb,"league_analysis_runs_v1",p.id,viewer.player_id,PUBLIC_MAX_ANALYSES_PER_PROFILE,"created_at");}
        catch(e:any){pruneWarning=text(e?.message||e).slice(0,240);console.error("league-api-v1 anonymous analysis cleanup",pruneWarning);}
      }
      return json(req,{ok:true,analysis_id:run.id,created_at:run.created_at,report:rep,public_analyses_pruned:prunedAnalyses,public_prune_warning:pruneWarning});
    }
    if(action==="report_latest"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),targetRole=role(body.target_role),{data:meta,error}=await sb.from("league_analysis_runs_v1").select("id,source_kind,analyzer_version,sample_match_ids,created_at,data_quality").eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).order("created_at",{ascending:false}).limit(25);
      if(error)throw error;
      const allRows=Array.isArray(meta)?meta:[],rows=targetRole==="GENERIC"?allRows:allRows.filter((x:any)=>role(x?.data_quality?.selectedRole)===targetRole),currentMeta=rows[0]||null,currentSig=currentMeta?JSON.stringify(currentMeta.sample_match_ids||[]):"",previousMeta=currentMeta?rows.slice(1).find((x:any)=>JSON.stringify(x.sample_match_ids||[])!==currentSig)||null:null,detailIds=[currentMeta?.id,previousMeta?.id].filter(Boolean);
      let detailById=new Map<any,any>();
      if(detailIds.length){
        const{data:details,error:detailError}=await sb.from("league_analysis_runs_v1").select("id,report_data,data_quality").eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).in("id",detailIds);
        if(detailError)throw detailError;detailById=new Map((details||[]).map((x:any)=>[x.id,x]));
      }
      const hydrate=(row:any)=>row?{...row,...(detailById.get(row.id)||{})}:null,current=hydrate(currentMeta),previous=hydrate(previousMeta);
      return json(req,{ok:true,analysis:current,previous,read_strategy:"metadata_then_selected_reports_v1"});
    }
    if(action==="report_import"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),rep=body.report;if(!rep||typeof rep!=="object")return json(req,{ok:false,error:"report_object_required"},400);
      const raw=JSON.stringify(rep);if(raw.length>2000000)return json(req,{ok:false,error:"report_too_large"},413);
      const{data,error}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"legacy_import",analyzer_version:text(rep.analyzerVersion||"legacy-import-v1").slice(0,120),sample_match_ids:Array.isArray(rep.games)?rep.games.map((g:any)=>text(g.matchId)).filter(Boolean).slice(0,100):[],report_data:rep,data_quality:rep.dataQuality||{}}).select("id,created_at").single();if(error)throw error;
      const prunedAnalyses=viewer.anonymous===true?await trimAnonymousRows(sb,"league_analysis_runs_v1",p.id,viewer.player_id,PUBLIC_MAX_ANALYSES_PER_PROFILE,"created_at"):0;
      return json(req,{ok:true,analysis_id:data.id,created_at:data.created_at,public_analyses_pruned:prunedAnalyses});
    }
    return json(req,{ok:false,error:"unknown_action"},400);
  }catch(e:any){console.error("league-api-v1",e);return json(req,{ok:false,error:text(e?.message||e).slice(0,500)},Number(e?.status)||500);}
});
