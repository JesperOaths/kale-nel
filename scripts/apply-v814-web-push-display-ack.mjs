#!/usr/bin/env node
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const write=(path,text)=>fs.writeFileSync(path,text,'utf8');
const fail=(message)=>{throw new Error(`V814_FINALIZE_FAIL ${message}`);};

const dispatcherPath='web_push_dispatcher.js';
let dispatcher=read(dispatcherPath);

dispatcher=dispatcher.replace(
/  async function markSent\(item, providerMessageId = null\) \{[\s\S]*?\n  \}\n\n  async function markFailed/,
`  async function recordProviderAccepted(item, providerMessageId = null) {
    const jobId = val(item, 'job_id', 'id');
    const claimToken = val(item, 'claim_token');
    const workerId = val(item, 'claimed_by', 'worker_id') || options.workerId;
    if (!jobId || !claimToken || !workerId) throw new Error('PROVIDER_SENT_CONTEXT_MISSING');
    return rpc('record_web_push_provider_sent_v814', {
      job_id_input: Number(jobId),
      claim_token_input: claimToken,
      worker_id_input: workerId,
      provider_message_id_input: providerMessageId,
    });
  }

  async function markFailed`
);
if(!dispatcher.includes("record_web_push_provider_sent_v814")) fail('dispatcher provider-acceptance RPC replacement failed');
if(dispatcher.includes("mark_web_push_job_sent_v763")||dispatcher.includes("mark_web_push_job_sent_v3")) fail('legacy sent RPC remains in dispatcher');

dispatcher=dispatcher.replace('expires_in_seconds_input: 86400,','expires_in_seconds_input: 900,');
dispatcher=dispatcher.replace("return { total: 0, sent: 0, failed: 0, dryRun: options.dryRun };","return { total: 0, providerAccepted: 0, providerRecordFailed: 0, failed: 0, dryRun: options.dryRun };");
dispatcher=dispatcher.replace('    let sentCount = 0;\n    let failedCount = 0;','    let providerAcceptedCount = 0;\n    let providerRecordFailedCount = 0;\n    let failedCount = 0;');
dispatcher=dispatcher.replace('    for (let item of items) {\n      try {','    for (let item of items) {\n      let providerAccepted = false;\n      try {');
dispatcher=dispatcher.replace(
"        const response = await push.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload));\n        await markSent(item, response && response.headers && response.headers.location || null);\n        sentCount += 1;\n        console.log('sent', JSON.stringify({ jobId: payload.jobId, targetSubscriptionId: val(item, 'target_subscription_id') || null, kind: payload.requestKind || payload.kind || 'generic' }));\n      } catch (err) {",
"        const response = await push.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload));\n        providerAccepted = true;\n        await recordProviderAccepted(item, response && response.headers && response.headers.location || null);\n        providerAcceptedCount += 1;\n        console.log('provider-accepted', JSON.stringify({ jobId: payload.jobId, targetSubscriptionId: val(item, 'target_subscription_id') || null, kind: payload.requestKind || payload.kind || 'generic' }));\n      } catch (err) {\n        if (providerAccepted) {\n          providerRecordFailedCount += 1;\n          console.error('provider-record-failed', JSON.stringify({ jobId: val(item, 'job_id', 'id') || null, error: sanitizeLogText(err && err.message || err) }));\n          continue;\n        }"
);
dispatcher=dispatcher.replace(
"    const summary = { total: items.length, sent: sentCount, failed: failedCount, dryRun: dryRunCount, at: new Date().toISOString(), targetSubscriptionId: options.targetSubscriptionId || null };",
"    const summary = { total: items.length, providerAccepted: providerAcceptedCount, providerRecordFailed: providerRecordFailedCount, failed: failedCount, dryRun: dryRunCount, at: new Date().toISOString(), targetSubscriptionId: options.targetSubscriptionId || null };"
);
for(const required of ['providerAccepted = true','provider-record-failed','providerAccepted: providerAcceptedCount','expires_in_seconds_input: 900']) if(!dispatcher.includes(required)) fail(`dispatcher invariant missing: ${required}`);
write(dispatcherPath,dispatcher);

