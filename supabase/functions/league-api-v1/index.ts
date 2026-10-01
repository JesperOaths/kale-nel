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
  return [text(r.tier).toUpperCase(),text(r.rank).toUpperCase(),Number.isFinite(Number(r.leaguePoints))?String(r.leaguePoints)+" LP":""].filter(Boolean).join(" ");
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
function frameAtMs(frames:any[],ms:number){
  if(!frames?.length)return null;
  let chosen=frames[0]||null;
  for(const f of frames){if(Number(f?.timestamp||0)<=ms)chosen=f;else break;}
  return chosen;
}
function frameStats(frame:any,pid:any){
  const p=frame?.participantFrames?.[String(pid)]||frame?.participantFrames?.[pid];
  if(!p)return null;
  return{gold:num(p.totalGold),currentGold:num(p.currentGold),cs:Number(p.minionsKilled||0)+Number(p.jungleMinionsKilled||0),xp:num(p.xp),level:num(p.level),position:xy(p.position)};
}
function participantRole(p:any){return role(p?.teamPosition||p?.individualPosition||p?.role||p?.lane);}
function opponent(match:any,p:any){
  const rr=participantRole(p),ps=Array.isArray(match?.info?.participants)?match.info.participants:[];
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
  const out:any={goldDiff10:null,goldDiff15:null,csDiff10:null,csDiff15:null,xpDiff10:null,xpDiff15:null,levelDiff10:null,levelDiff15:null,deathPositions:[],wards:[],wardKills:[],objectives:[],involvedKills:[],goldSeries:[],frameSamples:[],objectiveJoinRate:null,objectiveJoined:0,objectiveTeamTotal:0,earlyKp:null,impactTimeMin:null,impactType:null,badDeaths:[],badDeathCount:0,objectiveDeathCount:0,objectiveDeathPct:null,highUnspentGoldDeaths:0,overstays:[],overstayCount:0,greedyStayWindows:[],shopVisits:[],firstMajorItem:null,opponentFirstMajorItem:null,itemSpikeDeltaVsOpponent:null,roams:{attempts:0,successes:0,failures:0,neutral:0,events:[]},vision:{wardCount:0,wardKillCount:0,controlWardCount:0,offensive:0,defensive:0,river:0,objectiveSetup:0,wardsPer30:null},timelineAvailable:!!frames.length};
  for(const minute of[10,15]){
    const fr=nearestFrame(frames,minute),a=frameStats(fr,pid),b=oppId?frameStats(fr,oppId):null;
    if(a&&b){out["goldDiff"+minute]=(a.gold!=null&&b.gold!=null)?a.gold-b.gold:null;out["csDiff"+minute]=a.cs-b.cs;out["xpDiff"+minute]=(a.xp!=null&&b.xp!=null)?a.xp-b.xp:null;out["levelDiff"+minute]=(a.level!=null&&b.level!=null)?a.level-b.level:null;}
  }
  const purchaseByPid:any[]=[],purchaseByOpp:any[]=[],allObjectives:any[]=[],ownObjectiveEvents:any[]=[],deathEvents:any[]=[],involved:any[]=[];
  for(const fr of frames){
    const mine=frameStats(fr,pid);
    if(mine){const sample={time:Number(fr?.timestamp||0)/60000,totalGold:mine.gold,currentGold:mine.currentGold,cs:mine.cs,xp:mine.xp,level:mine.level,position:mine.position,zone:zoneFor(mapId,mine.position,teamId)};out.frameSamples.push(sample);if(mine.gold!=null)out.goldSeries.push({minute:sample.time,totalGold:mine.gold,currentGold:mine.currentGold});}
    for(const e of(Array.isArray(fr?.events)?fr.events:[])){
      const pxy=xy(e.position),tMs=Number(e.timestamp||0),tMin=tMs/60000;
      if(e.type==="CHAMPION_KILL"){
        const ev={tMs,tMin,...(pxy||{}),killerId:Number(e.killerId||0),victimId:Number(e.victimId||0),assistingIds:Array.isArray(e.assistingParticipantIds)?e.assistingParticipantIds.map(Number):[]};
        if(Number(e.victimId)===pid){deathEvents.push(ev);out.deathPositions.push({time:tMin,...(pxy||{})});}
        if(playerInKill(e,pid)){involved.push(ev);out.involvedKills.push({time:tMin,...(pxy||{}),killerId:e.killerId,victimId:e.victimId});}
      }else if(["ELITE_MONSTER_KILL","BUILDING_KILL","TURRET_PLATE_DESTROYED"].includes(String(e.type))){
        const owner=objectiveOwnerTeam(e,byId),obj={tMs,tMin,type:text(e.type),monsterType:text(e.monsterType),monsterSubType:text(e.monsterSubType),buildingType:text(e.buildingType),ownerTeam:owner,...(pxy||{})};
        allObjectives.push(obj);out.objectives.push(obj);if(owner===teamId)ownObjectiveEvents.push(obj);
      }else if(e.type==="WARD_PLACED"&&Number(e.creatorId)===pid&&pxy){
        const territory=wardTerritory(teamId,pxy),w={time:tMin,tMs,...pxy,wardType:text(e.wardType),territory};out.wards.push(w);out.vision.wardCount++;if(text(e.wardType).toUpperCase().includes("CONTROL"))out.vision.controlWardCount++;if(territory==="offensive")out.vision.offensive++;else if(territory==="defensive")out.vision.defensive++;else if(territory==="river")out.vision.river++;
      }else if(e.type==="WARD_KILL"&&Number(e.killerId)===pid&&pxy){out.wardKills.push({time:tMin,tMs,...pxy,wardType:text(e.wardType)});out.vision.wardKillCount++;}
      else if(e.type==="ITEM_PURCHASED"){const ev={tMs,tMin,itemId:Number(e.itemId||0)};if(Number(e.participantId)===pid)purchaseByPid.push(ev);if(oppId&&Number(e.participantId)===oppId)purchaseByOpp.push(ev);}
    }
  }
  out.shopVisits=purchaseGroups(purchaseByPid,catalog);out.firstMajorItem=firstMajorPurchase(purchaseByPid,catalog);out.opponentFirstMajorItem=firstMajorPurchase(purchaseByOpp,catalog);if(out.firstMajorItem&&out.opponentFirstMajorItem)out.itemSpikeDeltaVsOpponent=out.firstMajorItem.time-out.opponentFirstMajorItem.time;
  const duration=Math.max(1,Number(match?.info?.gameDuration||0)/60);out.vision.wardsPer30=out.vision.wardCount/duration*30;
  for(const obj of ownObjectiveEvents){out.objectiveTeamTotal++;const fs=frameAtMs(frames,obj.tMs),me=frameStats(fs,pid),near=me?.position&&obj.x!=null&&obj.y!=null&&dist2(me.position,obj)<=2500*2500;if(near){out.objectiveJoined++;if(out.impactTimeMin==null||obj.tMin<out.impactTimeMin){out.impactTimeMin=obj.tMin;out.impactType="objective";}}}
  if(out.objectiveTeamTotal>0)out.objectiveJoinRate=100*out.objectiveJoined/out.objectiveTeamTotal;
  let teamEarly=0,playerEarly=0;
  for(const fr of frames){for(const e of(Array.isArray(fr?.events)?fr.events:[])){if(e.type!=="CHAMPION_KILL"||Number(e.timestamp||0)>14*60*1000)continue;const killer=byId.get(Number(e.killerId));if(!killer||Number(killer.teamId)!==teamId)continue;teamEarly++;if(playerInKill(e,pid))playerEarly++;}}
  if(teamEarly>0)out.earlyKp=100*playerEarly/teamEarly;
  for(const ev of involved){if(out.impactTimeMin==null||ev.tMin<out.impactTimeMin){out.impactTimeMin=ev.tMin;out.impactType="kill_or_assist";}}
  for(const d of deathEvents){
    const fr=frameAtMs(frames,d.tMs),me=frameStats(fr,pid),pos=(d.x!=null&&d.y!=null)?{x:d.x,y:d.y}:me?.position;let alliesNear=0,enemiesNear=0,nearestAlly=Infinity;
    if(pos&&fr?.participantFrames){for(const [id,q] of byId.entries()){if(id===pid)continue;const fs=frameStats(fr,id);if(!fs?.position)continue;const dd=dist2(pos,fs.position);if(Number(q.teamId)===teamId){nearestAlly=Math.min(nearestAlly,dd);if(dd<=3000*3000)alliesNear++;}else if(dd<=3000*3000)enemiesNear++;}}
    const isolated=!Number.isFinite(nearestAlly)||nearestAlly>3000*3000,sum=pos?Number(pos.x)+Number(pos.y):null,deep=sum==null?false:(teamId===100?sum>19000:sum<11000),outnumbered=enemiesNear>=alliesNear+2;
    const enemyObjSoon=allObjectives.some(o=>o.ownerTeam&&o.ownerTeam!==teamId&&o.tMs>d.tMs&&o.tMs<=d.tMs+45000),objectiveContext=allObjectives.some(o=>Math.abs(o.tMs-d.tMs)<=45000&&(o.x==null||pos==null||dist2(pos,o)<=3500*3500));
    const currentGold=Number(me?.currentGold||0),highUnspent=currentGold>=1000;let score=0;const tags:string[]=[];
    if(isolated){score++;tags.push("isolated");}if(deep){score++;tags.push("deep_enemy_side");}if(outnumbered){score++;tags.push("outnumbered");}if(enemyObjSoon){score+=2;tags.push("enemy_objective_after");}if(highUnspent){score++;tags.push("high_unspent_gold");}if(objectiveContext){out.objectiveDeathCount++;tags.push("objective_context");}
    const bad=score>=2;if(highUnspent)out.highUnspentGoldDeaths++;if(bad){out.badDeathCount++;out.badDeaths.push({time:d.tMin,x:d.x??null,y:d.y??null,score,tags,alliesNear,enemiesNear,currentGold});}if(bad&&(highUnspent||(deep&&isolated))){out.overstayCount++;out.overstays.push({time:d.tMin,currentGold,tags});}
  }
  if(deathEvents.length)out.objectiveDeathPct=100*out.objectiveDeathCount/deathEvents.length;
  const visits=out.shopVisits;
  for(let i=0;i<out.frameSamples.length;i++){const sm=out.frameSamples[i];if(sm.time<6||sm.time>22||Number(sm.currentGold||0)<1200||sm.zone==="base")continue;const next=visits.find((v:any)=>v.startMin>sm.time);if(!next||next.startMin-sm.time<=2)continue;const prev=out.greedyStayWindows[out.greedyStayWindows.length-1];if(prev&&sm.time-prev.startMin<2.5)continue;out.greedyStayWindows.push({startMin:sm.time,currentGold:sm.currentGold,nextShopMin:next.startMin,delayMin:next.startMin-sm.time});}
  for(const w of out.wards){if(allObjectives.some(o=>o.x!=null&&Math.abs(o.tMin-w.time)<=1.5&&o.tMin>=w.time&&dist2(w,o)<=3500*3500))out.vision.objectiveSetup++;}
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
          if(rr==="SUPPORT"){const adc=ps.find((x:any)=>Number(x.teamId)===teamId&&participantRole(x)==="ADC"),enemyAdc=adc?ps.find((x:any)=>Number(x.teamId)!==teamId&&participantRole(x)==="ADC"):null;if(adc&&enemyAdc){const sf=frameAtMs(frames,startSample.time*60000),ef=frameAtMs(frames,endSample.time*60000),a0=frameStats(sf,adc.participantId),b0=frameStats(sf,enemyAdc.participantId),a1=frameStats(ef,adc.participantId),b1=frameStats(ef,enemyAdc.participantId);if(a0&&b0&&a1&&b1)roam.adcLaneCostCs=(a1.cs-b1.cs)-(a0.cs-b0.cs);}}
          out.roams.events.push(roam);out.roams.attempts++;if(outcome==="success")out.roams.successes++;else if(outcome==="failure")out.roams.failures++;else out.roams.neutral++;
        }
        i=Math.max(j,i+1);
      }else i++;
    }
  }
  return out;
}
function signedText(v:any,d=0){const n=Number(v);return Number.isFinite(n)?(n>0?"+":"")+n.toFixed(d):"n/a";}
function gameJudgments(g:any){
  const items:any[]=[];
  const add=(priority:number,category:string,title:string,evidence:string,action:string,tone:string="improve")=>items.push({priority,category,title,evidence,action,tone});
  if(Number.isFinite(Number(g.goldDiff15))){
    if(Number(g.goldDiff15)<=-400)add(1,"laning","You reached 15 minutes materially behind your direct role opponent","At 15 minutes: "+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Review the first two recalls, waves conceded around fights, and trades that cost farm.");
    else if(Number(g.goldDiff15)>=400)add(3,"laning","You created a meaningful lane/economy lead","At 15 minutes: +"+Math.round(Number(g.goldDiff15))+"g and "+signedText(g.csDiff15,0)+" CS versus the same-role opponent.","Use the next purchase/objective window to convert the lead instead of letting the game return to even.","strength");
  }
  if(Number(g.badDeathCount)>=2){
    const top=(g.badDeaths||[]).slice(0,2).map((d:any)=>Number(d.time).toFixed(1)+"m ("+(d.tags||[]).join(", ")+")").join("; ");
    add(1,"deaths","Several deaths have multiple avoidability signals",String(g.badDeathCount)+" deaths crossed the multi-signal threshold"+(top?": "+top:".")+".","Before re-entering fog or enemy territory, check ally distance, current gold and the next objective timer.");
  }else if(Number(g.badDeathCount)===0&&Number(g.deaths)>=1){
    add(4,"deaths","No death crossed the high-risk threshold",String(g.deaths)+" deaths occurred, but none had enough combined isolation/depth/objective/gold signals to label confidently avoidable.","Keep the same risk discipline while looking for more pressure.","strength");
  }
  if(Number.isFinite(Number(g.itemSpikeDeltaVsOpponent))){
    if(Number(g.itemSpikeDeltaVsOpponent)>=1)add(1,"resets","Your first major item arrived later than your counterpart","You completed it "+Number(g.itemSpikeDeltaVsOpponent).toFixed(1)+" minutes after the same-role opponent.","Look for a cleaner reset once you are carrying enough gold for a completion; one extra wave is not always worth losing the purchase window.");
    else if(Number(g.itemSpikeDeltaVsOpponent)<=-1)add(3,"resets","You hit the first major item earlier than your counterpart","Your completion arrived "+Math.abs(Number(g.itemSpikeDeltaVsOpponent)).toFixed(1)+" minutes earlier.","Act on that temporary item advantage before the opponent completes theirs.","strength");
  }
  if(Number(g.greedyStayWindows?.length)>=1)add(2,"resets","You held a large amount of spendable gold for too long",String(g.greedyStayWindows.length)+" detected window(s) had at least 1200 current gold and more than two minutes until the next shop visit.","Reset when the map gives you a low-cost window, especially before objectives or a major item completion.");
  if(Number(g.roams?.attempts)>=1){
    const rate=100*Number(g.roams.successes||0)/Math.max(1,Number(g.roams.attempts||0));
    if(rate<40)add(2,"roaming","Roam conversion was weak in this game",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a kill/assist or objective.","Leave lane on pushed/covered waves and abort earlier when the target lane cannot follow.");
    else if(rate>=67)add(4,"roaming","Your roam windows converted well",String(g.roams.successes||0)+" of "+String(g.roams.attempts||0)+" detected departures produced a kill/assist or objective.","Keep the timing, then check the lane cost so the roam is not merely shifting resources.","strength");
  }
  if(Number(g.objectiveTeamTotal)>=2&&Number.isFinite(Number(g.objectiveJoinRate))){
    if(Number(g.objectiveJoinRate)<40)add(2,"objectives","You missed much of your team's objective action","Presence was "+Math.round(Number(g.objectiveJoinRate))+"% across "+String(g.objectiveTeamTotal)+" tracked team objective events.","Plan the preceding recall/path one minute earlier rather than reacting after the objective starts.");
    else if(Number(g.objectiveJoinRate)>=75)add(4,"objectives","You were consistently present for objective action","Presence was "+Math.round(Number(g.objectiveJoinRate))+"% across "+String(g.objectiveTeamTotal)+" tracked team objective events.","Preserve the timing and improve setup quality through vision and safer pre-objective positioning.","strength");
  }
  if(g.peer&&["ADC","MID","TOP"].includes(String(g.role))&&Number(g.peer.dpmDelta)<=-150)add(2,"fighting","Your same-role opponent converted more damage","You finished "+Math.round(Math.abs(Number(g.peer.dpmDelta)))+" DPM below the direct counterpart.","Check whether you were late to fights, under-itemized, or removed by an early death before your damage window.");
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
function meanField(games:any[],fn:(g:any)=>any){return avg(games.map(fn));}
function finiteGames(games:any[],fn:(g:any)=>any){return games.filter(g=>Number.isFinite(Number(fn(g))));}
function coachingModel(games:any[],summary:any,lifetime:any,primaryRole:string,playerRank:any=null){
  const recentFocus:any[]=[],highlights:any[]=[],coaching:any[]=[];
  const conf=(n:number)=>n>=10?"high":n>=5?"medium":"low";
  const push=(arr:any[],category:string,title:string,evidence:string,action:string,confidence:string="medium",priority:number=2,comparison:string="")=>arr.push({category,title,evidence,action,confidence,priority,comparison,text:title+" — "+evidence+(action?" "+action:"")});
  const wins=games.filter(g=>g.win),losses=games.filter(g=>!g.win),validTimeline=games.filter(g=>g.timelineAvailable),lane15=finiteGames(games,g=>g.goldDiff15),itemGames=finiteGames(games,g=>g.itemSpikeDeltaVsOpponent),peerGames=games.filter(g=>g.peer);
  const avgG15=meanField(lane15,g=>g.goldDiff15),avgC15=meanField(finiteGames(games,g=>g.csDiff15),g=>g.csDiff15),laneAhead=lane15.length?100*lane15.filter(g=>Number(g.goldDiff15)>0).length/lane15.length:null;
  const laneLeads=lane15.filter(g=>Number(g.goldDiff15)>=250),laneDeficits=lane15.filter(g=>Number(g.goldDiff15)<=-250);
  const laneLeadWr=laneLeads.length?100*laneLeads.filter(g=>g.win).length/laneLeads.length:null,laneDeficitWr=laneDeficits.length?100*laneDeficits.filter(g=>g.win).length/laneDeficits.length:null;
  const badPer=meanField(validTimeline,g=>g.badDeathCount),objDeathPct=meanField(finiteGames(validTimeline,g=>g.objectiveDeathPct),g=>g.objectiveDeathPct),unspent=validTimeline.reduce((n,g)=>n+Number(g.highUnspentGoldDeaths||0),0);
  const objJoin=meanField(finiteGames(validTimeline,g=>g.objectiveJoinRate),g=>g.objectiveJoinRate),earlyKp=meanField(finiteGames(validTimeline,g=>g.earlyKp),g=>g.earlyKp);
  const roamAttempts=validTimeline.reduce((n,g)=>n+Number(g.roams?.attempts||0),0),roamSuccess=validTimeline.reduce((n,g)=>n+Number(g.roams?.successes||0),0),roamFail=validTimeline.reduce((n,g)=>n+Number(g.roams?.failures||0),0),roamRate=roamAttempts?100*roamSuccess/roamAttempts:null;
  const itemDelta=meanField(itemGames,g=>g.itemSpikeDeltaVsOpponent),greedy=validTimeline.reduce((n,g)=>n+Number(g.greedyStayWindows?.length||0),0),peerCs=meanField(peerGames,g=>g.peer.csMinDelta),peerDpm=meanField(peerGames,g=>g.peer.dpmDelta),peerVpm=meanField(peerGames,g=>g.peer.vpmDelta),topDamage=games.filter(g=>Number(g.damageRank)===1).length;
  const outperform=(list:any[],fn:(g:any)=>any,invert=false)=>{const xs=list.filter(g=>Number.isFinite(Number(fn(g))));return xs.length?100*xs.filter(g=>invert?Number(fn(g))<0:Number(fn(g))>0).length/xs.length:null;};
  const peerGoldWin=outperform(lane15,g=>g.goldDiff15),peerCsWin=outperform(peerGames,g=>g.peer.csMinDelta),peerDpmWin=outperform(peerGames,g=>g.peer.dpmDelta),peerVpmWin=outperform(peerGames,g=>g.peer.vpmDelta),peerItemFaster=outperform(itemGames,g=>g.itemSpikeDeltaVsOpponent,true);
  const wl=(fn:(g:any)=>any)=>({wins:meanField(finiteGames(wins,fn),fn),losses:meanField(finiteGames(losses,fn),fn)});
  const winLoss={goldDiff15:wl(g=>g.goldDiff15),dpm:wl(g=>g.dpm),badDeaths:wl(g=>g.badDeathCount),earlyKp:wl(g=>g.earlyKp),objectiveJoin:wl(g=>g.objectiveJoinRate),greedyStays:wl(g=>g.greedyStayWindows?.length),itemDelta:wl(g=>g.itemSpikeDeltaVsOpponent)};
  const recent5=games.slice(0,5),prior15=games.slice(5,20);
  const trendMetric=(fn:(g:any)=>any)=>({recent:meanField(finiteGames(recent5,fn),fn),prior:meanField(finiteGames(prior15,fn),fn),recentN:finiteGames(recent5,fn).length,priorN:finiteGames(prior15,fn).length});
  const recentTrend={csMin:trendMetric(g=>g.csMin),dpm:trendMetric(g=>g.dpm),kp:trendMetric(g=>g.kp),goldDiff15:trendMetric(g=>g.goldDiff15),badDeaths:trendMetric(g=>g.badDeathCount),objectiveJoin:trendMetric(g=>g.objectiveJoinRate),itemDelta:trendMetric(g=>g.itemSpikeDeltaVsOpponent)};

  if(lane15.length>=5){
    if(Number(avgG15)<=-250)push(recentFocus,"laning","Early-lane economy is the clearest leak","Across "+lane15.length+" comparable games you average "+Math.round(Number(avgG15))+" gold and "+Math.round(Number(avgC15||0))+" CS versus the same-role opponent at 15; you are ahead in only "+Math.round(Number(laneAhead||0))+"% of them.","Prioritize wave access and lower-cost trades before 15 minutes; this is a direct opponent comparison, not a generic benchmark.",conf(lane15.length),1,"same-role opponents");
    else if(Number(avgG15)>=250)push(highlights,"laning","You are consistently creating lane economy","You average +"+Math.round(Number(avgG15))+" gold versus the same-role opponent at 15 across "+lane15.length+" games.","The next improvement lever is converting that lead into earlier objectives and cleaner resets.",conf(lane15.length),3,"same-role opponents");
    const lane10=meanField(finiteGames(games,g=>g.goldDiff10),g=>g.goldDiff10);
    if(Number(lane10)>=100&&Number(avgG15)<=-50)push(recentFocus,"laning","Early leads are leaking before 15","Average gold differential moves from "+Math.round(Number(lane10))+" at 10 minutes to "+Math.round(Number(avgG15))+" at 15.","Review the first reset and the 10–15 minute wave/fight decisions; you are creating a lead and then giving it back.",conf(lane15.length),1,"same-role opponents");
  }
  if(laneLeads.length>=4&&Number(laneLeadWr)<50)push(recentFocus,"conversion","Lane leads are not becoming enough wins","When you are at least +250g versus the direct role opponent at 15, you win only "+Math.round(Number(laneLeadWr))+"% of those "+laneLeads.length+" games.","After creating the lead, spend it before the next neutral objective and avoid low-value side fights that give shutdown/tempo back.",conf(laneLeads.length),1,"lead-to-win conversion");
  else if(laneLeads.length>=4&&Number(laneLeadWr)>=65)push(highlights,"conversion","You convert lane leads into wins well","You win "+Math.round(Number(laneLeadWr))+"% of the "+laneLeads.length+" games where you are at least +250g versus your role opponent at 15.","Keep repeating the post-lane choices that turn the advantage into objectives and map control.",conf(laneLeads.length),3,"lead-to-win conversion");
  if(laneDeficits.length>=4&&Number(laneDeficitWr)>=45)push(highlights,"recovery","You recover from lane deficits unusually often in this sample","You still win "+Math.round(Number(laneDeficitWr))+"% of "+laneDeficits.length+" games where you are at least 250g behind the role opponent at 15.","Preserve the low-variance recovery habits rather than forcing desperate fights when behind.",conf(laneDeficits.length),4,"deficit-to-win recovery");
  if(itemGames.length>=4){
    if(Number(itemDelta)>=0.75)push(recentFocus,"resets","Major item timing is slower than your direct opponent","Your first major completed item lands "+Number(itemDelta).toFixed(1)+" minutes later on average across "+itemGames.length+" games; you are faster in only "+Math.round(Number(peerItemFaster||0))+"% of comparable games.","Look for earlier high-value recalls after accumulating gold; avoid staying for one extra wave when it delays a completed item.",conf(itemGames.length),1,"same-role major-item timing");
    else if(Number(itemDelta)<=-0.75)push(highlights,"resets","You usually hit the first major item before your counterpart","Your first major completed item arrives "+Math.abs(Number(itemDelta)).toFixed(1)+" minutes earlier on average across "+itemGames.length+" games.","Use that purchase window deliberately: contest the next wave, objective or fight while the opponent is still down a completion.",conf(itemGames.length),3,"same-role major-item timing");
  }
  if(validTimeline.length>=5&&(Number(badPer)>=0.8||Number(objDeathPct)>=25||unspent>=3))push(recentFocus,"deaths","Death quality is costing map tempo","The analyzer flags "+Number(badPer||0).toFixed(1)+" high-risk deaths per timeline game; "+Number(objDeathPct||0).toFixed(0)+"% of deaths occur in objective context, and "+unspent+" deaths happened with at least 1000 unspent gold.","Before major objectives, reset earlier and avoid entering deep/outnumbered positions without nearby teammates.",conf(validTimeline.length),1,"multi-signal timeline evidence");
  else if(validTimeline.length>=5&&Number(badPer)<0.35)push(highlights,"deaths","Your risk discipline is strong","Only "+Number(badPer||0).toFixed(1)+" deaths per timeline game meet the multi-signal bad-death heuristic.","Keep the same discipline while increasing pressure from your strongest windows.",conf(validTimeline.length),4,"multi-signal timeline evidence");
  if(wins.length>=4&&losses.length>=4&&Number.isFinite(Number(winLoss.badDeaths.wins))&&Number.isFinite(Number(winLoss.badDeaths.losses))&&Number(winLoss.badDeaths.losses)-Number(winLoss.badDeaths.wins)>=0.5)push(recentFocus,"deaths","Avoidable-risk deaths distinguish your losses from your wins","You average "+Number(winLoss.badDeaths.losses).toFixed(1)+" flagged high-risk deaths in losses versus "+Number(winLoss.badDeaths.wins).toFixed(1)+" in wins.","Treat this as a controllable consistency lever: when a game starts going badly, reduce isolated/deep entries instead of trying to force recovery immediately.",conf(Math.min(wins.length,losses.length)),1,"wins vs losses in your own sample");
  if(["JUNGLE","SUPPORT"].includes(primaryRole)&&validTimeline.length>=5&&Number(objJoin)<50)push(recentFocus,"objectives","Objective presence is low for your primary role","You are within the objective-action radius for "+Number(objJoin||0).toFixed(0)+"% of your team's tracked major objective events.","Plan resets and pathing around the next objective timer rather than arriving after the action starts.",conf(validTimeline.length),1,"team objective events");
  else if(["JUNGLE","SUPPORT"].includes(primaryRole)&&Number(objJoin)>=70)push(highlights,"objectives","Objective presence is a strength","You are present for "+Number(objJoin).toFixed(0)+"% of your team's tracked major objective events.","Preserve this while improving the quality of the setup vision and pre-objective deaths.",conf(validTimeline.length),4,"team objective events");
  if(wins.length>=4&&losses.length>=4&&Number.isFinite(Number(winLoss.objectiveJoin.wins))&&Number.isFinite(Number(winLoss.objectiveJoin.losses))&&Number(winLoss.objectiveJoin.wins)-Number(winLoss.objectiveJoin.losses)>=15)push(recentFocus,"objectives","Objective attendance is strongly associated with your wins","Objective presence averages "+Number(winLoss.objectiveJoin.wins).toFixed(0)+"% in wins versus "+Number(winLoss.objectiveJoin.losses).toFixed(0)+"% in losses.","Protect the setup sequence—recall, path, vision, arrive—because missing it is one of the clearest differences between your wins and losses.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses; association, not causation");
  if(["MID","SUPPORT","TOP"].includes(primaryRole)&&roamAttempts>=4){
    if(Number(roamRate)<45)push(recentFocus,"roaming","Roams are not converting often enough",roamSuccess+"/"+roamAttempts+" detected pre-20-minute departures produced a kill/assist or objective, while "+roamFail+" ended in your death.","Roam on pushed waves and visible windows; cancel the move sooner when the target lane cannot follow.",conf(roamAttempts),2,"detected pre-20-minute departures");
    else if(Number(roamRate)>=65)push(highlights,"roaming","Your roams convert well",roamSuccess+"/"+roamAttempts+" detected pre-20-minute departures produced a kill/assist or objective.","Keep choosing these windows; the next check is whether the lane cost stays acceptable.",conf(roamAttempts),4,"detected pre-20-minute departures");
  }
  if(primaryRole==="SUPPORT"){
    const costly=validTimeline.flatMap(g=>g.roams?.events||[]).filter((r:any)=>Number.isFinite(Number(r.adcLaneCostCs))&&Number(r.adcLaneCostCs)<=-6&&!r.killOrAssist&&!r.objective).length;
    if(costly>=2)push(recentFocus,"roaming","Some support roams are expensive for your ADC",costly+" detected roams lost at least 6 CS of ADC-vs-ADC lane differential without a kill/assist or objective return.","Prefer roam windows after your ADC can safely crash, reset or collect under tower.","high",1,"ADC lane cost during support roams");
  }
  if(["SUPPORT","JUNGLE"].includes(primaryRole)&&peerGames.length>=5&&Number(peerVpm)<=-0.15)push(recentFocus,"vision","You are giving up vision volume to the opposing role","Vision score is "+Math.abs(Number(peerVpm)).toFixed(2)+" per minute lower than the same-role opponent on average; you beat them on VPM in "+Math.round(Number(peerVpmWin||0))+"% of "+peerGames.length+" games.","Shift more wards into river/objective setup before the contest, not after contact starts.",conf(peerGames.length),2,"same-role opponents");
  if(peerGames.length>=5){
    if(Number(peerDpm)<=-100&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"fighting","Damage conversion trails your direct counterpart","You average "+Math.round(Math.abs(Number(peerDpm)))+" less champion damage per minute than the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Check whether farm leads are being converted into timely fights and whether deaths are removing you before damage windows.",conf(peerGames.length),2,"same-role opponents");
    if(Number(peerDpm)>=120)push(highlights,"fighting","You outperform the direct counterpart in damage","You average +"+Math.round(Number(peerDpm))+" champion damage per minute versus the same-role opponent and beat them on DPM in "+Math.round(Number(peerDpmWin||0))+"% of "+peerGames.length+" games.","Protect this strength by reducing deaths that occur before objectives.",conf(peerGames.length),4,"same-role opponents");
    if(Number(peerCs)<=-0.5&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"farming","Farm pace trails the actual lane peer","You average "+Math.abs(Number(peerCs)).toFixed(2)+" CS/min less than the same-role opponent and finish ahead on CS/min in only "+Math.round(Number(peerCsWin||0))+"% of comparable games.","Track the waves lost around recalls, roams and unnecessary mid-game grouping.",conf(peerGames.length),2,"same-role opponents");
  }
  if(wins.length>=4&&losses.length>=4&&Number.isFinite(Number(winLoss.earlyKp.wins))&&Number.isFinite(Number(winLoss.earlyKp.losses))&&Number(winLoss.earlyKp.wins)-Number(winLoss.earlyKp.losses)>=15)push(recentFocus,"early impact","Early involvement is much higher in your wins","14-minute KP averages "+Number(winLoss.earlyKp.wins).toFixed(0)+"% in wins versus "+Number(winLoss.earlyKp.losses).toFixed(0)+"% in losses.","Look for repeatable early windows—rather than random aggression—that let you influence the map before the game state hardens.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses; association, not causation");
  const playerRankValue=rankScore(playerRank),rankedPeerGames=peerGames.filter(g=>rankScore(g.peer?.rank)!=null),higherRankGames=playerRankValue==null?[]:rankedPeerGames.filter(g=>Number(rankScore(g.peer?.rank))>Number(playerRankValue));
  const higherLane=finiteGames(higherRankGames,g=>g.goldDiff15),higherGold=meanField(higherLane,g=>g.goldDiff15),higherDpm=meanField(higherRankGames,g=>g.peer?.dpmDelta),higherGoldWin=outperform(higherLane,g=>g.goldDiff15);
  if(higherRankGames.length>=3&&higherLane.length>=3){
    if(Number(higherGold)<=-300)push(recentFocus,"rank pressure","Laning drops against higher-ranked direct opponents","Against "+higherLane.length+" same-role opponents ranked above "+rankLabel(playerRank)+", you average "+Math.round(Number(higherGold))+"g at 15 and finish ahead on gold in "+Math.round(Number(higherGoldWin||0))+"% of them.","Use these games as the clearest practice set: review the first recall, wave loss and trade timing before 15 rather than treating all opponents as equivalent.",conf(higherLane.length),1,"actual higher-ranked same-role opponents");
    else if(Number(higherGold)>=100)push(highlights,"rank pressure","Your lane fundamentals hold up against higher-ranked peers","Against "+higherLane.length+" same-role opponents ranked above "+rankLabel(playerRank)+", you average "+signedText(higherGold,0)+"g at 15.","The evidence suggests the next improvement is conversion/macro rather than simply surviving stronger lanes.",conf(higherLane.length),4,"actual higher-ranked same-role opponents");
  }
  if(recentTrend.csMin.recentN>=4&&recentTrend.csMin.priorN>=5&&Number.isFinite(Number(recentTrend.csMin.recent))&&Number.isFinite(Number(recentTrend.csMin.prior))){
    const d=Number(recentTrend.csMin.recent)-Number(recentTrend.csMin.prior);
    if(d<=-0.6)push(recentFocus,"recent trend","Recent five games show a farming drop","CS/min is "+Number(recentTrend.csMin.recent).toFixed(2)+" in the latest five versus "+Number(recentTrend.csMin.prior).toFixed(2)+" in the preceding "+recentTrend.csMin.priorN+" games.","Check what changed recently in early deaths, recall timing, roams or mid-game grouping before treating this as a new baseline.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d>=0.6)push(highlights,"recent trend","Recent farming is moving upward","CS/min is "+Number(recentTrend.csMin.recent).toFixed(2)+" in the latest five versus "+Number(recentTrend.csMin.prior).toFixed(2)+" in the preceding "+recentTrend.csMin.priorN+" games.","Identify the wave/recall habits behind the gain and keep them stable.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.goldDiff15.recentN>=4&&recentTrend.goldDiff15.priorN>=5&&Number.isFinite(Number(recentTrend.goldDiff15.recent))&&Number.isFinite(Number(recentTrend.goldDiff15.prior))){
    const d=Number(recentTrend.goldDiff15.recent)-Number(recentTrend.goldDiff15.prior);
    if(d<=-300)push(recentFocus,"recent trend","Your recent lane state has worsened","Gold differential at 15 is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g in the preceding sample.","Review the latest games specifically for first-recall timing, early deaths and waves abandoned for low-value fights.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d>=300)push(highlights,"recent trend","Your recent lane state has improved","Gold differential at 15 is "+signedText(recentTrend.goldDiff15.recent,0)+"g in the latest five versus "+signedText(recentTrend.goldDiff15.prior,0)+"g previously.","Keep the recent early-game habits and focus next on conversion after 15.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.badDeaths.recentN>=4&&recentTrend.badDeaths.priorN>=5&&Number.isFinite(Number(recentTrend.badDeaths.recent))&&Number.isFinite(Number(recentTrend.badDeaths.prior))){
    const d=Number(recentTrend.badDeaths.recent)-Number(recentTrend.badDeaths.prior);
    if(d>=0.6)push(recentFocus,"recent trend","High-risk deaths have increased recently","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Treat the change as a warning signal: reduce deep/isolated entries and spend gold before contest windows.","medium",1,"latest 5 vs preceding Last-20 games");
    else if(d<=-0.6)push(highlights,"recent trend","Your recent death quality is improving","The latest five average "+Number(recentTrend.badDeaths.recent).toFixed(1)+" flagged high-risk deaths versus "+Number(recentTrend.badDeaths.prior).toFixed(1)+" previously.","Preserve the safer positioning while keeping pressure high.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(recentTrend.dpm.recentN>=4&&recentTrend.dpm.priorN>=5&&Number.isFinite(Number(recentTrend.dpm.recent))&&Number.isFinite(Number(recentTrend.dpm.prior))){
    const d=Number(recentTrend.dpm.recent)-Number(recentTrend.dpm.prior);
    if(d<=-120&&["ADC","MID","TOP"].includes(primaryRole))push(recentFocus,"recent trend","Recent damage output has fallen","DPM is "+Math.round(Number(recentTrend.dpm.recent))+" in the latest five versus "+Math.round(Number(recentTrend.dpm.prior))+" previously.","Check whether this follows weaker lane economy, later item completions or deaths before major fights.","medium",2,"latest 5 vs preceding Last-20 games");
    else if(d>=120)push(highlights,"recent trend","Recent damage output is improving","DPM is "+Math.round(Number(recentTrend.dpm.recent))+" in the latest five versus "+Math.round(Number(recentTrend.dpm.prior))+" previously.","Keep the fight-entry and item-timing choices that are increasing uptime.","medium",4,"latest 5 vs preceding Last-20 games");
  }
  if(lifetime&&Number.isFinite(Number(lifetime.csMin))&&Number.isFinite(Number(summary.csMin))){
    const delta=Number(summary.csMin)-Number(lifetime.csMin);
    if(delta<=-0.45)push(recentFocus,"trend","Recent farming has slipped below your broader baseline","Last-20 CS/min is "+Number(summary.csMin).toFixed(2)+" versus "+Number(lifetime.csMin).toFixed(2)+" across the broader cached sample.","Inspect what changed in recalls, roaming or grouping rather than treating the recent value as your normal level.","high",2,"recent 20 vs broader cached self");
    else if(delta>=0.45)push(highlights,"trend","Recent farming is improving","Last-20 CS/min is "+Number(summary.csMin).toFixed(2)+" versus "+Number(lifetime.csMin).toFixed(2)+" across the broader cached sample.","Keep the underlying wave/recall habits that created the gain.","medium",4,"recent 20 vs broader cached self");
  }
  if(greedy>=4)push(recentFocus,"resets","High-gold stays appear repeatedly",greedy+" timeline windows show at least 1200 current gold followed by more than two minutes before the next detected shop visit.","When the map is quiet, cash the spike instead of carrying unspent power through another risky sequence.",conf(validTimeline.length),2,"timeline gold + shop events");
  if(wins.length>=4&&losses.length>=4&&Number.isFinite(Number(winLoss.greedyStays.wins))&&Number.isFinite(Number(winLoss.greedyStays.losses))&&Number(winLoss.greedyStays.losses)-Number(winLoss.greedyStays.wins)>=0.6)push(recentFocus,"resets","Greedy stays rise noticeably in losses","You average "+Number(winLoss.greedyStays.losses).toFixed(1)+" high-gold stay windows in losses versus "+Number(winLoss.greedyStays.wins).toFixed(1)+" in wins.","When behind, do not try to recover the deficit by staying indefinitely for one more wave; buy the power you already earned.",conf(Math.min(wins.length,losses.length)),2,"wins vs losses in your own sample");
  if(topDamage>=Math.max(5,Math.ceil(games.length*0.4)))push(highlights,"team impact","You frequently lead your team in champion damage","You are #1 on your team in champion damage in "+topDamage+"/"+games.length+" games.","Make survival around your damage windows a priority because your team loses substantial output when you die first.",conf(games.length),4,"own-team rank each match");
  recentFocus.sort((a,b)=>a.priority-b.priority);highlights.sort((a,b)=>a.priority-b.priority);coaching.push(...recentFocus,...highlights);
  return{
    recentFocus,highlights,coaching,
    peerComparison:{sameRoleGames:peerGames.length,rankedPeerGames:rankedPeerGames.length,higherRankPeerGames:higherRankGames.length,laneGames15:lane15.length,avgGoldDiff15:avgG15,avgCsDiff15:avgC15,laneAheadPct:laneAhead,gold15OutperformPct:peerGoldWin,avgCsMinDelta:peerCs,csMinOutperformPct:peerCsWin,avgDpmDelta:peerDpm,dpmOutperformPct:peerDpmWin,avgVpmDelta:peerVpm,vpmOutperformPct:peerVpmWin,majorItemGames:itemGames.length,avgMajorItemDeltaMin:itemDelta,majorItemFasterPct:peerItemFaster,higherRankAvgGoldDiff15:higherGold,higherRankGoldOutperformPct:higherGoldWin,higherRankAvgDpmDelta:higherDpm,definition:"Same-role opponent from each analyzed match"},
    conversion:{laneLeadGames:laneLeads.length,laneLeadWinRate:laneLeadWr,laneDeficitGames:laneDeficits.length,laneDeficitWinRate:laneDeficitWr},
    winLoss,recentTrend,
    behaviorSummary:{badDeathsPerTimelineGame:badPer,objectiveDeathPct:objDeathPct,objectiveJoinRate:objJoin,earlyKp,roamAttempts,roamSuccessRate:roamRate,greedyStayWindows:greedy,highUnspentGoldDeaths:unspent}
  };
}
function report(profile:any,rows:any[],catalog:any){
  const ordered=rows||[],games=ordered.slice(0,20).map(r=>game(r,text(profile.puuid),catalog)).filter(Boolean),baselineExtra=ordered.slice(20,100).map(r=>baselineGame(r,text(profile.puuid))).filter(Boolean),allGames=[...games,...baselineExtra],byRole:any={},byChampion:any={};
  for(const g of games){byRole[g.role]=byRole[g.role]||{games:0,wins:0};byRole[g.role].games++;if(g.win)byRole[g.role].wins++;byChampion[g.champion]=byChampion[g.champion]||{games:0,wins:0};byChampion[g.champion].games++;if(g.win)byChampion[g.champion].wins++;}
  let primaryRole="GENERIC",primaryGames=0;for(const[k,v]of Object.entries(byRole)as any){if(Number(v.games)>primaryGames){primaryGames=Number(v.games);primaryRole=k;}}
  const validTimeline=games.filter((g:any)=>g.timelineAvailable).length,coordinateGames=games.filter((g:any)=>(g.deathPositions?.length||0)+(g.wards?.length||0)+(g.objectives?.length||0)>0).length;
  const makeSummary=(sample:any[])=>({games:sample.length,wins:sample.filter((g:any)=>g.win).length,winRate:pct(sample.filter((g:any)=>g.win).length,sample.length),csMin:avg(sample.map((g:any)=>g.csMin)),kp:avg(sample.map((g:any)=>g.kp)),dpm:avg(sample.map((g:any)=>g.dpm)),gpm:avg(sample.map((g:any)=>g.gpm)),vpm:avg(sample.map((g:any)=>g.vpm)),goldDiff10:avg(sample.map((g:any)=>g.goldDiff10)),goldDiff15:avg(sample.map((g:any)=>g.goldDiff15)),csDiff10:avg(sample.map((g:any)=>g.csDiff10)),csDiff15:avg(sample.map((g:any)=>g.csDiff15)),xpDiff10:avg(sample.map((g:any)=>g.xpDiff10)),xpDiff15:avg(sample.map((g:any)=>g.xpDiff15))});
  const summary={...makeSummary(games),primaryRole,primaryRoleGames:primaryGames},lifetime=allGames.length>20?makeSummary(allGames):null,cm=coachingModel(games,summary,lifetime,primaryRole,profile.rank_snapshot||null);
  return{schemaVersion:"league-report-v2",analyzerVersion:"league-web-behavior-v2.3",generatedAt:now(),profile:{id:profile.id,displayName:profile.display_name,gameName:profile.game_name,tagLine:profile.tag_line,platformRegion:profile.platform_region,routingRegion:profile.routing_region,rank:profile.rank_snapshot||null},summary,lifetime,byRole,byChampion,recentFocus:cm.recentFocus,overallHighlights:cm.highlights,coaching:cm.coaching,peerComparison:cm.peerComparison,conversion:cm.conversion,winLoss:cm.winLoss,recentTrend:cm.recentTrend,games,charts:{csMin:games.map((g:any)=>({matchId:g.matchId,value:g.csMin})),kp:games.map((g:any)=>({matchId:g.matchId,value:g.kp})),dpm:games.map((g:any)=>({matchId:g.matchId,value:g.dpm})),goldDiff15:games.map((g:any)=>({matchId:g.matchId,value:g.goldDiff15}))},hiddenCharts:[],benchmarks:{rankAbove:{definition:"Actual higher-ranked same-role opponents encountered",sample:cm.peerComparison.higherRankPeerGames,avgGoldDiff15:cm.peerComparison.higherRankAvgGoldDiff15,goldOutperformPct:cm.peerComparison.higherRankGoldOutperformPct,avgDpmDelta:cm.peerComparison.higherRankAvgDpmDelta},itemSpike:{peerDefinition:"same-role opponent",avgDeltaMin:cm.peerComparison.avgMajorItemDeltaMin,sample:cm.peerComparison.majorItemGames}},aggregateMaps:{wards:games.flatMap((g:any)=>g.wards||[]),deaths:games.flatMap((g:any)=>g.deathPositions||[])},advanced:{dqi:null,agor:null,objectivePresence:cm.behaviorSummary.objectiveJoinRate,earlyKP:cm.behaviorSummary.earlyKp,objectiveDeathPct:cm.behaviorSummary.objectiveDeathPct,roams:{attempts:cm.behaviorSummary.roamAttempts,successRate:cm.behaviorSummary.roamSuccessRate},recalls:{greedyStayWindows:cm.behaviorSummary.greedyStayWindows},itemSpike:{avgDeltaVsOpponentMin:cm.peerComparison.avgMajorItemDeltaMin},wardClassification:true,currentSourcePortRequired:false,judgmentModel:"evidence+peer+self-baseline-v2"},behaviorSummary:cm.behaviorSummary,dataQuality:{cachedGames:allGames.length,analyzedGames:games.length,validTimelineGames:validTimeline,validCoordinateGames:coordinateGames,missingTimelineGames:games.length-validTimeline,baselineGames:lifetime?allGames.length:0,peerComparableGames:cm.peerComparison.sameRoleGames,rankedPeerGames:cm.peerComparison.rankedPeerGames,higherRankPeerGames:cm.peerComparison.higherRankPeerGames},sourceStatus:{currentBruisienatorSourceAvailable:false,historicalAnalyzerRecovered:true,note:"Behavioral analysis ports the historical Bruisienator timeline heuristics where defensible, upgrades weak formulas, and compares the player primarily with actual same-role opponents plus their broader cached baseline. DQI and AGOR remain unavailable because their formulas were not recovered."}};
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
