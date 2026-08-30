#!/usr/bin/env node
import fs from 'node:fs';

function read(path){ return fs.readFileSync(path,'utf8'); }
function write(path,text){ fs.writeFileSync(path,text,'utf8'); }
function mustReplace(text,before,after,label){
  if(text.includes(after)) return text;
  if(!text.includes(before)) throw new Error(`V814_PATCH_MARKER_MISSING ${label}`);
  return text.replace(before,after);
}

const versionPath='VERSION';
if(read(versionPath).trim()!=='v814') write(versionPath,'v814\n');

const dispatcherPath='web_push_dispatcher.js';
let dispatcher=read(dispatcherPath);
dispatcher=mustReplace(
  dispatcher,
  "#!/usr/bin/env node\nfunction loadWebPush() {",
  "#!/usr/bin/env node\nconst { randomBytes, createHash } = require('node:crypto');\n\nfunction loadWebPush() {",
  'dispatcher crypto import'
);
dispatcher=mustReplace(
  dispatcher,
  "\nfunction classifyFailure(err) {",
  "\nfunction makeDisplayAckCapability() {\n  const token = randomBytes(32).toString('base64url');\n  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };\n}\n\nfunction classifyFailure(err) {",
  'dispatcher capability helper'
);
dispatcher=mustReplace(
  dispatcher,
  "  if (/mint/i.test(msg)) return { stage: 'mint', code: 'mint_failed', text: msg, disableSubscription: false };\n  return { stage: 'send', code: 'transient_send_failure', text: msg, disableSubscription: false };",
  "  if (/mint/i.test(msg)) return { stage: 'mint', code: 'mint_failed', text: msg, disableSubscription: false };\n  if (/display[_ -]?ack|DISPLAY_ACK/i.test(msg)) return { stage: 'display_ack_prepare', code: 'display_ack_prepare_failed', text: msg, disableSubscription: false };\n  return { stage: 'send', code: 'transient_send_failure', text: msg, disableSubscription: false };",
  'dispatcher failure classification'
);
dispatcher=mustReplace(
  dispatcher,
  "  async function ensureActionTokens(item) {",
  "  async function prepareDisplayAck(item) {\n    if (!item) return item;\n    const jobId = val(item, 'job_id', 'id');\n    const claimToken = val(item, 'claim_token');\n    const subscriptionId = val(item, 'target_subscription_id');\n    const workerId = val(item, 'claimed_by', 'worker_id') || options.workerId;\n    if (!jobId || !claimToken || !subscriptionId || !workerId) throw new Error('DISPLAY_ACK_CONTEXT_MISSING');\n    const capability = makeDisplayAckCapability();\n    await rpc('prepare_web_push_display_ack_v814', {\n      job_id_input: Number(jobId),\n      claim_token_input: claimToken,\n      worker_id_input: workerId,\n      token_hash_input: capability.hash,\n      expires_in_seconds_input: 86400,\n    });\n    return Object.assign({}, item, {\n      displayAckToken: capability.token,\n      display_ack_token: capability.token,\n      displayAckSubscriptionId: Number(subscriptionId),\n      display_ack_subscription_id: Number(subscriptionId),\n    });\n  }\n\n  async function ensureActionTokens(item) {",
  'dispatcher prepare display ACK'
);
dispatcher=mustReplace(
  dispatcher,
  "    const wantsActions = !!(verifyToken || rejectToken);\n    return {",
  "    const wantsActions = !!(verifyToken || rejectToken);\n    const displayAckToken = val(item, 'displayAckToken', 'display_ack_token');\n    const displayAckSubscriptionId = val(item, 'displayAckSubscriptionId', 'display_ack_subscription_id', 'target_subscription_id');\n    return {",
  'dispatcher payload locals'
);
dispatcher=mustReplace(
  dispatcher,
  "      jobId: val(item, 'job_id', 'id'),\n      job_id: val(item, 'job_id', 'id'),\n      kind:",
  "      jobId: val(item, 'job_id', 'id'),\n      job_id: val(item, 'job_id', 'id'),\n      subscriptionId: displayAckSubscriptionId,\n      subscription_id: displayAckSubscriptionId,\n      displayAckToken,\n      display_ack_token: displayAckToken,\n      kind:",
  'dispatcher payload ACK fields'
);
dispatcher=mustReplace(
  dispatcher,
  "        item = await ensureActionTokens(item);\n        const payload = buildPayload(item);",
  "        item = await ensureActionTokens(item);\n        if (!options.dryRun) item = await prepareDisplayAck(item);\n        const payload = buildPayload(item);",
  'dispatcher prepare before payload'
);
dispatcher=mustReplace(
  dispatcher,
  "module.exports = { buildOptions, createDispatcher, classifyFailure, sanitizeLogText, parsePositiveInt, envFlag };",
  "module.exports = { buildOptions, createDispatcher, classifyFailure, sanitizeLogText, parsePositiveInt, envFlag, makeDisplayAckCapability };",
  'dispatcher export capability helper'
);
write(dispatcherPath,dispatcher);

