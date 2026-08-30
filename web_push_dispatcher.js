#!/usr/bin/env node
const { randomBytes, createHash } = require('node:crypto');

function loadWebPush() {
  return require('web-push');
}

function loadSupabaseClient() {
  return require('@supabase/supabase-js').createClient;
}

function envFlag(name, fallback = false, env = process.env) {
  const value = String(env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function parsePositiveInt(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/https:\/\/[^\s"')]+/gi, '[redacted-url]')
    .replace(/endpoint\s*[:=]\s*[^\s,;}]+/gi, 'endpoint=[redacted]')
    .replace(/p256dh\s*[:=]\s*[^\s,;}]+/gi, 'p256dh=[redacted]')
    .replace(/auth\s*[:=]\s*[^\s,;}]+/gi, 'auth=[redacted]')
    .slice(0, 1000);
}

function val(item) {
  for (let i = 1; i < arguments.length; i += 1) {
    const key = arguments[i];
    if (item && item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
  }
  return null;
}

function makeDisplayAckCapability() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

function classifyFailure(err) {
  const status = err && (err.statusCode || err.status);
  const msg = sanitizeLogText((err && (err.body || err.message)) || err || 'unknown_error');
  if (status === 404 || status === 410 || /404|410|gone|notregistered/i.test(msg)) return { stage: 'send', code: 'endpoint_gone', text: msg, disableSubscription: true };
  if (/payload_invalid|malformed/i.test(msg)) return { stage: 'payload', code: 'payload_invalid', text: msg, disableSubscription: false };
  if (/auth|p256dh|decrypt/i.test(msg)) return { stage: 'send', code: 'subscription_auth_invalid', text: msg, disableSubscription: true };
  if (/mint/i.test(msg)) return { stage: 'mint', code: 'mint_failed', text: msg, disableSubscription: false };
  if (/display[_ -]?ack|DISPLAY_ACK/i.test(msg)) return { stage: 'display_ack_prepare', code: 'display_ack_prepare_failed', text: msg, disableSubscription: false };
  return { stage: 'send', code: 'transient_send_failure', text: msg, disableSubscription: false };
}

function buildOptions(env = process.env) {
  const dryRun = envFlag('WEB_PUSH_DRY_RUN', false, env);
  const requireExplicitTarget = envFlag('WEB_PUSH_REQUIRE_EXPLICIT_TARGET', dryRun, env);
  const targetSubscriptionId = parsePositiveInt(env.WEB_PUSH_TARGET_SUBSCRIPTION_ID, 'WEB_PUSH_TARGET_SUBSCRIPTION_ID');
  if (requireExplicitTarget && !targetSubscriptionId) {
    throw new Error('WEB_PUSH_REQUIRE_EXPLICIT_TARGET is enabled, but WEB_PUSH_TARGET_SUBSCRIPTION_ID is missing');
  }
  return {
    url: env.SUPABASE_URL,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    vapidPublic: env.WEB_PUSH_VAPID_PUBLIC_KEY,
    vapidPrivate: env.WEB_PUSH_VAPID_PRIVATE_KEY,
    vapidSubject: env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@example.com',
    maxJobs: Number(env.WEB_PUSH_MAX_JOBS || 25),
    workerId: env.WEB_PUSH_WORKER_ID || 'github-actions-dispatcher',
    dryRun,
    requireExplicitTarget,
    targetSubscriptionId,
  };
}

function assertRuntimeSecrets(options) {
  if (!options.url || !options.key || !options.vapidPublic || !options.vapidPrivate) {
    throw new Error('Missing env vars for web push dispatcher');
  }
}

function createDispatcher(options, deps = {}) {
  assertRuntimeSecrets(options);
  const createClient = deps.createClient || loadSupabaseClient();
  const supabase = deps.supabase || createClient(options.url, options.key, { auth: { persistSession: false } });
  const push = deps.webpush || loadWebPush();
  if (!deps.webpush) push.setVapidDetails(options.vapidSubject, options.vapidPublic, options.vapidPrivate);

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  async function requeueStaleClaims() {
    try { await rpc('requeue_stale_web_push_claims_v3', { stale_minutes_input: 5 }); } catch (_) {}
  }

  async function claimCoreJobs() {
    const maxJobs = Number.isFinite(options.maxJobs) ? options.maxJobs : 25;
    const data = options.targetSubscriptionId
      ? await rpc('claim_web_push_jobs_targeted_v763', {
          target_subscription_id_input: options.targetSubscriptionId,
          max_jobs_input: maxJobs,
          worker_id_input: options.workerId,
        })
      : await rpc('claim_web_push_jobs_v3', { max_jobs_input: maxJobs });
    return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  }

  async function markSent(item, providerMessageId = null) {
    const jobId = val(item, 'job_id', 'id');
    const claimToken = val(item, 'claim_token');
    if (claimToken) {
      return rpc('mark_web_push_job_sent_v763', {
        job_id_input: jobId,
        claim_token_input: claimToken,
        worker_id_input: val(item, 'claimed_by', 'worker_id') || options.workerId,
        provider_message_id_input: providerMessageId,
      });
    }
    return rpc('mark_web_push_job_sent_v3', { job_id_input: jobId, provider_message_id_input: providerMessageId });
  }

  async function markFailed(item, stage, code, errorText, disableSubscription = false) {
    const jobId = val(item, 'job_id', 'id');
    const claimToken = val(item, 'claim_token');
    if (claimToken) {
      return rpc('mark_web_push_job_failed_v763', {
        job_id_input: jobId,
        claim_token_input: claimToken,
        worker_id_input: val(item, 'claimed_by', 'worker_id') || options.workerId,
        error_stage_input: stage,
        error_code_input: code,
        error_text_input: sanitizeLogText(errorText),
        disable_subscription_input: !!disableSubscription,
      });
    }
    return rpc('mark_web_push_job_failed_v3', {
      job_id_input: jobId,
      error_stage_input: stage,
      error_code_input: code,
      error_text_input: sanitizeLogText(errorText).slice(0, 2000),
    });
  }

  async function markDryRun(item) {
    const claimToken = val(item, 'claim_token');
    if (!claimToken) return null;
    return rpc('requeue_web_push_job_dry_run_v763', {
      job_id_input: val(item, 'job_id', 'id'),
      claim_token_input: claimToken,
      worker_id_input: val(item, 'claimed_by', 'worker_id') || options.workerId,
    });
  }

  async function prepareDisplayAck(item) {
    if (!item) return item;
    const jobId = val(item, 'job_id', 'id');
    const claimToken = val(item, 'claim_token');
    const subscriptionId = val(item, 'target_subscription_id');
    const workerId = val(item, 'claimed_by', 'worker_id') || options.workerId;
    if (!jobId || !claimToken || !subscriptionId || !workerId) throw new Error('DISPLAY_ACK_CONTEXT_MISSING');
    const capability = makeDisplayAckCapability();
    await rpc('prepare_web_push_display_ack_v814', {
      job_id_input: Number(jobId),
      claim_token_input: claimToken,
      worker_id_input: workerId,
      token_hash_input: capability.hash,
      expires_in_seconds_input: 86400,
    });
    return Object.assign({}, item, {
      displayAckToken: capability.token,
      display_ack_token: capability.token,
      displayAckSubscriptionId: Number(subscriptionId),
      display_ack_subscription_id: Number(subscriptionId),
    });
  }

  async function ensureActionTokens(item) {
    if (!item) return item;
    const hasVerify = val(item, 'verifyActionToken', 'verify_action_token');
    const hasReject = val(item, 'rejectActionToken', 'reject_action_token');
    if (hasVerify || hasReject) return item;
    const requestKind = val(item, 'requestKind', 'request_kind');
    const requestId = val(item, 'requestId', 'request_id');
    const kind = val(item, 'kind', 'trigger_kind');
    if (!requestKind || !requestId || !(kind === 'nearby_verification' || val(item, 'trigger_kind') === 'nearby_verification')) return item;
    const minted = await rpc('mint_web_push_action_tokens_v3', {
      request_kind_input: requestKind,
      request_id_input: Number(requestId),
      target_player_id_input: val(item, 'target_player_id', 'player_id') || null,
      trace_id_input: val(item, 'traceId', 'trace_id') || null,
      scope_input: val(item, 'site_scope') || null,
      job_id_input: val(item, 'job_id', 'id') || null,
      expires_in_seconds_input: 900,
    });
    return Object.assign({}, item, {
      verifyActionToken: minted?.verify_action_token || null,
      rejectActionToken: minted?.reject_action_token || null,
      verify_action_token: minted?.verify_action_token || null,
      reject_action_token: minted?.reject_action_token || null,
      expiresAt: minted?.expires_at || null,
      expires_at: minted?.expires_at || null,
    });
  }

  function assertExplicitTarget(item) {
    if (!options.targetSubscriptionId) return;
    const itemTarget = Number(val(item, 'target_subscription_id'));
    if (itemTarget !== options.targetSubscriptionId) {
      throw new Error(`claimed job target mismatch for job ${val(item, 'job_id', 'id') || 'unknown'}`);
    }
  }

  function buildPayload(item) {
    const verifyToken = val(item, 'verifyActionToken', 'verify_action_token');
    const rejectToken = val(item, 'rejectActionToken', 'reject_action_token');
    const wantsActions = !!(verifyToken || rejectToken);
    const displayAckToken = val(item, 'displayAckToken', 'display_ack_token');
    const displayAckSubscriptionId = val(item, 'displayAckSubscriptionId', 'display_ack_subscription_id', 'target_subscription_id');
    return {
      title: val(item, 'title', 'notification_title') || 'Gejast',
      body: val(item, 'body', 'message') || 'Er staat iets voor je klaar.',
      url: val(item, 'target_url', 'url') || './drinks_pending.html',
      tag: val(item, 'notification_tag', 'tag') || `job-${val(item, 'job_id', 'id')}`,
      traceId: val(item, 'traceId', 'trace_id'),
      trace_id: val(item, 'traceId', 'trace_id'),
      jobId: val(item, 'job_id', 'id'),
      job_id: val(item, 'job_id', 'id'),
      subscriptionId: displayAckSubscriptionId,
      subscription_id: displayAckSubscriptionId,
      displayAckToken,
      display_ack_token: displayAckToken,
      kind: val(item, 'kind', 'trigger_kind') || 'push',
      requestKind: val(item, 'requestKind', 'request_kind'),
      request_kind: val(item, 'requestKind', 'request_kind'),
      requestId: val(item, 'requestId', 'request_id'),
      request_id: val(item, 'requestId', 'request_id'),
      requireInteraction: !!(val(item, 'require_interaction') || wantsActions),
      verifyActionToken: verifyToken,
      verify_action_token: verifyToken,
      rejectActionToken: rejectToken,
      reject_action_token: rejectToken,
      expiresAt: val(item, 'expiresAt', 'expires_at'),
      expires_at: val(item, 'expiresAt', 'expires_at'),
      actions: wantsActions ? [{ action: 'open', title: 'Openen' }, { action: 'verify', title: 'Bevestigen' }, { action: 'reject', title: 'Afkeuren' }] : [{ action: 'open', title: 'Openen' }],
    };
  }

  async function run() {
    await requeueStaleClaims();
    const items = await claimCoreJobs();
    if (!items.length) {
      console.log('no-web-push-jobs', JSON.stringify({ at: new Date().toISOString(), dryRun: options.dryRun, targetSubscriptionId: options.targetSubscriptionId || null }));
      return { total: 0, sent: 0, failed: 0, dryRun: options.dryRun };
    }

    let sentCount = 0;
    let failedCount = 0;
    let dryRunCount = 0;
    for (let item of items) {
      try {
        assertExplicitTarget(item);
        item = await ensureActionTokens(item);
        if (!options.dryRun) item = await prepareDisplayAck(item);
        const payload = buildPayload(item);
        const endpoint = val(item, 'endpoint');
        const p256dh = val(item, 'p256dh_key', 'p256dh');
        const auth = val(item, 'auth_key', 'auth');
        if (!payload.title || !payload.body || !endpoint || !p256dh || !auth) throw new Error('payload_invalid');
        if (options.dryRun) {
          await markDryRun(item);
          dryRunCount += 1;
          console.log('dry-run', JSON.stringify({ jobId: payload.jobId, targetSubscriptionId: val(item, 'target_subscription_id') || null, kind: payload.requestKind || payload.kind || 'generic', url: payload.url, tag: payload.tag }));
          continue;
        }
        const response = await push.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload));
        await markSent(item, response && response.headers && response.headers.location || null);
        sentCount += 1;
        console.log('sent', JSON.stringify({ jobId: payload.jobId, targetSubscriptionId: val(item, 'target_subscription_id') || null, kind: payload.requestKind || payload.kind || 'generic' }));
      } catch (err) {
        const meta = classifyFailure(err);
        try { await markFailed(item, meta.stage, meta.code, meta.text, meta.disableSubscription); }
        catch (markErr) { console.error('mark-failed-error', JSON.stringify({ jobId: val(item, 'job_id', 'id') || null, error: sanitizeLogText(markErr && markErr.message || markErr) })); }
        failedCount += 1;
        console.error('failed', JSON.stringify({ jobId: val(item, 'job_id', 'id') || null, code: meta.code, error: meta.text }));
      }
    }
    const summary = { total: items.length, sent: sentCount, failed: failedCount, dryRun: dryRunCount, at: new Date().toISOString(), targetSubscriptionId: options.targetSubscriptionId || null };
    console.log('web-push-run-complete', JSON.stringify(summary));
    return summary;
  }

  return { run, rpc, claimCoreJobs, buildPayload, classifyFailure, sanitizeLogText };
}

async function main() {
  const options = buildOptions();
  const dispatcher = createDispatcher(options);
  await dispatcher.run();
}

if (require.main === module) {
  main().catch((err) => { console.error(sanitizeLogText(err && err.message || err)); process.exit(1); });
}

module.exports = { buildOptions, createDispatcher, classifyFailure, sanitizeLogText, parsePositiveInt, envFlag, makeDisplayAckCapability };
