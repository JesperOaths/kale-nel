
(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;

  const currentFile = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (['home.html','login.html','request.html','activate.html','activation.html','forgot.html','reset.html'].includes(currentFile)) return;

  const VISITOR_KEY = 'gejast_visitor_id_v2';
  const SESSION_KEY = 'gejast_visit_session_id_v2';
  const TRACKED_KEY = 'gejast_last_tracked_path_v2';
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const PLAYER_SESSION_KEYS = ['jas_session_token_v11','jas_session_token_v10'];
  const ADMIN_SESSION_KEYS = ['jas_admin_session_v8'];
  const PROFILE_CACHE_KEY = 'gejast_analytics_profile_cache_v1';
  const PROFILE_CACHE_MS = 5 * 60 * 1000;
  const now = Date.now();

  function randomId(prefix){
    try {
      const raw = new Uint8Array(16);
      crypto.getRandomValues(raw);
      return prefix + Array.from(raw).map(v => v.toString(16).padStart(2,'0')).join('');
    } catch (_) {
      return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }
  function getOrSet(storage, key, prefix){
    let value = storage.getItem(key);
    if (!value) {
      value = randomId(prefix);
      storage.setItem(key, value);
    }
    return value;
  }
  function getStorageValue(keys, storageList){
    for (const storage of storageList) {
      if (!storage) continue;
      for (const key of keys) {
        try {
          const value = storage.getItem(key);
          if (value) return value;
        } catch (_) {}
      }
    }
    return '';
  }
  function detectDeviceType(){
    const ua = navigator.userAgent || '';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobi|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function detectBrowser(){
    const ua = navigator.userAgent || '';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/edg/i.test(ua)) return 'Edge';
    if (/chrome|crios/i.test(ua)) return 'Chrome';
    if (/safari/i.test(ua) && !/chrome|crios|edg/i.test(ua)) return 'Safari';
    return 'Onbekend';
  }
  function detectOS(){
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac os/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Onbekend';
  }
  function rpcHeaders(){
    return {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }
  async function rpc(name, payload){
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', mode: 'cors', cache: 'no-store', keepalive: true,
      headers: rpcHeaders(), body: JSON.stringify(payload || {})
    });
    return parseResponse(res);
  }
  function getCachedProfile(){
    try {
      const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.cached_at || now - Number(data.cached_at) > PROFILE_CACHE_MS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }
  function setCachedProfile(data){
    try { sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(Object.assign({ cached_at: Date.now() }, data || {}))); } catch (_) {}
  }
  async function resolveProfile(){
    const cached = getCachedProfile();
    if (cached) return cached;
    const playerToken = getStorageValue(PLAYER_SESSION_KEYS, [sessionStorage, localStorage]);
    const adminToken = getStorageValue(ADMIN_SESSION_KEYS, [sessionStorage, localStorage]);
    const profile = { player_name: null, is_logged_in: false, is_admin: false };

    if (playerToken) {
      try {
        const data = await rpc('get_public_state', { session_token: playerToken });
        if (data && data.my_name) {
          profile.player_name = data.my_name;
          profile.is_logged_in = true;
        }
      } catch (_) {}
    }
    if (adminToken) {
      try {
        const data = await rpc('admin_check_session', { admin_session_token: adminToken });
        if (data && data.ok) profile.is_admin = true;
      } catch (_) {}
    }
    setCachedProfile(profile);
    return profile;
  }

  const visitorId = getOrSet(localStorage, VISITOR_KEY, 'vis_');
  let sessionMeta = null;
  try { sessionMeta = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}
  if (!sessionMeta || !sessionMeta.id || !sessionMeta.started_at || (now - Number(sessionMeta.last_seen_at || sessionMeta.started_at) > IDLE_TIMEOUT_MS)) {
    sessionMeta = { id: randomId('ses_'), started_at: now, last_seen_at: now };
  } else {
    sessionMeta.last_seen_at = now;
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionMeta));

  const path = location.pathname.replace(/\/+/g,'/');
  const fullUrl = location.origin + path + location.search + location.hash;
  const trackKey = path + '|' + sessionMeta.id;
  const basePayload = {
    page_path: path,
    page_url: fullUrl,
    page_title: document.title || '',
    referrer_url: document.referrer || '',
    visitor_id: visitorId,
    session_id: sessionMeta.id,
    device_type: detectDeviceType(),
    browser_name: detectBrowser(),
    os_name: detectOS(),
    viewport_width: window.innerWidth || null,
    viewport_height: window.innerHeight || null,
    language_code: navigator.language || null,
    time_zone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
    user_agent: navigator.userAgent || null,
    extra: {
      host: location.host,
      search: location.search || '',
      hash: location.hash || '',
      screen_width: window.screen && window.screen.width || null,
      screen_height: window.screen && window.screen.height || null,
      pixel_ratio: window.devicePixelRatio || 1
    }
  };

  function sendEvent(payload){
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        const ok = navigator.sendBeacon(`${SUPABASE_URL}/rest/v1/rpc/track_site_event`, blob);
        if (ok) return Promise.resolve();
      } catch (_) {}
    }
    return fetch(`${SUPABASE_URL}/rest/v1/rpc/track_site_event`, {
      method: 'POST', mode: 'cors', keepalive: true,
      headers: rpcHeaders(), body
    }).catch(() => {});
  }


  async function getExistingPushSubscription(){
    try {
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
      const version = (window.GEJAST_CONFIG && window.GEJAST_CONFIG.VERSION) || 'v311';
      const reg = await navigator.serviceWorker.register(`./gejast-sw.js?${version}`, { scope:'./' });
      if (!reg || !reg.pushManager) return null;
      return await reg.pushManager.getSubscription();
    } catch (_) { return null; }
  }
  async function touchActivePushPresence(profile){
    try {
      const runtime = window.GEJAST_PUSH_RUNTIME;
      if (!runtime || typeof runtime.touchPresence !== 'function') return;
      if (!(profile && profile.is_logged_in) || Notification.permission !== 'granted') return;
      await runtime.touchPresence({ force:true, pagePath:path, scope:(profile && profile.site_scope) || undefined }).catch(()=>{});
    } catch (_) {}
  }

  resolveProfile().then((profile) => {
    const enriched = Object.assign({}, basePayload, profile || {});
    if (sessionStorage.getItem(TRACKED_KEY) !== trackKey) {
      sessionStorage.setItem(TRACKED_KEY, trackKey);
      sendEvent(Object.assign({}, enriched, { event_name: 'page_view', event_category: 'navigatie', event_label: path }));
    }

    function trackClick(event){
      const target = event.target && event.target.closest ? event.target.closest('a,button,[data-analytics-label],[type="submit"]') : null;
      if (!target) return;
      const label = (target.getAttribute('data-analytics-label') || target.textContent || target.getAttribute('aria-label') || '').trim().slice(0, 120);
      if (!label) return;
      const href = target.getAttribute('href') || '';
      const type = target.tagName === 'A' ? 'link_klik' : 'knop_klik';
      sendEvent(Object.assign({}, enriched, {
        event_name: type,
        event_category: 'klik',
        event_label: label,
        extra: Object.assign({}, enriched.extra, { href, id: target.id || '', class_name: target.className || '' })
      }));
    }

    function trackForm(event){
      const form = event.target;
      if (!form || !form.tagName || form.tagName !== 'FORM') return;
      const label = (form.getAttribute('data-analytics-label') || form.id || form.getAttribute('name') || 'formulier').trim().slice(0, 120);
      sendEvent(Object.assign({}, enriched, {
        event_name: 'formulier_verzonden',
        event_category: 'formulier',
        event_label: label
      }));
    }

    document.addEventListener('click', trackClick, true);
    document.addEventListener('submit', trackForm, true);
    touchActivePushPresence(profile);
    setInterval(() => { if (!document.hidden) touchActivePushPresence(profile); }, 60000);
  }).catch(() => {
    if (sessionStorage.getItem(TRACKED_KEY) !== trackKey) {
      sessionStorage.setItem(TRACKED_KEY, trackKey);
      sendEvent(Object.assign({}, basePayload, { event_name: 'page_view', event_category: 'navigatie', event_label: path }));
    }
  });
})();
