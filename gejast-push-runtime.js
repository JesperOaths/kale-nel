(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_PUSH_RUNTIME = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];

  function cfg() {
    const config = root.GEJAST_CONFIG || {};
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('GEJAST_CONFIG ontbreekt of mist Supabase-config.');
    }
    return config;
  }

  function sessionToken() {
    if (root.GEJAST_CONFIG && typeof root.GEJAST_CONFIG.getPlayerSessionToken === 'function') {
      return root.GEJAST_CONFIG.getPlayerSessionToken() || '';
    }
    for (const key of SESSION_KEYS) {
      const value = root.localStorage.getItem(key) || root.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isStandalone() {
    try {
      return !!((root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
    } catch (_) {
      return false;
    }
  }

  function installationMode() {
    if (isIOS()) return isStandalone() ? 'ios_home_screen' : 'ios_browser';
    if (isAndroid()) return isStandalone() ? 'android_pwa' : 'android_browser';
    return isStandalone() ? 'standalone' : 'browser';
  }

  function platformLabel() {
    if (isIOS()) return 'iPhone/iPad';
    if (isAndroid()) return 'Android';
    return 'Browser';
  }

  function notificationsSupported() {
    return !!(root.isSecureContext && 'Notification' in root && 'serviceWorker' in navigator && 'PushManager' in root);
  }

  function permission() {
    try {
      return notificationsSupported() ? Notification.permission : 'unsupported';
    } catch (_) {
      return 'unsupported';
    }
  }

  function rpcHeaders() {
    const c = cfg();
    return {
      apikey: c.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${c.SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parseJson(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(data?.message || data?.error || text || `HTTP ${response.status}`);
    return data;
  }

  async function rpc(name, payload) {
    const c = cfg();
    const res = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseJson(res);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function registerWorker() {
    if (!notificationsSupported()) return null;
    const c = cfg();
    const reg = await navigator.serviceWorker.register(`./gejast-sw.js?${encodeURIComponent(root.GEJAST_PAGE_VERSION || c.VERSION || 'v352')}`, { scope: './' });
    return navigator.serviceWorker.ready.catch(() => reg);
  }

  async function getSubscription() {
    const reg = await registerWorker();
    if (!reg || !reg.pushManager) return null;
    return reg.pushManager.getSubscription();
  }

  async function ensureSubscription() {
    const c = cfg();
    const key = String(c.WEB_PUSH_PUBLIC_KEY || '').trim();
    if (!key) return { ok: false, code: 'MISSING_VAPID_PUBLIC_KEY', subscription: null };
    const reg = await registerWorker();
    if (!reg || !reg.pushManager) return { ok: false, code: 'WORKER_UNAVAILABLE', subscription: null };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }
    return { ok: true, code: 'SUBSCRIBED', subscription: sub };
  }

  function subscriptionSnapshot(subscription) {
    if (!subscription) return null;
    const json = subscription.toJSON ? subscription.toJSON() : subscription;
    const endpoint = json?.endpoint || subscription.endpoint || '';
    return {
      endpoint,
      p256dh: json?.keys?.p256dh || '',
      auth: json?.keys?.auth || ''
    };
  }

  async function syncSubscriptionAndPresence(options) {
    const opts = Object.assign({ forceTouch: true, pagePath: root.location.pathname + root.location.search + root.location.hash, lat: null, lng: null, accuracy: null }, options || {});
    const token = sessionToken();
    if (!token) return { ok: false, code: 'MISSING_SESSION' };
    const subResult = await ensureSubscription();
    if (!subResult.ok || !subResult.subscription) return subResult;
    const snap = subscriptionSnapshot(subResult.subscription);
    const payload = {
      session_token: token,
      endpoint_input: snap.endpoint,
      p256dh_input: snap.p256dh,
      auth_input: snap.auth,
      page_path_input: opts.pagePath,
      permission_input: permission(),
      standalone_input: isStandalone(),
      site_scope_input: (root.GEJAST_SCOPE_UTILS && root.GEJAST_SCOPE_UTILS.getScope && root.GEJAST_SCOPE_UTILS.getScope()) || 'friends',
      platform_input: platformLabel(),
      installation_mode_input: installationMode(),
      lat_input: opts.lat == null ? null : Number(opts.lat),
      lng_input: opts.lng == null ? null : Number(opts.lng),
      accuracy_input: opts.accuracy == null ? null : Number(opts.accuracy)
    };
    const syncResult = await rpc('register_web_push_subscription_v2', payload);
    const presenceResult = await rpc('touch_active_web_push_presence_v2', payload);
    return {
      ok: !!(syncResult?.ok && presenceResult?.ok),
      code: syncResult?.ok && presenceResult?.ok ? 'SYNCED' : 'SYNC_FAILED',
      subscription: snap,
      syncResult,
      presenceResult
    };
  }

  function computeUserFacingState(diag) {
    if (!diag.secure_context) return 'insecure_context';
    if (!diag.notifications_supported) return 'unsupported';
    if (diag.platform_family === 'ios' && !diag.installed) return 'ios_not_installed';
    if (diag.permission_state !== 'granted') return 'permission_required';
    if (!diag.service_worker_ready) return 'worker_missing';
    if (!diag.subscription_exists) return 'subscription_missing';
    if (!diag.subscription_synced) return 'backend_sync_missing';
    if (!diag.presence_ok) return 'presence_missing';
    return 'ready';
  }

  async function getDiagnostics() {
    const token = sessionToken();
    let serviceWorkerReady = false;
    let subscription = null;
    try {
      const reg = notificationsSupported() ? await registerWorker() : null;
      serviceWorkerReady = !!reg;
      subscription = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    } catch (_) {}

    let backend = null;
    if (token) {
      try {
        backend = await rpc('get_web_push_self_diagnostics_v2', {
          session_token: token,
          page_path_input: root.location.pathname + root.location.search + root.location.hash,
          site_scope_input: (root.GEJAST_SCOPE_UTILS && root.GEJAST_SCOPE_UTILS.getScope && root.GEJAST_SCOPE_UTILS.getScope()) || 'friends'
        });
      } catch (error) {
        backend = { ok: false, error: String(error && error.message || error) };
      }
    }

    const diag = {
      platform_family: isIOS() ? 'ios' : (isAndroid() ? 'android' : 'browser'),
      platform_label: platformLabel(),
      installed: isStandalone(),
      installation_mode: installationMode(),
      secure_context: !!root.isSecureContext,
      notifications_supported: notificationsSupported(),
      permission_state: permission(),
      service_worker_ready: serviceWorkerReady,
      subscription_exists: !!subscription,
      subscription_endpoint: subscriptionSnapshot(subscription)?.endpoint || '',
      subscription_synced: !!backend?.subscription?.ok,
      presence_ok: !!backend?.presence?.ok,
      backend: backend || null
    };
    diag.user_facing_state = computeUserFacingState(diag);
    return diag;
  }

  async function requestPermissionAndSync() {
    if (!notificationsSupported()) return { ok: false, code: 'UNSUPPORTED' };
    await registerWorker();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return { ok: false, code: perm === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_DISMISSED' };
    }
    return syncSubscriptionAndPresence({});
  }

  async function queueSelfTest() {
    const token = sessionToken();
    if (!token) return { ok: false, code: 'MISSING_SESSION' };
    return rpc('queue_test_web_push_v2', {
      session_token: token,
      site_scope_input: (root.GEJAST_SCOPE_UTILS && root.GEJAST_SCOPE_UTILS.getScope && root.GEJAST_SCOPE_UTILS.getScope()) || 'friends'
    });
  }

  return {
    isIOS,
    isAndroid,
    isStandalone,
    installationMode,
    platformLabel,
    notificationsSupported,
    permission,
    registerWorker,
    getSubscription,
    ensureSubscription,
    subscriptionSnapshot,
    syncSubscriptionAndPresence,
    getDiagnostics,
    requestPermissionAndSync,
    queueSelfTest,
    computeUserFacingState
  };
});
