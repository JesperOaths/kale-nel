#!/usr/bin/env node
const crypto = require('crypto');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vapidPublic = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT || 'https://kalenel.nl';
const workerId = process.env.WEB_PUSH_WORKER_ID || `dispatcher-${process.pid}`;

if (!url || !key || !vapidPublic || !vapidPrivate) {
  console.error('Missing env vars for repaired web push dispatcher');
  process.exit(1);
}

webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
const supabase = createClient(url, key, { auth: { persistSession: false } });

function claimToken() {
  return crypto.randomUUID();
}

async function reclaimStaleClaims() {
  const { error } = await supabase.rpc('requeue_stale_web_push_claims_v2', { stale_minutes: 15 });
  if (error) throw error;
}

async function claimJobs(maxJobs = 25) {
  const token = claimToken();
  const { data, error } = await supabase.rpc('claim_web_push_jobs_v2', {
    max_jobs: maxJobs,
    worker_id_input: workerId,
    claim_token_input: token
  });
  if (error) throw error;
  const items = Array.isArray(data?.items) ? data.items : [];
  return { token, items };
}

async function markSent(jobId, token, providerMessageId) {
  const { error } = await supabase.rpc('mark_web_push_job_sent_v2', {
    job_id_input: jobId,
    claim_token_input: token,
    worker_id_input: workerId,
    provider_message_id_input: providerMessageId || null
  });
  if (error) throw error;
}

async function markFailed(jobId, token, stage, code, reason, shouldDisable) {
  const { error } = await supabase.rpc('mark_web_push_job_failed_v2', {
    job_id_input: jobId,
    claim_token_input: token,
    worker_id_input: workerId,
    error_stage_input: stage,
    error_code_input: code || 'SEND_FAILED',
    error_text_input: String(reason || '').slice(0, 2000),
    disable_subscription_input: !!shouldDisable
  });
  if (error) throw error;
}

async function sendOne(job, token) {
  const payload = JSON.stringify({
    title: job.title,
    body: job.body,
    url: job.target_url || './drinks_pending.html',
    tag: job.notification_tag || `job-${job.job_id}`,
    requireInteraction: !!job.require_interaction,
    vibrate: Array.isArray(job.vibrate_pattern) ? job.vibrate_pattern : [180, 80, 180],
    jobId: job.job_id,
    traceId: job.trace_id,
    kind: job.trigger_kind || 'runtime'
  });

  try {
    const response = await webpush.sendNotification({
      endpoint: job.endpoint,
      keys: {
        p256dh: job.p256dh_key,
        auth: job.auth_key
      }
    }, payload);
    await markSent(job.job_id, token, response?.headers?.location || response?.statusCode || 'sent');
    console.log(`sent job=${job.job_id} scope=${job.target_scope} trigger=${job.trigger_kind}`);
  } catch (error) {
    const text = String(error && (error.body || error.message) || error);
    const statusCode = Number(error && error.statusCode || 0);
    const disable = statusCode === 404 || statusCode === 410 || /gone|unsubscribed|expired/i.test(text);
    await markFailed(job.job_id, token, 'send', String(statusCode || 'SEND_FAILED'), text, disable);
    console.error(`failed job=${job.job_id} code=${statusCode || 'SEND_FAILED'} ${text}`);
  }
}

async function run() {
  await reclaimStaleClaims();
  const { token, items } = await claimJobs(50);
  for (const item of items) {
    try {
      await sendOne(item, token);
    } catch (error) {
      const text = String(error && error.message || error);
      try {
        await markFailed(item.job_id, token, 'mark', 'MARK_FAILED', text, false);
      } catch (markError) {
        console.error(`mark-failed-error job=${item.job_id} ${String(markError && markError.message || markError)}`);
      }
    }
  }
}

run().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
