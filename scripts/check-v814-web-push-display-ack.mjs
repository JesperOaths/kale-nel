#!/usr/bin/env node
import fs from 'node:fs';
const fail=(message)=>{throw new Error('V814_WEB_PUSH_DISPLAY_ACK_FAIL '+message);};
const read=(path)=>{if(!fs.existsSync(path)) fail('missing '+path); return fs.readFileSync(path,'utf8');};
const norm=(s)=>s.toLowerCase().replace(/\s+/g,' ').trim();
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
const providerRecord=dispatcher.indexOf('await recordProviderAccepted(item',send);
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
if(/grant execute on function public\.ack_web_push_display_v814\([^)]*\) to [^;]*authenticated/.test(h)) fail('authenticated ACK execute was reintroduced');
if(!norm(initial).includes('create or replace function public.ack_web_push_display_v814(')) fail('initial migration provenance missing');
if(provenance.release!=='v814'||provenance.status!=='PASS') fail('provenance release/status mismatch');
const expected=[['20260830122459','web_push_display_ack_v814'],['20260830130604','web_push_display_ack_v814_hardening']];
for(const [version,name] of expected){const row=provenance.migrations?.find((m)=>m.version===version);if(!row||row.name!==name) fail('provenance migration mismatch '+version);}
if(provenance.security?.claim_token_bound!==true||provenance.security?.raw_display_capability_persisted_in_notification_data!==false) fail('provenance security contract mismatch');
if(!verify.includes('node scripts/check-v814-web-push-display-ack.mjs')) fail('permanent verify workflow guard missing');
for(const temp of ['.github/workflows/v814-web-push-display-ack-builder.yml','scripts/apply-v814-web-push-display-ack.mjs']) if(fs.existsSync(temp)) fail('temporary builder artifact remains '+temp);
console.log('RESULT=V814_WEB_PUSH_DISPLAY_ACK_PASS');
