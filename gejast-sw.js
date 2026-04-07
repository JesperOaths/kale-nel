
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
    data: { url: target },
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
      const appKey = self.GEJAST_VAPID_KEY || null;
      if (!self.registration.pushManager) return;
      await self.registration.pushManager.subscribe(appKey ? { userVisibleOnly:true, applicationServerKey: appKey } : { userVisibleOnly:true });
    } catch (_) {}
  })());
});
