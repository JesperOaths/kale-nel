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
const workerId = process.env.WEB_PUSH_WORKER_ID || 'dispatcher-v362';

function rpcErrorMessage(error) {
  return String((error && (error.message || error.details || error.hint)) || error || 'unknown error');
}

function shouldDisableSubscription(error) {
  const code = Number(error && (error.statusCode || error.status || error.code));
  const message = String(error && (error.body || error.message || error) || '').toLowerCase();
  return code === 404 || code === 410 || message.includes('410') || message.includes('404') || message.includes('expired') || message.includes('no longer valid');
}

async function claimCoreJobs(){
  const claimToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc('claim_web_push_jobs_v2', {
    max_jobs: 25,
    worker_id_input: workerId,
    claim_token_input: claimToken
  });
  if (!error) {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((item)=>Object.assign({ __source: 'core', __claim_token: data?.claim_token || claimToken }, item));
  }
  const fallback = await supabase.rpc('claim_web_push_jobs', { max_jobs: 25 });
  if (fallback.error) throw fallback.error;
  const items = Array.isArray(fallback.data?.items) ? fallback.data.items : [];
  return items.map((item)=>Object.assign({ __source: 'core' }, item));
}

async function claimAdminJobs(){
  const { data, error } = await supabase.rpc('claim_admin_web_push_jobs', { max_jobs: 25 });
  if (error) throw error;
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((item)=>Object.assign({ __source: 'admin' }, item));
}

async function markSent(item){
  if (item.__source === 'core' && item.__claim_token) {
    const { error } = await supabase.rpc('mark_web_push_job_sent_v2', {
      job_id_input: item.job_id,
      claim_token_input: item.__claim_token,
      worker_id_input: workerId,
      provider_message_id_input: null
    });
    if (!error) return;
  }
  if (item.__source === 'admin') {
    const { error } = await supabase.rpc('mark_admin_web_push_job_sent', { job_id_input: item.job_id });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('mark_web_push_job_sent', { job_id_input: item.job_id });
  if (error) throw error;
}

async function markFailed(item, errorText){
  if (item.__source === 'core' && item.__claim_token) {
    const { error } = await supabase.rpc('mark_web_push_job_failed_v2', {
      job_id_input: item.job_id,
      claim_token_input: item.__claim_token,
      worker_id_input: workerId,
      error_stage_input: 'send',
      error_code_input: shouldDisableSubscription(errorText) ? 'subscription_invalid' : 'send_failed',
      error_text_input: String(errorText || ''),
      disable_subscription_input: shouldDisableSubscription(errorText)
    });
    if (!error) return;
  }
  if (item.__source === 'admin') {
    const { error } = await supabase.rpc('mark_admin_web_push_job_failed', { job_id_input: item.job_id, error_input: errorText });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('mark_web_push_job_failed', { job_id_input: item.job_id, error_input: errorText });
  if (error) throw error;
}

async function run(){
  try {
    await supabase.rpc('requeue_stale_web_push_claims_v2', { max_age_minutes: 30 });
  } catch (_) {}
  const items = [...await claimCoreJobs(), ...await claimAdminJobs()];
  for (const item of items){
    try {
      await webpush.sendNotification({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh_key, auth: item.auth_key }
      }, JSON.stringify({
        title: item.title,
        body: item.body,
        url: item.target_url || './drinks_pending.html',
        tag: `job-${item.job_id}`
      }));
      await markSent(item);
      console.log('sent', item.__source, item.job_id);
    } catch (err) {
      const reason = rpcErrorMessage(err);
      try { await markFailed(item, reason); } catch (markErr) { console.error('mark-failed-error', item.job_id, markErr && markErr.message || markErr); }
      console.error('failed', item.__source, item.job_id, reason);
    }
  }
}
run().catch((err)=>{ console.error(err); process.exit(1); });
