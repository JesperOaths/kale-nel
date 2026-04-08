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

async function claimCoreJobs(){
  const { data, error } = await supabase.rpc('claim_web_push_jobs', { max_jobs: 25 });
  if (error) throw error;
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((item)=>Object.assign({ __source: 'core' }, item));
}

async function claimAdminJobs(){
  const { data, error } = await supabase.rpc('claim_admin_web_push_jobs', { max_jobs: 25 });
  if (error) throw error;
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((item)=>Object.assign({ __source: 'admin' }, item));
}

async function markSent(item){
  if (item.__source === 'admin') {
    const { error } = await supabase.rpc('mark_admin_web_push_job_sent', { job_id_input: item.job_id });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('mark_web_push_job_sent', { job_id_input: item.job_id });
  if (error) throw error;
}

async function markFailed(item, errorText){
  if (item.__source === 'admin') {
    const { error } = await supabase.rpc('mark_admin_web_push_job_failed', { job_id_input: item.job_id, error_input: errorText });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('mark_web_push_job_failed', { job_id_input: item.job_id, error_input: errorText });
  if (error) throw error;
}

async function run(){
  const claimedCore = await claimCoreJobs();
  const claimedAdmin = await claimAdminJobs();
  const items = [...claimedCore, ...claimedAdmin];
  if (!items.length) {
    console.log('no-web-push-jobs', JSON.stringify({ core: claimedCore.length, admin: claimedAdmin.length, at: new Date().toISOString() }));
    return;
  }
  let sentCount = 0;
  let failedCount = 0;
  for (const item of items){
    try {
      const payload = {
        title: item.title,
        body: item.body,
        url: item.target_url || './drinks_pending.html',
        tag: item.tag || `job-${item.job_id}`,
        renotify: true,
        vibrate: [180,80,180],
        icon: './logo.png',
        badge: './logo.png',
        requireInteraction: false
      };
      await webpush.sendNotification({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh_key, auth: item.auth_key }
      }, JSON.stringify(payload));
      await markSent(item);
      sentCount += 1;
      console.log('sent', item.__source, item.job_id, item.target_url || './drinks_pending.html');
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
