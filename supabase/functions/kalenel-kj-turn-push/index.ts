// Opt-in, event-driven Klaverjassen Web Push. No polling or scheduled jobs.
// Requests from Postgres are verified against a private 256-bit DB hook secret.
import webpush from 'npm:web-push@3.6.7';

const PROJECT=Deno.env.get('SUPABASE_URL')||'https://uiqntazgnrxwliaidkmy.supabase.co';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'Access-Control-Allow-Origin':'https://kalenel.nl',
 'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type,apikey',
 'Vary':'Origin'};
const headers={'Content-Type':'application/json',apikey:SERVICE_KEY,
 'Authorization':'Bearer '+SERVICE_KEY};
const ok=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function rows(table,query){
 const response=await fetch(PROJECT+'/rest/v1/'+table+'?'+query,{headers});
 if(!response.ok)throw Error('Private database read failed '+response.status);
 return await response.json();
}
async function configure(){
 const existing=(await rows('kalenel_kj_push_config','id=eq.1&select=id,hook_secret,vapid_public,vapid_private'))[0];
 if(!existing)throw Error('Push configuration missing');
 if(existing.vapid_public&&existing.vapid_private)return existing;
 const keys=webpush.generateVAPIDKeys();
 const response=await fetch(PROJECT+'/rest/v1/kalenel_kj_push_config?id=eq.1&vapid_public=is.null',{
   method:'PATCH',headers:{...headers,'Prefer':'return=representation'},
   body:JSON.stringify({vapid_public:keys.publicKey,vapid_private:keys.privateKey})
 });
 if(!response.ok)throw Error('Unable to store VAPID key');
 const current=(await rows('kalenel_kj_push_config','id=eq.1&select=id,hook_secret,vapid_public,vapid_private'))[0];
 if(!current?.vapid_public||!current.vapid_private)throw Error('Missing VAPID key after setup');
 return current;
}
function secretsMatch(a,b){
 if(!a||!b||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
const allowedPush=(endpoint)=>{
 try{
  const u=new URL(endpoint);
  return u.protocol==='https:' && (
   u.hostname==='fcm.googleapis.com' ||
   u.hostname==='updates.push.services.mozilla.com' ||
   u.hostname==='web.push.apple.com' ||
   /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)
  );
 }catch(_){return false;}
};
Deno.serve(async(request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!SERVICE_KEY)return ok({error:'Server push secret unavailable'},503);
 try{
  if(request.method==='GET' && new URL(request.url).pathname.endsWith('/public-key')){
   const c=await configure();
   return ok({publicKey:c.vapid_public});
  }
  if(request.method!=='POST')return ok({error:'Not found'},404);
  const config=await configure();
  if(!secretsMatch(request.headers.get('x-kj-hook-secret')||'',config.hook_secret))
   return ok({error:'Unauthorized'},401);
  const data=await request.json();
  if(!/^[0-9a-f-]{36}$/.test(String(data.room_id||'')) ||
     !Number.isInteger(data.revision)||!Number.isInteger(data.seat)||
     data.seat<0||data.seat>3) return ok({error:'Bad payload'},400);
  const matches=await rows('kalenel_klaverjassen_guest_rooms',
    'id=eq.'+encodeURIComponent(data.room_id)+
    '&select=id,code,room_title,revision,status,state');
  const room=matches[0];
  if(!room||room.status!=='playing'||room.revision!==data.revision)return ok({sent:0,stale:true});
  const state=room.state||{};
  const turn=state.phase==='bidding'?state.bidder_turn:state.turn;
  if(!['bidding','playing'].includes(state.phase)||Number(turn)!==data.seat||
      state.pending_trick || state.players?.[data.seat]?.is_bot)
   return ok({sent:0,stale:true});
  const subs=await rows('kalenel_kj_push_subscriptions',
     'room_id=eq.'+encodeURIComponent(data.room_id)+'&seat=eq.'+data.seat+
     '&select=endpoint,p256dh,auth');
  if(!subs.length)return ok({sent:0});
  webpush.setVapidDetails('https://kalenel.nl',config.vapid_public,config.vapid_private);
  const title='Klaverjassen · jouw beurt';
  const body=(room.room_title||room.code)+' · '+(state.phase==='bidding'?'Tijd om te bieden.':'Speel je kaart.');
  const url='https://kalenel.nl/klaverjassen/room.html?room='+encodeURIComponent(room.code);
  const payload=JSON.stringify({title,body,url,room:room.code,revision:room.revision});
  const results=await Promise.all(subs.map(async sub=>{
    if(!allowedPush(sub.endpoint))return false;
    try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
        payload,{TTL:86400,urgency:'normal'});
      return true;
    }catch(error){
      if([404,410].includes(error?.statusCode)){
       await fetch(PROJECT+'/rest/v1/kalenel_kj_push_subscriptions?room_id=eq.'+
         encodeURIComponent(room.id)+'&endpoint=eq.'+encodeURIComponent(sub.endpoint),{
         method:'DELETE',headers
       });
      }
      console.error('Push provider error',error?.statusCode||String(error).slice(0,120));
      return false;
    }
  }));
  return ok({sent:results.filter(Boolean).length});
 }catch(error){
  console.error('Klaverjassen turn push error',String(error).slice(0,220));
  return ok({error:'Push delivery error'},500);
 }
});