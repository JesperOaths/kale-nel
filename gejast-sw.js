
const GEJAST_VAPID_KEY = 'BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4';
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64); const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'Gejast';
  const target = data.url || './drinks_pending.html';
  const options = {
    body: data.body || 'Er staat iets voor je klaar.',
    tag: data.tag || 'gejast-push',
    icon: './logo.png',
    badge: './logo.png',
    data: { url: target, jobId: data.jobId || null, traceId: data.traceId || null, kind: data.kind || 'runtime' },
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    silent: false,
    timestamp: Date.now(),
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : [180, 80, 180],
    actions: Array.isArray(data.actions) ? data.actions : [
      { action: 'open', title: 'Openen' },
      { action: 'verify', title: 'Verifiëren' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  const action = event.action || 'open';
  const fallback = action === 'verify' ? './drinks_pending.html' : './index.html';
  const target = (event.notification && event.notification.data && event.notification.data.url) || fallback;
  event.notification && event.notification.close();
  event.waitUntil((async () => {
    const want = new URL(target, self.location.origin);
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
  })());
});
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const appKey = GEJAST_VAPID_KEY ? urlBase64ToUint8Array(GEJAST_VAPID_KEY) : null;
      if (!self.registration.pushManager) return;
      await self.registration.pushManager.subscribe(appKey ? { userVisibleOnly:true, applicationServerKey: appKey } : { userVisibleOnly:true });
      const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      await Promise.all(clients.map((client)=>client.postMessage({ type:'gejast-push-subscription-changed' })));
    } catch (_) {}
  })());
});
