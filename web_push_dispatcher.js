#!/usr/bin/env node
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vapidPublic = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@example.com';
const maxJobs = Number(process.env.WEB_PUSH_MAX_JOBS || 25);
if (!url || !key || !vapidPublic || !vapidPrivate) { console.error('Missing env vars for web push dispatcher'); process.exit(1); }
webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
const supabase = createClient(url, key, { auth: { persistSession: false } });
async function rpc(name,args){ const {data,error}=await supabase.rpc(name,args||{}); if(error) throw error; return data; }
async function requeueStaleClaims(){ try{ await rpc('requeue_stale_web_push_claims_v3',{stale_minutes_input:5}); }catch(_){} }
async function claimCoreJobs(){ const data=await rpc('claim_web_push_jobs_v3',{max_jobs_input:maxJobs}); return Array.isArray(data?.items)?data.items:(Array.isArray(data)?data:[]); }
async function markSent(item,providerMessageId=null){ return rpc('mark_web_push_job_sent_v3',{job_id_input:item.job_id||item.id,provider_message_id_input:providerMessageId}); }
async function markFailed(item,stage,code,errorText){ return rpc('mark_web_push_job_failed_v3',{job_id_input:item.job_id||item.id,error_stage_input:stage,error_code_input:code,error_text_input:String(errorText||'').slice(0,2000)}); }
function val(item){ for(let i=1;i<arguments.length;i++){const k=arguments[i]; if(item&&item[k]!==undefined&&item[k]!==null&&item[k]!=='') return item[k];} return null; }
async function ensureActionTokens(item){
  if(!item) return item;
  const hasVerify=val(item,'verifyActionToken','verify_action_token'), hasReject=val(item,'rejectActionToken','reject_action_token');
  if(hasVerify||hasReject) return item;
  const requestKind=val(item,'requestKind','request_kind'), requestId=val(item,'requestId','request_id'), kind=val(item,'kind','trigger_kind');
  if(!requestKind||!requestId||!(kind==='nearby_verification'||val(item,'trigger_kind')==='nearby_verification')) return item;
  const minted=await rpc('mint_web_push_action_tokens_v3',{request_kind_input:requestKind,request_id_input:Number(requestId),target_player_id_input:val(item,'target_player_id','player_id')||null,trace_id_input:val(item,'traceId','trace_id')||null,scope_input:val(item,'site_scope')||null,job_id_input:val(item,'job_id','id')||null,expires_in_seconds_input:900});
  return Object.assign({},item,{verifyActionToken:minted?.verify_action_token||null,rejectActionToken:minted?.reject_action_token||null,verify_action_token:minted?.verify_action_token||null,reject_action_token:minted?.reject_action_token||null,expiresAt:minted?.expires_at||null,expires_at:minted?.expires_at||null});
}
function classifyFailure(err){ const status=err&&(err.statusCode||err.status); const msg=String((err&&(err.body||err.message))||err||'unknown_error'); if(status===404||status===410||/404|410|gone|notregistered/i.test(msg)) return {stage:'send',code:'endpoint_gone',text:msg}; if(/payload_invalid|malformed/i.test(msg)) return {stage:'payload',code:'payload_invalid',text:msg}; if(/auth|p256dh|decrypt/i.test(msg)) return {stage:'send',code:'subscription_auth_invalid',text:msg}; if(/mint/i.test(msg)) return {stage:'mint',code:'mint_failed',text:msg}; return {stage:'send',code:'transient_send_failure',text:msg}; }
async function run(){
  await requeueStaleClaims();
  const items=await claimCoreJobs();
  if(!items.length){ console.log('no-web-push-jobs',JSON.stringify({at:new Date().toISOString()})); return; }
  let sentCount=0, failedCount=0;
  for(let item of items){
    try{
      item=await ensureActionTokens(item);
      const verifyToken=val(item,'verifyActionToken','verify_action_token'), rejectToken=val(item,'rejectActionToken','reject_action_token');
      const wantsActions=!!(verifyToken||rejectToken);
      const payload={title:val(item,'title','notification_title')||'Gejast',body:val(item,'body','message')||'Er staat iets voor je klaar.',url:val(item,'target_url','url')||'./drinks_pending.html',tag:val(item,'notification_tag','tag')||`job-${val(item,'job_id','id')}`,traceId:val(item,'traceId','trace_id'),trace_id:val(item,'traceId','trace_id'),jobId:val(item,'job_id','id'),job_id:val(item,'job_id','id'),kind:val(item,'kind','trigger_kind')||'push',requestKind:val(item,'requestKind','request_kind'),request_kind:val(item,'requestKind','request_kind'),requestId:val(item,'requestId','request_id'),request_id:val(item,'requestId','request_id'),requireInteraction:!!(val(item,'require_interaction')||wantsActions),verifyActionToken:verifyToken,verify_action_token:verifyToken,rejectActionToken:rejectToken,reject_action_token:rejectToken,expiresAt:val(item,'expiresAt','expires_at'),expires_at:val(item,'expiresAt','expires_at'),actions:wantsActions?[{action:'open',title:'Openen'},{action:'verify',title:'Bevestigen'},{action:'reject',title:'Afkeuren'}]:[{action:'open',title:'Openen'}]};
      const endpoint=val(item,'endpoint'), p256dh=val(item,'p256dh_key','p256dh'), auth=val(item,'auth_key','auth');
      if(!payload.title||!payload.body||!endpoint||!p256dh||!auth) throw new Error('payload_invalid');
      const response=await webpush.sendNotification({endpoint,keys:{p256dh,auth}},JSON.stringify(payload));
      await markSent(item,response&&response.headers&&response.headers.location||null);
      sentCount+=1; console.log('sent',val(item,'job_id','id'),payload.requestKind||payload.kind||'generic');
    }catch(err){ const meta=classifyFailure(err); try{await markFailed(item,meta.stage,meta.code,meta.text);}catch(markErr){console.error('mark-failed-error',val(item,'job_id','id'),markErr&&markErr.message||markErr);} failedCount+=1; console.error('failed',val(item,'job_id','id'),meta.code,meta.text); }
  }
  console.log('web-push-run-complete',JSON.stringify({total:items.length,sent:sentCount,failed:failedCount,at:new Date().toISOString()}));
}
run().catch((err)=>{ console.error(err); process.exit(1); });
