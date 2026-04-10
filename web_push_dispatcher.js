#!/usr/bin/env node
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vapidPublic = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@example.com';
if (!url || !key || !vapidPublic || !vapidPrivate) {
  console.error('Missing env vars for web push dispatcher');
  process.exit(1);
}
webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function rpc(name, args){
  const { data, error } = await supabase.rpc(name, args || {});
  if (error) throw error;
  return data;
}
async function requeueStaleClaims(){ try { await rpc('requeue_stale_web_push_claims_v3', { stale_minutes_input: 5 }); } catch (_) {} }
async function claimCoreJobs(){ const data = await rpc('claim_web_push_jobs_v3', { max_jobs_input: 25 }); return Array.isArray(data?.items) ? data.items : []; }
async function markSent(item, providerMessageId=null){ return rpc('mark_web_push_job_sent_v3', { job_id_input: item.job_id, provider_message_id_input: providerMessageId }); }
async function markFailed(item, stage, code, errorText){ return rpc('mark_web_push_job_failed_v3', { job_id_input: item.job_id, error_stage_input: stage, error_code_input: code, error_text_input: errorText }); }
async function ensureActionTokens(item){
  if (!item) return item;
  if (item.verifyActionToken || item.rejectActionToken) return item;
  if (!item.requestKind || !item.requestId || !(item.kind === 'nearby_verification' || item.trigger_kind === 'nearby_verification')) return item;
  const minted = await rpc('mint_web_push_action_tokens_v3', {
    request_kind_input: item.requestKind,
    request_id_input: Number(item.requestId),
    target_player_id_input: item.target_player_id || null,
    trace_id_input: item.traceId || null,
    scope_input: item.site_scope || null,
    job_id_input: item.job_id || null,
    expires_in_seconds_input: 900
  });
  return Object.assign({}, item, {
    verifyActionToken: minted?.verify_action_token || null,
    rejectActionToken: minted?.reject_action_token || null,
    expiresAt: minted?.expires_at || null
  });
}
function classifyFailure(err){
  const msg = String((err && (err.body || err.message)) || err || 'unknown_error');
  if (/404|410|gone|notregistered/i.test(msg)) return { stage:'send', code:'endpoint_gone', text:msg };
  if (/payload_invalid|malformed/i.test(msg)) return { stage:'payload', code:'payload_invalid', text:msg };
  if (/auth|p256dh|decrypt/i.test(msg)) return { stage:'send', code:'subscription_auth_invalid', text:msg };
  if (/mint/i.test(msg)) return { stage:'mint', code:'mint_failed', text:msg };
  return { stage:'send', code:'transient_send_failure', text:msg };
}
async function run(){
  await requeueStaleClaims();
  const items = await claimCoreJobs();
  if (!items.length) {
    console.log('no-web-push-jobs', JSON.stringify({ at: new Date().toISOString() }));
    return;
  }
  let sentCount = 0;
  let failedCount = 0;
  for (let item of items){
    try {
      item = await ensureActionTokens(item);
      const wantsActions = !!(item.verifyActionToken || item.rejectActionToken);
      const payload = {
        title: item.title,
        body: item.body,
        url: item.target_url || './drinks_pending.html',
        tag: item.notification_tag || item.tag || `job-${item.job_id}`,
        traceId: item.traceId || item.trace_id || null,
        jobId: item.job_id,
        kind: item.kind || item.trigger_kind || 'push',
        requestKind: item.requestKind || item.request_kind || null,
        requestId: item.requestId || item.request_id || null,
        requireInteraction: !!(item.require_interaction || wantsActions),
        verifyActionToken: item.verifyActionToken || null,
        rejectActionToken: item.rejectActionToken || null,
        expiresAt: item.expiresAt || null,
        actions: wantsActions ? [{ action:'open', title:'Openen' },{ action:'verify', title:'Bevestigen' },{ action:'reject', title:'Afkeuren' }] : [{ action:'open', title:'Openen' }]
      };
      if (!payload.title || !payload.body || !item.endpoint) throw new Error('payload_invalid');
      const response = await webpush.sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh_key, auth: item.auth_key } }, JSON.stringify(payload));
      await markSent(item, response && response.headers && response.headers.location || null);
      sentCount += 1;
      console.log('sent', item.job_id, payload.requestKind || payload.kind || 'generic');
    } catch (err) {
      const meta = classifyFailure(err);
      try { await markFailed(item, meta.stage, meta.code, meta.text); } catch (markErr) { console.error('mark-failed-error', item.job_id, markErr && markErr.message || markErr); }
      failedCount += 1;
      console.error('failed', item.job_id, meta.code, meta.text);
    }
  }
  console.log('web-push-run-complete', JSON.stringify({ total: items.length, sent: sentCount, failed: failedCount, at: new Date().toISOString() }));
}
run().catch((err)=>{ console.error(err); process.exit(1); });
