const GEJAST_VAPID_KEY = 'BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4';
const GEJAST_SUPABASE_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co';
const GEJAST_SUPABASE_KEY = 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64); const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
async function consumeActionToken(actionToken){
  if (!actionToken) return { ok:false, reason:'missing-token' };
  try {
    const res = await fetch(`${GEJAST_SUPABASE_URL}/rest/v1/rpc/consume_web_push_action_v3`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:GEJAST_SUPABASE_KEY, Authorization:`Bearer ${GEJAST_SUPABASE_KEY}`, Accept:'application/json' },
      body: JSON.stringify({ action_token_input: actionToken })
    });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { data = { raw:txt }; }
    if (!res.ok) return { ok:false, reason:data?.message || data?.error || txt || `HTTP ${res.status}` };
    return Object.assign({ ok:true }, data || {});
  } catch (err) {
    return { ok:false, reason:(err && err.message) || 'consume-failed' };
  }
}
function withStatusUrl(target, params={}){
  const url = new URL(target || './drinks_pending.html', self.location.origin);
  Object.entries(params || {}).forEach(([key, value])=>{ if (value != null && value !== '') url.searchParams.set(key, String(value)); });
  return url.href;
}
async function focusOrOpen(target){
  const want = new URL(target || './index.html', self.location.origin);
  const allClients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  for (const client of allClients) {
    try {
      const url = new URL(client.url);
      if (url.pathname === want.pathname) {
        await client.focus();
        if ('navigate' in client && client.url !== want.href) await client.navigate(want.href);
        return;
      }
    } catch (_) {}
  }
  if (self.clients.openWindow) await self.clients.openWindow(want.href);
}
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const target = data.url || './drinks_pending.html';
  const payloadActions = Array.isArray(data.actions) ? data.actions : [];
  const actions = payloadActions.length ? payloadActions : [
    { action: 'open', title: 'Openen' },
    { action: 'verify', title: 'Bevestigen' },
    { action: 'reject', title: 'Afkeuren' }
  ];
  const options = {
    body: data.body || 'Er staat iets voor je klaar.',
    tag: data.tag || `gejast-${data.kind || 'push'}`,
    icon: './logo.png',
    badge: './logo.png',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    silent: false,
    timestamp: Date.now(),
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : [180, 80, 180],
    actions,
    data: {
      url: target,
      jobId: data.jobId || null,
      traceId: data.traceId || null,
      kind: data.kind || null,
      requestKind: data.requestKind || null,
      requestId: data.requestId || null,
      verifyActionToken: data.verifyActionToken || null,
      rejectActionToken: data.rejectActionToken || null,
      expiresAt: data.expiresAt || null
    }
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Gejast', options));
});
self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  const action = event.action || 'open';
  const fallbackTarget = data.url || (data.requestKind === 'speed' ? './drinks_speed.html' : './drinks_pending.html');
  event.notification && event.notification.close();
  event.waitUntil((async () => {
    if (action === 'verify' || action === 'reject') {
      const actionToken = action === 'verify' ? data.verifyActionToken : data.rejectActionToken;
      const result = await consumeActionToken(actionToken);
      if (result && result.ok) {
        const successUrl = withStatusUrl(fallbackTarget, { request_kind: data.requestKind || '', request_id: data.requestId || '', action_status: action === 'verify' ? 'verified' : 'rejected', trace_id: data.traceId || '' });
        await focusOrOpen(successUrl);
        return;
      }
      const degradedUrl = withStatusUrl(fallbackTarget, { request_kind: data.requestKind || '', request_id: data.requestId || '', action_status: 'failed', trace_id: data.traceId || '', action_reason: result && result.reason || 'consume_failed' });
      await focusOrOpen(degradedUrl);
      return;
    }
    await focusOrOpen(fallbackTarget);
  })());
});
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const appKey = GEJAST_VAPID_KEY ? urlBase64ToUint8Array(GEJAST_VAPID_KEY) : null;
      if (!self.registration.pushManager) return;
      await self.registration.pushManager.subscribe(appKey ? { userVisibleOnly:true, applicationServerKey: appKey } : { userVisibleOnly:true });
      const allClients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      allClients.forEach((client)=>{ try { client.postMessage({ type:'gejast-pushsubscriptionchange' }); } catch (_) {} });
    } catch (_) {}
  })());
});