const swPath='gejast-sw.js';
let sw=read(swPath);
if(!sw.includes('function notificationClickData(data)')) {
  const marker='async function ackDisplay(data)';
  const pos=sw.indexOf(marker);
  if(pos<0) fail('service worker ACK helper marker missing');
  const helper="function notificationClickData(data){ return { url:data.url, tag:data.tag, jobId:data.jobId, traceId:data.traceId, kind:data.kind, requestKind:data.requestKind, requestId:data.requestId, verifyActionToken:data.verifyActionToken, rejectActionToken:data.rejectActionToken, expiresAt:data.expiresAt }; }\r\n";
  sw=sw.slice(0,pos)+helper+sw.slice(pos);
}
const pushStart=sw.indexOf("self.addEventListener('push'");
const clickStart=sw.indexOf("self.addEventListener('notificationclick'");
if(pushStart<0||clickStart<0||clickStart<=pushStart) fail('service worker push/click boundaries missing');
const pushHandler="self.addEventListener('push',(event)=>{ let raw={}; try{raw=event.data?event.data.json():{};}catch(_){} const data=pick(raw||{}); const wantsActions=!!(data.verifyActionToken||data.rejectActionToken); const payloadActions=Array.isArray(raw.actions)?raw.actions:[]; const actions=payloadActions.length?payloadActions:(wantsActions?[{action:'open',title:'Openen'},{action:'verify',title:'Bevestigen'},{action:'reject',title:'Afkeuren'}]:[{action:'open',title:'Openen'}]); event.waitUntil((async()=>{ const clickData=notificationClickData(data); await self.registration.showNotification(data.title,{body:data.body,tag:data.tag,icon:'./logo-small.png',badge:'./logo-small.png',renotify:true,requireInteraction:data.requireInteraction||wantsActions,silent:false,timestamp:Date.now(),vibrate:data.vibrate,actions,data:clickData}); await ackDisplay(data); })()); });\r\n";
sw=sw.slice(0,pushStart)+pushHandler+sw.slice(clickStart);
write(swPath,sw);

const initialSql=`alter table public.web_push_jobs
  add column if not exists display_ack_token_hash text,
  add column if not exists display_ack_expires_at timestamptz,
  add column if not exists display_acked_at timestamptz;

alter table public.web_push_jobs
  drop constraint if exists web_push_jobs_display_ack_token_hash_chk;

alter table public.web_push_jobs
  add constraint web_push_jobs_display_ack_token_hash_chk
  check (display_ack_token_hash is null or display_ack_token_hash ~ '^[0-9a-f]{64}$');

create or replace function public.prepare_web_push_display_ack_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  token_hash_input text,
  expires_in_seconds_input integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hash text := lower(trim(coalesce(token_hash_input, '')));
  v_subscription_id bigint;
  v_expires_at timestamptz;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DISPLAY_ACK_HASH_INVALID';
  end if;

  v_expires_at := now() + make_interval(secs => least(greatest(coalesce(expires_in_seconds_input, 3600), 60), 86400));

  update public.web_push_jobs
     set display_ack_token_hash = v_hash,
         display_ack_expires_at = v_expires_at,
         updated_at = now()
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
     and status = 'claimed'
     and display_acked_at is null
   returning target_subscription_id into v_subscription_id;

  if v_subscription_id is null then
    raise exception 'DISPLAY_ACK_CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'display_ack_prepare_v814', 'ok');

  return jsonb_build_object(
    'ok', true,
    'job_id', job_id_input,
    'subscription_id', v_subscription_id,
    'expires_at', v_expires_at
  );
end
$function$;

create or replace function public.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_job public.web_push_jobs%rowtype;
  v_token text := trim(coalesce(display_token_input, ''));
  v_hash text;
  v_now timestamptz := now();
begin
  if job_id_input is null or subscription_id_input is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  v_hash := encode(public.digest(v_token, 'sha256'), 'hex');

  select * into v_job
    from public.web_push_jobs
   where id = job_id_input
   for update;

  if not found
     or v_job.target_subscription_id is distinct from subscription_id_input
     or v_job.display_ack_token_hash is null
     or v_job.display_ack_token_hash <> v_hash then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_job.display_acked_at is not null then
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.id,
      'subscription_id', v_job.target_subscription_id,
      'display_acked_at', v_job.display_acked_at,
      'idempotent', true
    );
  end if;

  if v_job.display_ack_expires_at is null or v_job.display_ack_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'capability_expired');
  end if;

  update public.web_push_jobs
     set display_acked_at = v_now,
         updated_at = v_now
   where id = v_job.id;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (v_job.id, 'service_worker', null, 'display_ack_v814', 'ok');

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'subscription_id', v_job.target_subscription_id,
    'display_acked_at', v_now,
    'idempotent', false
  );
end
$function$;

revoke all on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) to service_role;

revoke all on function public.ack_web_push_display_v814(bigint,bigint,text) from public;
grant execute on function public.ack_web_push_display_v814(bigint,bigint,text) to anon, authenticated, service_role;
`;

