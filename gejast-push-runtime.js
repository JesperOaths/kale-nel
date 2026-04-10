(function(){
  if (window.GEJAST_PUSH_RUNTIME) return;
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || '';
  const VAPID = String(cfg.WEB_PUSH_PUBLIC_KEY || '').trim();
  const PLAYER_KEYS = Array.isArray(cfg.PLAYER_SESSION_KEYS) && cfg.PLAYER_SESSION_KEYS.length ? cfg.PLAYER_SESSION_KEYS : ['jas_session_token_v11','jas_session_token_v10'];
  const RPC = {
    registerV3: cfg.WEB_PUSH_REGISTER_RPC_V3 || 'register_web_push_subscription_v3',
    touchV3: cfg.ACTIVE_PUSH_TOUCH_RPC_V3 || 'touch_active_web_push_presence_v3',
    selfDiagV3: cfg.WEB_PUSH_SELF_DIAGNOSTICS_RPC_V3 || 'get_web_push_self_diagnostics_v3',
    queueNearbyV3: cfg.WEB_PUSH_QUEUE_NEARBY_RPC_V3 || 'queue_nearby_verification_pushes_v3',
    consumeV3: cfg.WEB_PUSH_CONSUME_ACTION_RPC_V3 || 'consume_web_push_action_v3',
    adminDiagV3: cfg.ADMIN_PUSH_DIAGNOSTICS_RPC_V3 || 'admin_get_web_push_diagnostics_v3',
    adminQueueV3: cfg.ADMIN_ACTIVE_PUSH_RPC_V3 || 'admin_queue_active_web_push_v3',
    testQueue: cfg.WEB_PUSH_TEST_RPC || 'queue_test_web_push'
  };

  function getToken(){
    if (cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken() || '').trim();
    for (const key of PLAYER_KEYS){ const value = localStorage.getItem(key) || sessionStorage.getItem(key); if (value) return String(value).trim(); }
    return '';
  }
  function headers(){ return { 'Content-Type':'application/json', apikey:KEY, Authorization:`Bearer ${KEY}`, Accept:'application/json' }; }
  async function parse(res){
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, body){
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(body || {}) });
    const raw = await parse(res);
    return raw?.[name] || raw;
  }
  function platformName(){ const ua = navigator.userAgent || ''; if (/iphone|ipad|ipod/i.test(ua)) return 'ios'; if (/android/i.test(ua)) return 'android'; return 'desktop'; }
  function isIOS(){ return platformName() === 'ios'; }
  function isStandalone(){ return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true); }
  function installationMode(){ if (isIOS()) return isStandalone() ? 'ios_standalone' : 'ios_browser'; return isStandalone() ? 'standalone' : 'browser'; }
  function notificationSupported(){ return !!(window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator); }
  function notificationPermission(){ return 'Notification' in window ? Notification.permission : 'unsupported'; }
  function notificationActionsSupported(){ try { return Number(Notification.maxActions || 0) > 0; } catch (_) { return platformName() === 'android'; } }
  function directActionSupported(){ return notificationActionsSupported() && (!isIOS() || isStandalone()); }
  function inferScope(){ try { const qs = new URLSearchParams(location.search || ''); return (cfg.normalizeScope ? cfg.normalizeScope(qs.get('scope')) : ((qs.get('scope') || '').toLowerCase() === 'family' ? 'family' : 'friends')); } catch (_) { return 'friends'; } }
  function pagePath(){ return `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`; }
  function userAgent(){ return navigator.userAgent || ''; }
  function urlBase64ToUint8Array(base64String){ const padding = '='.repeat((4 - base64String.length % 4) % 4); const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(base64); const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  async function registerWorker(){ if (!notificationSupported()) return null; const version = (cfg.VERSION || window.GEJAST_PAGE_VERSION || 'v383'); return navigator.serviceWorker.register(`./gejast-sw.js?${version}`, { scope:'./' }); }
  async function getSubscription(){ const reg = await registerWorker(); if (!reg || !reg.pushManager) return null; return reg.pushManager.getSubscription(); }
  async function ensureSubscription(){ const reg = await registerWorker(); if (!reg || !reg.pushManager || !VAPID) return null; let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(VAPID) }); return sub; }
  async function syncSubscription(subscription, options={}){
    const token = getToken();
    if (!token || !subscription) return { synced:false, reason:'missing-context' };
    const json = subscription.toJSON ? subscription.toJSON() : subscription;
    const payload = {
      session_token_input: token,
      endpoint_input: json.endpoint || subscription.endpoint || '',
      p256dh_input: json.keys?.p256dh || '',
      auth_input: json.keys?.auth || '',
      user_agent_input: userAgent(),
      permission_input: notificationPermission(),
      standalone_input: isStandalone(),
      site_scope_input: options.scope || inferScope(),
      page_path_input: options.pagePath || pagePath(),
      platform_input: platformName(),
      installation_mode_input: installationMode()
    };
    try {
      const result = await rpc(RPC.registerV3, payload);
      return { synced:true, payload:result };
    } catch (err) {
      return { synced:false, reason:(err && err.message) || 'register-failed' };
    }
  }
  async function touchPresence(input=null){
    const token = getToken();
    if (!token) return { touched:false, reason:'missing-session' };
    let sub = input;
    let options = {};
    if (input && !input.endpoint && !input.toJSON && (input.subscription || input.force || input.pagePath || input.scope || input.location)) {
      options = input;
      sub = input.subscription || null;
    }
    try {
      if (!sub) sub = await getSubscription();
      const json = sub && (sub.toJSON ? sub.toJSON() : sub);
      const location = options.location || null;
      const payload = {
        session_token_input: token,
        endpoint_input: json?.endpoint || sub?.endpoint || null,
        p256dh_input: json?.keys?.p256dh || null,
        auth_input: json?.keys?.auth || null,
        page_path_input: options.pagePath || pagePath(),
        permission_input: notificationPermission(),
        standalone_input: isStandalone(),
        site_scope_input: options.scope || inferScope(),
        platform_input: platformName(),
        installation_mode_input: installationMode(),
        user_agent_input: userAgent(),
        lat_input: location && location.lat != null ? Number(location.lat) : null,
        lng_input: location && location.lng != null ? Number(location.lng) : null,
        accuracy_input: location && location.accuracy != null ? Number(location.accuracy) : null
      };
      const result = await rpc(RPC.touchV3, payload);
      return { touched:true, payload:result };
    } catch (err) {
      return { touched:false, reason:(err && err.message) || 'touch-failed' };
    }
  }
  async function queueTest(){
    const token = getToken();
    if (!token) return { queued:false, reason:'missing-session' };
    try {
      const result = await rpc(RPC.testQueue, { session_token_input: token, session_token: token, site_scope_input: inferScope() });
      return { queued:true, payload:result };
    } catch (err) {
      return { queued:false, reason:(err && err.message) || 'queue-failed' };
    }
  }
  function computeReadiness(diag){
    if (!notificationSupported()) return { key:'unsupported', label:'niet ondersteund' };
    if (!window.isSecureContext) return { key:'insecure_context', label:'geen veilige context' };
    if (isIOS() && !isStandalone()) return { key:'ios_not_installed', label:'iPhone niet als app geopend' };
    if (notificationPermission() !== 'granted') return { key:'permission_required', label:'toestemming ontbreekt' };
    if (!diag.workerReady) return { key:'worker_missing', label:'service worker ontbreekt' };
    if (!diag.subscription) return { key:'subscription_missing', label:'abonnement ontbreekt' };
    if (!(diag.backendSync && diag.backendSync.synced)) return { key:'backend_sync_missing', label:'backend-sync ontbreekt' };
    if (!(diag.presenceTouch && diag.presenceTouch.touched)) return { key:'presence_missing', label:'presence ontbreekt' };
    return { key:directActionSupported() ? 'ready_actionable' : 'ready_passive', label:directActionSupported() ? 'actie-klaar' : 'passief klaar' };
  }
  async function getSelfDiagnostics(options={}){
    let workerReady = false;
    let subscription = null;
    try {
      const reg = await registerWorker();
      workerReady = !!reg;
      if (reg && reg.pushManager) subscription = await reg.pushManager.getSubscription();
    } catch (_) {}
    const local = {
      platform: platformName(),
      standalone: isStandalone(),
      installationMode: installationMode(),
      actionsSupported: notificationActionsSupported(),
      directActionSupported: directActionSupported(),
      permission: notificationPermission(),
      workerReady,
      subscription: !!subscription
    };
    const backendSync = subscription ? await syncSubscription(subscription, options) : { synced:false, reason:'no-subscription' };
    const presenceTouch = subscription ? await touchPresence({ subscription, pagePath: options.pagePath, scope: options.scope, location: options.location || null }) : { touched:false, reason:'no-subscription' };
    let backend = null;
    const token = getToken();
    if (token) {
      try {
        backend = await rpc(RPC.selfDiagV3, {
          session_token_input: token,
          page_path_input: options.pagePath || pagePath(),
          site_scope_input: options.scope || inferScope(),
          platform_input: platformName(),
          installation_mode_input: installationMode(),
          permission_input: notificationPermission(),
          standalone_input: isStandalone()
        });
      } catch (_) {}
    }
    const backendTest = options.queueTest ? await queueTest() : null;
    const diag = Object.assign({}, local, { backend, backendSync, presenceTouch, backendTest });
    diag.readiness = computeReadiness(diag);
    window.GEJAST_PUSH_RUNTIME.__lastDiagnostics = diag;
    return diag;
  }
  async function requestPermissionAndSync(options={}){
    if (!notificationSupported()) return { granted:false, reason:'unsupported', diagnostics: await getSelfDiagnostics(options) };
    try { await registerWorker(); } catch (_) {}
    let permission = notificationPermission();
    if (permission !== 'granted') {
      try { permission = await Notification.requestPermission(); } catch (_) {}
    }
    if (permission !== 'granted') return { granted:false, reason:permission, diagnostics: await getSelfDiagnostics(options) };
    const subscription = await ensureSubscription();
    const backendSync = subscription ? await syncSubscription(subscription, options) : { synced:false, reason:'subscription-failed' };
    const presenceTouch = subscription ? await touchPresence({ subscription, pagePath: options.pagePath, scope: options.scope, location: options.location || null }) : { touched:false, reason:'subscription-failed' };
    const diagnostics = await getSelfDiagnostics(options);
    const result = { granted:true, subscription, backendSync, presenceTouch, diagnostics, readiness: diagnostics && diagnostics.readiness && diagnostics.readiness.key || '' };
    window.GEJAST_PUSH_RUNTIME.__lastDiagnostics = result;
    return result;
  }
  async function consumeActionToken(actionToken){ if (!actionToken) return { ok:false, reason:'missing-token' }; try { const result = await rpc(RPC.consumeV3, { action_token_input: actionToken }); return Object.assign({ ok:true }, result || {}); } catch (err) { return { ok:false, reason:(err && err.message) || 'consume-failed' }; } }
  async function queueNearbyVerificationPushes(payload){ try { return await rpc(RPC.queueNearbyV3, payload || {}); } catch (err) { return { ok:false, reason:(err && err.message) || 'queue-nearby-failed' }; } }
  window.GEJAST_PUSH_RUNTIME = {
    notificationSupported, notificationPermission, notificationActionsSupported, directActionSupported,
    isStandalone, isIOS, installationMode, platformName,
    registerWorker, getSubscription, ensureSubscription, syncSubscription, touchPresence, queueTest,
    getSelfDiagnostics, requestPermissionAndSync, consumeActionToken, queueNearbyVerificationPushes,
    inferScope, pagePath
  };
})();
