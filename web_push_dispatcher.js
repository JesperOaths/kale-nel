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

async function rpcFirst(names, args){
  let lastErr = null;
  for (const name of names){
    try {
      const { data, error } = await supabase.rpc(name, args || {});
      if (error) throw error;
      return data;
    } catch (err) { lastErr = err; }
  }
  if (lastErr) throw lastErr;
  throw new Error('RPC unavailable');
}
async function requeueStaleClaims(){ try { await rpcFirst(['requeue_stale_web_push_claims_v3'], { stale_minutes_input: 5 }); } catch (_) {} }
async function claimCoreJobs(){ const data = await rpcFirst(['claim_web_push_jobs_v3','claim_web_push_jobs'], { max_jobs: 25 }); const items = Array.isArray(data?.items) ? data.items : []; return items.map((item)=>Object.assign({ __source:'core' }, item)); }
async function claimAdminJobs(){ try { const data = await rpcFirst(['claim_admin_web_push_jobs'], { max_jobs: 25 }); const items = Array.isArray(data?.items) ? data.items : []; return items.map((item)=>Object.assign({ __source:'admin' }, item)); } catch (_) { return []; } }
async function markSent(item){ if (item.__source === 'admin') return rpcFirst(['mark_admin_web_push_job_sent'], { job_id_input: item.job_id }); return rpcFirst(['mark_web_push_job_sent_v3','mark_web_push_job_sent'], { job_id_input: item.job_id }); }
async function markFailed(item, errorText){ if (item.__source === 'admin') return rpcFirst(['mark_admin_web_push_job_failed'], { job_id_input: item.job_id, error_input: errorText }); return rpcFirst(['mark_web_push_job_failed_v3','mark_web_push_job_failed'], { job_id_input: item.job_id, error_input: errorText }); }
async function ensureActionTokens(item){
  if (!item || item.__source === 'admin') return item;
  if (item.verifyActionToken || item.rejectActionToken) return item;
  if (!item.requestKind || !item.requestId) return item;
  try {
    const minted = await rpcFirst(['mint_web_push_action_tokens_v3'], {
      request_kind_input: item.requestKind,
      request_id_input: Number(item.requestId),
      target_player_id_input: item.target_player_id || null,
      trace_id_input: item.traceId || null,
      scope_input: item.site_scope || null,
      job_id_input: item.job_id || null,
      session_token_input: item.session_token || null,
      expires_in_seconds_input: 900
    });
    return Object.assign({}, item, {
      verifyActionToken: minted?.verify_action_token || null,
      rejectActionToken: minted?.reject_action_token || null,
      expiresAt: minted?.expires_at || null
    });
  } catch (_) { return item; }
}
async function run(){
  await requeueStaleClaims();
  const claimedCore = await claimCoreJobs();
  const claimedAdmin = await claimAdminJobs();
  const items = [...claimedCore, ...claimedAdmin];
  if (!items.length) {
    console.log('no-web-push-jobs', JSON.stringify({ core: claimedCore.length, admin: claimedAdmin.length, at: new Date().toISOString() }));
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
        tag: item.tag || `job-${item.job_id}`,
        traceId: item.traceId || item.trace_id || null,
        jobId: item.job_id,
        kind: item.kind || item.requestKind || 'push',
        requestKind: item.requestKind || item.request_kind || null,
        requestId: item.requestId || item.request_id || null,
        requireInteraction: !!wantsActions,
        verifyActionToken: item.verifyActionToken || null,
        rejectActionToken: item.rejectActionToken || null,
        expiresAt: item.expiresAt || null,
        actions: wantsActions ? [{ action:'open', title:'Openen' },{ action:'verify', title:'Bevestigen' },{ action:'reject', title:'Afkeuren' }] : [{ action:'open', title:'Openen' }]
      };
      if (!payload.title || !payload.body || !item.endpoint) throw new Error('payload_invalid');
      await webpush.sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh_key, auth: item.auth_key } }, JSON.stringify(payload));
      await markSent(item);
      sentCount += 1;
      console.log('sent', item.__source, item.job_id, payload.requestKind || payload.kind || 'generic');
    } catch (err) {
      const reason = String((err && (err.body || err.message)) || err);
      try { await markFailed(item, reason); } catch (markErr) { console.error('mark-failed-error', item.job_id, markErr && markErr.message || markErr); }
      failedCount += 1;
      console.error('failed', item.__source, item.job_id, reason);
    }
  }
  console.log('web-push-run-complete', JSON.stringify({ total: items.length, sent: sentCount, failed: failedCount, at: new Date().toISOString() }));
}
run().catch((err)=>{ console.error(err); process.exit(1); });
