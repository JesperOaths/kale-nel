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

async function run(){
  const { data, error } = await supabase.rpc('claim_web_push_jobs', { max_jobs: 25 });
  if (error) throw error;
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items){
    try {
      await webpush.sendNotification({
        endpoint: item.endpoint,
        keys: { p256dh: item.p256dh_key, auth: item.auth_key }
      }, JSON.stringify({
        title: item.title,
        body: item.body,
        url: item.target_url || './drinks.html#verifyPanel',
        tag: `job-${item.job_id}`
      }));
      await supabase.rpc('mark_web_push_job_sent', { job_id_input: item.job_id });
      console.log('sent', item.job_id);
    } catch (err) {
      await supabase.rpc('mark_web_push_job_failed', { job_id_input: item.job_id, error_input: String(err && err.message || err) });
      console.error('failed', item.job_id, err && err.message || err);
    }
  }
}
run().catch((err)=>{ console.error(err); process.exit(1); });
