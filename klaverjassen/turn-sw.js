// Standalone Klaverjassen service worker, scoped to /klaverjassen/.
// Only displays game-turn notifications when this site's page is not visible.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?.json()||{};}catch(_){}
 const code=String(data.room||'').toUpperCase();
 if(!/^[A-Z0-9]{4,12}$/.test(code))return;
 const url='/klaverjassen/room.html?room='+encodeURIComponent(code);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(windows.some(w=>w.visibilityState==='visible'&&w.url.includes('/klaverjassen/room.html?room='+code)))return;
  await self.registration.showNotification('Klaverjassen · jij bent aan de beurt',{
   body:String(data.body||'Je team wacht op jouw kaart.').slice(0,110),
   tag:'klaverjassen-turn-'+code,
   renotify:true,
   icon:'/favicon.ico',
   badge:'/favicon.ico',
   data:{url,code},
   requireInteraction:false
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=event.notification.data?.url||'/klaverjassen/';
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients){
   if(client.url.includes('/klaverjassen/')){
    await client.navigate(url);
    return client.focus();
   }
  }
  return self.clients.openWindow(url);
 })());
});