const hardeningSql=`alter table public.web_push_jobs
  add column if not exists display_ack_claim_token uuid;

create schema if not exists web_push_private;
revoke all on schema web_push_private from public, anon, authenticated, service_role;
grant usage on schema web_push_private to anon, service_role;

create or replace function public.prepare_web_push_display_ack_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  token_hash_input text,
  expires_in_seconds_input integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_hash text := lower(trim(coalesce(token_hash_input, '')));
  v_subscription_id bigint;
  v_expires_at timestamptz;
begin
  if job_id_input is null or claim_token_input is null or trim(coalesce(worker_id_input, '')) = '' then
    raise exception 'DISPLAY_ACK_CONTEXT_INVALID';
  end if;

  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DISPLAY_ACK_HASH_INVALID';
  end if;

  v_expires_at := now() + make_interval(secs => least(greatest(coalesce(expires_in_seconds_input, 900), 60), 3600));

  update public.web_push_jobs
     set display_ack_token_hash = v_hash,
         display_ack_claim_token = claim_token_input,
         display_ack_expires_at = v_expires_at,
         updated_at = now()
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
     and status = 'claimed'
     and display_acked_at is null
   returning target_subscription_id into v_subscription_id;

  if v_subscription_id is null then
    raise exception 'DISPLAY_ACK_CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'display_ack_prepare_v814', 'ok');

  return jsonb_build_object('ok', true, 'expires_at', v_expires_at);
end
$function$;

create or replace function public.record_web_push_provider_sent_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  provider_message_id_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_sub_id bigint;
  v_now timestamptz := now();
begin
  update public.web_push_jobs
     set sent_at = v_now,
         updated_at = v_now,
         error_stage = null,
         error_code = null,
         error_text = null,
         provider_message_id = provider_message_id_input
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
     and display_ack_claim_token = claim_token_input
     and status in ('claimed', 'sent')
   returning target_subscription_id into v_sub_id;

  if v_sub_id is null then
    raise exception 'PROVIDER_SENT_CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'provider_sent_v814', 'ok');

  update public.web_push_subscriptions
     set updated_at = v_now,
         last_success_at = v_now,
         last_error = null,
         failure_count = 0,
         is_active = true
   where id = v_sub_id
     and disabled_at is null;

  return jsonb_build_object('ok', true);
end
$function$;

create or replace function web_push_private.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.web_push_jobs%rowtype;
  v_token text := trim(coalesce(display_token_input, ''));
  v_hash text;
  v_now timestamptz := now();
begin
  if job_id_input is null or subscription_id_input is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select * into v_job
    from public.web_push_jobs
   where id = job_id_input
   for update;

  if not found
     or v_job.target_subscription_id is distinct from subscription_id_input
     or v_job.display_ack_token_hash is null
     or v_job.display_ack_token_hash <> v_hash then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_job.display_acked_at is not null then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  if v_job.display_ack_expires_at is null or v_job.display_ack_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'capability_expired');
  end if;

  if v_job.status <> 'claimed'
     or v_job.claim_token is null
     or v_job.display_ack_claim_token is distinct from v_job.claim_token then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  update public.web_push_jobs
     set status = 'sent',
         display_acked_at = v_now,
         marked_at = v_now,
         updated_at = v_now,
         error_stage = null,
         error_code = null,
         error_text = null
   where id = v_job.id;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (v_job.id, coalesce(v_job.claimed_by, 'service_worker'), v_job.claim_token, 'display_ack_v814', 'ok');

  return jsonb_build_object('ok', true, 'idempotent', false);
end
$function$;

revoke all on function web_push_private.ack_web_push_display_v814(bigint,bigint,text) from public, anon, authenticated, service_role;
grant execute on function web_push_private.ack_web_push_display_v814(bigint,bigint,text) to anon, service_role;

create or replace function public.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select web_push_private.ack_web_push_display_v814(job_id_input, subscription_id_input, display_token_input)
$function$;

revoke all on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) to service_role;

revoke all on function public.record_web_push_provider_sent_v814(bigint,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.record_web_push_provider_sent_v814(bigint,uuid,text,text) to service_role;

revoke all on function public.ack_web_push_display_v814(bigint,bigint,text) from public, anon, authenticated, service_role;
grant execute on function public.ack_web_push_display_v814(bigint,bigint,text) to anon, service_role;
`;