const swPath='gejast-sw.js';
let sw=read(swPath);
sw=mustReplace(
  sw,
  "jobId:coalesce(data.jobId,data.job_id), traceId:",
  "jobId:coalesce(data.jobId,data.job_id), subscriptionId:coalesce(data.subscriptionId,data.subscription_id,data.targetSubscriptionId,data.target_subscription_id), displayAckToken:coalesce(data.displayAckToken,data.display_ack_token), traceId:",
  'service worker pick ACK fields'
);
sw=mustReplace(
  sw,
  "function withStatusUrl(target,params={}){",
  "async function ackDisplay(data){ const jobId=Number(data&&data.jobId); const subscriptionId=Number(data&&data.subscriptionId); const token=String(data&&data.displayAckToken||'').trim(); if(!Number.isSafeInteger(jobId)||jobId<=0||!Number.isSafeInteger(subscriptionId)||subscriptionId<=0||!token) return {ok:false,reason:'missing-capability'}; let lastReason='ack-failed'; for(let attempt=0;attempt<2;attempt+=1){ try{ const res=await fetch(`${GEJAST_SUPABASE_URL}/rest/v1/rpc/ack_web_push_display_v814`,{method:'POST',headers:{'Content-Type':'application/json',apikey:GEJAST_SUPABASE_KEY,Authorization:`Bearer ${GEJAST_SUPABASE_KEY}`,Accept:'application/json'},body:JSON.stringify({job_id_input:jobId,subscription_id_input:subscriptionId,display_token_input:token})}); const txt=await res.text(); let payload=null; try{payload=txt?JSON.parse(txt):null;}catch(_){payload=null;} if(res.ok&&payload&&payload.ok) return payload; lastReason=payload&&payload.reason||`HTTP ${res.status}`; if(res.status>=400&&res.status<500) return {ok:false,reason:lastReason}; }catch(err){ lastReason=err&&err.message||'ack-network-failed'; } if(attempt===0) await new Promise((resolve)=>setTimeout(resolve,250)); } return {ok:false,reason:lastReason}; }\r\nfunction withStatusUrl(target,params={}){",
  'service worker ACK RPC'
);
const oldShow="event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,icon:'./logo-small.png',badge:'./logo-small.png',renotify:true,requireInteraction:data.requireInteraction||wantsActions,silent:false,timestamp:Date.now(),vibrate:data.vibrate,actions,data}));";
const newShow="event.waitUntil((async()=>{ await self.registration.showNotification(data.title,{body:data.body,tag:data.tag,icon:'./logo-small.png',badge:'./logo-small.png',renotify:true,requireInteraction:data.requireInteraction||wantsActions,silent:false,timestamp:Date.now(),vibrate:data.vibrate,actions,data}); await ackDisplay(data); })());";
sw=mustReplace(sw,oldShow,newShow,'service worker ACK after showNotification');
write(swPath,sw);

console.log('RESULT=V814_WEB_PUSH_DISPLAY_ACK_PATCH_APPLIED');
