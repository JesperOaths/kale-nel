import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function need(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const baseUrl = new URL(process.env.GEJAST_BASE_URL || 'https://kalenel.nl/');
const origin = baseUrl.origin;
const playerName = need('GEJAST_PLAYER_NAME');
const playerToken = need('GEJAST_PLAYER_TOKEN');
const chromePath = need('GEJAST_SYSTEM_CHROME');
const supabaseUrl = need('SUPABASE_URL');
const serviceRoleKey = need('SUPABASE_SERVICE_ROLE_KEY');
const vapidPublic = need('WEB_PUSH_VAPID_PUBLIC_KEY');
const vapidPrivate = need('WEB_PUSH_VAPID_PRIVATE_KEY');
const vapidSubject = process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@example.com';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function child(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const cp = spawn(command, args, { stdio: 'inherit', ...options });
    cp.on('error', reject);
    cp.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited code=${code} signal=${signal || 'none'}`));
    });
  });
}

async function latestJob(subscriptionId, notBeforeIso) {
  const { data, error } = await supabase
    .from('web_push_jobs')
    .select('id,status,target_subscription_id,created_at,sent_at,provider_message_id,display_acked_at,marked_at,error_stage,error_code,error_text')
    .eq('target_subscription_id', subscriptionId)
    .gte('created_at', notBeforeIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] || null;
}

async function jobAttempts(jobId) {
  const { data, error } = await supabase
    .from('web_push_job_attempts')
    .select('stage,status,worker_id,created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function waitForAck(subscriptionId, notBeforeIso, timeoutMs = 75000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await latestJob(subscriptionId, notBeforeIso);
    if (last && last.sent_at && last.display_acked_at && last.status === 'sent') return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for real display ACK; last=${JSON.stringify(last && {
    id: last.id,
    status: last.status,
    sent_at: last.sent_at,
    display_acked_at: last.display_acked_at,
    error_stage: last.error_stage,
    error_code: last.error_code,
  })}`);
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'gejast-v814-push-cert-'));
let context = null;
let subscriptionId = null;
let observedJob = null;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-background-networking'],
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  await context.grantPermissions(['notifications'], { origin });
  await context.addInitScript(({ token }) => {
    try {
      localStorage.setItem('jas_session_token_v11', token);
      localStorage.setItem('jas_session_token_v10', token);
      sessionStorage.setItem('jas_session_token_v11', token);
      sessionStorage.setItem('jas_session_token_v10', token);
    } catch (_) {}
  }, { token: playerToken });

  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (/push|service worker|notification/i.test(text)) console.log(`browser-console ${msg.type()}: ${text.slice(0, 500)}`);
  });
  page.on('pageerror', (err) => console.log(`browser-pageerror ${String(err && err.message || err).slice(0, 500)}`));

  await page.goto(new URL(`index.html?scope=friends&v814_push_cert=${Date.now()}`, baseUrl).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForFunction(() => !!window.GEJAST_CONFIG, null, { timeout: 15000 });
  const runtimePresent = await page.evaluate(() => !!window.GEJAST_PUSH_RUNTIME);
  if (!runtimePresent) {
    await page.addScriptTag({ url: new URL(`gejast-push-runtime.js?v814&cert=${Date.now()}`, baseUrl).href });
  }
  await page.waitForFunction(() => !!window.GEJAST_PUSH_RUNTIME, null, { timeout: 15000 });

  const localPermission = await page.evaluate(() => ({
    secure: window.isSecureContext,
    notification: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
  }));
  console.log('browser-capabilities', JSON.stringify(localPermission));
  assert(localPermission.secure, 'Production page is not a secure context');
  assert(localPermission.notification === 'granted', `Notification permission is ${localPermission.notification}`);
  assert(localPermission.serviceWorker && localPermission.pushManager, 'Service Worker or PushManager unavailable');

  const sync = await page.evaluate(async () => {
    const result = await window.GEJAST_PUSH_RUNTIME.requestPermissionAndSync({
      scope: 'friends',
      pagePath: '/index.html?scope=friends',
      requestLocation: false,
    });
    const subscription = await window.GEJAST_PUSH_RUNTIME.getSubscription();
    return {
      granted: !!result?.granted,
      readiness: result?.readiness || result?.diagnostics?.readiness?.key || null,
      backendSync: result?.backendSync || null,
      presenceTouch: result?.presenceTouch || null,
      permission: window.GEJAST_PUSH_RUNTIME.notificationPermission(),
      subscription: subscription && subscription.toJSON ? subscription.toJSON() : null,
    };
  });

  const safeSync = {
    granted: sync.granted,
    readiness: sync.readiness,
    permission: sync.permission,
    backendSynced: !!sync.backendSync?.synced,
    presenceTouched: !!sync.presenceTouch?.touched,
    subscriptionId: sync.backendSync?.payload?.subscription_id || sync.presenceTouch?.payload?.subscription_id || null,
    hasEndpoint: !!sync.subscription?.endpoint,
    hasP256dh: !!sync.subscription?.keys?.p256dh,
    hasAuth: !!sync.subscription?.keys?.auth,
  };
  console.log('push-sync', JSON.stringify(safeSync));
  assert(sync.granted, 'Notification grant/runtime sync failed');
  assert(sync.backendSync?.synced, `Backend subscription sync failed: ${sync.backendSync?.reason || 'unknown'}`);
  assert(sync.presenceTouch?.touched, `Active presence touch failed: ${sync.presenceTouch?.reason || 'unknown'}`);
  assert(sync.subscription?.endpoint && sync.subscription?.keys?.p256dh && sync.subscription?.keys?.auth, 'Real PushSubscription material missing');

  subscriptionId = Number(sync.backendSync?.payload?.subscription_id || sync.presenceTouch?.payload?.subscription_id || 0);
  assert(Number.isSafeInteger(subscriptionId) && subscriptionId > 0, 'Backend subscription id missing');

  const { data: presenceRows, error: presenceError } = await supabase
    .from('web_push_active_presence')
    .select('player_id,subscription_id,permission_state,last_seen_at')
    .eq('subscription_id', subscriptionId)
    .eq('permission_state', 'granted')
    .gte('last_seen_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(1);
  if (presenceError) throw presenceError;
  assert(presenceRows && presenceRows.length === 1, 'Fresh granted active presence was not persisted');
  console.log(`RESULT=V814_REAL_PUSH_FRESH_PRESENCE_PASS subscription_id=${subscriptionId}`);

  const notBeforeIso = new Date(Date.now() - 2000).toISOString();
  const queued = await page.evaluate(() => window.GEJAST_PUSH_RUNTIME.queueTest());
  console.log('queue-test', JSON.stringify({
    queued: !!queued?.queued,
    ok: !!queued?.payload?.ok,
    queuedCount: Number(queued?.payload?.queued_count || 0),
  }));
  assert(queued?.queued && queued?.payload?.ok, `Product queue_test_web_push failed: ${queued?.reason || 'unknown'}`);
  assert(Number(queued?.payload?.queued_count || 0) === 1, `Expected exactly one disposable push job, got ${queued?.payload?.queued_count}`);

  await child(process.execPath, ['web_push_dispatcher.js'], {
    env: {
      ...process.env,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      WEB_PUSH_VAPID_PUBLIC_KEY: vapidPublic,
      WEB_PUSH_VAPID_PRIVATE_KEY: vapidPrivate,
      WEB_PUSH_VAPID_SUBJECT: vapidSubject,
      WEB_PUSH_WORKER_ID: `v814-display-ack-cert-${process.env.GITHUB_RUN_ID || 'local'}`,
      WEB_PUSH_DRY_RUN: 'false',
      WEB_PUSH_REQUIRE_EXPLICIT_TARGET: 'true',
      WEB_PUSH_TARGET_SUBSCRIPTION_ID: String(subscriptionId),
      WEB_PUSH_MAX_JOBS: '1',
    },
  });

  observedJob = await waitForAck(subscriptionId, notBeforeIso);
  const attempts = await jobAttempts(observedJob.id);
  const stages = new Set(attempts.filter((row) => row.status === 'ok').map((row) => row.stage));
  assert(stages.has('provider_sent_v814'), `Provider acceptance attempt missing: ${JSON.stringify(attempts)}`);
  assert(stages.has('display_ack_v814'), `Service-worker display ACK attempt missing: ${JSON.stringify(attempts)}`);

  const notificationState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const notifications = await reg.getNotifications();
    return notifications.map((n) => ({ title: n.title, tag: n.tag, body: n.body })).slice(0, 10);
  });
  const actualNotification = notificationState.find((n) => n.title === 'GEJAST testmelding');
  assert(actualNotification, `Displayed GEJAST test notification not visible via ServiceWorkerRegistration.getNotifications(): ${JSON.stringify(notificationState)}`);

  console.log('display-proof', JSON.stringify({
    jobId: observedJob.id,
    status: observedJob.status,
    providerAcceptedAt: observedJob.sent_at,
    providerMessageIdPresent: !!observedJob.provider_message_id,
    displayAckedAt: observedJob.display_acked_at,
    markedAt: observedJob.marked_at,
    attempts: attempts.map((row) => `${row.stage}:${row.status}`),
    notification: { title: actualNotification.title, tag: actualNotification.tag },
  }));
  console.log('RESULT=V814_REAL_WEB_PUSH_PROVIDER_ACCEPTANCE_PASS');
  console.log('RESULT=V814_REAL_WEB_PUSH_SERVICE_WORKER_DISPLAY_ACK_PASS');
  console.log('RESULT=V814_REAL_WEB_PUSH_END_TO_END_PASS');
} finally {
  if (context) {
    try {
      for (const page of context.pages()) {
        await page.evaluate(async () => {
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
            const notifications = await reg.getNotifications();
            notifications.forEach((n) => n.close());
          } catch (_) {}
        });
      }
    } catch (_) {}
    try { await context.close(); } catch (_) {}
  }
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