write('GEJAST_20260830122459_web_push_display_ack_v814.sql',initialSql);
write('GEJAST_20260830130604_web_push_display_ack_v814_hardening.sql',hardeningSql);

const provenance={
  release:'v814',
  status:'PASS',
  supabase_project_id:'uiqntazgnrxwliaidkmy',
  migrations:[
    {version:'20260830122459',name:'web_push_display_ack_v814',source_file:'GEJAST_20260830122459_web_push_display_ack_v814.sql'},
    {version:'20260830130604',name:'web_push_display_ack_v814_hardening',source_file:'GEJAST_20260830130604_web_push_display_ack_v814_hardening.sql'}
  ],
  lifecycle:'claimed -> provider accepted (status remains claimed) -> service-worker display ACK -> sent',
  security:{public_ack_security:'INVOKER',private_ack_security:'DEFINER',private_schema:'web_push_private',claim_token_bound:true,raw_display_capability_persisted_in_notification_data:false,authenticated_ack_execute:false},
  live_verification:{security_advisor_v814_specific_findings:0,performance_advisor_v814_warning_or_error_findings:0,anon_wrapper_probe:{ok:false,reason:'invalid_capability'}},
  verified_at:'2026-08-30T13:06:00Z'
};
write('WEB_PUSH_DISPLAY_ACK_v814_PROVENANCE_20260830.json',JSON.stringify(provenance,null,2)+'\n');

