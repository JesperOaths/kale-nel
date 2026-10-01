// League web backend source.
// Production currently deploys this source into a pre-existing retired diagnostic Edge Function slot
// because the Supabase project is at its function-count limit. The public contract is /league/;
// the legacy deployment slug is an internal implementation detail and can be renamed when a slot is free.


import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "");
const SERVICE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const RIOT_KEY = String(Deno.env.get("RIOT_API_KEY") || Deno.env.get("RIOT_API_TOKEN") || "");
const ALLOWED_ORIGINS = new Set(["https://kalenel.nl","https://www.kalenel.nl","https://admin.kalenel.nl","https://jesperoaths.github.io"]);
const text=(v:any)=>String(v??"").trim();
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):null;
const now=()=>new Date().toISOString();

function cors(req:Request){
  const origin=text(req.headers.get("origin"));
  const allow=ALLOWED_ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)?origin:"https://kalenel.nl";
  return {"Access-Control-Allow-Origin":allow,"Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-gejast-session","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
}
const json=(req:Request,body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
function sbClient(){
  if(!SUPABASE_URL||!SERVICE_KEY) throw new Error("server_not_configured");
  return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
function safeKey(v:any){return text(v).toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64);}
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
  if(r==="UTILITY"||r==="SUPPORT")return"SUPPORT";
  if(r==="BOTTOM"||r==="BOT"||r==="ADC")return"ADC";
  if(r==="MIDDLE"||r==="MID")return"MID";
  if(r==="JUNGLE")return"JUNGLE";
  if(r==="TOP")return"TOP";
  return"GENERIC";
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function avg(xs:any[]){const a=(xs||[]).map(Number).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function pct(a:number,b:number){return b>0?a/b*100:null;}
function xy(v:any){const x=num(v?.x),y=num(v?.y);return x!=null&&y!=null?{x,y}:null;}

async function session(req:Request,body:any){
  const token=text(req.headers.get("x-gejast-session")||body?.session_token);
  if(!token)throw Object.assign(new Error("session_required"),{status:401});
  const sb=sbClient();
  const {data,error}=await sb.from("gejast_player_sessions_v746").select("player_id,display_name,site_scope,expires_at").eq("session_token",token).gt("expires_at",now()).maybeSingle();
  if(error||!data)throw Object.assign(new Error("invalid_session"),{status:401});
  return{sb,viewer:data};
}
async function riot(url:string){
  if(!RIOT_KEY)throw Object.assign(new Error("riot_api_key_not_configured"),{status:503});
  let last="riot_request_failed";
  for(let i=0;i<4;i++){
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
    try{
      const r=await fetch(url,{headers:{"X-Riot-Token":RIOT_KEY,Accept:"application/json"},signal:c.signal});
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
async function resolveProfile(sb:any,p:any){
  if(text(p.puuid))return p;
  const gn=text(p.game_name),tag=text(p.tag_line);
  if(!gn||!tag)throw Object.assign(new Error("riot_id_required"),{status:400});
  const rr=text(p.routing_region)||routeFor(p.platform_region);
  const account=await riot("https://"+rr+".api.riotgames.com/riot/account/v1/accounts/by-riot-id/"+encodeURIComponent(gn)+"/"+encodeURIComponent(tag));
  const patch={puuid:text(account?.puuid),riot_account:account,last_resolved_at:now(),routing_region:rr,updated_at:now()};
  if(!patch.puuid)throw new Error("riot_account_missing_puuid");
  const {data,error}=await sb.from("league_profiles_v1").update(patch).eq("id",p.id).select("*").single();
  if(error)throw error;
  return data;
}
function nearestFrame(frames:any[],minute:number){
  if(!frames?.length)return null;
  const target=minute*60000;let best=null,d=Infinity;
  for(const f of frames){const x=Math.abs(Number(f?.timestamp||0)-target);if(x<d){best=f;d=x;}}
  return best;
}
function frameStats(frame:any,pid:any){
  const p=frame?.participantFrames?.[String(pid)]||frame?.participantFrames?.[pid];
  if(!p)return null;
  return{gold:num(p.totalGold),cs:Number(p.minionsKilled||0)+Number(p.jungleMinionsKilled||0),xp:num(p.xp),position:xy(p.position)};
}
function opponent(match:any,p:any){
  const rr=role(p?.teamPosition||p?.individualPosition||p?.role);
  return(match?.info?.participants||[]).find((x:any)=>x.teamId!==p.teamId&&role(x.teamPosition||x.individualPosition||x.role)===rr)||null;
}
function timelineFacts(match:any,timeline:any,p:any){
  const frames=Array.isArray(timeline?.info?.frames)?timeline.info.frames:[], pid=p.participantId,opp=opponent(match,p);
  const out:any={goldDiff10:null,goldDiff15:null,csDiff10:null,csDiff15:null,xpDiff10:null,xpDiff15:null,deathPositions:[],wards:[],objectives:[],involvedKills:[],goldSeries:[],recalls:null,roams:null,itemSpike:null};
  for(const m of[10,15]){
    const f=nearestFrame(frames,m),a=frameStats(f,pid),b=opp?frameStats(f,opp.participantId):null;
    if(a&&b){out["goldDiff"+m]=(a.gold!=null&&b.gold!=null)?a.gold-b.gold:null;out["csDiff"+m]=a.cs-b.cs;out["xpDiff"+m]=(a.xp!=null&&b.xp!=null)?a.xp-b.xp:null;}
  }
  for(const f of frames){
    const mine=frameStats(f,pid);if(mine?.gold!=null)out.goldSeries.push({minute:Number(f.timestamp||0)/60000,totalGold:mine.gold});
    for(const e of(Array.isArray(f?.events)?f.events:[])){
      const pxy=xy(e.position);
      if(e.type==="CHAMPION_KILL"){
        if(Number(e.victimId)===Number(pid)&&pxy)out.deathPositions.push({time:Number(e.timestamp||0)/60000,...pxy});
        const involved=Number(e.killerId)===Number(pid)||(Array.isArray(e.assistingParticipantIds)&&e.assistingParticipantIds.map(Number).includes(Number(pid)));
        if(involved&&pxy)out.involvedKills.push({time:Number(e.timestamp||0)/60000,...pxy,killerId:e.killerId,victimId:e.victimId});
      }
      if(e.type==="WARD_PLACED"&&Number(e.creatorId)===Number(pid)&&pxy)out.wards.push({time:Number(e.timestamp||0)/60000,...pxy,wardType:text(e.wardType),offensive:null});
      if(e.type==="ELITE_MONSTER_KILL"){
        const involved=Number(e.killerId)===Number(pid)||(Array.isArray(e.assistingParticipantIds)&&e.assistingParticipantIds.map(Number).includes(Number(pid)));
        if(involved&&pxy)out.objectives.push({time:Number(e.timestamp||0)/60000,...pxy,monsterType:text(e.monsterType),monsterSubType:text(e.monsterSubType)});
      }
    }
  }
  return out;
}
function game(row:any,puuid:string){
  const m=row?.match_json||{},ps=Array.isArray(m?.info?.participants)?m.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===puuid);
  if(!p)return null;
  const mins=Math.max(1,Number(m?.info?.gameDuration||row?.game_duration_seconds||0)/60),teamKills=ps.filter((x:any)=>x.teamId===p.teamId).reduce((s:number,x:any)=>s+Number(x.kills||0),0);
  return{matchId:text(m?.metadata?.matchId||row.match_id),gameStartTimestamp:Number(m?.info?.gameStartTimestamp||0),champion:text(p.championName||"Unknown"),championId:num(p.championId),role:role(p.teamPosition||p.individualPosition||p.role),rawRole:text(p.teamPosition||p.individualPosition||p.role),win:!!p.win,kills:Number(p.kills||0),deaths:Number(p.deaths||0),assists:Number(p.assists||0),kda:Number(p.deaths||0)>0?(Number(p.kills||0)+Number(p.assists||0))/Number(p.deaths):Number(p.kills||0)+Number(p.assists||0),kp:pct(Number(p.kills||0)+Number(p.assists||0),teamKills),csMin:(Number(p.totalMinionsKilled||0)+Number(p.neutralMinionsKilled||0))/mins,gpm:Number(p.goldEarned||0)/mins,dpm:Number(p.totalDamageDealtToChampions||0)/mins,vpm:Number(p.visionScore||0)/mins,durationMinutes:mins,mapId:Number(m?.info?.mapId||row.map_id||0)||null,queueId:Number(m?.info?.queueId||row.queue_id||0)||null,timelineAvailable:!!row.timeline_json,...timelineFacts(m,row.timeline_json,p)};
}
function report(profile:any,rows:any[]){
  const games=(rows||[]).map(r=>game(r,text(profile.puuid))).filter(Boolean).slice(0,20),byRole:any={},byChampion:any={};
  for(const g of games){byRole[g.role]=byRole[g.role]||{games:0,wins:0};byRole[g.role].games++;if(g.win)byRole[g.role].wins++;byChampion[g.champion]=byChampion[g.champion]||{games:0,wins:0};byChampion[g.champion].games++;if(g.win)byChampion[g.champion].wins++;}
  let primaryRole="GENERIC",primaryGames=0;for(const[k,v]of Object.entries(byRole)as any){if(Number(v.games)>primaryGames){primaryGames=Number(v.games);primaryRole=k;}}
  const validTimeline=games.filter((g:any)=>g.timelineAvailable).length,coordinateGames=games.filter((g:any)=>(g.deathPositions?.length||0)+(g.wards?.length||0)+(g.objectives?.length||0)>0).length;
  const summary={games:games.length,wins:games.filter((g:any)=>g.win).length,winRate:pct(games.filter((g:any)=>g.win).length,games.length),primaryRole,primaryRoleGames:primaryGames,csMin:avg(games.map((g:any)=>g.csMin)),kp:avg(games.map((g:any)=>g.kp)),dpm:avg(games.map((g:any)=>g.dpm)),gpm:avg(games.map((g:any)=>g.gpm)),vpm:avg(games.map((g:any)=>g.vpm)),goldDiff10:avg(games.map((g:any)=>g.goldDiff10)),goldDiff15:avg(games.map((g:any)=>g.goldDiff15)),csDiff10:avg(games.map((g:any)=>g.csDiff10)),csDiff15:avg(games.map((g:any)=>g.csDiff15))};
  return{schemaVersion:"league-report-v1",analyzerVersion:"league-web-basic-v1",generatedAt:now(),profile:{id:profile.id,displayName:profile.display_name,gameName:profile.game_name,tagLine:profile.tag_line,platformRegion:profile.platform_region,routingRegion:profile.routing_region},summary,byRole,byChampion,recentFocus:[],overallHighlights:[],coaching:[],games,charts:{csMin:games.map((g:any)=>({matchId:g.matchId,value:g.csMin})),kp:games.map((g:any)=>({matchId:g.matchId,value:g.kp})),dpm:games.map((g:any)=>({matchId:g.matchId,value:g.dpm})),goldDiff15:games.map((g:any)=>({matchId:g.matchId,value:g.goldDiff15}))},hiddenCharts:[],benchmarks:{rankAbove:null,itemSpike:null},aggregateMaps:{wards:[],deaths:[]},advanced:{dqi:null,agor:null,objectivePresence:null,earlyKP:null,objectiveDeathPct:null,roams:null,recalls:null,itemSpike:null,wardClassification:null,currentSourcePortRequired:true},dataQuality:{cachedGames:rows.length,analyzedGames:games.length,validTimelineGames:validTimeline,validCoordinateGames:coordinateGames,missingTimelineGames:games.length-validTimeline},sourceStatus:{currentBruisienatorSourceAvailable:false,note:"Basic deterministic web metrics are active. Advanced Bruisienator formulas remain intentionally unported until the current source package is supplied."}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method==="GET")return json(req,{ok:true,mode:"league-api-v1",internal_slot:"retired-diagnostic-reuse",requires_session:true,riot_configured:!!RIOT_KEY});
  if(req.method!=="POST")return json(req,{ok:false,error:"method_not_allowed"},405);
  let body:any={};try{body=await req.json();}catch{return json(req,{ok:false,error:"invalid_json"},400);}
  try{
    const{sb,viewer}=await session(req,body),action=text(body.action||"health");
    if(action==="health")return json(req,{ok:true,riot_configured:!!RIOT_KEY,player:viewer.display_name,site_scope:viewer.site_scope});
    if(action==="profiles_list"){
      const{data,error}=await sb.from("league_profiles_v1").select("id,profile_key,display_name,game_name,tag_line,platform_region,routing_region,notes,puuid,last_resolved_at,rank_snapshot,updated_at").eq("owner_player_id",viewer.player_id).eq("site_scope",viewer.site_scope).order("updated_at",{ascending:false});
      if(error)throw error;return json(req,{ok:true,profiles:data||[]});
    }
    if(action==="profile_save"){
      const input=body.profile||{},profileKey=safeKey(input.profile_key||input.display_name||input.game_name),displayName=text(input.display_name||input.game_name||profileKey);
      if(!profileKey||!displayName)return json(req,{ok:false,error:"profile_name_required"},400);
      const plat=platform(input.platform_region),patch:any={owner_player_id:viewer.player_id,owner_display_name:viewer.display_name,site_scope:viewer.site_scope,profile_key:profileKey,display_name:displayName.slice(0,120),game_name:text(input.game_name).slice(0,80)||null,tag_line:text(input.tag_line).slice(0,32)||null,platform_region:plat,routing_region:routeFor(plat),notes:text(input.notes).slice(0,500)||null,updated_at:now()};
      let saved:any;
      if(text(input.id)){const{data,error}=await sb.from("league_profiles_v1").update(patch).eq("id",text(input.id)).eq("owner_player_id",viewer.player_id).select("*").maybeSingle();if(error||!data)throw error||Object.assign(new Error("profile_not_found"),{status:404});saved=data;}
      else{const{data,error}=await sb.from("league_profiles_v1").upsert(patch,{onConflict:"owner_player_id,site_scope,profile_key"}).select("*").single();if(error)throw error;saved=data;}
      if(RIOT_KEY&&saved.game_name&&saved.tag_line){try{saved=await resolveProfile(sb,saved);}catch(e:any){return json(req,{ok:true,profile:saved,resolve_warning:text(e?.message||e)});}}
      return json(req,{ok:true,profile:saved});
    }
    if(action==="fetch_prepare"){
      let p=await getProfile(sb,viewer.player_id,body.profile_id);p=await resolveProfile(sb,p);
      const count=Math.max(1,Math.min(20,Number(body.count||20))),rr=text(p.routing_region)||routeFor(p.platform_region);
      const ids=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/by-puuid/"+encodeURIComponent(p.puuid)+"/ids?start=0&count="+count),matchIds=Array.isArray(ids)?ids.map(text).filter(Boolean):[];
      const{data:cached}=matchIds.length?await sb.from("league_match_cache_v1").select("match_id").eq("profile_id",p.id).in("match_id",matchIds).not("match_json","is",null):{data:[]};
      const set=new Set((cached||[]).map((x:any)=>x.match_id));
      const{data:run,error}=await sb.from("league_fetch_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,status:"running",match_ids:matchIds,completed_count:set.size,total_count:matchIds.length,cache_hits:set.size,updated_at:now()}).select("*").single();
      if(error)throw error;return json(req,{ok:true,run_id:run.id,match_ids:matchIds,cached_match_ids:[...set],profile:p});
    }
    if(action==="fetch_one"){
      const{data:run,error:re}=await sb.from("league_fetch_runs_v1").select("*").eq("id",text(body.run_id)).eq("owner_player_id",viewer.player_id).maybeSingle();if(re||!run)throw re||Object.assign(new Error("fetch_run_not_found"),{status:404});
      const id=text(body.match_id),allowed=new Set(Array.isArray(run.match_ids)?run.match_ids:[]);if(!allowed.has(id))return json(req,{ok:false,error:"match_not_in_run"},400);
      const p=await getProfile(sb,viewer.player_id,run.profile_id),{data:old}=await sb.from("league_match_cache_v1").select("match_json,timeline_json").eq("profile_id",p.id).eq("match_id",id).maybeSingle();
      if(old?.match_json&&old?.timeline_json&&body.force!==true)return json(req,{ok:true,match_id:id,cache_hit:true,timeline_available:true});
      const rr=text(p.routing_region)||routeFor(p.platform_region),m=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id));
      let tl:any=null,tlError:string|null=null;try{tl=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id)+"/timeline");}catch(e:any){tlError=text(e?.message||e).slice(0,500);}
      const gs=Number(m?.info?.gameStartTimestamp||0),row={profile_id:p.id,match_id:id,owner_player_id:viewer.player_id,game_start_at:gs?new Date(gs).toISOString():null,map_id:num(m?.info?.mapId),queue_id:num(m?.info?.queueId),game_duration_seconds:num(m?.info?.gameDuration),match_json:m,timeline_json:tl,match_fetched_at:now(),timeline_fetched_at:tl?now():null,fetch_error:tlError,updated_at:now()};
      const{error}=await sb.from("league_match_cache_v1").upsert(row,{onConflict:"profile_id,match_id"});if(error)throw error;
      await sb.from("league_fetch_runs_v1").update({completed_count:Math.min(Number(run.total_count||0),Number(run.completed_count||0)+1),updated_at:now(),last_error:tlError}).eq("id",run.id);
      return json(req,{ok:true,match_id:id,cache_hit:false,timeline_available:!!tl,timeline_error:tlError});
    }
    if(action==="fetch_finish"){
      const{data,error}=await sb.from("league_fetch_runs_v1").update({status:"done",completed_at:now(),updated_at:now()}).eq("id",text(body.run_id)).eq("owner_player_id",viewer.player_id).select("*").maybeSingle();if(error||!data)throw error||Object.assign(new Error("fetch_run_not_found"),{status:404});return json(req,{ok:true,run:data});
    }
    if(action==="cache_status"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),{count,error}=await sb.from("league_match_cache_v1").select("*",{count:"exact",head:true}).eq("profile_id",p.id);if(error)throw error;
      const{data:last}=await sb.from("league_match_cache_v1").select("updated_at,game_start_at").eq("profile_id",p.id).order("updated_at",{ascending:false}).limit(1).maybeSingle();return json(req,{ok:true,cached_games:count||0,last_updated_at:last?.updated_at||null,last_game_at:last?.game_start_at||null});
    }
    if(action==="analyze_basic"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id);if(!text(p.puuid))return json(req,{ok:false,error:"profile_not_resolved"},400);
      const{data:rows,error}=await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,match_json,timeline_json,fetch_error").eq("profile_id",p.id).not("match_json","is",null).order("game_start_at",{ascending:false}).limit(20);if(error)throw error;
      const rep=report(p,rows||[]),{data:run,error:se}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"web_basic",analyzer_version:rep.analyzerVersion,sample_match_ids:rep.games.map((g:any)=>g.matchId),report_data:rep,data_quality:rep.dataQuality}).select("id,created_at").single();if(se)throw se;
      return json(req,{ok:true,analysis_id:run.id,created_at:run.created_at,report:rep});
    }
    if(action==="report_latest"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),{data,error}=await sb.from("league_analysis_runs_v1").select("id,source_kind,analyzer_version,report_data,data_quality,created_at").eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw error;return json(req,{ok:true,analysis:data||null});
    }
    if(action==="report_import"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),rep=body.report;if(!rep||typeof rep!=="object")return json(req,{ok:false,error:"report_object_required"},400);
      const raw=JSON.stringify(rep);if(raw.length>2000000)return json(req,{ok:false,error:"report_too_large"},413);
      const{data,error}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"legacy_import",analyzer_version:text(rep.analyzerVersion||"legacy-import-v1").slice(0,120),sample_match_ids:Array.isArray(rep.games)?rep.games.map((g:any)=>text(g.matchId)).filter(Boolean).slice(0,100):[],report_data:rep,data_quality:rep.dataQuality||{}}).select("id,created_at").single();if(error)throw error;return json(req,{ok:true,analysis_id:data.id,created_at:data.created_at});
    }
    return json(req,{ok:false,error:"unknown_action"},400);
  }catch(e:any){console.error("league-api-v1",e);return json(req,{ok:false,error:text(e?.message||e).slice(0,500)},Number(e?.status)||500);}
});
