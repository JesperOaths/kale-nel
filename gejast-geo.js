(function(){
  const CACHE_KEY = 'gejast_geo_cache_v5';
  const ADDRESS_KEY = 'gejast_geo_address_cache_v1';
  const NOTIFY_LAST_KEY = 'gejast_notify_last_seen_v1';
  const SESSION_KEYS = ['jas_session_token_v11','jas_session_token_v10'];
  let watchId = null;
  let lastPos = null;
  let lastError = null;
  let monitorId = null;
  let visibilityBound = false;
  let notifyStateCache = null;
  let buttonsReadyState = false;

  function isIOS(){ const ua = navigator.userAgent || ''; return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isAndroid(){ return /Android/i.test(navigator.userAgent || ''); }
  function isStandalone(){ try { return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch(_) { return false; } }
  function platformName(){ if (isIOS()) return 'iPhone/iPad'; if (isAndroid()) return 'Android'; return 'browser'; }
  function mobilePermissionHelp(kind, state){
    const rows = [];
    if (kind === 'notification') {
      if (isIOS() && !isStandalone()) {
        rows.push('Op iPhone/iPad werkt de native meldingen-popup vaak alleen goed vanuit de Safari-thuisscherm-app. Voeg de site toe aan je beginscherm, open hem vanaf daar en druk daarna opnieuw op de bel.');
      }
      if (state === 'denied') {
        rows.push(isIOS() ? 'Zet meldingen voor deze site weer aan via Safari/website-instellingen of in de iPhone-instellingen en druk daarna opnieuw op de bel.' : 'Zet meldingen voor deze site weer aan via browser-site-instellingen of app-instellingen en druk daarna opnieuw op de bel.');
      } else if (state === 'default') {
        rows.push('De site heeft opnieuw om meldingstoestemming gevraagd. Krijg je geen native popup, controleer dan of de browser de vraag heeft onderdrukt.');
      }
    } else if (kind === 'location') {
      if (state === 'denied') {
        rows.push(isIOS() ? 'Zet locatie voor deze site weer aan via Safari/website-instellingen of in de iPhone-instellingen en druk daarna opnieuw op het vizier.' : 'Zet locatie voor deze site weer aan via browser-site-instellingen of app-instellingen en druk daarna opnieuw op het vizier.');
      } else {
        rows.push('De site heeft opnieuw om locatietoestemming gevraagd. Krijg je geen native popup, controleer dan of de browser de vraag heeft onderdrukt.');
      }
    }
    return rows;
  }

  function normalize(pos, source='live'){
    if (!pos || !pos.coords) return null;
    return { source, coords: { latitude: Number(pos.coords.latitude), longitude: Number(pos.coords.longitude), accuracy: pos.coords.accuracy == null ? null : Number(pos.coords.accuracy) }, timestamp: pos.timestamp || Date.now() };
  }
  function announce(type, detail){ try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch(_){} }
  function save(pos, source='live'){
    const out = normalize(pos, source); if (!out) return null;
    lastPos = out; lastError = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat: out.coords.latitude, lng: out.coords.longitude, accuracy: out.coords.accuracy, at: Date.now() })); } catch(_){}
    announce('gejast:geo-update', out); return out;
  }
  function cached(maxAgeMs=10*60*1000){
    if (lastPos && Date.now() - (lastPos.timestamp || 0) <= maxAgeMs) return lastPos;
    try { const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (!raw || !raw.at || (Date.now() - raw.at) > maxAgeMs) return null; return normalize({ coords:{ latitude: raw.lat, longitude: raw.lng, accuracy: raw.accuracy }, timestamp: raw.at }, 'cache'); } catch(_) { return null; }
  }
  async function permissionState(){ try { if (!navigator.permissions || !navigator.permissions.query) return 'unknown'; const r = await navigator.permissions.query({ name:'geolocation' }); return r.state || 'unknown'; } catch(_) { return 'unknown'; } }
  function classify(err){ const code = err && typeof err.code === 'number' ? err.code : null; const raw = String((err && err.message) || '').toLowerCase(); if (code===1||raw.includes('denied')||raw.includes('permission')) return 'permission'; if (code===2||raw.includes('unavailable')) return 'unavailable'; if (code===3||raw.includes('timeout')) return 'timeout'; return 'unknown'; }
  function message(err){ if (!window.isSecureContext) return 'Geolocatie werkt alleen via een beveiligde https-verbinding.'; if (!navigator.geolocation) return 'Geolocatie wordt niet ondersteund op dit apparaat of in deze browser.'; const kind = classify(err); if (kind==='permission') return 'De browser gaf geolocatie nog niet vrij. Controleer browser-sitepermissie en apparaatlocatie, en probeer daarna opnieuw.'; if (kind==='unavailable') return 'Locatie is nu niet beschikbaar. Controleer of gps of locatievoorzieningen aanstaan en probeer opnieuw.'; if (kind==='timeout') return 'Locatie opvragen duurde te lang. We proberen daarom ook een minder strikte locatielezing.'; return 'Geolocatie ophalen is mislukt. Controleer toestemming, gps en browserinstellingen en probeer opnieuw.'; }
  function currentPosition(options){ return new Promise((resolve, reject)=>{ if (!window.isSecureContext) return reject(new Error(message())); if (!navigator.geolocation) return reject(new Error(message())); navigator.geolocation.getCurrentPosition((pos)=>resolve(save(pos,'live')), async(err)=>{ lastError = { code: err && err.code, raw: String(err && err.message || ''), permission_state: await permissionState() }; reject(new Error(message(err))); }, options); }); }
  function watchOnce(options){ return new Promise((resolve, reject)=>{ if (!window.isSecureContext || !navigator.geolocation) return reject(new Error(message())); let settled=false; const wid=navigator.geolocation.watchPosition((pos)=>{ if (settled) return; settled=true; clearTimeout(timer); try { navigator.geolocation.clearWatch(wid); } catch(_){} resolve(save(pos,'watch-once')); }, async(err)=>{ if (settled) return; settled=true; clearTimeout(timer); try { navigator.geolocation.clearWatch(wid); } catch(_){} lastError={ code: err&&err.code, raw:String(err&&err.message||''), permission_state: await permissionState() }; reject(new Error(message(err))); }, options); const timer=setTimeout(()=>{ if (settled) return; settled=true; try { navigator.geolocation.clearWatch(wid); } catch(_){} reject(new Error('watch timeout')); }, (options.timeout||12000)+1500); }); }
  async function request(forceFresh=false){ const maxAge=forceFresh?0:120000; try { return await currentPosition({ enableHighAccuracy:true, timeout:15000, maximumAge:maxAge }); } catch (err) { try { return await watchOnce({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 }); } catch(_){} try { return await currentPosition({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 }); } catch(_){} throw err; } }
  async function ensure(forceFresh=false, opts={}){ if (!forceFresh) { const c = cached(); if (c) return c; } if (opts.silent) return null; try { return await request(forceFresh); } catch (err) { const c = cached(60*60*1000); if (c) return c; throw err; } }
  function stopWatch(){ if (watchId === null || !navigator.geolocation) return; try { navigator.geolocation.clearWatch(watchId); } catch(_){} watchId = null; }
  function startWatch(){ if (!navigator.geolocation || watchId !== null) return; watchId = navigator.geolocation.watchPosition((pos)=>save(pos,'watch'), async(err)=>{ lastError = { code: err&&err.code, raw:String(err&&err.message||''), permission_state: await permissionState() }; announce('gejast:geo-error', lastError); }, { enableHighAccuracy:false, maximumAge:90*1000, timeout:12000 }); }
  function shouldExclude(){ const path = String((window.location && window.location.pathname) || '').toLowerCase(); return ['login.html','request.html','activate.html','scorer.html','boerenbridge.html','beerpong.html'].some((name)=>path.endsWith('/'+name) || path.endsWith(name)) || /\/admin[^/]*\.html$/.test(path); }
  function syncWatch(){ if (shouldExclude()) return stopWatch(); if (document.visibilityState === 'visible') startWatch(); else stopWatch(); }
  function startMonitor(options={}){
    if (shouldExclude()) return;
    const intervalMs = Math.max(45000, Number(options.intervalMs || 90000));
    syncWatch();
    if (!visibilityBound){ visibilityBound = true; document.addEventListener('visibilitychange', syncWatch); window.addEventListener('focus', syncWatch); }
    if (monitorId !== null) return;
    monitorId = window.setInterval(async()=>{ try { if (shouldExclude()) return stopMonitor(); const maxAge = document.visibilityState === 'visible' ? intervalMs : intervalMs * 2; if (!cached(maxAge)) await ensure(false, { silent:false }); } catch(_){} }, intervalMs);
  }
  function stopMonitor(){ if (monitorId !== null) { clearInterval(monitorId); monitorId = null; } stopWatch(); }
  function coordsKey(lat,lng){ return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`; }
  async function reverseGeocode(lat,lng){ const key=coordsKey(lat,lng); try { const map=JSON.parse(localStorage.getItem(ADDRESS_KEY)||'{}'); if (map[key] && (Date.now()-map[key].at)<86400000) return map[key].address; } catch(_){} try { const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,{headers:{Accept:'application/json'}}); const data=await res.json(); const address=data?.display_name||''; if (address) { try { const map=JSON.parse(localStorage.getItem(ADDRESS_KEY)||'{}'); map[key]={address,at:Date.now()}; localStorage.setItem(ADDRESS_KEY, JSON.stringify(map)); } catch(_){} } return address; } catch(_) { return ''; } }
  function formatCoords(pos){ if (!pos || !pos.coords) return ''; return `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} · nauwkeurigheid ${Math.round(pos.coords.accuracy || 0)}m`; }
  function getLastError(){ return lastError; }

  function ensureChromeStyle(){
    if (document.getElementById('gejast-geo-chrome-style')) return;
    const style=document.createElement('style'); style.id='gejast-geo-chrome-style'; style.textContent=`.gejast-corner-tools{position:fixed !important;top:14px !important;left:14px !important;right:auto !important;z-index:10020 !important;display:flex !important;align-items:center;gap:10px;flex:0 0 auto;pointer-events:auto}@media(max-width:640px){.gejast-corner-tools{top:auto !important;left:auto !important;right:12px !important;bottom:108px !important;flex-direction:column}}.gejast-geo-button,.gejast-notify-button{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:999px;border:1px solid rgba(0,0,0,.08);background:#ddd3cd;color:#7d6659;box-shadow:0 10px 24px rgba(0,0,0,.08);cursor:pointer;transition:background .18s ease,color .18s ease,border-color .18s ease,transform .12s ease}.gejast-geo-button svg,.gejast-notify-button svg{width:42px;height:42px;display:block;stroke:currentColor;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.gejast-geo-button:active,.gejast-notify-button:active{transform:translateY(1px)}.gejast-geo-button.is-ready,.gejast-notify-button.is-ready{background:#d7dfd3;color:#627c57;border-color:rgba(98,124,87,.22)}.gejast-geo-button.is-bad,.gejast-notify-button.is-bad{background:#ddd3cd;color:#8b6b61;border-color:rgba(139,107,97,.22)}.gejast-notify-button.is-pending{background:#f0e5bb;color:#7c6421;border-color:rgba(124,100,33,.26)}.gejast-notify-button.is-denied{background:#ead0cf;color:#934d4a;border-color:rgba(147,77,74,.26)}.gejast-logo-chip{display:inline-flex;width:54px;height:54px;border-radius:999px;align-items:center;justify-content:center;background:rgba(255,251,245,.82);border:1px solid rgba(0,0,0,.08);box-shadow:0 10px 22px rgba(0,0,0,.08)}.gejast-logo-chip img{width:48px;height:48px;display:block;object-fit:contain}.gejast-top-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:nowrap}.gejast-top-row>:first-child{min-width:0}.gejast-diagnostics-toast{position:fixed;right:14px;bottom:14px;z-index:10005;max-width:360px;background:rgba(17,17,17,.95);color:#fff;border-radius:18px;border:1px solid rgba(212,175,55,.34);padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.34)}.gejast-diagnostics-toast strong{display:block;margin-bottom:8px}.gejast-diagnostics-toast .row{font-size:13px;line-height:1.45;color:rgba(255,255,255,.9)}.gejast-diagnostics-toast .muted{color:rgba(255,255,255,.7)}.gejast-diagnostics-toast .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gejast-diagnostics-toast button{appearance:none;border:0;border-radius:999px;padding:8px 12px;font:inherit;font-weight:800;background:#9a8241;color:#111;cursor:pointer}.gejast-diagnostics-toast button.alt{background:rgba(255,255,255,.12);color:#fff}@media(max-width:640px){.gejast-corner-tools{gap:8px}.gejast-geo-button,.gejast-notify-button{width:58px;height:58px}.gejast-geo-button svg,.gejast-notify-button svg{width:38px;height:38px}.gejast-logo-chip{width:48px;height:48px}.gejast-logo-chip img{width:42px;height:42px}.gejast-diagnostics-toast{left:10px;right:10px;max-width:none;bottom:12px}}`;
    document.head.appendChild(style);
  }
  function dismissDiagnostics(){ const el=document.getElementById('gejastDiagnosticsToast'); if (el) el.remove(); }
  function showDiagnostics(title, rows, actions=[]){
    dismissDiagnostics();
    const box=document.createElement('div'); box.id='gejastDiagnosticsToast'; box.className='gejast-diagnostics-toast';
    box.innerHTML=`<strong>${title}</strong>${rows.map((r)=>`<div class="row">${r}</div>`).join('')}<div class="actions"></div>`;
    const host=box.querySelector('.actions');
    actions.forEach((a)=>{ const btn=document.createElement('button'); btn.type='button'; btn.textContent=a.label; if (a.alt) btn.classList.add('alt'); btn.addEventListener('click', ()=>{ try{ a.onClick && a.onClick(); } finally { if (!a.keepOpen) dismissDiagnostics(); } }); host.appendChild(btn); });
    if (!actions.length){ const btn=document.createElement('button'); btn.type='button'; btn.textContent='Sluiten'; btn.classList.add('alt'); btn.addEventListener('click', dismissDiagnostics); host.appendChild(btn); }
    document.body.appendChild(box);
    window.setTimeout(()=>{ const el=document.getElementById('gejastDiagnosticsToast'); if (el) el.remove(); }, 12000);
  }



  function browserLabel(){
    const ua = navigator.userAgent || '';
    if (isIOS()) return 'Safari';
    if (/Chrome/i.test(ua)) return 'Chrome';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    return 'browser';
  }
  function openNotificationHelpSheet(state){
    const rows = [
      `Platform: ${platformName()} · ${browserLabel()}`,
      state === 'denied' ? 'Meldingen staan nu geblokkeerd voor deze site.' : 'De browser heeft de meldingen-popup niet vrijgegeven.',
      ...mobilePermissionHelp('notification', state),
      isIOS() ? 'Safari/iPhone: open de browser-/site-instellingen voor deze website en zet meldingen weer aan. Open daarna de site opnieuw en druk weer op de bel.' : 'Android: open site-instellingen of browser-appinstellingen voor deze website en zet meldingen weer aan. Open daarna de site opnieuw en druk weer op de bel.'
    ];
    showDiagnostics('Hoe zet ik meldingen weer aan?', rows, [{ label:'Sluiten', alt:true }]);
  }
  async function openLocationHelpSheet(){
    const state = await permissionState();
    const rows = [
      `Platform: ${platformName()} · ${browserLabel()}`,
      state === 'denied' ? 'Locatie staat nu geblokkeerd voor deze site.' : 'De browser heeft de locatie-popup niet vrijgegeven.',
      ...mobilePermissionHelp('location', state),
      isIOS() ? 'Safari/iPhone: open de browser-/site-instellingen voor deze website en zet locatie weer aan. Open daarna de site opnieuw en druk weer op het vizier.' : 'Android: open site-instellingen of browser-appinstellingen voor deze website en zet locatie weer aan. Open daarna de site opnieuw en druk weer op het vizier.'
    ];
    showDiagnostics('Hoe zet ik locatie weer aan?', rows, [{ label:'Sluiten', alt:true }]);
  }
  function openNotificationPermissionSheet(){
    const state = notificationPermission();
    showDiagnostics('Meldingen opnieuw aanvragen', [
      `Platform: ${platformName()} · ${browserLabel()}`,
      'Druk hieronder op “Vraag opnieuw” om de browser nogmaals om meldingstoestemming te laten vragen.',
      ...mobilePermissionHelp('notification', state)
    ], [
      { label:'Vraag opnieuw', onClick:()=>requestNotificationAccess() },
      { label:'Hoe zet ik het weer aan?', onClick:()=>openNotificationHelpSheet(state) },
      { label:'Sluiten', alt:true }
    ]);
  }
  function openLocationPermissionSheet(){
    showDiagnostics('Locatie opnieuw aanvragen', [
      `Platform: ${platformName()} · ${browserLabel()}`,
      'Druk hieronder op “Vraag opnieuw” om de browser nogmaals om locatietoestemming te laten vragen.'
    ], [
      { label:'Vraag opnieuw', onClick:()=>requestGeoAccess() },
      { label:'Hoe zet ik het weer aan?', onClick:()=>openLocationHelpSheet() },
      { label:'Sluiten', alt:true }
    ]);
  }
  function playerToken(){ for (const key of SESSION_KEYS){ const value = localStorage.getItem(key) || sessionStorage.getItem(key); if (value) return value; } return ''; }
  function rpcHeaders(key=''){ return { 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}`, Accept:'application/json' }; }
  async function parseJson(res){ const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch(_) { throw new Error(t || `HTTP ${res.status}`); } if (!res.ok) throw new Error(d?.message || d?.error || `HTTP ${res.status}`); return d; }

  function notificationSupported(){ return !!(window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator); }
  function notificationPermission(){ try { return notificationSupported() ? Notification.permission : 'unsupported'; } catch(_) { return 'unsupported'; } }
  async function registerNotificationWorker(){
    if (!notificationSupported()) return null;
    try {
      const reg = await navigator.serviceWorker.register('./gejast-sw.js?v303', { scope:'./' });
      return await navigator.serviceWorker.ready.catch(()=>reg);
    } catch(_) { return null; }
  }
  function urlBase64ToUint8Array(base64String){
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64); const output = new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) output[i] = raw.charCodeAt(i);
    return output;
  }


  async function requestGeoAccess(){
    try {
      const pos = await request(true);
      if (pos) startMonitor();
      setButtonState(!!pos);
      showDiagnostics('Locatie actief', [
        `Toestemming: granted`,
        formatCoords(pos) || 'Locatie opgeslagen.'
      ], [{ label:'Sluiten', alt:true }]);
      return { granted:true, position:pos };
    } catch (err) {
      const perm = await permissionState();
      setButtonState(!!cached());
      showDiagnostics('Locatie opnieuw gevraagd', [
        `Platform: ${platformName()}`,
        `Toestemming: ${perm}`,
        (err && err.message) || 'Locatie ophalen mislukt.',
        ...mobilePermissionHelp('location', perm),
        perm === 'granted' ? 'Locatie staat aan; probeer het nog eens als gps of netwerk tijdelijk geen positie gaf.' : 'Druk opnieuw op de locatieknop om het nog een keer te proberen.'
      ], [{ label:'Sluiten', alt:true }]);
      return { granted:false, reason:(err && err.message) || 'geo-failed', permission:perm };
    }
  }

  async function queueBackendTestPush(){
    const cfg = window.GEJAST_CONFIG || {};
    const token = playerToken();
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || !token) return { queued:false, reason:'missing-context' };
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${cfg.WEB_PUSH_TEST_RPC || 'queue_test_web_push'}`, {
        method:'POST', headers: rpcHeaders(cfg.SUPABASE_PUBLISHABLE_KEY), body: JSON.stringify({ session_token: token })
      });
      return { queued:true, payload: await parseJson(res) };
    } catch(err) {
      return { queued:false, reason:(err && err.message) || 'queue-failed' };
    }
  }

  async function syncPushSubscriptionToBackend(subscription, extras={}){
    const cfg = window.GEJAST_CONFIG || {};
    const token = playerToken();
    if (!subscription || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || !token) return { synced:false, reason:'missing-context' };
    try {
      const json = subscription.toJSON ? subscription.toJSON() : subscription;
      const out = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/register_web_push_subscription`, {
        method:'POST', headers: rpcHeaders(cfg.SUPABASE_PUBLISHABLE_KEY),
        body: JSON.stringify({
          session_token: token,
          endpoint_input: json.endpoint || subscription.endpoint || '',
          p256dh_input: json.keys?.p256dh || extras.p256dh || '',
          auth_input: json.keys?.auth || extras.auth || '',
          user_agent_input: navigator.userAgent || '',
          permission_input: notificationPermission()
        })
      });
      return { synced:true, payload: await parseJson(out) };
    } catch(err) {
      return { synced:false, reason:(err && err.message) || 'sync-failed' };
    }
  }

  async function ensurePushSubscription(){
    const cfg = window.GEJAST_CONFIG || {};
    const vapid = String(cfg.WEB_PUSH_PUBLIC_KEY || '').trim();
    if (!vapid || !('PushManager' in window)) return { supported: false, reason: vapid ? 'push-unavailable' : 'no-vapid-key', subscription: null };
    const reg = await registerNotificationWorker();
    if (!reg || !reg.pushManager) return { supported: false, reason:'sw-unavailable', subscription:null };
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(vapid) });
      const sync = await syncPushSubscriptionToBackend(sub);
      return { supported:true, reason:'ok', subscription:sub, backendSync:sync };
    } catch(err) {
      return { supported:false, reason:(err && err.message) || 'subscribe-failed', subscription:null };
    }
  }
  async function getNotificationDiagnostics(){
    const supported = notificationSupported();
    const permission = notificationPermission();
    let workerReady = false;
    let pushSupported = false;
    let subscribed = false;
    let pushReason = '';
    try {
      if (supported) {
        const reg = await registerNotificationWorker();
        workerReady = !!reg;
        pushSupported = !!(reg && reg.pushManager && 'PushManager' in window);
        if (pushSupported) {
          const sub = await reg.pushManager.getSubscription();
          subscribed = !!sub;
        }
      }
    } catch(err) { pushReason = (err && err.message) || ''; }
    const state = { supported, permission, workerReady, pushSupported, subscribed, secure: !!window.isSecureContext, visibility: document.visibilityState, userAgent: navigator.userAgent || '', pushReason };
    notifyStateCache = state;
    announce('gejast:notification-state', state);
    return state;
  }
  function setNotificationButtonState(permission, extras={}){
    document.querySelectorAll('[data-gejast-notify-button]').forEach((btn)=>{
      const p = permission || 'unsupported';
      btn.classList.toggle('is-ready', p === 'granted');
      btn.classList.toggle('is-pending', p === 'default');
      btn.classList.toggle('is-denied', p === 'denied' || p === 'unsupported');
      btn.classList.toggle('is-bad', p === 'denied' || p === 'unsupported');
      let title = 'Meldingen instellen';
      if (p === 'granted') title = extras.subscribed ? 'Meldingen actief' : 'Meldingen toegestaan';
      else if (p === 'default') title = 'Meldingen inschakelen';
      else if (p === 'denied') title = 'Meldingen geblokkeerd';
      else if (p === 'unsupported') title = 'Meldingen niet ondersteund';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.setAttribute('aria-pressed', p === 'granted' ? 'true' : 'false');
    });
  }
  async function refreshNotificationButton(){
    const state = await getNotificationDiagnostics();
    setNotificationButtonState(state.permission, state);
    return state;
  }
  async function requestNotificationAccess(){
    if (!notificationSupported()) {
      const rows = [
        `<span class="muted">Deze browser ondersteunt webmeldingen hier niet goed of de site draait niet via https.</span>`,
        `Secure context: ${window.isSecureContext ? 'ja' : 'nee'}`
      ];
      showDiagnostics('Meldingen niet beschikbaar', rows);
      return { granted:false, reason:'unsupported' };
    }
    await registerNotificationWorker();
    let permission = notificationPermission();
    try {
      permission = await Notification.requestPermission();
    } catch(_) {}
    const state = await refreshNotificationButton();
    if (permission === 'granted') {
      const sub = await ensurePushSubscription();
      const updated = await refreshNotificationButton();
      const queuedTest = sub.subscription ? await queueBackendTestPush() : { queued:false, reason:'no-subscription' };
      showDiagnostics('Meldingen opnieuw gevraagd', [
        `Platform: ${platformName()}`,
        `Browsertoestemming: ${updated.permission}`,
        `Service worker: ${updated.workerReady ? 'klaar' : 'niet klaar'}`,
        `Push-abonnement: ${sub.subscription ? 'actief' : (sub.reason === 'no-vapid-key' ? 'mist publieke VAPID-sleutel in gejast-config.js' : 'niet actief')}`,
        `Backend test-queue: ${queuedTest.queued ? 'klaargezet' : (queuedTest.reason === 'no-subscription' ? 'geen push-abonnement opgeslagen' : (queuedTest.reason || 'niet klaar'))}`,
        ...mobilePermissionHelp('notification', updated.permission)
      ], [{ label:'Sluiten', alt:true }]);
      return { granted:true, state:updated, subscription:sub, queuedTest };
    }
    const actions=[];
    if (permission === 'denied') actions.push({ label:'Instellingen uitleg', onClick:()=>showDiagnostics('Meldingen geblokkeerd', ['De browser laat geen nieuwe native prompt meer zien zolang meldingen voor deze site op geblokkeerd staan. Zet het handmatig weer aan in je browser/site-instellingen en druk daarna opnieuw op de belknop.'], [{label:'Sluiten', alt:true}]), keepOpen:false });
    showDiagnostics('Meldingen opnieuw gevraagd', [
      `Platform: ${platformName()}`,
      `Browsertoestemming: ${permission}`,
      permission === 'denied' ? 'De browser heeft meldingen voor deze site geblokkeerd en toont daarom geen nieuwe native popup.' : 'De browser heeft de toestemmingsvraag niet vrijgegeven.',
      ...mobilePermissionHelp('notification', permission)
    ], [{ label:'Sluiten', alt:true }, ...actions]);
    return { granted:false, reason:permission, state };
  }
  async function showNotificationFromServiceWorker(title, options={}){
    if (!notificationSupported()) return false;
    try {
      const reg = await registerNotificationWorker();
      if (!reg || notificationPermission() !== 'granted') return false;
      await reg.showNotification(title || 'Gejast', Object.assign({ tag:'gejast-generic', badge:'./logo.png', icon:'./logo.png' }, options || {}));
      try { localStorage.setItem(NOTIFY_LAST_KEY, String(Date.now())); } catch(_){}
      return true;
    } catch(_) { return false; }
  }
  function bindGeoButton(btn){ if (!btn || btn.dataset.geoBound==='1') return; btn.dataset.geoBound='1'; btn.addEventListener('click', ()=>{ openLocationPermissionSheet(); }); }
  function bindNotifyButton(btn){ if (!btn || btn.dataset.notifyBound==='1') return; btn.dataset.notifyBound='1'; btn.addEventListener('click', ()=>{ openNotificationPermissionSheet(); }); }
  function createButton(){ const btn=document.createElement('button'); btn.type='button'; btn.className='gejast-geo-button is-bad'; btn.setAttribute('data-gejast-geo-button','1'); btn.setAttribute('aria-label','Geolocatie opnieuw proberen'); btn.title='Geolocatie opnieuw proberen'; btn.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v8M32 50v8M6 32h8M50 32h8"/><circle cx="32" cy="32" r="20" fill="none"/><circle cx="32" cy="32" r="9" fill="currentColor" stroke="none"/></svg>'; bindGeoButton(btn); return btn; }
  function createNotifyButton(){ const btn=document.createElement('button'); btn.type='button'; btn.className='gejast-notify-button is-pending'; btn.setAttribute('data-gejast-notify-button','1'); btn.setAttribute('aria-label','Meldingen inschakelen'); btn.title='Meldingen inschakelen'; btn.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 46h28"/><path d="M24 46V28c0-10 16-10 16 0v18"/><path d="M20 46c2-2 4-6 4-10"/><path d="M44 46c-2-2-4-6-4-10"/><path d="M28 52c1 3 3 4 4 4s3-1 4-4"/></svg>'; bindNotifyButton(btn); return btn; }
  function ensureCornerTools(){
    if (shouldExclude()) return null;
    ensureChromeStyle();
    let existing=document.querySelector('.gejast-corner-tools');
    if (!existing){
      existing=document.createElement('div');
      existing.className='gejast-corner-tools';
      existing.appendChild(createButton());
      if ((window.GEJAST_CONFIG||{}).NOTIFICATION_BUTTON_ENABLED !== false) existing.appendChild(createNotifyButton());
      const mount = document.getElementById('gejastTopRightToolsMount');
      (mount || document.body || document.documentElement).appendChild(existing);
    }
    existing.style.position='fixed';
    if (window.innerWidth <= 640){ existing.style.top='auto'; existing.style.left='auto'; existing.style.right='12px'; existing.style.bottom='108px'; existing.style.flexDirection='column'; } else { existing.style.top='14px'; existing.style.left='14px'; existing.style.right='auto'; existing.style.bottom='auto'; existing.style.flexDirection='row'; }
    existing.style.zIndex='10020';
    existing.style.display='flex';
    existing.style.pointerEvents='auto';
    existing.style.visibility='visible';
    existing.style.opacity='1';
    existing.querySelectorAll('[data-gejast-geo-button]').forEach(bindGeoButton);
    existing.querySelectorAll('[data-gejast-notify-button]').forEach(bindNotifyButton);
    return existing;
  }
  function setButtonState(ready){ buttonsReadyState = !!ready; document.querySelectorAll('[data-gejast-geo-button]').forEach((btn)=>{ btn.classList.toggle('is-ready',!!ready); btn.classList.toggle('is-bad',!ready); btn.title = ready ? 'Geolocatie actief' : 'Geolocatie opnieuw proberen'; btn.setAttribute('aria-pressed', ready ? 'true' : 'false'); }); }
  window.GEJAST_GEO = { cached, ensure, request, requestGeoAccess, startWatch, stopWatch, startMonitor, stopMonitor, permissionState, message, reverseGeocode, formatCoords, getLastError, setButtonState, ensureCornerTools, notificationSupported, notificationPermission, registerNotificationWorker, ensurePushSubscription, syncPushSubscriptionToBackend, queueBackendTestPush, getNotificationDiagnostics, refreshNotificationButton, requestNotificationAccess, showNotificationFromServiceWorker, setNotificationButtonState, showDiagnostics };
  function init(){ if (!shouldExclude()) ensureCornerTools(); setButtonState(!!cached()); refreshNotificationButton().catch(()=>{}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
  window.addEventListener('load', ()=>{ try { ensureCornerTools(); refreshNotificationButton().catch(()=>{}); } catch(_){} });
  window.addEventListener('resize', ()=>{ try { ensureCornerTools(); } catch(_){} });
  let retryCount = 0; const retryId = window.setInterval(()=>{ try { if (shouldExclude()) { clearInterval(retryId); return; } const el = ensureCornerTools(); if (el) retryCount += 1; if (retryCount >= 8) clearInterval(retryId); } catch(_){} }, 1200);
})();