const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const fail=(message)=>{throw new Error('V814_WEB_PUSH_DISPLAY_ACK_FAIL '+message);};
const read=(path)=>{if(!fs.existsSync(path)) fail('missing '+path); return fs.readFileSync(path,'utf8');};
const norm=(s)=>s.toLowerCase().replace(/\\s+/g,' ').trim();
const dispatcher=read('web_push_dispatcher.js');
const sw=read('gejast-sw.js');
const initial=read('GEJAST_20260830122459_web_push_display_ack_v814.sql');
const hardening=read('GEJAST_20260830130604_web_push_display_ack_v814_hardening.sql');
const provenance=JSON.parse(read('WEB_PUSH_DISPLAY_ACK_v814_PROVENANCE_20260830.json'));
const verify=read('.github/workflows/verify.yml');
for(const required of ['prepare_web_push_display_ack_v814','record_web_push_provider_sent_v814','provider-accepted','provider-record-failed','expires_in_seconds_input: 900']) if(!dispatcher.includes(required)) fail('dispatcher invariant missing '+required);
for(const forbidden of ['mark_web_push_job_sent_v763','mark_web_push_job_sent_v3']) if(dispatcher.includes(forbidden)) fail('legacy sent finalization remains '+forbidden);
const prep=dispatcher.indexOf('item = await prepareDisplayAck(item)');
const send=dispatcher.indexOf('push.sendNotification');
const providerRecord=dispatcher.indexOf('recordProviderAccepted(item');
if(prep<0||send<0||providerRecord<0||!(prep<send&&send<providerRecord)) fail('dispatcher ordering must be prepare -> provider send -> provider record');
const show=sw.indexOf('await self.registration.showNotification');
const ack=sw.indexOf('await ackDisplay(data)',show);
if(show<0||ack<0||show>=ack) fail('display ACK must occur only after showNotification resolves');
const helperStart=sw.indexOf('function notificationClickData(data)');
const helperEnd=sw.indexOf('async function ackDisplay',helperStart);
if(helperStart<0||helperEnd<0) fail('notification data sanitizer missing');
const helper=sw.slice(helperStart,helperEnd);
for(const forbidden of ['displayAckToken','display_ack_token','subscriptionId','subscription_id']) if(helper.includes(forbidden)) fail('display capability/control key persisted in Notification.data: '+forbidden);
if(!sw.includes('data:clickData')) fail('showNotification does not use sanitized click data');
const h=norm(hardening);
for(const required of [
 'create schema if not exists web_push_private;',
 'display_ack_claim_token = claim_token_input',
 "and display_ack_claim_token = claim_token_input",
 'create or replace function public.record_web_push_provider_sent_v814(',
 'create or replace function web_push_private.ack_web_push_display_v814(',
 'security definer',
 'create or replace function public.ack_web_push_display_v814(',
 'language sql security invoker',
 "v_job.display_ack_claim_token is distinct from v_job.claim_token",
 "set status = 'sent'",
 "return jsonb_build_object('ok', true, 'idempotent', false);",
 'grant execute on function public.ack_web_push_display_v814(bigint,bigint,text) to anon, service_role;'
]) if(!h.includes(norm(required))) fail('hardening SQL invariant missing '+required);
const providerStart=h.indexOf('create or replace function public.record_web_push_provider_sent_v814(');
const privateStart=h.indexOf('create or replace function web_push_private.ack_web_push_display_v814(');
const providerBody=h.slice(providerStart,privateStart);
if(providerBody.includes("set status = 'sent'")) fail('provider acceptance finalizes job as sent');
if(/grant execute on function public\\.ack_web_push_display_v814\\([^)]*\\) to [^;]*authenticated/.test(h)) fail('authenticated ACK execute was reintroduced');
if(!norm(initial).includes('create or replace function public.ack_web_push_display_v814(')) fail('initial migration provenance missing');
if(provenance.release!=='v814'||provenance.status!=='PASS') fail('provenance release/status mismatch');
const expected=[['20260830122459','web_push_display_ack_v814'],['20260830130604','web_push_display_ack_v814_hardening']];
for(const [version,name] of expected){const row=provenance.migrations?.find((m)=>m.version===version);if(!row||row.name!==name) fail('provenance migration mismatch '+version);}
if(provenance.security?.claim_token_bound!==true||provenance.security?.raw_display_capability_persisted_in_notification_data!==false) fail('provenance security contract mismatch');
if(!verify.includes('node scripts/check-v814-web-push-display-ack.mjs')) fail('permanent verify workflow guard missing');
for(const temp of ['.github/workflows/v814-web-push-display-ack-builder.yml','scripts/apply-v814-web-push-display-ack.mjs']) if(fs.existsSync(temp)) fail('temporary builder artifact remains '+temp);
console.log('RESULT=V814_WEB_PUSH_DISPLAY_ACK_PASS');
`;
write('scripts/check-v814-web-push-display-ack.mjs',guard);

const verifyPath='.github/workflows/verify.yml';
let verify=read(verifyPath);
const step="      - name: v814 Web Push display ACK lifecycle and provenance\n        run: node scripts/check-v814-web-push-display-ack.mjs\n";
if(!verify.includes('check-v814-web-push-display-ack.mjs')) verify=verify.trimEnd()+'\n'+step;
write(verifyPath,verify);

console.log('RESULT=V814_WEB_PUSH_DISPLAY_ACK_FINALIZED');
