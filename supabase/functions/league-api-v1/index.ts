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
const hasNum=(v:any)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
const num=(v:any)=>hasNum(v)?Number(v):null;
const now=()=>new Date().toISOString();

function cors(req:Request){
  const origin=text(req.headers.get("origin"));
  const allow=ALLOWED_ORIGINS.has(origin)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)?origin:"https://kalenel.nl";
  return {"Access-Control-Allow-Origin":allow,"Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-gejast-session, x-riot-api-key","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
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
function avg(xs:any[]){const a=(xs||[]).filter(hasNum).map(Number);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
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
async function riot(url:string, requestKey=""){
  const key=RIOT_KEY||text(requestKey);
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
async function resolveProfile(sb:any,p:any,requestKey=""){
  if(text(p.puuid))return p;
  const gn=text(p.game_name),tag=text(p.tag_line);
  if(!gn||!tag)throw Object.assign(new Error("riot_id_required"),{status:400});
  const rr=text(p.routing_region)||routeFor(p.platform_region);
  const account=await riot("https://"+rr+".api.riotgames.com/riot/account/v1/accounts/by-riot-id/"+encodeURIComponent(gn)+"/"+encodeURIComponent(tag),requestKey);
  const patch={puuid:text(account?.puuid),riot_account:account,last_resolved_at:now(),routing_region:rr,updated_at:now()};
  if(!patch.puuid)throw new Error("riot_account_missing_puuid");
  const {data,error}=await sb.from("league_profiles_v1").update(patch).eq("id",p.id).select("*").single();
  if(error)throw error;
  return data;
}

async function rankSnapshotFor(p:any,requestKey=""){
  if(!p||!text(p.puuid))return null;
  try{
    const plat=platform(p.platform_region);
    const rows=await riot("https://"+plat+".api.riotgames.com/lol/league/v4/entries/by-puuid/"+encodeURIComponent(p.puuid),requestKey);
    if(!Array.isArray(rows))return null;
    const pick=rows.find((x:any)=>text(x?.queueType)==="RANKED_SOLO_5x5")||rows.find((x:any)=>text(x?.queueType)==="RANKED_FLEX_SR")||rows[0]||null;
    if(!pick)return null;
    return {
      queueType:text(pick.queueType),tier:text(pick.tier).toUpperCase(),rank:text(pick.rank).toUpperCase(),
      leaguePoints:num(pick.leaguePoints),wins:num(pick.wins),losses:num(pick.losses),
      veteran:!!pick.veteran,hotStreak:!!pick.hotStreak,freshBlood:!!pick.freshBlood,inactive:!!pick.inactive,
      fetchedAt:now()
    };
  }catch(_){return null;}
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

let itemCatalogCache:any=null;
let itemCatalogFetchedAt=0;
async function itemCatalog(){
  if(itemCatalogCache&&(Date.now()-itemCatalogFetchedAt)<6*60*60*1000)return itemCatalogCache;
  try{
    const versions=await fetch("https://ddragon.leagueoflegends.com/api/versions.json",{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():[]);
    const version=Array.isArray(versions)&&versions[0]?String(versions[0]):"";
    if(!version)return {};
    const payload=await fetch("https://ddragon.leagueoflegends.com/cdn/"+encodeURIComponent(version)+"/data/en_US/item.json",{headers:{Accept:"application/json"}}).then(r=>r.ok?r.json():null);
    itemCatalogCache=payload?.data||{};itemCatalogFetchedAt=Date.now();
    return itemCatalogCache;
  }catch(_){return itemCatalogCache||{};}
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
function participantRole(p:any){return role(p?.teamPosition||p?.individualPosition||p?.role||p?.lane);}
function opponent(match:any,p:any){
  const rr=participantRole(p),ps=Array.isArray(match?.info?.participants)?match.info.participants:[];
  if(rr==="GENERIC")return null;
  return ps.find((x:any)=>x.teamId!==p.teamId&&participantRole(x)===rr)||null;
}
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
function wardTerritory(teamId:any,pos:any){
  if(!pos)return"unknown";const sum=Number(pos.x)+Number(pos.y);if(!Number.isFinite(sum))return"unknown";
  if(sum>=13500&&sum<=16500)return"river";
  if(Number(teamId)===100)return sum>16500?"offensive":"defensive";
  if(Number(teamId)===200)return sum<13500?"offensive":"defensive";
  return"unknown";
}
function objectiveOwnerTeam(e:any,byId:Map<number,any>){
  if(e?.type==="ELITE_MONSTER_KILL"&&byId.has(Number(e.killerId)))return Number(byId.get(Number(e.killerId))?.teamId)||null;
  if(e?.type==="BUILDING_KILL"||e?.type==="TURRET_PLATE_DESTROYED"){
    if(byId.has(Number(e.killerId)))return Number(byId.get(Number(e.killerId))?.teamId)||null;
    const victimTeam=Number(e?.teamId);if(victimTeam===100)return 200;if(victimTeam===200)return 100;
  }
  return null;
}
function playerInKill(e:any,pid:any){
  return Number(e?.killerId)===Number(pid)||(Array.isArray(e?.assistingParticipantIds)&&e.assistingParticipantIds.map(Number).includes(Number(pid)));
}
function killConversionWindows(kills:any[],objectives:any[]){
  const sorted=[...(kills||[])].sort((a,b)=>a.tMs-b.tMs),windows:any[]=[];
  for(const ev of sorted){
    let w=windows[windows.length-1];
    if(!w||ev.tMs-w.endMs>30000){w={startMs:ev.tMs,endMs:ev.tMs,kills:1,events:[ev]};windows.push(w);}
    else{w.endMs=ev.tMs;w.kills++;w.events.push(ev);}
  }
  const used=new Set<number>(),objs=[...(objectives||[])].sort((a,b)=>a.tMs-b.tMs);
  for(const w of windows){
    let hitIndex=-1;
    for(let i=0;i<objs.length;i++){
      const o=objs[i];if(used.has(i)||o.tMs<w.endMs)continue;
      if(o.tMs>w.endMs+75000)break;
      hitIndex=i;break;
    }
    const hit=hitIndex>=0?objs[hitIndex]:null;
    if(hitIndex>=0)used.add(hitIndex);
    w.converted=!!hit;
    w.startMin=w.startMs/60000;w.endMin=w.endMs/60000;
    w.objectiveType=hit?text(hit.monsterType||hit.buildingType||hit.type):null;
    w.secondsAfter=hit?Math.round((hit.tMs-w.endMs)/1000):null;
    delete w.events;
  }
  const converted=windows.filter(w=>w.converted).length;
  return{windows:windows.length,converted,rate:windows.length?100*converted/windows.length:null,events:windows};
}
function itemInfo(catalog:any,itemId:any){return catalog?.[String(itemId)]||null;}
function isMajorItem(info:any){
  if(!info)return false;const total=Number(info?.gold?.total||0),tags=Array.isArray(info?.tags)?info.tags:[];
  return total>=2200&&!tags.includes("Boots")&&!tags.includes("Consumable")&&!tags.includes("Trinket");
}
function purchaseGroups(events:any[],catalog:any){
  const sorted=[...(events||[])].sort((a,b)=>a.tMs-b.tMs),groups:any[]=[];
  for(const e of sorted){
    let g=groups[groups.length-1];
    if(!g||e.tMs-g.lastMs>60000){g={startMs:e.tMs,lastMs:e.tMs,startMin:e.tMin,lastMin:e.tMin,items:[],spent:0};groups.push(g);}
    g.lastMs=e.tMs;g.lastMin=e.tMin;
    const info=itemInfo(catalog,e.itemId);g.items.push({itemId:e.itemId,name:text(info?.name)||String(e.itemId),cost:Number(info?.gold?.base||0),totalCost:Number(info?.gold?.total||0),major:isMajorItem(info)});
    g.spent+=Number(info?.gold?.base||0);
  }
  return groups;
}
function firstMajorPurchase(events:any[],catalog:any){
  for(const e of [...(events||[])].sort((a,b)=>a.tMs-b.tMs)){
    const info=itemInfo(catalog,e.itemId);if(isMajorItem(info))return{time:e.tMin,itemId:e.itemId,name:text(info?.name)||String(e.itemId),cost:Number(info?.gold?.total||0)};
  }
  return null;
}
function participantFullGameMetrics(match:any,p:any){
  if(!p)return null;const ps=Array.isArray(match?.info?.participants)?match.info.participants:[],mins=Math.max(1,Number(match?.info?.gameDuration||0)/60);
  const team=ps.filter((x:any)=>x.teamId===p.teamId),teamKills=team.reduce((sum:number,x:any)=>sum+Number(x.kills||0),0);
  const teamDamage=team.reduce((sum:number,x:any)=>sum+Number(x.totalDamageDealtToChampions||0),0),teamGold=team.reduce((sum:number,x:any)=>sum+Number(x.goldEarned||0),0),teamVision=team.reduce((sum:number,x:any)=>sum+Number(x.visionScore||0),0);
  const rankIn=(key:string)=>1+[...team].sort((a:any,b:any)=>Number(b[key]||0)-Number(a[key]||0)).findIndex((x:any)=>Number(x.participantId)===Number(p.participantId));
  return{
    kills:Number(p.kills||0),deaths:Number(p.deaths||0),assists:Number(p.assists||0),kda:Number(p.deaths||0)>0?(Number(p.kills||0)+Number(p.assists||0))/Number(p.deaths):Number(p.kills||0)+Number(p.assists||0),
    csMin:(Number(p.totalMinionsKilled||0)+Number(p.neutralMinionsKilled||0))/mins,dpm:Number(p.totalDamageDealtToChampions||0)/mins,gpm:Number(p.goldEarned||0)/mins,vpm:Number(p.visionScore||0)/mins,
    kp:pct(Number(p.kills||0)+Number(p.assists||0),teamKills),damageShare:pct(Number(p.totalDamageDealtToChampions||0),teamDamage),goldShare:pct(Number(p.goldEarned||0),teamGold),visionShare:pct(Number(p.visionScore||0),teamVision),
    damageRank:rankIn("totalDamageDealtToChampions"),goldRank:rankIn("goldEarned"),visionRank:rankIn("visionScore")
  };
}
function timelineFacts(match:any,timeline:any,p:any,catalog:any){
  const frames=Array.isArray(timeline?.info?.frames)?timeline.info.frames:[],pid=Number(p.participantId),opp=opponent(match,p),oppId=opp?Number(opp.participantId):null;
  const ps=Array.isArray(match?.info?.participants)?match.info.participants:[],byId=new Map<number,any>();for(const q of ps)byId.set(Number(q.participantId),q);
  const mapId=Number(match?.info?.mapId||0),teamId=Number(p.teamId),rr=participantRole(p),homeLane=homeLaneForRole(rr);
  const out:any={goldDiff10:null,goldDiff15:null,goldDiff25:null,csDiff10:null,csDiff15:null,csDiff25:null,xpDiff10:null,xpDiff15:null,xpDiff25:null,levelDiff10:null,levelDiff15:null,levelDiff25:null,deathPositions:[],wards:[],wardKills:[],objectives:[],involvedKills:[],goldSeries:[],frameSamples:[],objectiveJoinRate:null,objectiveJoined:0,objectiveTeamTotal:0,earlyKp:null,impactTimeMin:null,impactType:null,opponentImpactTimeMin:null,opponentImpactType:null,impactDeltaVsOpponent:null,badDeaths:[],badDeathCount:0,tradedDeathCount:0,untradedDeathCount:0,highRiskUntradedDeathCount:0,deathTrades:[],leadDeaths:[],leadDeathCount:0,highRiskLeadDeathCount:0,riskStateDeaths:{ahead:0,even:0,behind:0,highRiskAhead:0,highRiskEven:0,highRiskBehind:0,events:[]},objectiveDeathCount:0,objectiveDeathPct:null,preObjectiveDeaths:[],preObjectiveDeathCount:0,preObjectiveDeathPct:null,highUnspentGoldDeaths:0,overstays:[],overstayCount:0,greedyStayWindows:[],shopVisits:[],firstMajorItem:null,opponentFirstMajorItem:null,itemSpikeDeltaVsOpponent:null,roams:{attempts:0,successes:0,failures:0,neutral:0,events:[]},vision:{wardCount:0,wardKillCount:0,controlWardCount:0,offensive:0,defensive:0,river:0,objectiveSetup:0,objectiveSetupRate:null,objectiveSetupDeltaVsOpponent:null,objectiveSetupRateDeltaVsOpponent:null,wardsPer30:null},opponentVision:{wardCount:0,controlWardCount:0,objectiveSetup:0,objectiveSetupRate:null},killConversion:{windows:0,converted:0,rate:null,events:[]},opponentKillConversion:{windows:0,converted:0,rate:null,events:[]},objectiveReadiness:{neutralTeamObjectives:0,joined:0,lateResetMisses:0,freshPurchaseJoins:0,events:[]},laneDuel:{soloKillsVsRole:0,soloDeathsToRole:0,pre14SoloKillsVsRole:0,pre14SoloDeathsToRole:0,events:[]},lanePressure:{pre14HomeLaneDeaths:0,pre14OutsidePressureDeaths:0,outsidePressureShare:null,events:[]},fightProfile:{attended:0,firstAllyDeaths:0,diedBeforeContribution:0,survived:0,highUnspentStarts:0,itemDisadvantageStarts:0,goldDeficitStarts:0,unspentAndBehindStarts:0,outnumberedStarts:0,lostOutnumberedStarts:0,rolePeerFightStarts:0,roleLevelDisadvantageStarts:0,firstAllyDeathRate:null,diedBeforeContributionRate:null,survivalRate:null,highUnspentStartRate:null,itemDisadvantageStartRate:null,goldDeficitStartRate:null,outnumberedStartRate:null,outnumberedLossRate:null,roleLevelDisadvantageRate:null,events:[]},timelineAvailable:!!frames.length};
  for(const minute of[10,15]){
    const fr=nearestFrame(frames,minute),a=frameStats(fr,pid),b=oppId?frameStats(fr,oppId):null;
    if(a&&b){out["goldDiff"+minute]=(a.gold!=null&&b.gold!=null)?a.gold-b.gold:null;out["csDiff"+minute]=a.cs-b.cs;out["xpDiff"+minute]=(a.xp!=null&&b.xp!=null)?a.xp-b.xp:null;out["levelDiff"+minute]=(a.level!=null&&b.level!=null)?a.level-b.level:null;}
  }
  const reaches25=Number(match?.info?.gameDuration||0)>=25*60,fr25=reaches25?frameNearMinute(frames,25,45000):null,a25=frameStats(fr25,pid),b25=oppId?frameStats(fr25,oppId):null;
  if(a25&&b25){out.goldDiff25=(a25.gold!=null&&b25.gold!=null)?a25.gold-b25.gold:null;out.csDiff25=a25.cs-b25.cs;out.xpDiff25=(a25.xp!=null&&b25.xp!=null)?a25.xp-b25.xp:null;out.levelDiff25=(a25.level!=null&&b25.level!=null)?a25.level-b25.level:null;}

  const purchaseByPid:any[]=[],purchaseByOpp:any[]=[],allObjectives:any[]=[],ownObjectiveEvents:any[]=[],oppObjectiveEvents:any[]=[],deathEvents:any[]=[],involved:any[]=[],oppInvolved:any[]=[],oppWards:any[]=[],allChampionKills:any[]=[];
  for(const fr of frames){
    const mine=frameStats(fr,pid);
    if(mine){const sample={time:Number(fr?.timestamp||0)/60000,totalGold:mine.gold,currentGold:mine.currentGold,cs:mine.cs,xp:mine.xp,level:mine.level,position:mine.position,zone:zoneFor(mapId,mine.position,teamId)};out.frameSamples.push(sample);if(mine.gold!=null)out.goldSeries.push({minute:sample.time,totalGold:mine.gold,currentGold:mine.currentGold});}
    for(const e of(Array.isArray(fr?.events)?fr.events:[])){
      const pxy=xy(e.position),tMs=Number(e.timestamp||0),tMin=tMs/60000;
      if(e.type==="CHAMPION_KILL"){
        const killer=byId.get(Number(e.killerId||0)),victim=byId.get(Number(e.victimId||0));
        const ev={tMs,tMin,...(pxy||{}),killerId:Number(e.killerId||0),victimId:Number(e.victimId||0),killerTeam:Number(killer?.teamId||0)||null,victimTeam:Number(victim?.teamId||0)||null,assistingIds:Array.isArray(e.assistingParticipantIds)?e.assistingParticipantIds.map(Number):[],playerContribution:playerInKill(e,pid),opponentContribution:oppId?playerInKill(e,oppId):false};
        allChampionKills.push(ev);
        if(oppId&&ev.assistingIds.length===0){
          if(ev.killerId===pid&&ev.victimId===oppId){
            out.laneDuel.soloKillsVsRole++;if(tMin<=14)out.laneDuel.pre14SoloKillsVsRole++;
            out.laneDuel.events.push({time:tMin,result:"solo_kill",pre14:tMin<=14,...(pxy||{})});
          }else if(ev.killerId===oppId&&ev.victimId===pid){
            out.laneDuel.soloDeathsToRole++;if(tMin<=14)out.laneDuel.pre14SoloDeathsToRole++;
            out.laneDuel.events.push({time:tMin,result:"solo_death",pre14:tMin<=14,...(pxy||{})});
          }
        }
        if(Number(e.victimId)===pid){
          deathEvents.push(ev);out.deathPositions.push({time:tMin,...(pxy||{}),zone:deathArea(mapId,pxy,teamId)});
          if(tMin<=14&&["TOP","MID"].includes(rr)){
            const deathFrame=frameAtMs(frames,tMs),deathState=frameStats(deathFrame,pid),deathPos=pxy||deathState?.position,deathZone=zoneFor(mapId,deathPos,teamId);
            if(deathZone===homeLane){
              out.lanePressure.pre14HomeLaneDeaths++;
              const attackers=[ev.killerId,...ev.assistingIds].filter((id:any)=>Number(id)>0);
              const outsideIds=attackers.filter((id:any)=>Number(id)!==Number(oppId));
              const outsideRoles=[...new Set(outsideIds.map((id:any)=>participantRole(byId.get(Number(id)))).filter((x:any)=>x&&x!=="GENERIC"))];
              const outsidePressure=outsideIds.length>0;
              if(outsidePressure)out.lanePressure.pre14OutsidePressureDeaths++;
              out.lanePressure.events.push({time:tMin,outsidePressure,attackerCount:attackers.length,outsideRoles,killerRole:participantRole(killer),assisted:ev.assistingIds.length>0,...(pxy||{})});
            }
          }
        }
        if(ev.playerContribution){involved.push(ev);out.involvedKills.push({time:tMin,...(pxy||{}),killerId:e.killerId,victimId:e.victimId});}
        if(ev.opponentContribution)oppInvolved.push(ev);
      }else if(["ELITE_MONSTER_KILL","BUILDING_KILL","TURRET_PLATE_DESTROYED"].includes(String(e.type))){
        const owner=objectiveOwnerTeam(e,byId),obj={tMs,tMin,type:text(e.type),monsterType:text(e.monsterType),monsterSubType:text(e.monsterSubType),buildingType:text(e.buildingType),ownerTeam:owner,...(pxy||{})};
        allObjectives.push(obj);out.objectives.push(obj);if(owner===teamId)ownObjectiveEvents.push(obj);if(opp&&owner===Number(opp.teamId))oppObjectiveEvents.push(obj);
      }else if(e.type==="WARD_PLACED"&&Number(e.creatorId)===pid&&pxy){
        const territory=wardTerritory(teamId,pxy),w={time:tMin,tMs,...pxy,wardType:text(e.wardType),territory};out.wards.push(w);out.vision.wardCount++;if(text(e.wardType).toUpperCase().includes("CONTROL"))out.vision.controlWardCount++;if(territory==="offensive")out.vision.offensive++;else if(territory==="defensive")out.vision.defensive++;else if(territory==="river")out.vision.river++;
      }else if(e.type==="WARD_PLACED"&&oppId&&Number(e.creatorId)===oppId&&pxy){
        const w={time:tMin,tMs,...pxy,wardType:text(e.wardType)};oppWards.push(w);out.opponentVision.wardCount++;if(text(e.wardType).toUpperCase().includes("CONTROL"))out.opponentVision.controlWardCount++;
      }else if(e.type==="WARD_KILL"&&Number(e.killerId)===pid&&pxy){out.wardKills.push({time:tMin,tMs,...pxy,wardType:text(e.wardType)});out.vision.wardKillCount++;}
      else if(e.type==="ITEM_PURCHASED"){const ev={tMs,tMin,itemId:Number(e.itemId||0)};if(Number(e.participantId)===pid)purchaseByPid.push(ev);if(oppId&&Number(e.participantId)===oppId)purchaseByOpp.push(ev);}
    }
  }
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
    const events=cluster.events,first=events[0],fr=frameAtMs(frames,first.tMs),me=frameStats(fr,pid),them=oppId?frameStats(fr,oppId):null;
    const nearby=me?.position&&events.some((e:any)=>hasNum(e.x)&&hasNum(e.y)&&dist2(me.position,e)<=5000*5000);
    const playerDeath=events.find((e:any)=>Number(e.victimId)===pid),contributed=events.some((e:any)=>e.playerContribution),attended=!!playerDeath||contributed||!!nearby;
    if(!attended)continue;
    const alliedDeaths=events.filter((e:any)=>Number(e.victimTeam)===teamId).sort((a:any,b:any)=>a.tMs-b.tMs);
    const firstAllyDeath=!!playerDeath&&alliedDeaths.length>0&&Number(alliedDeaths[0].victimId)===pid;
    const contributionBeforeDeath=contributed&&(!playerDeath||events.some((e:any)=>e.playerContribution&&e.tMs<=playerDeath.tMs));
    const diedBeforeContribution=!!playerDeath&&!contributionBeforeDeath;
    out.fightProfile.attended++;
    if(firstAllyDeath)out.fightProfile.firstAllyDeaths++;
    if(diedBeforeContribution)out.fightProfile.diedBeforeContribution++;
    if(!playerDeath)out.fightProfile.survived++;
    const goldDiffAtStart=me&&them&&hasNum(me.gold)&&hasNum(them.gold)?Number(me.gold)-Number(them.gold):null,levelDiffAtStart=me&&them&&hasNum(me.level)&&hasNum(them.level)?Number(me.level)-Number(them.level):null;
    const anchor=(hasNum(first.x)&&hasNum(first.y))?{x:Number(first.x),y:Number(first.y)}:me?.position;
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
    const teamFightKills=events.filter((e:any)=>Number(e.killerTeam)===teamId).length,enemyFightKills=events.filter((e:any)=>Number(e.killerTeam)&&Number(e.killerTeam)!==teamId).length;
    const rolePeerNear=!!(anchor&&them?.position&&dist2(anchor,them.position)<=5000*5000),roleLevelDisadvantage=rolePeerNear&&hasNum(levelDiffAtStart)&&Number(levelDiffAtStart)<=-1;
    const outnumberedAtFirstKill=hasNum(numbersDelta)&&Number(numbersDelta)<=-2,lostFight=enemyFightKills>teamFightKills;
    if(outnumberedAtFirstKill){out.fightProfile.outnumberedStarts++;if(lostFight)out.fightProfile.lostOutnumberedStarts++;}
    if(rolePeerNear){out.fightProfile.rolePeerFightStarts++;if(roleLevelDisadvantage)out.fightProfile.roleLevelDisadvantageStarts++;}
    out.fightProfile.events.push({startMin:first.tMin,endMin:events[events.length-1].tMin,kills:events.length,playerDied:!!playerDeath,firstAllyDeath,diedBeforeContribution,contributed,survived:!playerDeath,currentGoldAtStart:me?.currentGold??null,goldDiffAtStart,levelDiffAtStart,alliesNear,enemiesNear,numbersDelta,outnumberedAtFirstKill,teamFightKills,enemyFightKills,lostFight,rolePeerNear,roleLevelDisadvantage});
  }
  if(out.fightProfile.attended>0){
    out.fightProfile.firstAllyDeathRate=100*out.fightProfile.firstAllyDeaths/out.fightProfile.attended;
    out.fightProfile.diedBeforeContributionRate=100*out.fightProfile.diedBeforeContribution/out.fightProfile.attended;
    out.fightProfile.survivalRate=100*out.fightProfile.survived/out.fightProfile.attended;
    out.fightProfile.outnumberedStartRate=100*out.fightProfile.outnumberedStarts/out.fightProfile.attended;
    out.fightProfile.outnumberedLossRate=out.fightProfile.outnumberedStarts?100*out.fightProfile.lostOutnumberedStarts/out.fightProfile.outnumberedStarts:null;
    out.fightProfile.roleLevelDisadvantageRate=out.fightProfile.rolePeerFightStarts?100*out.fightProfile.roleLevelDisadvantageStarts/out.fightProfile.rolePeerFightStarts:null;
  }
  out.shopVisits=purchaseGroups(purchaseByPid,catalog);out.firstMajorItem=firstMajorPurchase(purchaseByPid,catalog);out.opponentFirstMajorItem=firstMajorPurchase(purchaseByOpp,catalog);if(out.firstMajorItem&&out.opponentFirstMajorItem)out.itemSpikeDeltaVsOpponent=out.firstMajorItem.time-out.opponentFirstMajorItem.time;
  const neutralOwnObjectives=ownObjectiveEvents.filter((o:any)=>o.type==="ELITE_MONSTER_KILL");
  for(const obj of neutralOwnObjectives){
    out.objectiveReadiness.neutralTeamObjectives++;
    const fr=frameAtMs(frames,obj.tMs),me=frameStats(fr,pid),present=!!(me?.position&&obj.x!=null&&obj.y!=null&&dist2(me.position,obj)<=2500*2500);
    if(present)out.objectiveReadiness.joined++;
    const priorVisits=out.shopVisits.filter((v:any)=>Number(v.lastMs)<=Number(obj.tMs)),lastVisit=priorVisits[priorVisits.length-1]||null;
    const secondsSinceShop=lastVisit?Math.round((Number(obj.tMs)-Number(lastVisit.lastMs))/1000):null;
    const recentDeath=deathEvents.some((d:any)=>d.tMs<=obj.tMs&&d.tMs>=obj.tMs-75000);
    const lateResetMiss=!present&&!recentDeath&&secondsSinceShop!=null&&secondsSinceShop>=0&&secondsSinceShop<=60;
    const freshPurchaseJoin=present&&secondsSinceShop!=null&&secondsSinceShop>=0&&secondsSinceShop<=120;
    if(lateResetMiss)out.objectiveReadiness.lateResetMisses++;
    if(freshPurchaseJoin)out.objectiveReadiness.freshPurchaseJoins++;
    out.objectiveReadiness.events.push({time:obj.tMin,objectiveType:text(obj.monsterType||obj.monsterSubType||"neutral objective"),present,secondsSinceShop,currentGold:me?.currentGold??null,recentDeath,lateResetMiss,freshPurchaseJoin});
  }

  for(const ev of out.fightProfile.events){
    ev.highUnspent=hasNum(ev.currentGoldAtStart)&&Number(ev.currentGoldAtStart)>=1000;
    ev.goldDeficit=hasNum(ev.goldDiffAtStart)&&Number(ev.goldDiffAtStart)<=-600;
    ev.playerMajorReady=!!out.firstMajorItem&&Number(out.firstMajorItem.time)<=Number(ev.startMin);
    ev.opponentMajorReady=!!out.opponentFirstMajorItem&&Number(out.opponentFirstMajorItem.time)<=Number(ev.startMin);
    ev.itemDisadvantage=ev.opponentMajorReady&&!ev.playerMajorReady;
    if(ev.highUnspent)out.fightProfile.highUnspentStarts++;
    if(ev.goldDeficit)out.fightProfile.goldDeficitStarts++;
    if(ev.itemDisadvantage)out.fightProfile.itemDisadvantageStarts++;
    if(ev.highUnspent&&ev.goldDeficit)out.fightProfile.unspentAndBehindStarts++;
  }
  if(out.fightProfile.attended>0){
    out.fightProfile.highUnspentStartRate=100*out.fightProfile.highUnspentStarts/out.fightProfile.attended;
    out.fightProfile.itemDisadvantageStartRate=100*out.fightProfile.itemDisadvantageStarts/out.fightProfile.attended;
    out.fightProfile.goldDeficitStartRate=100*out.fightProfile.goldDeficitStarts/out.fightProfile.attended;
  }
  const duration=Math.max(1,Number(match?.info?.gameDuration||0)/60);out.vision.wardsPer30=out.vision.wardCount/duration*30;
  for(const obj of ownObjectiveEvents){out.objectiveTeamTotal++;const fs=frameAtMs(frames,obj.tMs),me=frameStats(fs,pid),near=me?.position&&obj.x!=null&&obj.y!=null&&dist2(me.position,obj)<=2500*2500;if(near){out.objectiveJoined++;if(out.impactTimeMin==null||obj.tMin<out.impactTimeMin){out.impactTimeMin=obj.tMin;out.impactType="objective";}}}
  if(out.objectiveTeamTotal>0)out.objectiveJoinRate=100*out.objectiveJoined/out.objectiveTeamTotal;
  for(const obj of oppObjectiveEvents){
    const fs=frameAtMs(frames,obj.tMs),them=oppId?frameStats(fs,oppId):null,near=them?.position&&obj.x!=null&&obj.y!=null&&dist2(them.position,obj)<=2500*2500;
    if(near&&(out.opponentImpactTimeMin==null||obj.tMin<out.opponentImpactTimeMin)){out.opponentImpactTimeMin=obj.tMin;out.opponentImpactType="objective";}
  }
  let teamEarly=0,playerEarly=0;
  for(const fr of frames){for(const e of(Array.isArray(fr?.events)?fr.events:[])){if(e.type!=="CHAMPION_KILL"||Number(e.timestamp||0)>14*60*1000)continue;const killer=byId.get(Number(e.killerId));if(!killer||Number(killer.teamId)!==teamId)continue;teamEarly++;if(playerInKill(e,pid))playerEarly++;}}
  if(teamEarly>0)out.earlyKp=100*playerEarly/teamEarly;
  out.killConversion=killConversionWindows(involved,ownObjectiveEvents);
  out.opponentKillConversion=killConversionWindows(oppInvolved,oppObjectiveEvents);
  for(const ev of involved){if(out.impactTimeMin==null||ev.tMin<out.impactTimeMin){out.impactTimeMin=ev.tMin;out.impactType="kill_or_assist";}}
  for(const ev of oppInvolved){if(out.opponentImpactTimeMin==null||ev.tMin<out.opponentImpactTimeMin){out.opponentImpactTimeMin=ev.tMin;out.opponentImpactType="kill_or_assist";}}
  if(hasNum(out.impactTimeMin)&&hasNum(out.opponentImpactTimeMin))out.impactDeltaVsOpponent=Number(out.impactTimeMin)-Number(out.opponentImpactTimeMin);
  for(const d of deathEvents){
    const fr=frameAtMs(frames,d.tMs),me=frameStats(fr,pid),pos=(d.x!=null&&d.y!=null)?{x:d.x,y:d.y}:me?.position;let alliesNear=0,enemiesNear=0,nearestAlly=Infinity;
    if(pos&&fr?.participantFrames){for(const [id,q] of byId.entries()){if(id===pid)continue;const fs=frameStats(fr,id);if(!fs?.position)continue;const dd=dist2(pos,fs.position);if(Number(q.teamId)===teamId){nearestAlly=Math.min(nearestAlly,dd);if(dd<=3000*3000)alliesNear++;}else if(dd<=3000*3000)enemiesNear++;}}
    const isolated=!Number.isFinite(nearestAlly)||nearestAlly>3000*3000,sum=pos?Number(pos.x)+Number(pos.y):null,deep=sum==null?false:(teamId===100?sum>19000:sum<11000),outnumbered=enemiesNear>=alliesNear+2;
    const nextEnemyObj=allObjectives.find(o=>o.ownerTeam&&o.ownerTeam!==teamId&&o.tMs>d.tMs&&o.tMs<=d.tMs+75000),enemyObjSoon=!!nextEnemyObj,objectiveContext=allObjectives.some(o=>Math.abs(o.tMs-d.tMs)<=45000&&(o.x==null||pos==null||dist2(pos,o)<=3500*3500));
    const tradeKill=allChampionKills.find((k:any)=>{
      if(Number(k.tMs)<=Number(d.tMs)||Number(k.tMs)>Number(d.tMs)+15000||Number(k.killerTeam)!==teamId||Number(k.victimTeam)===teamId)return false;
      if(pos&&hasNum(k.x)&&hasNum(k.y))return dist2(pos,k)<=3500*3500;
      return false;
    });
    const traded=!!tradeKill,tradeDelaySec=tradeKill?Math.round((Number(tradeKill.tMs)-Number(d.tMs))/1000):null;
    const them=oppId?frameStats(fr,oppId):null,goldDiffAtDeath=me&&them&&hasNum(me.gold)&&hasNum(them.gold)?Number(me.gold)-Number(them.gold):null;
    const afterFr=frameAfterMs(frames,d.tMs+45000,90000),afterMe=frameStats(afterFr,pid),afterThem=oppId?frameStats(afterFr,oppId):null;
    const goldDiffAfter=afterMe&&afterThem&&hasNum(afterMe.gold)&&hasNum(afterThem.gold)?Number(afterMe.gold)-Number(afterThem.gold):null;
    const goldSwingAfter=hasNum(goldDiffAtDeath)&&hasNum(goldDiffAfter)?Number(goldDiffAfter)-Number(goldDiffAtDeath):null;
    const currentGold=Number(me?.currentGold||0),highUnspent=currentGold>=1000;let score=0;const tags:string[]=[];
    if(isolated){score++;tags.push("isolated");}if(deep){score++;tags.push("deep_enemy_side");}if(outnumbered){score++;tags.push("outnumbered");}if(enemyObjSoon){score+=2;tags.push("enemy_objective_after");out.preObjectiveDeathCount++;out.preObjectiveDeaths.push({time:d.tMin,secondsBeforeObjective:Math.round((nextEnemyObj.tMs-d.tMs)/1000),objectiveType:nextEnemyObj.monsterType||nextEnemyObj.buildingType||nextEnemyObj.type,currentGold});}if(highUnspent){score++;tags.push("high_unspent_gold");}if(objectiveContext){out.objectiveDeathCount++;tags.push("objective_context");}
    const bad=score>=2,wasMateriallyAhead=hasNum(goldDiffAtDeath)&&Number(goldDiffAtDeath)>=500;
    const roleEconomyState=!hasNum(goldDiffAtDeath)?"unknown":Number(goldDiffAtDeath)>=500?"ahead":Number(goldDiffAtDeath)<=-500?"behind":"even";
    if(roleEconomyState!=="unknown"){
      out.riskStateDeaths[roleEconomyState]++;
      if(bad)out.riskStateDeaths["highRisk"+roleEconomyState[0].toUpperCase()+roleEconomyState.slice(1)]++;
      out.riskStateDeaths.events.push({time:d.tMin,state:roleEconomyState,goldDiffAtDeath,highRisk:bad,traded,currentGold,zone:deathArea(mapId,pos,teamId),tags,enemyObjectiveAfter:enemyObjSoon,goldSwingAfter});
    }
    if(traded)out.tradedDeathCount++;else out.untradedDeathCount++;
    if(bad&&!traded)out.highRiskUntradedDeathCount++;
    out.deathTrades.push({time:d.tMin,traded,tradeDelaySec,highRisk:bad,zone:deathArea(mapId,pos,teamId)});
    if(highUnspent)out.highUnspentGoldDeaths++;
    if(wasMateriallyAhead){
      out.leadDeathCount++;if(bad)out.highRiskLeadDeathCount++;
      out.leadDeaths.push({time:d.tMin,goldDiffAtDeath,goldDiffAfter,goldSwingAfter,currentGold,highRisk:bad,tags,zone:deathArea(mapId,pos,teamId),enemyObjectiveAfter:enemyObjSoon});
    }
    if(bad){out.badDeathCount++;out.badDeaths.push({time:d.tMin,x:d.x??null,y:d.y??null,zone:deathArea(mapId,pos,teamId),score,tags,alliesNear,enemiesNear,currentGold,goldDiffAtDeath,goldSwingAfter,traded,tradeDelaySec});}
    if(bad&&(highUnspent||(deep&&isolated))){out.overstayCount++;out.overstays.push({time:d.tMin,currentGold,tags});}
  }
  if(deathEvents.length){out.objectiveDeathPct=100*out.objectiveDeathCount/deathEvents.length;out.preObjectiveDeathPct=100*out.preObjectiveDeathCount/deathEvents.length;}
  const visits=out.shopVisits;
  for(let i=0;i<out.frameSamples.length;i++){const sm=out.frameSamples[i];if(sm.time<6||sm.time>22||Number(sm.currentGold||0)<1200||sm.zone==="base")continue;const next=visits.find((v:any)=>v.startMin>sm.time);if(!next||next.startMin-sm.time<=2)continue;const prev=out.greedyStayWindows[out.greedyStayWindows.length-1];if(prev&&sm.time-prev.startMin<2.5)continue;out.greedyStayWindows.push({startMin:sm.time,currentGold:sm.currentGold,nextShopMin:next.startMin,delayMin:next.startMin-sm.time});}
  for(const w of out.wards){w.objectiveSetup=allObjectives.some(o=>o.x!=null&&Math.abs(o.tMin-w.time)<=1.5&&o.tMin>=w.time&&dist2(w,o)<=3500*3500);if(w.objectiveSetup)out.vision.objectiveSetup++;}
  for(const w of oppWards){w.objectiveSetup=allObjectives.some(o=>o.x!=null&&Math.abs(o.tMin-w.time)<=1.5&&o.tMin>=w.time&&dist2(w,o)<=3500*3500);if(w.objectiveSetup)out.opponentVision.objectiveSetup++;}
  if(oppId)out.vision.objectiveSetupDeltaVsOpponent=Number(out.vision.objectiveSetup||0)-Number(out.opponentVision.objectiveSetup||0);
  if(homeLane&&rr!=="JUNGLE"&&mapId===11){
    const samples=out.frameSamples.filter((x:any)=>x.time>=3&&x.time<=20&&x.zone!=="unknown");let i=1;
    while(i<samples.length){
      if(samples[i-1].zone===homeLane&&samples[i].zone!==homeLane&&samples[i].zone!=="base"){
        const startSample=samples[i],outside:any[]=[startSample];let j=i+1;while(j<samples.length&&samples[j].zone!==homeLane&&samples[j].zone!=="base"){outside.push(samples[j]);j++;}
        const endSample=samples[Math.min(j,samples.length-1)]||outside[outside.length-1];
        if(outside.length>=1&&(endSample.time-startSample.time)>=0.7){
          const st=startSample.time,et=endSample.time+0.5,kill=involved.find(e=>e.tMin>=st-0.3&&e.tMin<=et),death=deathEvents.find(e=>e.tMin>=st-0.3&&e.tMin<=et),obj=ownObjectiveEvents.find(e=>e.tMin>=st-0.3&&e.tMin<=et);
          const zoneCounts:any={};outside.forEach(x=>zoneCounts[x.zone]=(zoneCounts[x.zone]||0)+1);const target=Object.entries(zoneCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1]))[0]?.[0]||"map";
          let outcome="neutral";if(kill||obj)outcome="success";else if(death)outcome="failure";
          const roam:any={startMin:st,endMin:endSample.time,targetZone:target,outcome,killOrAssist:!!kill,objective:!!obj,death:!!death};
          if(oppId){
            const sf=frameAtMs(frames,startSample.time*60000),ef=frameAtMs(frames,endSample.time*60000),m0=frameStats(sf,pid),o0=frameStats(sf,oppId),m1=frameStats(ef,pid),o1=frameStats(ef,oppId);
            if(m0&&o0&&m1&&o1)roam.laneCostCs=(m1.cs-o1.cs)-(m0.cs-o0.cs);
          }
          if(rr==="SUPPORT"){const adc=ps.find((x:any)=>Number(x.teamId)===teamId&&participantRole(x)==="ADC"),enemyAdc=adc?ps.find((x:any)=>Number(x.teamId)!==teamId&&participantRole(x)==="ADC"):null;if(adc&&enemyAdc){const sf=frameAtMs(frames,startSample.time*60000),ef=frameAtMs(frames,endSample.time*60000),a0=frameStats(sf,adc.participantId),b0=frameStats(sf,enemyAdc.participantId),a1=frameStats(ef,adc.participantId),b1=frameStats(ef,enemyAdc.participantId);if(a0&&b0&&a1&&b1)roam.adcLaneCostCs=(a1.cs-b1.cs)-(a0.cs-b0.cs);}}
          out.roams.events.push(roam);out.roams.attempts++;if(outcome==="success")out.roams.successes++;else if(outcome==="failure")out.roams.failures++;else out.roams.neutral++;
        }
        i=Math.max(j,i+1);
      }else i++;
    }
  }
  if(out.lanePressure.pre14HomeLaneDeaths>0)out.lanePressure.outsidePressureShare=100*out.lanePressure.pre14OutsidePressureDeaths/out.lanePressure.pre14HomeLaneDeaths;
  return out;
}
function signedText(v:any,d=0){if(!hasNum(v))return"n/a";const n=Number(v);return(n>0?"+":"")+n.toFixed(d);}
function gameJudgments(g:any){
  const items:any[]=[];
  const add=(priority:number,category:string,title:string,evidence:string,action:string,tone:string="improve")=>items.push({priority,category,title,evidence,action,tone});
  if(Number(g.laneDuel?.pre14SoloDeathsToRole)>=1&&Number(g.laneDuel?.pre14SoloDeathsToRole)>Number(g.laneDuel?.pre14SoloKillsVsRole)){
    add(1,"laning","The direct lane duel went against you",String(g.laneDuel.pre14SoloKillsVsRole||0)+" solo kill(s) versus "+String(g.laneDuel.pre14SoloDeathsToRole||0)+" solo death(s) against the same-role opponent before 14 minutes, excluding kills with assisting participants.","Review the exact trade/all-in that created the solo death: health/resource state, cooldowns, wave position and whether disengaging preserved more lane value.");
  }else if(Number(g.laneDuel?.pre14SoloKillsVsRole)>=1&&Number(g.laneDuel?.pre14SoloKillsVsRole)>Number(g.laneDuel?.pre14SoloDeathsToRole)){
    add(4,"laning","You won the clean direct-role duel",String(g.laneDuel.pre14SoloKillsVsRole)+" solo kill(s) versus "+String(g.laneDuel.pre14SoloDeathsToRole||0)+" solo death(s) against the same-role opponent before 14 minutes.","Preserve the matchup-specific trade/all-in conditions that produced the advantage; distinguish those from plays that depended on outside pressure.","strength");
  }
  if(["TOP","MID"].includes(String(g.role))&&Number(g.lanePressure?.pre14OutsidePressureDeaths)>=2){
    const roles=[...new Set((g.lanePressure.events||[]).flatMap((x:any)=>x.outsideRoles||[]))].join(", ");
    add(2,"map awareness","Repeated early lane deaths involved outside-role pressure",String(g.lanePressure.pre14OutsidePressureDeaths)+" pre-14 home-lane deaths involved at least one enemy other than the direct role opponent"+(roles?" ("+roles+")":"")+".","Review wave depth and information before the deaths: where was the enemy jungler/support last seen, which side was warded, and could the wave have been collected from a safer position?");
  }
  if(hasNum(g.goldDiff15)){
    if(Number(g.goldDiff15)<=-400)add(1,"laning","You reached 15 minutes materially behind your direct role opponent","At 15 minutes: "+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Review the first two recalls, waves conceded around fights, and trades that cost farm.");
    else if(Number(g.goldDiff15)>=400)add(3,"laning","You created a meaningful lane/economy lead","At 15 minutes: +"+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Use the next purchase/objective window to convert the lead instead of letting the game return to even.","strength");
  }
  if(hasNum(g.goldDiff15)&&hasNum(g.goldDiff25)){
    const swing=Number(g.goldDiff25)-Number(g.goldDiff15);
    if(Number(g.goldDiff15)>=300&&swing<=-700)add(1,"mid game","A lane lead eroded sharply between 15 and 25","You were "+signedText(g.goldDiff15,0)+"g at 15 and "+signedText(g.goldDiff25,0)+"g at 25 versus the same-role opponent. The advantage fell by "+Math.abs(Math.round(swing))+"g.","Review the first rotations after lane: side-lane waves, reset timing and fights taken before the next item/objective window.");
    else if(Number(g.goldDiff15)<=-300&&swing>=700)add(4,"mid game","You recovered a substantial early deficit","You moved from "+signedText(g.goldDiff15,0)+"g at 15 to "+signedText(g.goldDiff25,0)+"g at 25 versus the same-role opponent.","Identify the safe farm, picks or objective sequence that created the recovery and repeat that low-variance pattern.","strength");
  }
  if(["ADC","MID","TOP"].includes(String(g.role))&&hasNum(g.csDiff15)&&hasNum(g.csDiff25)){
    const csSwing=Number(g.csDiff25)-Number(g.csDiff15);
    if(csSwing<=-15)add(2,"mid game","Role-relative farm dropped sharply after lane","Your CS differential versus the same-role opponent moved from "+signedText(g.csDiff15,0)+" at 15 to "+signedText(g.csDiff25,0)+" at 25 ("+signedText(csSwing,0)+" CS swing).","Review the 15–25 minute wave assignments: which safe side waves were skipped for grouping, low-value movement or fights that did not require you?");
    else if(csSwing>=15)add(4,"mid game","You gained substantial role-relative farm after lane","Your CS differential moved from "+signedText(g.csDiff15,0)+" at 15 to "+signedText(g.csDiff25,0)+" at 25 ("+signedText(csSwing,0)+" CS swing).","Preserve the routing that collects safe waves without making you late to important objectives or fights.","strength");
  }
  if(Number(g.fightProfile?.itemDisadvantageStarts)>=1&&["ADC","MID","TOP","JUNGLE"].includes(String(g.role)))add(1,"fight readiness","You fought before matching the opponent's first major item",String(g.fightProfile.itemDisadvantageStarts)+" attended multi-kill fight(s) began after the same-role opponent had completed a major item while you had not.","If the fight is not forced, use the reset/item-completion window first; contesting on an item breakpoint disadvantage makes otherwise-even execution harder.");
  if(Number(g.fightProfile?.highUnspentStarts)>=2)add(1,"fight readiness","Repeated fights started with substantial unspent gold",String(g.fightProfile.highUnspentStarts)+" attended multi-kill fight(s) began while you were carrying at least 1000 unspent gold.","Convert stored gold into stats before the next contest whenever the map gives you a safe reset window.");
  if(Number(g.fightProfile?.roleLevelDisadvantageStarts)>=2){
    add(1,"fight readiness","The same-role opponent entered repeated fights a level ahead",String(g.fightProfile.roleLevelDisadvantageStarts)+" attended fight cluster(s) had the actual same-role opponent nearby while you were at least one level lower.","Before taking the contest, check the nearby role opponent's level as well as items and numbers. If the fight is optional, collect the next safe XP breakpoint or trade the play elsewhere.");
  }
  if(Number(g.fightProfile?.outnumberedStarts)>=2){
    add(1,"fight selection","Repeated fights are occurring with a local numbers disadvantage",String(g.fightProfile.outnumberedStarts)+" attended fight cluster(s) had at least two fewer nearby allies than enemies at the first kill event; "+String(g.fightProfile.lostOutnumberedStarts||0)+" of those clusters ended with more enemy kills.","Before committing to a developing fight, count visible/nearby bodies and identify which teammate can actually arrive in the next few seconds; do not treat distant allies on the minimap as present.");
  }
  if(["ADC","MID","TOP"].includes(String(g.role))&&Number(g.fightProfile?.attended)>=2){
    if(Number(g.fightProfile?.firstAllyDeaths)>=2)add(1,"teamfights","You are dying first in repeated multi-kill fights","You were the first allied death in "+String(g.fightProfile.firstAllyDeaths)+" of "+String(g.fightProfile.attended)+" attended multi-kill fight clusters.","Delay entry until key enemy threat/CC is committed, preserve your escape route, and prioritize uninterrupted damage time over being the first body in range.");
    else if(Number(g.fightProfile?.diedBeforeContribution)>=2)add(1,"teamfights","You are being removed before contributing in fights","You died before a tracked kill/assist contribution in "+String(g.fightProfile.diedBeforeContribution)+" of "+String(g.fightProfile.attended)+" attended multi-kill fights.","Review fight approach and initial positioning; entering one screen later can be worth more than arriving first.");
  }
  if(Number(g.killConversion?.windows)>=2){
    if(Number(g.killConversion?.converted)===0)add(2,"conversion","Kill windows did not convert into map value",String(g.killConversion.windows)+" player-involved kill windows were followed by no tracked team objective/structure within 75 seconds.","After a won skirmish, check the nearest objective, structure and wave before chasing another kill or defaulting to a reset.");
    else if(Number(g.killConversion?.rate)>=67)add(4,"conversion","Your team converted player-involved kills efficiently",String(g.killConversion.converted)+" of "+String(g.killConversion.windows)+" player-involved kill windows were followed by a tracked objective/structure within 75 seconds.","Keep the immediate post-kill decision discipline: objective/structure first when the map allows it.","strength");
  }
  if(Number(g.objectiveReadiness?.lateResetMisses)>=1)add(1,"objectives","A late reset appears to have cost neutral-objective attendance",String(g.objectiveReadiness.lateResetMisses)+" neutral objective(s) were taken by your team while you were absent, not recently dead, and your last detected shop visit ended within 60 seconds of the objective.","Move the reset earlier: aim to finish shopping and start pathing before the final setup minute rather than using that minute to buy.");
  if(Number(g.highRiskLeadDeathCount)>=1){
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
  if(hasNum(g.impactDeltaVsOpponent)){
    if(Number(g.impactDeltaVsOpponent)>=3)add(2,"early impact","Your counterpart affected the map earlier","Your first tracked kill/assist/objective impact was at "+Number(g.impactTimeMin).toFixed(1)+"m versus "+Number(g.opponentImpactTimeMin).toFixed(1)+"m for the same-role opponent ("+signedText(g.impactDeltaVsOpponent,1)+"m later).","Check the first actionable window: wave priority, pathing and whether you could move earlier without sacrificing a high-value wave.");
    else if(Number(g.impactDeltaVsOpponent)<=-3)add(4,"early impact","You created meaningful map impact earlier than your counterpart","Your first tracked impact was at "+Number(g.impactTimeMin).toFixed(1)+"m versus "+Number(g.opponentImpactTimeMin).toFixed(1)+"m for the same-role opponent.","Preserve the setup that creates this early timing without forcing low-probability plays.","strength");
  }
  if(hasNum(g.itemSpikeDeltaVsOpponent)){
    if(Number(g.itemSpikeDeltaVsOpponent)>=1)add(1,"resets","Your first major item arrived later than your counterpart","You completed it "+Number(g.itemSpikeDeltaVsOpponent).toFixed(1)+" minutes after the same-role opponent.","Look for a cleaner reset once you are carrying enough gold for a completion; one extra wave is not always worth losing the purchase window.");
    else if(Number(g.itemSpikeDeltaVsOpponent)<=-1)add(3,"resets","You hit the first major item earlier than your counterpart","Your completion arrived "+Math.abs(Number(g.itemSpikeDeltaVsOpponent)).toFixed(1)+" minutes earlier.","Act on that temporary item advantage before the opponent completes theirs.","strength");
  }
  if(Number(g.greedyStayWindows?.length)>=1)add(2,"resets","You held a large amount of spendable gold for too long",String(g.greedyStayWindows.length)+" detected window(s) had at least 1200 current gold and more than two minutes until the next shop visit.","Reset when the map gives you a low-cost window, especially before objectives or a major item completion.");
  const costlyRoams=(g.roams?.events||[]).filter((r:any)=>hasNum(r.laneCostCs)&&Number(r.laneCostCs)<=-6);
  const emptyCostlyRoams=costlyRoams.filter((r:any)=>!r.killOrAssist&&!r.objective);
  if(emptyCostlyRoams.length>=1)add(1,"roaming","The roam result did not justify the lane cost",emptyCostlyRoams.length+" roam(s) lost at least 6 CS of direct-role differential without a kill/assist or objective return.","Push or secure the wave before leaving; cancel the move earlier when the target does not become actionable.");
  if(Number(g.roams?.attempts)>=1){
    const rate=100*Number(g.roams.successes||0)/Math.max(1,Number(g.roams.attempts||0));
    if(rate<40)add(2,"roaming","Roam conversion was weak in this game",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a kill/assist or objective.","Leave lane on pushed/covered waves and abort earlier when the target lane cannot follow.");
    else if(rate>=67)add(4,"roaming","Your roam windows converted well",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a kill/assist or objective.","Keep the timing, then check the lane cost so the roam is not merely shifting resources.","strength");
  }
  if(Number(g.objectiveTeamTotal)>=2&&hasNum(g.objectiveJoinRate)){
    if(Number(g.objectiveJoinRate)<40)add(2,"objectives","You missed much of your team's objective action","Presence was "+Math.round(Number(g.objectiveJoinRate))+"% across "+String(g.objectiveTeamTotal)+" tracked team objective events.","Plan the preceding recall/path one minute earlier rather than reacting after the objective starts.");
    else if(Number(g.objectiveJoinRate)>=75)add(4,"objectives","You were consistently present for objective action","Presence was "+Math.round(Number(g.objectiveJoinRate))+"% across "+String(g.objectiveTeamTotal)+" tracked team objective events.","Preserve the timing and improve setup quality through vision and safer pre-objective positioning.","strength");
  }
  if(g.peer&&["ADC","MID","TOP"].includes(String(g.role))&&Number(g.peer.dpmDelta)<=-150)add(2,"fighting","Your same-role opponent converted more damage","You finished "+Math.round(Math.abs(Number(g.peer.dpmDelta)))+" DPM below the direct counterpart.","Check whether you were late to fights, under-itemized, or removed by an early death before your damage window.");
  if(["ADC","MID","TOP"].includes(String(g.role))&&hasNum(g.damageShare)&&hasNum(g.goldShare)){
    const efficiency=Number(g.damageShare)-Number(g.goldShare);
    if(efficiency<=-6)add(2,"resource conversion","Your damage share did not match your share of team gold","You used "+Number(g.goldShare).toFixed(0)+"% of team gold but produced "+Number(g.damageShare).toFixed(0)+"% of team champion damage.","Review fight arrival, target access and whether deaths are cutting off the damage window after resources have been invested in you.");
    else if(efficiency>=6)add(4,"resource conversion","You converted team resources efficiently","You used "+Number(g.goldShare).toFixed(0)+"% of team gold and produced "+Number(g.damageShare).toFixed(0)+"% of team champion damage.","Keep the positioning/fight selection that lets you create this much output per share of resources.","strength");
  }
  if(Number(g.damageRank)===1)add(4,"team impact","You led your team in champion damage","You ranked #1 of 5 teammates in champion damage this game.","Protect your uptime: unnecessary deaths are especially expensive when your team depends on your damage.","strength");
  return items.sort((a,b)=>a.priority-b.priority).slice(0,5);
}
function game(row:any,puuid:string,catalog:any){
  const m=row?.match_json||{},ps=Array.isArray(m?.info?.participants)?m.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===puuid);if(!p)return null;
  const full=participantFullGameMetrics(m,p),opp=opponent(m,p),oppFull=participantFullGameMetrics(m,opp),facts=timelineFacts(m,row?.timeline_json,p,catalog);
  const peer=oppFull?{champion:text(opp?.championName||"Unknown"),role:participantRole(opp),rank:row?.peer_rank_json||null,csMinDelta:full.csMin-oppFull.csMin,dpmDelta:full.dpm-oppFull.dpm,gpmDelta:full.gpm-oppFull.gpm,vpmDelta:full.vpm-oppFull.vpm,kdaDelta:full.kda-oppFull.kda,opponent:{kda:oppFull.kda,csMin:oppFull.csMin,dpm:oppFull.dpm,gpm:oppFull.gpm,vpm:oppFull.vpm,kp:oppFull.kp}}:null;
  const out:any={matchId:text(m?.metadata?.matchId||row.match_id),gameStartTimestamp:Number(m?.info?.gameStartTimestamp||0),champion:text(p.championName||"Unknown"),championId:num(p.championId),role:participantRole(p),rawRole:text(p.teamPosition||p.individualPosition||p.role),win:!!p.win,...full,durationMinutes:Math.max(1,Number(m?.info?.gameDuration||row?.game_duration_seconds||0)/60),mapId:Number(m?.info?.mapId||row.map_id||0)||null,queueId:Number(m?.info?.queueId||row.queue_id||0)||null,timelineAvailable:!!row.timeline_json,peer,...facts};
  out.judgments=gameJudgments(out);return out;
}
function baselineGame(row:any,puuid:string){
  const m=row?.match_json||{},ps=Array.isArray(m?.info?.participants)?m.info.participants:[],p=ps.find((x:any)=>text(x?.puuid)===puuid);if(!p)return null;
  const full=participantFullGameMetrics(m,p);
  return{matchId:text(m?.metadata?.matchId||row.match_id),gameStartTimestamp:Number(m?.info?.gameStartTimestamp||0),champion:text(p.championName||"Unknown"),role:participantRole(p),win:!!p.win,...full,durationMinutes:Math.max(1,Number(m?.info?.gameDuration||row?.game_duration_seconds||0)/60),mapId:Number(m?.info?.mapId||row.map_id||0)||null,queueId:Number(m?.info?.queueId||row.queue_id||0)||null,timelineAvailable:!!row.timeline_json,goldDiff10:null,goldDiff15:null,csDiff10:null,csDiff15:null,xpDiff10:null,xpDiff15:null};
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
function sessionBehaviorModel(games:any[]){
  const first=games.filter((g:any)=>Number(g.sessionContext?.sessionGameNumber)===1),late=games.filter((g:any)=>Number(g.sessionContext?.sessionGameNumber)>=3);
  const quickAfterLoss=games.filter((g:any)=>g.sessionContext?.previousWin===false&&hasNum(g.sessionContext?.gapAfterPreviousMin)&&Number(g.sessionContext.gapAfterPreviousMin)<=45);
  const quickAfterWin=games.filter((g:any)=>g.sessionContext?.previousWin===true&&hasNum(g.sessionContext?.gapAfterPreviousMin)&&Number(g.sessionContext.gapAfterPreviousMin)<=45);
  const pack=(xs:any[])=>({games:xs.length,goldDiff15:meanField(finiteGames(xs,g=>g.goldDiff15),g=>g.goldDiff15),badDeaths:meanField(xs.filter(g=>g.timelineAvailable),g=>g.badDeathCount),dpm:meanField(xs,g=>g.dpm),csMin:meanField(xs,g=>g.csMin)});
  const firstP=pack(first),lateP=pack(late),lossP=pack(quickAfterLoss),winP=pack(quickAfterWin);
  return{
    firstGame:firstP,game3Plus:lateP,quickAfterLoss:lossP,quickAfterWin:winP,
    game3PlusGoldDelta:hasNum(lateP.goldDiff15)&&hasNum(firstP.goldDiff15)?Number(lateP.goldDiff15)-Number(firstP.goldDiff15):null,
    game3PlusBadDeathDelta:hasNum(lateP.badDeaths)&&hasNum(firstP.badDeaths)?Number(lateP.badDeaths)-Number(firstP.badDeaths):null,
    game3PlusDpmDelta:hasNum(lateP.dpm)&&hasNum(firstP.dpm)?Number(lateP.dpm)-Number(firstP.dpm):null,
    postLossGoldDelta:hasNum(lossP.goldDiff15)&&hasNum(winP.goldDiff15)?Number(lossP.goldDiff15)-Number(winP.goldDiff15):null,
    postLossBadDeathDelta:hasNum(lossP.badDeaths)&&hasNum(winP.badDeaths)?Number(lossP.badDeaths)-Number(winP.badDeaths):null,
    definition:"Session continues while the gap after the previous game end is ≤90 minutes. Quick requeue comparison uses ≤45 minutes."
  };
}
function meanField(games:any[],fn:(g:any)=>any){return avg(games.map(fn));}
function finiteGames(games:any[],fn:(g:any)=>any){return games.filter(g=>hasNum(fn(g)));}
function coachingModel(games:any[],summary:any,lifetime:any,primaryRole:string,playerRank:any=null){
  const recentFocus:any[]=[],highlights:any[]=[],coaching:any[]=[];
  const sessionModel=sessionBehaviorModel(games);
  const conf=(n:number)=>n>=10?"high":n>=5?"medium":"low";
  const push=(arr:any[],category:string,title:string,evidence:string,action:string,confidence:string="medium",priority:number=2,comparison:string="")=>arr.push({category,title,evidence,action,confidence,priority,comparison,text:title+" — "+evidence+(action?" "+action:"")});
  const wins=games.filter(g=>g.win),losses=games.filter(g=>!g.win),validTimeline=games.filter(g=>g.timelineAvailable),lane15=finiteGames(games,g=>g.goldDiff15),itemGames=finiteGames(games,g=>g.itemSpikeDeltaVsOpponent),peerGames=games.filter(g=>g.peer);
  const avgG15=meanField(lane15,g=>g.goldDiff15),avgC15=meanField(finiteGames(games,g=>g.csDiff15),g=>g.csDiff15),laneAhead=lane15.length?100*lane15.filter(g=>Number(g.goldDiff15)>0).length/lane15.length:null;
  const roleSoloKills=validTimeline.reduce((n,g)=>n+Number(g.laneDuel?.soloKillsVsRole||0),0),roleSoloDeaths=validTimeline.reduce((n,g)=>n+Number(g.laneDuel?.soloDeathsToRole||0),0),pre14RoleSoloKills=validTimeline.reduce((n,g)=>n+Number(g.laneDuel?.pre14SoloKillsVsRole||0),0),pre14RoleSoloDeaths=validTimeline.reduce((n,g)=>n+Number(g.laneDuel?.pre14SoloDeathsToRole||0),0),pre14RoleSoloDeathPerGame=validTimeline.length?pre14RoleSoloDeaths/validTimeline.length:null;
  const pre14HomeLaneDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14HomeLaneDeaths||0),0),pre14OutsidePressureDeaths=validTimeline.reduce((n,g)=>n+Number(g.lanePressure?.pre14OutsidePressureDeaths||0),0),pre14OutsidePressureShare=pre14HomeLaneDeaths?100*pre14OutsidePressureDeaths/pre14HomeLaneDeaths:null;
  const laneLeads=lane15.filter(g=>Number(g.goldDiff15)>=250),laneDeficits=lane15.filter(g=>Number(g.goldDiff15)<=-250);
  const midgameGames=games.filter(g=>hasNum(g.goldDiff15)&&hasNum(g.goldDiff25)),leadMidgame=midgameGames.filter(g=>Number(g.goldDiff15)>=250),deficitMidgame=midgameGames.filter(g=>Number(g.goldDiff15)<=-250);
  const avgSwing15to25=meanField(midgameGames,g=>Number(g.goldDiff25)-Number(g.goldDiff15)),leadSwing15to25=meanField(leadMidgame,g=>Number(g.goldDiff25)-Number(g.goldDiff15)),deficitSwing15to25=meanField(deficitMidgame,g=>Number(g.goldDiff25)-Number(g.goldDiff15));
  const midgameCsGames=["ADC","MID","TOP"].includes(primaryRole)?games.filter(g=>hasNum(g.csDiff15)&&hasNum(g.csDiff25)):[],avgCsSwing15to25=meanField(midgameCsGames,g=>Number(g.csDiff25)-Number(g.csDiff15));
  const laneLeadWr=laneLeads.length?100*laneLeads.filter(g=>g.win).length/laneLeads.length:null,laneDeficitWr=laneDeficits.length?100*laneDeficits.filter(g=>g.win).length/laneDeficits.length:null;
  const badPer=meanField(validTimeline,g=>g.badDeathCount),totalTimelineDeaths=validTimeline.reduce((n,g)=>n+Number(g.deaths||0),0),tradedDeaths=validTimeline.reduce((n,g)=>n+Number(g.tradedDeathCount||0),0),highRiskUntradedDeaths=validTimeline.reduce((n,g)=>n+Number(g.highRiskUntradedDeathCount||0),0),deathTradeRate=totalTimelineDeaths?100*tradedDeaths/totalTimelineDeaths:null,highRiskUntradedPerGame=validTimeline.length?highRiskUntradedDeaths/validTimeline.length:null,leadDeaths=validTimeline.reduce((n,g)=>n+Number(g.leadDeathCount||0),0),highRiskLeadDeaths=validTimeline.reduce((n,g)=>n+Number(g.highRiskLeadDeathCount||0),0),highRiskLeadDeathsPerGame=validTimeline.length?highRiskLeadDeaths/validTimeline.length:null,
    aheadStateDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.ahead||0),0),evenStateDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.even||0),0),behindStateDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.behind||0),0),
    highRiskAheadStateDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskAhead||0),0),highRiskEvenStateDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskEven||0),0),highRiskBehindDeaths=validTimeline.reduce((n,g)=>n+Number(g.riskStateDeaths?.highRiskBehind||0),0),
    highRiskBehindDeathRate=behindStateDeaths?100*highRiskBehindDeaths/behindStateDeaths:null,highRiskBehindDeathsPerGame=validTimeline.length?highRiskBehindDeaths/validTimeline.length:null,objDeathPct=meanField(finiteGames(validTimeline,g=>g.objectiveDeathPct),g=>g.objectiveDeathPct),preObjDeaths=validTimeline.reduce((n,g)=>n+Number(g.preObjectiveDeathCount||0),0),preObjDeathPct=meanField(finiteGames(validTimeline,g=>g.preObjectiveDeathPct),g=>g.preObjectiveDeathPct),unspent=validTimeline.reduce((n,g)=>n+Number(g.highUnspentGoldDeaths||0),0);
  const badDeathZoneCounts:any={};for(const g of validTimeline){for(const d of(g.badDeaths||[])){const z=text(d.zone)||"unknown";badDeathZoneCounts[z]=(badDeathZoneCounts[z]||0)+1;}}
  const badDeathZoneEntries=Object.entries(badDeathZoneCounts).sort((a:any,b:any)=>Number(b[1])-Number(a[1])),topBadDeathZone=badDeathZoneEntries[0]?.[0]||null,topBadDeathZoneCount=Number(badDeathZoneEntries[0]?.[1]||0),totalBadDeaths=badDeathZoneEntries.reduce((n:number,x:any)=>n+Number(x[1]||0),0),topBadDeathZonePct=totalBadDeaths?100*topBadDeathZoneCount/totalBadDeaths:null;
  const objJoin=meanField(finiteGames(validTimeline,g=>g.objectiveJoinRate),g=>g.objectiveJoinRate),earlyKp=meanField(finiteGames(validTimeline,g=>g.earlyKp),g=>g.earlyKp);
  const roamAttempts=validTimeline.reduce((n,g)=>n+Number(g.roams?.attempts||0),0),roamSuccess=validTimeline.reduce((n,g)=>n+Number(g.roams?.successes||0),0),roamFail=validTimeline.reduce((n,g)=>n+Number(g.roams?.failures||0),0),roamRate=roamAttempts?100*roamSuccess/roamAttempts:null;
  const roamLaneCostEvents=validTimeline.flatMap(g=>g.roams?.events||[]).filter((r:any)=>hasNum(r.laneCostCs)),avgRoamLaneCostCs=avg(roamLaneCostEvents.map((r:any)=>r.laneCostCs)),costlyRoams=roamLaneCostEvents.filter((r:any)=>Number(r.laneCostCs)<=-6),emptyCostlyRoams=costlyRoams.filter((r:any)=>!r.killOrAssist&&!r.objective);
  const itemDelta=meanField(itemGames,g=>g.itemSpikeDeltaVsOpponent),greedy=validTimeline.reduce((n,g)=>n+Number(g.greedyStayWindows?.length||0),0),peerCs=meanField(peerGames,g=>g.peer.csMinDelta),peerDpm=meanField(peerGames,g=>g.peer.dpmDelta),peerVpm=meanField(peerGames,g=>g.peer.vpmDelta),topDamage=games.filter(g=>Number(g.damageRank)===1).length;
  const impactGames=finiteGames(validTimeline,g=>g.impactDeltaVsOpponent),avgImpactDelta=meanField(impactGames,g=>g.impactDeltaVsOpponent),impactEarlierPct=impactGames.length?100*impactGames.filter(g=>Number(g.impactDeltaVsOpponent)<0).length/impactGames.length:null;
  const resourceGames=games.filter(g=>hasNum(g.damageShare)&&hasNum(g.goldShare)),damageGoldEfficiency=meanField(resourceGames,g=>Number(g.damageShare)-Number(g.goldShare)),avgDamageShare=meanField(resourceGames,g=>g.damageShare),avgGoldShare=meanField(resourceGames,g=>g.goldShare);
  const fightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.attended||0),0),firstAllyFightDeaths=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.firstAllyDeaths||0),0),preContributionFightDeaths=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.diedBeforeContribution||0),0),survivedFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.survived||0),0);
  const firstAllyFightDeathRate=fightSamples?100*firstAllyFightDeaths/fightSamples:null,preContributionFightDeathRate=fightSamples?100*preContributionFightDeaths/fightSamples:null,fightSurvivalRate=fightSamples?100*survivedFightSamples/fightSamples:null;
  const highUnspentFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.highUnspentStarts||0),0),itemDisadvantageFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.itemDisadvantageStarts||0),0),goldDeficitFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.goldDeficitStarts||0),0),unspentAndBehindFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.unspentAndBehindStarts||0),0);
  const outnumberedFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.outnumberedStarts||0),0),lostOutnumberedFights=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.lostOutnumberedStarts||0),0);
  const rolePeerFightSamples=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.rolePeerFightStarts||0),0),roleLevelDisadvantageFightStarts=validTimeline.reduce((n,g)=>n+Number(g.fightProfile?.roleLevelDisadvantageStarts||0),0),roleLevelDisadvantageFightRate=rolePeerFightSamples?100*roleLevelDisadvantageFightStarts/rolePeerFightSamples:null;
  const outnumberedFightStartRate=fightSamples?100*outnumberedFightStarts/fightSamples:null,outnumberedFightLossRate=outnumberedFightStarts?100*lostOutnumberedFights/outnumberedFightStarts:null;
  const highUnspentFightRate=fightSamples?100*highUnspentFightStarts/fightSamples:null,itemDisadvantageFightRate=fightSamples?100*itemDisadvantageFightStarts/fightSamples:null,goldDeficitFightRate=fightSamples?100*goldDeficitFightStarts/fightSamples:null;
  const visionSetupGames=finiteGames(validTimeline,g=>g.vision?.objectiveSetupDeltaVsOpponent),avgObjectiveSetupDelta=meanField(visionSetupGames,g=>g.vision.objectiveSetupDeltaVsOpponent),objectiveSetupOutperformPct=visionSetupGames.length?100*visionSetupGames.filter(g=>Number(g.vision.objectiveSetupDeltaVsOpponent)>0).length/visionSetupGames.length:null;
  const visionWardTotal=validTimeline.reduce((n,g)=>n+Number(g.vision?.wardCount||0),0),visionSetupTotal=validTimeline.reduce((n,g)=>n+Number(g.vision?.objectiveSetup||0),0),opponentVisionWardTotal=validTimeline.reduce((n,g)=>n+Number(g.opponentVision?.wardCount||0),0),opponentVisionSetupTotal=validTimeline.reduce((n,g)=>n+Number(g.opponentVision?.objectiveSetup||0),0);
  const objectiveSetupWardRate=visionWardTotal?100*visionSetupTotal/visionWardTotal:null,opponentObjectiveSetupWardRate=opponentVisionWardTotal?100*opponentVisionSetupTotal/opponentVisionWardTotal:null,objectiveSetupWardRateDelta=hasNum(objectiveSetupWardRate)&&hasNum(opponentObjectiveSetupWardRate)?Number(objectiveSetupWardRate)-Number(opponentObjectiveSetupWardRate):null;
  const killConversionWindowsCount=validTimeline.reduce((n,g)=>n+Number(g.killConversion?.windows||0),0),killConversions=validTimeline.reduce((n,g)=>n+Number(g.killConversion?.converted||0),0),oppKillConversionWindows=validTimeline.reduce((n,g)=>n+Number(g.opponentKillConversion?.windows||0),0),oppKillConversions=validTimeline.reduce((n,g)=>n+Number(g.opponentKillConversion?.converted||0),0);
  const neutralObjectiveEvents=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.neutralTeamObjectives||0),0),neutralObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.joined||0),0),lateResetObjectiveMisses=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.lateResetMisses||0),0),freshPurchaseObjectiveJoins=validTimeline.reduce((n,g)=>n+Number(g.objectiveReadiness?.freshPurchaseJoins||0),0);
  const lateResetObjectiveMissRate=neutralObjectiveEvents?100*lateResetObjectiveMisses/neutralObjectiveEvents:null,freshPurchaseObjectiveJoinRate=neutralObjectiveEvents?100*freshPurchaseObjectiveJoins/neutralObjectiveEvents:null;
  const killConversionRate=killConversionWindowsCount?100*killConversions/killConversionWindowsCount:null,opponentKillConversionRate=oppKillConversionWindows?100*oppKillConversions/oppKillConversionWindows:null,killConversionDelta=hasNum(killConversionRate)&&hasNum(opponentKillConversionRate)?Number(killConversionRate)-Number(opponentKillConversionRate):null;
  const outperform=(list:any[],fn:(g:any)=>any,invert=false)=>{const xs=list.filter(g=>hasNum(fn(g)));return xs.length?100*xs.filter(g=>invert?Number(fn(g))<0:Number(fn(g))>0).length/xs.length:null;};
  const peerGoldWin=outperform(lane15,g=>g.goldDiff15),peerCsWin=outperform(peerGames,g=>g.peer.csMinDelta),peerDpmWin=outperform(peerGames,g=>g.peer.dpmDelta),peerVpmWin=outperform(peerGames,g=>g.peer.vpmDelta),peerItemFaster=outperform(itemGames,g=>g.itemSpikeDeltaVsOpponent,true);
  const wl=(fn:(g:any)=>any)=>({wins:meanField(finiteGames(wins,fn),fn),losses:meanField(finiteGames(losses,fn),fn)});
  const winLoss={goldDiff15:wl(g=>g.goldDiff15),dpm:wl(g=>g.dpm),badDeaths:wl(g=>g.badDeathCount),earlyKp:wl(g=>g.earlyKp),objectiveJoin:wl(g=>g.objectiveJoinRate),greedyStays:wl(g=>g.greedyStayWindows?.length),itemDelta:wl(g=>g.itemSpikeDeltaVsOpponent)};
  const recent5=games.slice(0,5),prior15=games.slice(5,20);
  const trendMetric=(fn:(g:any)=>any)=>({recent:meanField(finiteGames(recent5,fn),fn),prior:meanField(finiteGames(prior15,fn),fn),recentN:finiteGames(recent5,fn).length,priorN:finiteGames(prior15,fn).length});
  const recentTrend={csMin:trendMetric(g=>g.csMin),dpm:trendMetric(g=>g.dpm),kp:trendMetric(g=>g.kp),goldDiff15:trendMetric(g=>g.goldDiff15),badDeaths:trendMetric(g=>g.badDeathCount),objectiveJoin:trendMetric(g=>g.objectiveJoinRate),itemDelta:trendMetric(g=>g.itemSpikeDeltaVsOpponent)};
  const objectivePresenceLow=["JUNGLE","SUPPORT"].includes(primaryRole)&&validTimeline.length>=5&&hasNum(objJoin)&&Number(objJoin)<50,objectiveRootCauses:any[]=[];
  if(objectivePresenceLow){
    if(neutralObjectiveEvents>=5&&lateResetObjectiveMisses>=2)objectiveRootCauses.push({key:"late_reset",label:"late reset timing",evidence:lateResetObjectiveMisses+" late-reset objective miss(es)",severity:lateResetObjectiveMissRate||0});
    if(preObjDeaths>=2)objectiveRootCauses.push({key:"pre_objective_death",label:"death before the contest",evidence:preObjDeaths+" deaths followed by enemy objective conversion",severity:Math.min(100,preObjDeaths*20)});
    if(visionWardTotal>=20&&opponentVisionWardTotal>=20&&hasNum(objectiveSetupWardRateDelta)&&Number(objectiveSetupWardRateDelta)<=-10)objectiveRootCauses.push({key:"setup_vision",label:"setup-vision share",evidence:signedText(objectiveSetupWardRateDelta,0)+" pp setup-ward-rate delta vs role peers",severity:Math.abs(Number(objectiveSetupWardRateDelta))});
    objectiveRootCauses.sort((a:any,b:any)=>Number(b.severity||0)-Number(a.severity||0));
  }
  const objectivePrimaryCause=objectiveRootCauses[0]||null;

  if(["TOP","MID"].includes(primaryRole)&&pre14HomeLaneDeaths>=4&&pre14OutsidePressureDeaths>=3&&Number(pre14OutsidePressureShare)>=60)push(recentFocus,"map awareness","Most early home-lane deaths involve outside pressure",pre14OutsidePressureDeaths+" of "+pre14HomeLaneDeaths+" pre-14 home-lane deaths ("+Math.round(Number(pre14OutsidePressureShare))+"%) involved at least one enemy other than the direct role opponent.","Treat this separately from matchup mechanics: tighten wave depth when enemy positions are unknown, place vision before the vulnerable wave arrives, and track likely jungle/support timing before committing to trades.",conf(pre14HomeLaneDeaths),1,"pre-14 TOP/MID home-lane death participants");
  if(validTimeline.length>=5&&pre14RoleSoloDeaths>=3&&pre14RoleSoloDeaths>=pre14RoleSoloKills+2)push(recentFocus,"laning","Clean 1v1 lane deaths to your direct counterpart recur",pre14RoleSoloKills+" solo kill(s) versus "+pre14RoleSoloDeaths+" solo death(s) against the same-role opponent before 14 minutes across "+validTimeline.length+" timeline-complete games. Kills with assisting participants are excluded.","Prioritize matchup-specific review: identify which cooldown/resource/wave conditions precede the solo deaths and define a clear disengage threshold for those states.",conf(validTimeline.length),1,"clean pre-14 solo kills/deaths versus actual same-role opponents");
  else if(validTimeline.length>=5&&pre14RoleSoloKills>=3&&pre14RoleSoloKills>=pre14RoleSoloDeaths+2)push(highlights,"laning","Direct 1v1 lane duels are a strength",pre14RoleSoloKills+" solo kill(s) versus "+pre14RoleSoloDeaths+" solo death(s) against the same-role opponent before 14 minutes, excluding assisted kills.","Preserve the matchup-specific trade discipline that creates these clean advantages; the next step is converting them into wave, reset and objective value.",conf(validTimeline.length),4,"clean pre-14 solo kills/deaths versus actual same-role opponents");
  if(lane15.length>=5){
    if(Number(avgG15)<=-250)push(recentFocus,"laning","Early-lane economy is the clearest leak","Across "+lane15.length+" comparable games you average "+Math.round(Number(avgG15))+" gold and "+Math.round(Number(avgC15||0))+" CS versus the same-role opponent at 15; you are ahead in only "+Math.round(Number(laneAhead||0))+"% of them.","Prioritize wave access and lower-cost trades before 15 minutes; this is a direct opponent comparison, not a generic benchmark.",conf(lane15.length),1,"same-role opponents");
    else if(Number(avgG15)>=250)push(highlights,"laning","You are consistently creating lane economy","You average +"+Math.round(Number(avgG15))+" gold versus the same-role opponent at 15 across "+lane15.length+" games.","The next improvement lever is converting that lead into earlier objectives and cleaner resets.",conf(lane15.length),3,"same-role opponents");
    const lane10=meanField(finiteGames(games,g=>g.goldDiff10),g=>g.goldDiff10);
    if(Number(lane10)>=100&&Number(avgG15)<=-50)push(recentFocus,"laning","Early leads are leaking before 15","Average gold differential moves from "+Math.round(Number(lane10))+" at 10 minutes to "+Math.round(Number(avgG15))+" at 15.","Review the first reset and the 10–15 minute wave/fight decisions; you are creating a lead and then giving it back.",conf(lane15.length),1,"same-role opponents");
  }
  if(laneLeads.length>=4&&Number(laneLeadWr)<50)push(recentFocus,"conversion","Lane leads are not becoming enough wins","When you are at least +250g versus the direct role opponent at 15, you win only "+Math.round(Number(laneLeadWr))+"% of those "+laneLeads.length+" games.","After creating the lead, spend it before the next neutral objective and avoid low-value side fights that give shutdown/tempo back.",conf(laneLeads.length),1,"lead-to-win conversion");
  else if(laneLeads.length>=4&&Number(laneLeadWr)>=65)push(highlights,"conversion","You convert lane leads into wins well","You win "+Math.round(Number(laneLeadWr))+"% of the "+laneLeads.length+" games where you are at least +250g versus your role opponent at 15.","Keep repeating the post-lane choices that turn the advantage into objectives and map control.",conf(laneLeads.length),3,"lead-to-win conversion");
  if(laneDeficits.length>=4&&Number(laneDeficitWr)>=45)push(highlights,"recovery","You recover from lane deficits unusually often in this sample","You still win "+Math.round(Number(laneDeficitWr))+"% of "+laneDeficits.length+" games where you are at least 250g behind the role opponent at 15.","Preserve the low-variance recovery habits rather than forcing desperate fights when behind.",conf(laneDeficits.length),4,"deficit-to-win recovery");
  if(midgameCsGames.length>=4&&hasNum(avgCsSwing15to25)){
    if(Number(avgCsSwing15to25)<=-8)push(recentFocus,"mid game","Mid-game routing is losing role-relative farm","Across "+midgameCsGames.length+" comparable games, your CS differential versus the same-role opponent worsens by "+Math.abs(Number(avgCsSwing15to25)).toFixed(1)+" CS on average from 15 to 25 minutes.","Audit the waves you skip between 15 and 25: collect safe side waves before grouping, and distinguish required objective movement from movement that only shadows teammates.",conf(midgameCsGames.length),2,"same-role CS differential from 15→25");
    else if(Number(avgCsSwing15to25)>=8)push(highlights,"mid game","Your post-lane farm routing gains ground on the role opponent","Across "+midgameCsGames.length+" comparable games, you improve direct-role CS differential by "+Number(avgCsSwing15to25).toFixed(1)+" CS on average from 15 to 25.","Keep the routing, while verifying that the extra waves do not make you late to high-value objective/fight windows.",conf(midgameCsGames.length),4,"same-role CS differential from 15→25");
  }
  if(leadMidgame.length>=4&&Number(leadSwing15to25)<=-500)push(recentFocus,"mid game","Leads are eroding between 15 and 25","In "+leadMidgame.length+" games where you are at least +250g at 15, your direct-role gold differential falls by "+Math.abs(Math.round(Number(leadSwing15to25)))+"g on average by 25.","Treat the first post-lane rotation as a decision window: collect safe side waves, buy before objectives, and avoid low-value fights that hand tempo back.",conf(leadMidgame.length),1,"same-role gold differential from 15→25");
  else if(leadMidgame.length>=4&&Number(leadSwing15to25)>=250)push(highlights,"mid game","You tend to extend lane leads through the first rotations","When at least +250g at 15, you add another "+Math.round(Number(leadSwing15to25))+"g versus the role opponent by 25 on average across "+leadMidgame.length+" games.","Keep the side-lane/reset/objective sequence that preserves and compounds the advantage.",conf(leadMidgame.length),4,"same-role gold differential from 15→25");
  if(deficitMidgame.length>=4&&Number(deficitSwing15to25)>=500)push(highlights,"mid game","Your mid-game recovery is a real strength","From games at least 250g behind at 15, you recover "+Math.round(Number(deficitSwing15to25))+"g of direct-role differential by 25 on average.","Preserve the low-risk recovery pattern rather than forcing early comeback fights.","medium",4,"same-role gold differential from 15→25");
  if(impactGames.length>=5&&["JUNGLE","SUPPORT","MID"].includes(primaryRole)){
    if(Number(avgImpactDelta)>=1.5)push(recentFocus,"early impact","First map impact trails your direct role opponent","Across "+impactGames.length+" comparable games, your first tracked impact comes "+Number(avgImpactDelta).toFixed(1)+" minutes later on average, and you act first in "+Math.round(Number(impactEarlierPct||0))+"% of games.","Review the first move window—lane priority, jungle path, river setup or recall timing—rather than trying to compensate with later forced plays.",conf(impactGames.length),1,"first kill/assist/objective impact vs same-role opponent");
    else if(Number(avgImpactDelta)<=-1.5)push(highlights,"early impact","You tend to influence the map before your counterpart","Across "+impactGames.length+" comparable games, your first tracked impact comes "+Math.abs(Number(avgImpactDelta)).toFixed(1)+" minutes earlier on average.","Preserve the early setup while checking that the move does not cost too much lane economy.","medium",4,"first kill/assist/objective impact vs same-role opponent");
  }
  if(itemGames.length>=4){
    if(Number(itemDelta)>=0.75)push(recentFocus,"resets","Major item timing is slower than your direct opponent","Your first major completed item lands "+Number(itemDelta).toFixed(1)+" minutes later on average across "+itemGames.length+" games; you are faster in only "+Math.round(Number(peerItemFaster||0))+"% of comparable games.","Look for earlier high-value recalls after accumulating gold; avoid staying for one extra wave when it delays a completed item.",conf(itemGames.length),1,"same-role major-item timing");
    else if(Number(itemDelta)<=-0.75)push(highlights,"resets","You usually hit the first major item before your counterpart","Your first major completed item arrives "+Math.abs(Number(itemDelta)).toFixed(1)+" minutes earlier on average across "+itemGames.length+" games.","Use that purchase window deliberately: contest the next wave, objective or fight while the opponent is still down a completion.",conf(itemGames.length),3,"same-role major-item timing");
  }
  if(validTimeline.length>=5&&behindStateDeaths>=4&&highRiskBehindDeaths>=3&&Number(highRiskBehindDeathRate)>=50)push(recentFocus,"risk when behind","High-risk deaths are compounding direct-role deficits",highRiskBehindDeaths+" of "+behindStateDeaths+" deaths taken while at least 500g behind the direct role opponent crossed the high-risk threshold ("+Number(highRiskBehindDeathRate).toFixed(0)+"%).","When your role matchup is behind, lower variance first: collect safe waves/camps, trade cross-map, and avoid isolated/deep entries that make the opponent's existing lead easier to convert.",conf(behindStateDeaths),1,"death quality while ≥500g behind the same-role opponent");
  else if(validTimeline.length>=5&&behindStateDeaths>=4&&Number(highRiskBehindDeathRate)<=25)push(highlights,"risk when behind","You show restraint when the direct role matchup is behind",highRiskBehindDeaths+" of "+behindStateDeaths+" deaths while at least 500g behind crossed the high-risk threshold ("+Number(highRiskBehindDeathRate).toFixed(0)+"%).","Keep the low-variance recovery discipline; the next improvement lever is finding safe resource and cross-map opportunities rather than forcing equal fights.","medium",4,"death quality while ≥500g behind the same-role opponent");
  if(validTimeline.length>=5&&highRiskLeadDeaths>=3)push(recentFocus,"lead protection","Deaths while ahead are giving back earned advantages",highRiskLeadDeaths+" high-risk deaths occurred while you were at least +500g versus the direct role opponent across "+validTimeline.length+" timeline-complete games.","When you are ahead, make your risk threshold stricter: spend first, move with information, and force the opponent to take the risky play instead.",conf(validTimeline.length),1,"same-role gold advantage at death + multi-signal death quality");
  if(validTimeline.length>=5&&highRiskUntradedDeaths>=3)push(recentFocus,"deaths","High-risk deaths are frequently going untraded",highRiskUntradedDeaths+" high-risk deaths in the timeline sample received no nearby allied return kill within 15 seconds ("+Number(highRiskUntradedPerGame).toFixed(1)+" per game).","Reduce the entries that give the opponent free tempo. If you must take risk, prefer positions where teammates can immediately punish the enemy commitment.",conf(validTimeline.length),1,"nearby allied return kill within 15 seconds after death");
  if(validTimeline.length>=5&&(Number(badPer)>=0.8||Number(objDeathPct)>=25||unspent>=3))push(recentFocus,"deaths","Death quality is costing map tempo","The analyzer flags "+Number(badPer||0).toFixed(1)+" high-risk deaths per timeline game; "+Number(objDeathPct||0).toFixed(0)+"% of deaths occur in objective context, and "+unspent+" deaths happened with at least 1000 unspent gold.","Before major objectives, reset earlier and avoid entering deep/outnumbered positions without nearby teammates.",conf(validTimeline.length),1,"multi-signal timeline evidence");
  if(validTimeline.length>=5&&preObjDeaths>=3)push(recentFocus,"objectives","Deaths before enemy objective conversions recur",preObjDeaths+" deaths in the Last-20 timeline sample were followed by an enemy objective within 75 seconds ("+Number(preObjDeathPct||0).toFixed(0)+"% of deaths in comparable games).","Make the pre-objective minute a hard discipline window: recall earlier, move with teammates/vision, and do not face-check merely to establish setup.",conf(validTimeline.length),1,"death timestamp → enemy objective within 75 seconds");
  if(totalBadDeaths>=3&&topBadDeathZone&&Number(topBadDeathZonePct)>=50){
    const zoneAction=topBadDeathZone==="enemy jungle"?"Enter enemy jungle only with lane priority, teammate proximity or confirmed information; do not turn missing information into a forced invade.":topBadDeathZone==="river"?"Set river vision before walking into fog and move through contested river with teammates when an objective is approaching.":topBadDeathZone==="top lane"||topBadDeathZone==="mid lane"||topBadDeathZone==="bot lane"?"Respect side-lane depth and missing opponents; collect the wave without extending past the information your team actually has.":"Use the repeated location as a review cue: check what information and nearby support you had before committing.";
    push(recentFocus,"positioning","High-risk deaths cluster in "+topBadDeathZone,topBadDeathZoneCount+" of "+totalBadDeaths+" flagged high-risk deaths ("+Math.round(Number(topBadDeathZonePct))+"%) occur in "+topBadDeathZone+".",zoneAction,conf(totalBadDeaths),1,"spatial cluster of multi-signal high-risk deaths");
  }
  else if(validTimeline.length>=5&&Number(badPer)<0.35)push(highlights,"deaths","Your risk discipline is strong","Only "+Number(badPer||0).toFixed(1)+" deaths per timeline game meet the multi-signal bad-death heuristic.","Keep the same discipline while increasing pressure from your strongest windows.",conf(validTimeline.length),4,"multi-signal timeline evidence");
  if(wins.length>=4&&losses.length>=4&&hasNum(winLoss.badDeaths.wins)&&hasNum(winLoss.badDeaths.losses)&&Number(winLoss.badDeaths.losses)-Number(winLoss.badDeaths.wins)>=0.5)push(recentFocus,"deaths","Avoidable-risk deaths distinguish your losses from your wins","You average "+Number(winLoss.badDeaths.losses).toFixed(1)+" flagged high-risk deaths in losses versus "+Number(winLoss.badDeaths.wins).toFixed(1)+" in wins.","Treat this as a controllable consistency lever: when a game starts going badly, reduce isolated/deep entries instead of trying to force recovery immediately.",conf(Math.min(wins.length,losses.length)),1,"wins vs losses in your own sample");
  if(objectivePresenceLow){
    const causeText=objectiveRootCauses.length?objectiveRootCauses.map((x:any)=>x.evidence).join("; "):"no single reset/death/vision cause crossed its evidence threshold";
    const action=objectivePrimaryCause?.key==="late_reset"
      ?"Move the reset deadline earlier first: finish shopping before the final setup minute, then path with the team."
      :objectivePrimaryCause?.key==="pre_objective_death"
        ?"Treat the pre-objective minute as a survival/setup window: move through information and teammates rather than contesting fog alone."
        :objectivePrimaryCause?.key==="setup_vision"
          ?"Start the vision cycle 60–90 seconds earlier, then preserve enough wards/information for the actual objective approach."
          :"Review pathing from the preceding wave/camp: the current data does not pin the misses on resets, deaths or setup vision, so arrival timing is the remaining hypothesis.";
    push(recentFocus,"objectives","Low objective presence has a specific setup diagnosis","Presence is "+Number(objJoin).toFixed(0)+"% for your primary role; "+causeText+".",action,conf(validTimeline.length),1,"objective presence + reset/death/vision root-cause evidence");
  }else if(["JUNGLE","SUPPORT"].includes(primaryRole)&&hasNum(objJoin)&&Number(objJoin)>=70)push(highlights,"objectives","Objective presence is a strength","You are present for "+Number(objJoin).toFixed(0)+"% of your team's tracked major objective events.","Preserve this while improving the quality of the setup vision and pre-objective deaths.",conf(validTimeline.length),4,"team objective events");
  if(wins.length>=4&&losses.length>=4&&hasNum(winLoss.objectiveJoin.wins)&&hasNum(winLoss.objectiveJoin.losses)&&Number(winLoss.objectiveJoin.wins)-Number(winLoss.objectiveJoin.losses)>=15)push(recentFocus,"objectives","Objective attendance is strongly associated with your wins","Objective presence averages "+Number(winLoss.objectiveJoin.wins).toFixed(0)+"% in wins versus "+Number(winLoss.objectiveJoin.losses).toFixed(0)+"% in losses.","Protect the setup sequence—recall, path, vision, arrive—because missing it is one of the clearest differences between your wins and losses.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses; association, not causation");
  if(["MID","SUPPORT","TOP"].includes(primaryRole)&&roamAttempts>=4){
    if(Number(roamRate)<45)push(recentFocus,"roaming","Roams are not converting often enough",roamSuccess+"/"+roamAttempts+" detected pre-20-minute departures produced a kill/assist or objective, while "+roamFail+" ended in your death.","Roam on pushed waves and visible windows; cancel the move sooner when the target lane cannot follow.",conf(roamAttempts),2,"detected pre-20-minute departures");
    else if(Number(roamRate)>=65)push(highlights,"roaming","Your roams convert well",roamSuccess+"/"+roamAttempts+" detected pre-20-minute departures produced a kill/assist or objective.","Keep choosing these windows; the next check is whether the lane cost stays acceptable.",conf(roamAttempts),4,"detected pre-20-minute departures");
  }
  if(["MID","TOP"].includes(primaryRole)&&roamLaneCostEvents.length>=4){
    if(emptyCostlyRoams.length>=2)push(recentFocus,"roaming","Some roams are costing lane economy without returning value",emptyCostlyRoams.length+" detected roams lost at least 6 CS of direct-role differential and produced no kill/assist or objective.","Create the roam from a pushed/crashed wave; if the target does not open quickly, return before the opponent collects uncontested waves.",conf(roamLaneCostEvents.length),1,"CS differential change during detected roam");
    else if(hasNum(avgRoamLaneCostCs)&&Number(avgRoamLaneCostCs)<=-5)push(recentFocus,"roaming","Roams are converting at a high lane cost","Across "+roamLaneCostEvents.length+" measured roams, direct-role CS differential changes by "+signedText(avgRoamLaneCostCs,1)+" CS on average while you are away.","Keep only the highest-value roam windows and protect the wave first; a successful play can still be economically expensive.",conf(roamLaneCostEvents.length),2,"CS differential change during detected roam");
    else if(hasNum(avgRoamLaneCostCs)&&Number(avgRoamLaneCostCs)>=-2&&Number(roamRate)>=60)push(highlights,"roaming","Your roam timing preserves lane economy","Across "+roamLaneCostEvents.length+" measured roams, lane differential changes only "+signedText(avgRoamLaneCostCs,1)+" CS on average while roam conversion is "+Math.round(Number(roamRate))+"%.","Preserve the wave preparation that lets you move without donating lane resources.","medium",4,"CS differential change during detected roam");
  }
  if(primaryRole==="SUPPORT"){
    const costly=validTimeline.flatMap(g=>g.roams?.events||[]).filter((r:any)=>hasNum(r.adcLaneCostCs)&&Number(r.adcLaneCostCs)<=-6&&!r.killOrAssist&&!r.objective).length;
    if(costly>=2)push(recentFocus,"roaming","Some support roams are expensive for your ADC",costly+" detected roams lost at least 6 CS of ADC-vs-ADC lane differential without a kill/assist or objective return.","Prefer roam windows after your ADC can safely crash, reset or collect under tower.","high",1,"ADC lane cost during support roams");
  }
  if(neutralObjectiveEvents>=5&&lateResetObjectiveMisses>=2)push(recentFocus,"objectives","Late resets are costing neutral-objective attendance",lateResetObjectiveMisses+" of "+neutralObjectiveEvents+" tracked team neutral objectives were taken while you were absent, not recently dead, and your last detected shop visit ended within 60 seconds of the objective.","Set an earlier reset deadline—finish shopping before the final setup minute so you can path with your team instead of arriving after the objective is already decided.",conf(neutralObjectiveEvents),1,"shop timing + neutral-objective attendance");
  else if(neutralObjectiveEvents>=5&&lateResetObjectiveMisses===0&&freshPurchaseObjectiveJoins>=3)push(highlights,"objectives","Your neutral-objective reset timing is disciplined",freshPurchaseObjectiveJoins+" tracked neutral objectives were attended within two minutes of a detected shop visit, with no late-reset miss in the sample.","Keep using early reset windows to arrive with spent gold and time to set up.","medium",4,"shop timing + neutral-objective attendance");
  if(killConversionWindowsCount>=5&&oppKillConversionWindows>=5&&hasNum(killConversionDelta)){
    if(Number(killConversionDelta)<=-15)push(recentFocus,"conversion","Post-kill conversion trails the opposing role","Your team converts "+Number(killConversionRate).toFixed(0)+"% of player-involved kill windows into a tracked objective/structure within 75 seconds versus "+Number(opponentKillConversionRate).toFixed(0)+"% after the opposing role's kill windows.","After a won skirmish, immediately scan for objective/structure/wave value before chasing or resetting; this is a team-context signal, not sole-player attribution.",conf(Math.min(killConversionWindowsCount,oppKillConversionWindows)),2,"player-involved kill windows vs same-role-opponent-involved kill windows");
    else if(Number(killConversionDelta)>=15&&Number(killConversionRate)>=55)push(highlights,"conversion","Your post-kill map conversion is strong","Your team converts "+Number(killConversionRate).toFixed(0)+"% of player-involved kill windows within 75 seconds versus "+Number(opponentKillConversionRate).toFixed(0)+"% after the opposing role's kill windows.","Keep turning skirmish wins into structures/objectives instead of extending low-value chases.","medium",4,"player-involved kill windows vs same-role-opponent-involved kill windows");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&peerGames.length>=5&&Number(peerVpm)<=-0.15)push(recentFocus,"vision","You are giving up vision volume to the opposing role","Vision score is "+Math.abs(Number(peerVpm)).toFixed(2)+" per minute lower than the same-role opponent on average; you beat them on VPM in "+Math.round(Number(peerVpmWin||0))+"% of "+peerGames.length+" games.","Shift more wards into river/objective setup before the contest, not after contact starts.",conf(peerGames.length),2,"same-role opponents");
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&visionWardTotal>=20&&opponentVisionWardTotal>=20&&hasNum(objectiveSetupWardRateDelta)){
    if(Number(objectiveSetupWardRateDelta)<=-10)push(recentFocus,"vision","Ward volume is not translating into objective setup",Number(objectiveSetupWardRate).toFixed(0)+"% of your tracked wards are objective-setup wards versus "+Number(opponentObjectiveSetupWardRate).toFixed(0)+"% for the same-role opponents ("+signedText(objectiveSetupWardRateDelta,0)+" pp).","Shift ward timing toward the 60–90 seconds before neutral objectives; vision placed after contact starts is less useful for choosing the fight.",conf(Math.min(visionWardTotal,opponentVisionWardTotal)),2,"objective-setup share of wards vs same-role opponents");
    else if(Number(objectiveSetupWardRateDelta)>=10&&Number(objectiveSetupWardRate)>=20)push(highlights,"vision","Your wards are well aligned with objective setup",Number(objectiveSetupWardRate).toFixed(0)+"% of tracked wards contribute to objective setup versus "+Number(opponentObjectiveSetupWardRate).toFixed(0)+"% for the same-role opponents.","Keep the timing and use the information to avoid the pre-objective deaths/late entries the rest of the report tracks.","medium",4,"objective-setup share of wards vs same-role opponents");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&visionSetupGames.length>=5){
    if(Number(avgObjectiveSetupDelta)<=-0.5)push(recentFocus,"vision","Pre-objective vision setup trails the opposing role","You average "+Math.abs(Number(avgObjectiveSetupDelta)).toFixed(1)+" fewer wards near upcoming objectives than the same-role opponent across "+visionSetupGames.length+" timeline games; you place more setup wards in "+Math.round(Number(objectiveSetupOutperformPct||0))+"% of them.","Start the vision cycle before the contest: reset for wards, establish river/jungle information, then preserve enough wards for the objective approach.",conf(visionSetupGames.length),1,"objective-setup wards vs same-role opponent");
    else if(Number(avgObjectiveSetupDelta)>=0.5)push(highlights,"vision","You establish more pre-objective vision than your counterpart","You average +"+Number(avgObjectiveSetupDelta).toFixed(1)+" setup wards near upcoming objectives versus the same-role opponent across "+visionSetupGames.length+" games.","Preserve the early setup timing and focus next on keeping that vision alive/useful through the contest.","medium",4,"objective-setup wards vs same-role opponent");
  }
  if(peerGames.length>=5){
    if(Number(peerDpm)<=-100&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"fighting","Damage conversion trails your direct counterpart","You average "+Math.round(Math.abs(Number(peerDpm)))+" less champion damage per minute than the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Check whether farm leads are being converted into timely fights and whether deaths are removing you before damage windows.",conf(peerGames.length),2,"same-role opponents");
    if(Number(peerDpm)>=120)push(highlights,"fighting","You outperform the direct counterpart in damage","You average +"+Math.round(Number(peerDpm))+" champion damage per minute versus the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Protect this strength by reducing deaths that occur before objectives.",conf(peerGames.length),4,"same-role opponents");
    if(Number(peerCs)<=-0.5&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"farming","Farm pace trails the actual lane peer","You average "+Math.abs(Number(peerCs)).toFixed(2)+" CS/min less than the same-role opponent and finish ahead on CS/min in only "+Math.round(Number(peerCsWin||0))+"% of comparable games.","Track the waves lost around recalls, roams and unnecessary mid-game grouping.",conf(peerGames.length),2,"same-role opponents");
  }
  if(rolePeerFightSamples>=5&&roleLevelDisadvantageFightStarts>=3&&Number(roleLevelDisadvantageFightRate)>=40)push(recentFocus,"fight readiness","Role-opponent level disadvantage recurs in shared fights",roleLevelDisadvantageFightStarts+" of "+rolePeerFightSamples+" attended fights where the actual same-role opponent was nearby ("+Number(roleLevelDisadvantageFightRate).toFixed(0)+"%) began with you at least one level lower.","Add level to the pre-fight readiness check alongside items, gold and local numbers; when the contest is optional, take the nearby XP/wave breakpoint first or trade the play elsewhere.",conf(rolePeerFightSamples),2,"same-role opponent nearby at first kill + role level differential");
  if(fightSamples>=8&&outnumberedFightStarts>=3&&Number(outnumberedFightLossRate)>=60)push(recentFocus,"fight selection","Too many attended fights are already locally outnumbered",outnumberedFightStarts+" of "+fightSamples+" attended fight clusters had at least two fewer nearby allies than enemies at the first kill event, and "+Number(outnumberedFightLossRate).toFixed(0)+"% of those clusters ended with more enemy kills.","Use a local numbers check before following or re-entering: who is within actual fight distance, who is showing elsewhere, and which side reaches the next body first?",conf(fightSamples),1,"nearby ally/enemy counts at first kill in attended fight clusters");
  if(fightSamples>=8&&Number(highUnspentFightRate)>=30)push(recentFocus,"fight readiness","Too many fights begin before your gold is converted into stats",highUnspentFightStarts+" of "+fightSamples+" attended multi-kill fights ("+Number(highUnspentFightRate).toFixed(0)+"%) begin while you are carrying at least 1000 unspent gold.","Create a reset deadline before the next likely contest; arriving with completed purchases is a controllable advantage even when the fight itself is mechanically difficult.",conf(fightSamples),1,"current gold at fight-cluster start");
  if(["ADC","MID","TOP","JUNGLE"].includes(primaryRole)&&fightSamples>=8&&Number(itemDisadvantageFightRate)>=25)push(recentFocus,"fight readiness","You often contest after the direct opponent has completed a major item first",itemDisadvantageFightStarts+" of "+fightSamples+" attended multi-kill fights ("+Number(itemDisadvantageFightRate).toFixed(0)+"%) start after the same-role opponent has a first major completion and you do not.","Unless the objective is forced, delay or trade the play until your purchase closes the item breakpoint gap.",conf(fightSamples),1,"first-major-item completion state at fight start");
  if(["ADC","MID","TOP"].includes(primaryRole)&&fightSamples>=8){
    if(Number(firstAllyFightDeathRate)>=35)push(recentFocus,"teamfights","You are too often the first allied death in fights","Across "+fightSamples+" attended multi-kill fight clusters, you are the first allied death "+Number(firstAllyFightDeathRate).toFixed(0)+"% of the time.","Prioritize second-wave entry: wait for the first key enemy engage/CC to be committed, then use your resources on sustained damage rather than absorbing the opening burst.",conf(fightSamples),1,"order of allied deaths in attended multi-kill fights");
    else if(Number(preContributionFightDeathRate)>=25)push(recentFocus,"teamfights","Too many fights end before you contribute","You die before a tracked kill/assist contribution in "+Number(preContributionFightDeathRate).toFixed(0)+"% of "+fightSamples+" attended multi-kill fights.","Review approach angles and threat range before the fight begins; being present is not enough if the first enemy action removes you.",conf(fightSamples),1,"contribution timing inside attended multi-kill fights");
    else if(Number(fightSurvivalRate)>=70&&Number(firstAllyFightDeathRate)<=15)push(highlights,"teamfights","Your fight survival/order is disciplined","You survive "+Number(fightSurvivalRate).toFixed(0)+"% of "+fightSamples+" attended multi-kill fights and are first allied death only "+Number(firstAllyFightDeathRate).toFixed(0)+"% of the time.","Keep protecting uptime; this is especially valuable when your damage/resource share is high.",conf(fightSamples),4,"attended multi-kill fight clusters");
  }
  if(["ADC","MID","TOP"].includes(primaryRole)&&resourceGames.length>=5&&hasNum(damageGoldEfficiency)){
    if(Number(damageGoldEfficiency)<=-4)push(recentFocus,"resource conversion","Resource conversion is below your team investment","Across "+resourceGames.length+" games you average "+Number(avgGoldShare).toFixed(1)+"% of team gold but "+Number(avgDamageShare).toFixed(1)+"% of team champion damage ("+signedText(damageGoldEfficiency,1)+" percentage points).","Focus on turning farm/item advantages into fight uptime: arrive on time, preserve positioning, and avoid deaths before the damage window.",conf(resourceGames.length),2,"own-team damage share versus gold share");
    else if(Number(damageGoldEfficiency)>=4)push(highlights,"resource conversion","You create strong damage output for your share of resources","Across "+resourceGames.length+" games you average "+Number(avgDamageShare).toFixed(1)+"% of team champion damage from "+Number(avgGoldShare).toFixed(1)+"% of team gold ("+signedText(damageGoldEfficiency,1)+" percentage points).","Protect this efficiency; do not give away uptime through avoidable deaths when your team is getting high output from your resources.",conf(resourceGames.length),4,"own-team damage share versus gold share");
  }
  if(wins.length>=4&&losses.length>=4&&hasNum(winLoss.earlyKp.wins)&&hasNum(winLoss.earlyKp.losses)&&Number(winLoss.earlyKp.wins)-Number(winLoss.earlyKp.losses)>=15)push(recentFocus,"early impact","Early involvement is much higher in your wins","14-minute KP averages "+Number(winLoss.earlyKp.wins).toFixed(0)+"% in wins versus "+Number(winLoss.earlyKp.losses).toFixed(0)+"% in losses.","Look for repeatable early windows—rather than random aggression—that let you influence the map before the game state hardens.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses; association, not causation");
  const playerRankValue=rankScore(playerRank),playerRankBand=playerRankValue==null?null:Math.floor(Number(playerRankValue)),rankedPeerGames=peerGames.filter(g=>rankScore(g.peer?.rank)!=null);
  const peerBand=(g:any)=>{const v=rankScore(g.peer?.rank);return v==null?null:Math.floor(Number(v));};
  const higherRankGames=playerRankBand==null?[]:rankedPeerGames.filter(g=>Number(peerBand(g))>Number(playerRankBand));
  const sameRankGames=playerRankBand==null?[]:rankedPeerGames.filter(g=>Number(peerBand(g))===Number(playerRankBand));
  const lowerRankGames=playerRankBand==null?[]:rankedPeerGames.filter(g=>Number(peerBand(g))<Number(playerRankBand));
  const rankBandStats=(xs:any[])=>{const lane=finiteGames(xs,g=>g.goldDiff15);return{games:xs.length,laneGames:lane.length,avgGoldDiff15:meanField(lane,g=>g.goldDiff15),goldOutperformPct:outperform(lane,g=>g.goldDiff15),avgCsMinDelta:meanField(xs,g=>g.peer?.csMinDelta),avgDpmDelta:meanField(xs,g=>g.peer?.dpmDelta),avgVpmDelta:meanField(xs,g=>g.peer?.vpmDelta)};};
  const higherRankStats=rankBandStats(higherRankGames),sameRankStats=rankBandStats(sameRankGames),lowerRankStats=rankBandStats(lowerRankGames);
  const higherLane=finiteGames(higherRankGames,g=>g.goldDiff15),higherGold=higherRankStats.avgGoldDiff15,higherDpm=higherRankStats.avgDpmDelta,higherGoldWin=higherRankStats.goldOutperformPct;
  if(higherRankGames.length>=3&&higherLane.length>=3){
    if(Number(higherGold)<=-300)push(recentFocus,"rank pressure","Laning drops against higher-ranked direct opponents","Against "+higherLane.length+" same-role opponents ranked above "+rankLabel(playerRank)+", you average "+Math.round(Number(higherGold))+"g at 15 and finish ahead on gold in "+Math.round(Number(higherGoldWin||0))+"% of them.","Use these games as the clearest practice set: review the first recall, wave loss and trade timing before 15 rather than treating all opponents as equivalent.",conf(higherLane.length),1,"actual higher-ranked same-role opponents");
    else if(Number(higherGold)>=100)push(highlights,"rank pressure","Your lane fundamentals hold up against higher-ranked peers","Against "+higherLane.length+" same-role opponents ranked above "+rankLabel(playerRank)+", you average "+signedText(higherGold,0)+"g at 15.","The evidence suggests the next improvement is conversion/macro rather than simply surviving stronger lanes.",conf(higherLane.length),4,"actual higher-ranked same-role opponents");
  }
  if(lowerRankStats.laneGames>=3&&hasNum(lowerRankStats.avgGoldDiff15)){
    if(Number(lowerRankStats.avgGoldDiff15)<=-100)push(recentFocus,"rank pressure","Lower-ranked direct peers are not being converted into a lane advantage","Against "+lowerRankStats.laneGames+" same-role opponents in a lower tier/division band, you average "+signedText(lowerRankStats.avgGoldDiff15,0)+"g at 15 and finish ahead on gold in "+Number(lowerRankStats.goldOutperformPct||0).toFixed(0)+"% of them.","Treat these games as a consistency check: avoid giving away early waves/trades simply because the matchup appears easier on paper.",conf(lowerRankStats.laneGames),2,"actual lower-ranked same-role opponents at fetch-time rank snapshot");
    else if(Number(lowerRankStats.avgGoldDiff15)>=300)push(highlights,"rank pressure","You reliably punish lower-ranked direct peers in lane","Against "+lowerRankStats.laneGames+" lower-band same-role opponents you average "+signedText(lowerRankStats.avgGoldDiff15,0)+"g at 15.","Keep the early discipline, then judge the game by conversion rather than continuing to force lane advantages after the lead is already secured.",conf(lowerRankStats.laneGames),4,"actual lower-ranked same-role opponents at fetch-time rank snapshot");
  }
  if(sessionModel.firstGame.games>=3&&sessionModel.game3Plus.games>=3){
    const lateSignals:string[]=[];
    if(hasNum(sessionModel.game3PlusGoldDelta)&&Number(sessionModel.game3PlusGoldDelta)<=-300)lateSignals.push(Math.abs(Math.round(Number(sessionModel.game3PlusGoldDelta)))+"g worse gold@15");
    if(hasNum(sessionModel.game3PlusBadDeathDelta)&&Number(sessionModel.game3PlusBadDeathDelta)>=0.5)lateSignals.push("+"+Number(sessionModel.game3PlusBadDeathDelta).toFixed(1)+" high-risk deaths/game");
    if(hasNum(sessionModel.game3PlusDpmDelta)&&Number(sessionModel.game3PlusDpmDelta)<=-120)lateSignals.push(Math.abs(Math.round(Number(sessionModel.game3PlusDpmDelta)))+" lower DPM");
    if(lateSignals.length)push(recentFocus,"session habits","Later-session games are materially weaker",sessionModel.game3Plus.games+" primary-role games played as game 3+ of a session show "+lateSignals.join(", ")+" compared with "+sessionModel.firstGame.games+" session-opening games.","Use a deliberate break/checkpoint before game 3: only continue if concentration, posture and decision speed still feel normal; otherwise end the session before the data pattern repeats.","medium",2,"game 3+ of session vs session-opening primary-role games");
  }
  if(sessionModel.quickAfterLoss.games>=3&&sessionModel.quickAfterWin.games>=3){
    const postLossSignals:string[]=[];
    if(hasNum(sessionModel.postLossGoldDelta)&&Number(sessionModel.postLossGoldDelta)<=-300)postLossSignals.push(Math.abs(Math.round(Number(sessionModel.postLossGoldDelta)))+"g worse gold@15");
    if(hasNum(sessionModel.postLossBadDeathDelta)&&Number(sessionModel.postLossBadDeathDelta)>=0.5)postLossSignals.push("+"+Number(sessionModel.postLossBadDeathDelta).toFixed(1)+" high-risk deaths/game");
    if(postLossSignals.length)push(recentFocus,"requeue habits","Quick requeues after losses are followed by weaker next games",sessionModel.quickAfterLoss.games+" quick post-loss requeues show "+postLossSignals.join(", ")+" compared with "+sessionModel.quickAfterWin.games+" quick requeues after wins.","After a loss, insert a short reset before queueing again: review one concrete mistake, stand up, then decide whether the next game is intentional rather than automatic.","medium",2,"next primary-role game within 45m after loss vs after win");
  }
  if(recentTrend.csMin.recentN>=4&&recentTrend.csMin.priorN>=5&&hasNum(recentTrend.csMin.recent)&&hasNum(recentTrend.csMin.prior)){
    const d=Number(recentTrend.csMin.recent)-Number(recentTrend.csMin.prior);
    if(d<=-0.6)push(recentFocus,"recent trend","Recent five games show a farming drop","CS/min is "+Number(recentTrend.csMin.recent).toFixed(2)+" in the latest five versus "+Number(recentTrend.csMin.prior).toFixed(2)+" in the preceding "+recentTrend.csMin.priorN+" games.","Check what changed recently in early deaths, recall timing, roams or mid-game grouping before treating this as a new baseline.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d>=0.6)push(highlights,"recent trend","Recent farming is moving upward","CS/min is "+Number(recentTrend.csMin.recent).toFixed(2)+" in the latest five versus "+Number(recentTrend.csMin.prior).toFixed(2)+" in the preceding "+recentTrend.csMin.priorN+" games.","Identify the wave/recall habits behind the gain and keep them stable.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.goldDiff15.recentN>=4&&recentTrend.goldDiff15.priorN>=5&&hasNum(recentTrend.goldDiff15.recent)&&hasNum(recentTrend.goldDiff15.prior)){
    const d=Number(recentTrend.goldDiff15.recent)-Number(recentTrend.goldDiff15.prior);
    if(d<=-300)push(recentFocus,"recent trend","Your recent lane state has worsened","Gold differential at 15 is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g in the preceding sample.","Review the latest games specifically for first-recall timing, early deaths and waves abandoned for low-value fights.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d>=300)push(highlights,"recent trend","Your recent lane state has improved","Gold differential at 15 is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g previously.","Keep the recent early-game habits and focus next on conversion after 15.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.badDeaths.recentN>=4&&recentTrend.badDeaths.priorN>=5&&hasNum(recentTrend.badDeaths.recent)&&hasNum(recentTrend.badDeaths.prior)){
    const d=Number(recentTrend.badDeaths.recent)-Number(recentTrend.badDeaths.prior);
    if(d>=0.6)push(recentFocus,"recent trend","High-risk deaths have increased recently","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Treat the change as a warning signal: reduce deep/isolated entries and spend gold before contest windows.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d<=-0.6)push(highlights,"recent trend","Your recent death quality is improving","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Preserve the safer positioning while keeping pressure high.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.dpm.recentN>=4&&recentTrend.dpm.priorN>=5&&hasNum(recentTrend.dpm.recent)&&hasNum(recentTrend.dpm.prior)){
    const d=Number(recentTrend.dpm.recent)-Number(recentTrend.dpm.prior);
    if(d<=-120&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"recent trend","Recent damage output has fallen","DPM is "+Math.round(Number(recentTrend.dpm.recent))+" in the latest five versus "+Math.round(Number(recentTrend.dpm.prior))+" previously.","Check whether this follows weaker lane economy, later item completions or deaths before major fights.","medium",2,"latest 5 vs preceding Last-20 games");
    else if(d>=120)push(highlights,"recent trend","Recent damage output is improving","DPM is "+Math.round(Number(recentTrend.dpm.recent))+" in the latest five versus "+Math.round(Number(recentTrend.dpm.prior))+" previously.","Keep the fight-entry and item-timing choices that are increasing uptime.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(lifetime&&hasNum(lifetime.csMin)&&hasNum(summary.csMin)){
    const delta=Number(summary.csMin)-Number(lifetime.csMin);
    if(delta<=-0.45)push(recentFocus,"trend","Recent farming has slipped below your broader baseline","Last-20 CS/min is "+Number(summary.csMin).toFixed(2)+" versus "+Number(lifetime.csMin).toFixed(2)+" across the broader cached sample.","Inspect what changed in recalls, roaming or grouping rather than treating the recent value as your normal level.","high",2,"recent 20 vs broader cached self");
    else if(delta>=0.45)push(highlights,"trend","Recent farming is improving","Last-20 CS/min is "+Number(summary.csMin).toFixed(2)+" versus "+Number(lifetime.csMin).toFixed(2)+" across the broader cached sample.","Keep the underlying wave/recall habits that created the gain.","medium",4,"recent 20 vs broader cached self");
  }
  if(greedy>=4)push(recentFocus,"resets","High-gold stays appear repeatedly",greedy+" timeline windows show at least 1200 current gold followed by more than two minutes before the next detected shop visit.","When the map is quiet, cash the spike instead of carrying unspent power through another risky sequence.",conf(validTimeline.length),2,"timeline gold + shop events");
  if(wins.length>=4&&losses.length>=4&&hasNum(winLoss.greedyStays.wins)&&hasNum(winLoss.greedyStays.losses)&&Number(winLoss.greedyStays.losses)-Number(winLoss.greedyStays.wins)>=0.6)push(recentFocus,"resets","Greedy stays rise noticeably in losses","You average "+Number(winLoss.greedyStays.losses).toFixed(1)+" high-gold stay windows in losses versus "+Number(winLoss.greedyStays.wins).toFixed(1)+" in wins.","When behind, do not try to recover the deficit by staying indefinitely for one more wave; buy the power you already earned.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses in your own sample");
  if(topDamage>=Math.max(5,Math.ceil(games.length*0.4)))push(highlights,"team impact","You frequently lead your team in champion damage","You are #1 on your team in champion damage in "+topDamage+"/"+games.length+" games.","Make survival around your damage windows a priority because your team loses substantial output when you die first.",conf(games.length),4,"own-team rank each match");
  recentFocus.sort((a,b)=>a.priority-b.priority);highlights.sort((a,b)=>a.priority-b.priority);coaching.push(...recentFocus,...highlights);
  return{
    recentFocus,highlights,coaching,
    peerComparison:{sameRoleGames:peerGames.length,rankedPeerGames:rankedPeerGames.length,higherRankPeerGames:higherRankGames.length,sameRankPeerGames:sameRankGames.length,lowerRankPeerGames:lowerRankGames.length,rankBands:{higher:higherRankStats,same:sameRankStats,lower:lowerRankStats,definition:"Tier/division band at fetch-time rank snapshot; LP differences within a division are ignored"},laneGames15:lane15.length,midgameComparableGames:midgameGames.length,avgGoldSwing15to25:avgSwing15to25,leadGames15to25:leadMidgame.length,avgLeadSwing15to25:leadSwing15to25,deficitGames15to25:deficitMidgame.length,avgDeficitSwing15to25:deficitSwing15to25,avgGoldDiff15:avgG15,avgCsDiff15:avgC15,laneAheadPct:laneAhead,gold15OutperformPct:peerGoldWin,avgCsMinDelta:peerCs,csMinOutperformPct:peerCsWin,avgDpmDelta:peerDpm,dpmOutperformPct:peerDpmWin,avgVpmDelta:peerVpm,vpmOutperformPct:peerVpmWin,visionSetupGames:visionSetupGames.length,avgObjectiveSetupDelta,objectiveSetupOutperformPct,visionWardTotal,visionSetupTotal,objectiveSetupWardRate,opponentVisionWardTotal,opponentVisionSetupTotal,opponentObjectiveSetupWardRate,objectiveSetupWardRateDelta,majorItemGames:itemGames.length,avgMajorItemDeltaMin:itemDelta,majorItemFasterPct:peerItemFaster,impactGames:impactGames.length,avgImpactDeltaMin:avgImpactDelta,impactEarlierPct,higherRankAvgGoldDiff15:higherGold,higherRankGoldOutperformPct:higherGoldWin,higherRankAvgDpmDelta:higherDpm,definition:"Same-role opponent from each analyzed match"},
    conversion:{laneLeadGames:laneLeads.length,laneLeadWinRate:laneLeadWr,laneDeficitGames:laneDeficits.length,laneDeficitWinRate:laneDeficitWr},
    winLoss,recentTrend,sessionModel,
    behaviorSummary:{
      badDeathsPerTimelineGame:badPer,totalTimelineDeaths,tradedDeaths,deathTradeRate,highRiskUntradedDeaths,highRiskUntradedPerGame,
      leadDeaths,highRiskLeadDeaths,highRiskLeadDeathsPerGame,
      aheadStateDeaths,evenStateDeaths,behindStateDeaths,highRiskAheadStateDeaths,highRiskEvenStateDeaths,highRiskBehindDeaths,highRiskBehindDeathRate,highRiskBehindDeathsPerGame,
      badDeathZones:badDeathZoneCounts,topBadDeathZone,topBadDeathZonePct,
      objectiveDeathPct:objDeathPct,preObjectiveDeaths:preObjDeaths,preObjectiveDeathPct,objectiveJoinRate:objJoin,earlyKp,
      roamAttempts,roamSuccessRate:roamRate,roamFailures:roamFail,roamLaneCostGames:roamLaneCostEvents.length,avgRoamLaneCostCs,costlyRoams:costlyRoams.length,emptyCostlyRoams:emptyCostlyRoams.length,
      greedyStayWindows:greedy,highUnspentGoldDeaths:unspent,
      avgDamageShare,avgGoldShare,damageGoldEfficiency,
      fightSamples,firstAllyFightDeaths,firstAllyFightDeathRate,preContributionFightDeaths,preContributionFightDeathRate,survivedFightSamples,fightSurvivalRate,
      highUnspentFightStarts,highUnspentFightRate,itemDisadvantageFightStarts,itemDisadvantageFightRate,goldDeficitFightStarts,goldDeficitFightRate,unspentAndBehindFightStarts,
      outnumberedFightStarts,outnumberedFightStartRate,lostOutnumberedFights,outnumberedFightLossRate,
      visionWardTotal,visionSetupTotal,objectiveSetupWardRate,opponentVisionWardTotal,opponentVisionSetupTotal,opponentObjectiveSetupWardRate,objectiveSetupWardRateDelta,
      killConversionWindows:killConversionWindowsCount,killConversions,killConversionRate,
      opponentKillConversionWindows:oppKillConversionWindows,opponentKillConversions:oppKillConversions,opponentKillConversionRate,killConversionDelta,
      neutralObjectiveEvents,neutralObjectiveJoins,lateResetObjectiveMisses,lateResetObjectiveMissRate,freshPurchaseObjectiveJoins,freshPurchaseObjectiveJoinRate,
      objectiveDiagnosis:{presenceLow:objectivePresenceLow,primaryCause:objectivePrimaryCause?.key||null,causes:objectiveRootCauses}
    }
  };
}
function championBehaviorModel(games:any[],summary:any,behaviorSummary:any,primaryRole:string){
  const groups=new Map<string,any[]>();
  for(const g of games){
    const key=String(g.champion||"Unknown")+"|"+String(g.role||"GENERIC");
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(g);
  }
  const profiles:any[]=[],focus:any[]=[],highlights:any[]=[];
  const confidence=(n:number)=>n>=5?"medium":"low";
  for(const [key,list] of groups.entries()){
    if(list.length<3)continue;
    const [champion,roleName]=key.split("|"),lane=finiteGames(list,g=>g.goldDiff15),tl=list.filter(g=>g.timelineAvailable),items=finiteGames(list,g=>g.itemSpikeDeltaVsOpponent);
    const p:any={
      champion,role:roleName,games:list.length,wins:list.filter(g=>g.win).length,winRate:pct(list.filter(g=>g.win).length,list.length),
      csMin:meanField(list,g=>g.csMin),dpm:meanField(list,g=>g.dpm),kp:meanField(list,g=>g.kp),
      laneGames:lane.length,goldDiff15:meanField(lane,g=>g.goldDiff15),badDeaths:meanField(tl,g=>g.badDeathCount),
      timelineGames:tl.length,itemGames:items.length,itemDelta:meanField(items,g=>g.itemSpikeDeltaVsOpponent)
    };
    profiles.push(p);
    if(roleName!==primaryRole)continue;
    if(lane.length>=3&&hasNum(p.goldDiff15)&&hasNum(summary.goldDiff15)&&Number(p.goldDiff15)-Number(summary.goldDiff15)<=-300){
      focus.push({category:"champion",title:champion+" lane state is below your usual "+primaryRole+" level",evidence:"Across "+lane.length+" "+champion+" "+primaryRole+" games you average "+signedText(p.goldDiff15,0)+"g at 15 versus "+signedText(summary.goldDiff15,0)+"g across the full Last-20 role sample.",action:"Review the champion-specific first waves, trade pattern and first recall rather than assuming the problem is your general laning.",confidence:confidence(lane.length),priority:2,comparison:"champion-role sample vs your Last-20 primary-role sample"});
    }
    if(tl.length>=3&&hasNum(p.badDeaths)&&hasNum(behaviorSummary?.badDeathsPerTimelineGame)&&Number(p.badDeaths)-Number(behaviorSummary.badDeathsPerTimelineGame)>=0.7){
      focus.push({category:"champion",title:champion+" games contain more high-risk deaths",evidence:"This champion averages "+Number(p.badDeaths).toFixed(1)+" flagged high-risk deaths per timeline game versus "+Number(behaviorSummary.badDeathsPerTimelineGame).toFixed(1)+" overall.",action:"Check whether this champion's engage/range pattern is pulling you deeper or leaving you with fewer exit options after committing.",confidence:confidence(tl.length),priority:2,comparison:"champion-role sample vs your Last-20 primary-role sample"});
    }
    if(items.length>=3&&hasNum(p.itemDelta)&&Number(p.itemDelta)>=1){
      focus.push({category:"champion",title:champion+" reaches the first major item late versus its direct peers",evidence:"Across "+items.length+" comparable games, your first major item is "+Number(p.itemDelta).toFixed(1)+" minutes later than the same-role opponent on average.",action:"Check whether this champion's early recall plan or wave clearing is delaying the first complete item.",confidence:confidence(items.length),priority:2,comparison:"same-role opponents in "+champion+" games"});
    }
    if(list.length>=3&&hasNum(p.dpm)&&hasNum(summary.dpm)&&Number(p.dpm)-Number(summary.dpm)>=150){
      highlights.push({category:"champion",title:champion+" is a high-output pick in your current sample",evidence:"DPM averages "+Math.round(Number(p.dpm))+" across "+list.length+" games versus "+Math.round(Number(summary.dpm))+" across the Last 20.",action:"Preserve the fight positioning and resource conversion that make this pick productive; do not infer mastery from win rate alone.",confidence:confidence(list.length),priority:4,comparison:"champion-role sample vs your Last-20 primary-role sample"});
    }
  }
  profiles.sort((a,b)=>b.games-a.games);
  return{profiles,focus,highlights};
}
function report(profile:any,rows:any[],catalog:any){
  const cachedRows=rows||[],eligibleRows=cachedRows.filter((r:any)=>Number(r?.match_json?.info?.mapId||r?.map_id||0)===11),ordered=eligibleRows,
    deepCandidates=ordered.map((r:any)=>({row:r,g:game(r,text(profile.puuid),catalog)})).filter((x:any)=>x.g&&x.g.role!=="GENERIC"),
    games=deepCandidates.slice(0,20).map((x:any)=>x.g),
    usedIds=new Set(deepCandidates.slice(0,20).map((x:any)=>x.g.matchId)),
    baselineExtra=ordered.filter((r:any)=>!usedIds.has(text(r?.match_json?.metadata?.matchId||r?.match_id))).slice(0,80).map(r=>baselineGame(r,text(profile.puuid))).filter((g:any)=>g&&g.role!=="GENERIC"),
    allGames=[...games,...baselineExtra],byRole:any={},byChampion:any={};
  annotateSessionContext(games);
  for(const g of games){byRole[g.role]=byRole[g.role]||{games:0,wins:0};byRole[g.role].games++;if(g.win)byRole[g.role].wins++;byChampion[g.champion]=byChampion[g.champion]||{games:0,wins:0};byChampion[g.champion].games++;if(g.win)byChampion[g.champion].wins++;}
  let primaryRole="GENERIC",primaryGames=0;for(const[k,v]of Object.entries(byRole)as any){if(Number(v.games)>primaryGames){primaryGames=Number(v.games);primaryRole=k;}}
  const validTimeline=games.filter((g:any)=>g.timelineAvailable).length,coordinateGames=games.filter((g:any)=>(g.deathPositions?.length||0)+(g.wards?.length||0)+(g.objectives?.length||0)>0).length;
  const makeSummary=(sample:any[])=>({games:sample.length,wins:sample.filter((g:any)=>g.win).length,winRate:pct(sample.filter((g:any)=>g.win).length,sample.length),csMin:avg(sample.map((g:any)=>g.csMin)),kp:avg(sample.map((g:any)=>g.kp)),dpm:avg(sample.map((g:any)=>g.dpm)),gpm:avg(sample.map((g:any)=>g.gpm)),vpm:avg(sample.map((g:any)=>g.vpm)),goldDiff10:avg(sample.map((g:any)=>g.goldDiff10)),goldDiff15:avg(sample.map((g:any)=>g.goldDiff15)),goldDiff25:avg(sample.map((g:any)=>g.goldDiff25)),csDiff10:avg(sample.map((g:any)=>g.csDiff10)),csDiff15:avg(sample.map((g:any)=>g.csDiff15)),csDiff25:avg(sample.map((g:any)=>g.csDiff25)),xpDiff10:avg(sample.map((g:any)=>g.xpDiff10)),xpDiff15:avg(sample.map((g:any)=>g.xpDiff15)),xpDiff25:avg(sample.map((g:any)=>g.xpDiff25))});
  const summary={...makeSummary(games),primaryRole,primaryRoleGames:primaryGames},lifetime=allGames.length>20?makeSummary(allGames):null;
  const coachingGames=games.filter((g:any)=>g.role===primaryRole),coachingAllGames=allGames.filter((g:any)=>g.role===primaryRole);
  const coachingSummary={...makeSummary(coachingGames),primaryRole,primaryRoleGames:coachingGames.length};
  const coachingLifetime=coachingAllGames.length>coachingGames.length?makeSummary(coachingAllGames):null;
  const cm=coachingModel(coachingGames,coachingSummary,coachingLifetime,primaryRole,profile.rank_snapshot||null),championModel=championBehaviorModel(games,coachingSummary,cm.behaviorSummary,primaryRole);
  cm.recentFocus.push(...championModel.focus);cm.highlights.push(...championModel.highlights);cm.recentFocus.sort((a:any,b:any)=>Number(a.priority||9)-Number(b.priority||9));cm.highlights.sort((a:any,b:any)=>Number(a.priority||9)-Number(b.priority||9));cm.coaching=[...cm.recentFocus,...cm.highlights];
  return{schemaVersion:"league-report-v2",analyzerVersion:"league-web-behavior-v4.7",generatedAt:now(),profile:{id:profile.id,displayName:profile.display_name,gameName:profile.game_name,tagLine:profile.tag_line,platformRegion:profile.platform_region,routingRegion:profile.routing_region,rank:profile.rank_snapshot||null},summary,lifetime,coachingSummary,coachingLifetime,byRole,byChampion,championBehavior:championModel.profiles,recentFocus:cm.recentFocus,overallHighlights:cm.highlights,coaching:cm.coaching,peerComparison:cm.peerComparison,conversion:cm.conversion,winLoss:cm.winLoss,recentTrend:cm.recentTrend,sessionBehavior:cm.sessionModel,games,charts:{csMin:games.map((g:any)=>({matchId:g.matchId,value:g.csMin})),kp:games.map((g:any)=>({matchId:g.matchId,value:g.kp})),dpm:games.map((g:any)=>({matchId:g.matchId,value:g.dpm})),goldDiff15:games.map((g:any)=>({matchId:g.matchId,value:g.goldDiff15}))},hiddenCharts:[],benchmarks:{rankAbove:{definition:"Actual higher-ranked same-role opponents encountered",sample:cm.peerComparison.higherRankPeerGames,avgGoldDiff15:cm.peerComparison.higherRankAvgGoldDiff15,goldOutperformPct:cm.peerComparison.higherRankGoldOutperformPct,avgDpmDelta:cm.peerComparison.higherRankAvgDpmDelta},itemSpike:{peerDefinition:"same-role opponent",avgDeltaMin:cm.peerComparison.avgMajorItemDeltaMin,sample:cm.peerComparison.majorItemGames}},aggregateMaps:{wards:games.flatMap((g:any)=>g.wards||[]),deaths:games.flatMap((g:any)=>g.deathPositions||[])},advanced:{dqi:null,agor:null,objectivePresence:cm.behaviorSummary.objectiveJoinRate,earlyKP:cm.behaviorSummary.earlyKp,firstImpact:{games:cm.peerComparison.impactGames,avgDeltaVsOpponentMin:cm.peerComparison.avgImpactDeltaMin,earlierPct:cm.peerComparison.impactEarlierPct},objectiveDeathPct:cm.behaviorSummary.objectiveDeathPct,preObjectiveDeaths:cm.behaviorSummary.preObjectiveDeaths,preObjectiveDeathPct:cm.behaviorSummary.preObjectiveDeathPct,roams:{attempts:cm.behaviorSummary.roamAttempts,successRate:cm.behaviorSummary.roamSuccessRate,measuredLaneCost:cm.behaviorSummary.roamLaneCostGames,avgLaneCostCs:cm.behaviorSummary.avgRoamLaneCostCs,costlyRoams:cm.behaviorSummary.costlyRoams,emptyCostlyRoams:cm.behaviorSummary.emptyCostlyRoams},recalls:{greedyStayWindows:cm.behaviorSummary.greedyStayWindows},itemSpike:{avgDeltaVsOpponentMin:cm.peerComparison.avgMajorItemDeltaMin},visionSetup:{games:cm.peerComparison.visionSetupGames,avgDeltaVsOpponent:cm.peerComparison.avgObjectiveSetupDelta,outperformPct:cm.peerComparison.objectiveSetupOutperformPct},wardClassification:true,currentSourcePortRequired:false,judgmentModel:"evidence+peer+self-baseline-v2"},behaviorSummary:cm.behaviorSummary,dataQuality:{cachedGames:cachedRows.length,eligibleSummonersRiftGames:eligibleRows.length,excludedOtherMaps:cachedRows.length-eligibleRows.length,excludedMissingRole:eligibleRows.length-deepCandidates.length,analyzedGames:games.length,validTimelineGames:validTimeline,validCoordinateGames:coordinateGames,missingTimelineGames:games.length-validTimeline,baselineGames:lifetime?allGames.length:0,coachingRoleGames:coachingGames.length,coachingBaselineRoleGames:coachingLifetime?coachingAllGames.length:0,peerComparableGames:cm.peerComparison.sameRoleGames,rankedPeerGames:cm.peerComparison.rankedPeerGames,higherRankPeerGames:cm.peerComparison.higherRankPeerGames},sourceStatus:{currentBruisienatorSourceAvailable:false,historicalAnalyzerRecovered:true,note:"Behavioral analysis ports the historical Bruisienator timeline heuristics where defensible, upgrades weak formulas, and compares the player primarily with actual same-role opponents plus their broader cached baseline. DQI and AGOR remain unavailable because their formulas were not recovered."}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method==="GET")return json(req,{ok:true,mode:"league-api-v1",internal_slot:"retired-diagnostic-reuse",requires_session:true,riot_configured:!!RIOT_KEY});
  if(req.method!=="POST")return json(req,{ok:false,error:"method_not_allowed"},405);
  let body:any={};try{body=await req.json();}catch{return json(req,{ok:false,error:"invalid_json"},400);}
  try{
    const{sb,viewer}=await session(req,body),action=text(body.action||"health"),requestRiotKey=text(req.headers.get("x-riot-api-key")||body?.riot_api_key);
    if(action==="health")return json(req,{ok:true,riot_configured:!!(RIOT_KEY||requestRiotKey),server_riot_key:!!RIOT_KEY,player:viewer.display_name,site_scope:viewer.site_scope});
    if(action==="riot_test"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id);
      const resolved=await resolveProfile(sb,{...p,puuid:null},requestRiotKey);
      return json(req,{ok:true,profile_id:resolved.id,game_name:resolved.game_name,tag_line:resolved.tag_line,platform_region:resolved.platform_region,puuid_resolved:!!text(resolved.puuid)});
    }
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
      if((RIOT_KEY||requestRiotKey)&&saved.game_name&&saved.tag_line){try{saved=await resolveProfile(sb,saved,requestRiotKey);}catch(e:any){return json(req,{ok:true,profile:saved,resolve_warning:text(e?.message||e)});}}
      return json(req,{ok:true,profile:saved});
    }
    if(action==="fetch_prepare"){
      let p=await getProfile(sb,viewer.player_id,body.profile_id);p=await resolveProfile(sb,p,requestRiotKey);
      const rank=await rankSnapshotFor(p,requestRiotKey);
      if(rank){
        const {data:ranked}=await sb.from("league_profiles_v1").update({rank_snapshot:rank,ranked_fetched_at:now(),updated_at:now()}).eq("id",p.id).select("*").maybeSingle();
        if(ranked)p=ranked;
      }
      const count=Math.max(1,Math.min(100,Number(body.count||20))),rr=text(p.routing_region)||routeFor(p.platform_region);
      const ids=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/by-puuid/"+encodeURIComponent(p.puuid)+"/ids?start=0&count="+count,requestRiotKey),matchIds=Array.isArray(ids)?ids.map(text).filter(Boolean):[];
      const recentRankIds=new Set(matchIds.slice(0,20));
      const{data:cached}=matchIds.length?await sb.from("league_match_cache_v1").select("match_id,timeline_json,peer_rank_fetched_at").eq("profile_id",p.id).in("match_id",matchIds).not("match_json","is",null):{data:[]};
      const set=new Set((cached||[]).filter((x:any)=>!!x.timeline_json&&(!recentRankIds.has(x.match_id)||!!x.peer_rank_fetched_at)).map((x:any)=>x.match_id));
      const{data:run,error}=await sb.from("league_fetch_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,status:"running",match_ids:matchIds,completed_count:set.size,total_count:matchIds.length,cache_hits:set.size,updated_at:now()}).select("*").single();
      if(error)throw error;return json(req,{ok:true,run_id:run.id,match_ids:matchIds,cached_match_ids:[...set],profile:p});
    }
    if(action==="fetch_one"){
      const{data:run,error:re}=await sb.from("league_fetch_runs_v1").select("*").eq("id",text(body.run_id)).eq("owner_player_id",viewer.player_id).maybeSingle();if(re||!run)throw re||Object.assign(new Error("fetch_run_not_found"),{status:404});
      const id=text(body.match_id),runIds=Array.isArray(run.match_ids)?run.match_ids:[],idx=runIds.indexOf(id);if(idx<0)return json(req,{ok:false,error:"match_not_in_run"},400);
      const p=await getProfile(sb,viewer.player_id,run.profile_id),{data:old}=await sb.from("league_match_cache_v1").select("match_json,timeline_json,peer_rank_json,peer_rank_fetched_at").eq("profile_id",p.id).eq("match_id",id).maybeSingle();
      const needsPeerRank=idx<20&&(!old?.peer_rank_fetched_at||body.force===true);
      if(old?.match_json&&old?.timeline_json&&!needsPeerRank&&body.force!==true)return json(req,{ok:true,match_id:id,cache_hit:true,timeline_available:true,peer_rank_checked:idx>=20||!!old?.peer_rank_fetched_at});
      const rr=text(p.routing_region)||routeFor(p.platform_region);
      let m=old?.match_json||null,tl=old?.timeline_json||null,tlError:string|null=null;
      if(!m||body.force===true)m=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id),requestRiotKey);
      if(!tl||body.force===true){try{tl=await riot("https://"+rr+".api.riotgames.com/lol/match/v5/matches/"+encodeURIComponent(id)+"/timeline",requestRiotKey);}catch(e:any){tlError=text(e?.message||e).slice(0,500);}}
      let peerRank=old?.peer_rank_json||null,peerRankFetchedAt=old?.peer_rank_fetched_at||null;
      if(idx<20&&(!peerRankFetchedAt||body.force===true)){
        const participants=Array.isArray(m?.info?.participants)?m.info.participants:[],me=participants.find((x:any)=>text(x?.puuid)===text(p.puuid)),opp=me?opponent(m,me):null;
        peerRank=opp?.puuid?await rankSnapshotFor({puuid:opp.puuid,platform_region:p.platform_region},requestRiotKey):null;
        peerRankFetchedAt=now();
      }
      const gs=Number(m?.info?.gameStartTimestamp||0),row={profile_id:p.id,match_id:id,owner_player_id:viewer.player_id,game_start_at:gs?new Date(gs).toISOString():null,map_id:num(m?.info?.mapId),queue_id:num(m?.info?.queueId),game_duration_seconds:num(m?.info?.gameDuration),match_json:m,timeline_json:tl,peer_rank_json:peerRank,peer_rank_fetched_at:peerRankFetchedAt,match_fetched_at:now(),timeline_fetched_at:tl?now():null,fetch_error:tlError,updated_at:now()};
      const{error}=await sb.from("league_match_cache_v1").upsert(row,{onConflict:"profile_id,match_id"});if(error)throw error;
      await sb.from("league_fetch_runs_v1").update({completed_count:Math.min(Number(run.total_count||0),Number(run.completed_count||0)+1),updated_at:now(),last_error:tlError}).eq("id",run.id);
      return json(req,{ok:true,match_id:id,cache_hit:!!old?.match_json&&!!old?.timeline_json,timeline_available:!!tl,timeline_error:tlError,peer_rank_checked:idx>=20||!!peerRankFetchedAt,peer_rank:peerRank});
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
      const{data:rows,error}=await sb.from("league_match_cache_v1").select("match_id,game_start_at,map_id,queue_id,game_duration_seconds,match_json,timeline_json,peer_rank_json,peer_rank_fetched_at,fetch_error").eq("profile_id",p.id).not("match_json","is",null).order("game_start_at",{ascending:false}).limit(100);if(error)throw error;
      const catalog=await itemCatalog();
      const rep=report(p,rows||[],catalog),{data:run,error:se}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"web_behavior",analyzer_version:rep.analyzerVersion,sample_match_ids:rep.games.map((g:any)=>g.matchId),report_data:rep,data_quality:rep.dataQuality}).select("id,created_at").single();if(se)throw se;
      return json(req,{ok:true,analysis_id:run.id,created_at:run.created_at,report:rep});
    }
    if(action==="report_latest"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),{data,error}=await sb.from("league_analysis_runs_v1").select("id,source_kind,analyzer_version,sample_match_ids,report_data,data_quality,created_at").eq("profile_id",p.id).eq("owner_player_id",viewer.player_id).order("created_at",{ascending:false}).limit(10);
      if(error)throw error;
      const rows=Array.isArray(data)?data:[],current=rows[0]||null,currentSig=current?JSON.stringify(current.sample_match_ids||[]):"";
      const previous=current?rows.slice(1).find((x:any)=>JSON.stringify(x.sample_match_ids||[])!==currentSig)||null:null;
      return json(req,{ok:true,analysis:current,previous});
    }
    if(action==="report_import"){
      const p=await getProfile(sb,viewer.player_id,body.profile_id),rep=body.report;if(!rep||typeof rep!=="object")return json(req,{ok:false,error:"report_object_required"},400);
      const raw=JSON.stringify(rep);if(raw.length>2000000)return json(req,{ok:false,error:"report_too_large"},413);
      const{data,error}=await sb.from("league_analysis_runs_v1").insert({profile_id:p.id,owner_player_id:viewer.player_id,source_kind:"legacy_import",analyzer_version:text(rep.analyzerVersion||"legacy-import-v1").slice(0,120),sample_match_ids:Array.isArray(rep.games)?rep.games.map((g:any)=>text(g.matchId)).filter(Boolean).slice(0,100):[],report_data:rep,data_quality:rep.dataQuality||{}}).select("id,created_at").single();if(error)throw error;return json(req,{ok:true,analysis_id:data.id,created_at:data.created_at});
    }
    return json(req,{ok:false,error:"unknown_action"},400);
  }catch(e:any){console.error("league-api-v1",e);return json(req,{ok:false,error:text(e?.message||e).slice(0,500)},Number(e?.status)||500);}
});
