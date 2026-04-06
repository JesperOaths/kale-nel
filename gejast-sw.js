self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'Gejast';
  const options = {
    body: data.body || 'Er staat iets voor je klaar.',
    tag: data.tag || 'gejast-push',
    icon: './logo.png',
    badge: './logo.png',
    data: { url: data.url || './drinks_pending.html' },
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const target = (event.notification && event.notification.data && event.notification.data.url) || './drinks_pending.html';
  event.notification && event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        const want = new URL(target, self.location.origin);
        if (url.pathname === want.pathname) {
          await client.focus();
          if ('navigate' in client && client.url !== want.href) await client.navigate(want.href);
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
