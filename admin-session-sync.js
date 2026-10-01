(function(){
  // v757: protected admin pages stay hidden until backend admin validation succeeds.
  // Do not force admin.kalenel.nl here: that hostname may not be configured yet.
  function normalizeAdminPageName(){
    try {
      const path = window.location.pathname || '';
      const raw = (path.split('/').pop() || '').toLowerCase();
      // The Worker intentionally exposes the main admin hub as /, /admin and
      // /admin.html. Those routes must render the inner Supabase/TOTP lock when
      // the inner session is missing, not be hidden by the protected-page gate.
      if (!raw || raw === 'admin' || raw === 'admin/') return 'admin.html';
      return raw;
    } catch (_) {
      return 'admin.html';
    }
  }
  const pageName = normalizeAdminPageName();
  const protectedAdminPage = /^admin/i.test(pageName) && pageName !== 'admin.html';
  if (protectedAdminPage) {
    try {
      document.documentElement.classList.add('admin-gate-pending');
      const style = document.createElement('style');
      style.setAttribute('data-admin-session-gate', 'true');
      style.textContent = 'html.admin-gate-pending body{visibility:visible!important}html.admin-gate-pending body>*{visibility:hidden!important}html.admin-gate-pending body::before{content:"Checking admin session…";visibility:visible!important;position:fixed;inset:0;display:grid;place-items:center;background:#eee9df;color:#17130f;font:700 16px/1.4 Inter,system-ui,sans-serif;z-index:2147483647}html.admin-gate-ready body{visibility:visible!important}html.admin-gate-ready body>*{visibility:visible!important}';
      (document.head || document.documentElement).appendChild(style);
    } catch (_) {}
  }
  const ADMIN_SESSION_KEY = 'jas_admin_session_v8';
  const ADMIN_DEVICE_KEY = 'jas_admin_device_v1';
  const ADMIN_USER_KEY = 'jas_admin_user_v1';
  const ADMIN_DEADLINE_KEY = 'jas_admin_deadline_v1';
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co';
  const SUPABASE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  const REMEMBER_MS = Number(cfg.ADMIN_SESSION_REMEMBER_MS || (45 * 24 * 60 * 60 * 1000));
  const TRUST_DAYS = 45;
  let validatePromise = null;
  let lastValidation = null;
  const VALIDATION_CACHE_MS = 5000;

  function headers(){
    if (typeof cfg.publicApiHeaders === 'function') return cfg.publicApiHeaders({ 'Content-Type':'application/json', Accept:'application/json' });
    const out={apikey:SUPABASE_KEY,'Content-Type':'application/json',Accept:'application/json'};
    if(/^[^.]+\.[^.]+\.[^.]+$/.test(SUPABASE_KEY)) out.Authorization=`Bearer ${SUPABASE_KEY}`;
    return out;
  }
  async function parse(res){
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    return data;
  }

  function getToken(){ return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY) || ''; }
  function getUsername(){ return sessionStorage.getItem(ADMIN_USER_KEY) || localStorage.getItem(ADMIN_USER_KEY) || ''; }
  function getDevice(){ return localStorage.getItem(ADMIN_DEVICE_KEY) || ''; }
  function getDeadline(){ return Number(sessionStorage.getItem(ADMIN_DEADLINE_KEY) || localStorage.getItem(ADMIN_DEADLINE_KEY) || '0'); }

  function emitUpdate(){ try { window.dispatchEvent(new CustomEvent('gejast:admin-session-updated')); } catch (_) {} }

  function resolveTrustedUntil(trustedUntil=''){
    const raw = String(trustedUntil ?? '').trim();
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 1000000000000) return numeric;
    const parsed = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    const existing = getDeadline();
    if (Number.isFinite(existing) && existing > Date.now()) return existing;
    return Date.now() + REMEMBER_MS;
  }

  function setBundle(token, username='', persist=true, deviceToken='', trustedUntil=''){
    const before = {
      token: getToken(),
      username: getUsername(),
      device: getDevice(),
      deadline: getDeadline()
    };
    if (token) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, token);
      if (persist) localStorage.setItem(ADMIN_SESSION_KEY, token);
    }
    if (username) {
      sessionStorage.setItem(ADMIN_USER_KEY, username);
      localStorage.setItem(ADMIN_USER_KEY, username);
    }
    if (deviceToken) localStorage.setItem(ADMIN_DEVICE_KEY, deviceToken);
    const until = resolveTrustedUntil(trustedUntil);
    sessionStorage.setItem(ADMIN_DEADLINE_KEY, String(until));
    localStorage.setItem(ADMIN_DEADLINE_KEY, String(until));

    const changed =
      getToken() !== before.token ||
      getUsername() !== before.username ||
      getDevice() !== before.device ||
      getDeadline() !== before.deadline;
    if (changed) emitUpdate();
  }

  function clearBundle(){
    lastValidation = null;
    const hadBundle = !!(getToken() || getDevice() || getUsername() || getDeadline());
    [ADMIN_SESSION_KEY, ADMIN_DEVICE_KEY, ADMIN_USER_KEY, ADMIN_DEADLINE_KEY].forEach((k)=>{
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
    if (hadBundle) emitUpdate();
  }

  function fingerprint(){
    // Deliberately stable across normal browser-version updates. The long random
    // trusted-device token is the real credential; this is only a binding signal.
    const p = [
      navigator.language || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      String(screen?.width || 0),
      String(screen?.height || 0),
      navigator.platform || ''
    ];
    return p.join('|').slice(0, 500);
  }

  function deviceLabel(){
    const platform = String(navigator.platform || '').trim();
    const browser = /Edg\//.test(navigator.userAgent) ? 'Edge' :
      /Chrome\//.test(navigator.userAgent) ? 'Chrome' :
      /Firefox\//.test(navigator.userAgent) ? 'Firefox' :
      /Safari\//.test(navigator.userAgent) ? 'Safari' : 'Browser';
    return [browser, platform].filter(Boolean).join(' on ').slice(0, 120);
  }

  function randomDeviceToken(){
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b)=>b.toString(16).padStart(2,'0')).join('');
  }

  async function rpc(name, payload, options={}){
    const controller = new AbortController();
    const sameOriginProxy = window.location.hostname === 'admin.kalenel.nl';
    const timeoutId = setTimeout(() => controller.abort(), sameOriginProxy ? 6500 : 15000);
    try {
      const url = sameOriginProxy ? './api/admin-session' : `${SUPABASE_URL}/rest/v1/rpc/${name}`;
      const init = sameOriginProxy ? {
        method:'POST', cache:'no-store',
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({rpc:name,payload:payload || {}}), signal:controller.signal,
        keepalive: options?.keepalive === true
      } : {
        method:'POST', mode:'cors', cache:'no-store', headers:headers(),
        body:JSON.stringify(payload || {}), signal:controller.signal,
        keepalive: options?.keepalive === true
      };
      const res = await fetch(url, init);
      return await parse(res);
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Admin session check timed out.');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function safeReturnTarget(raw){
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^(?:[a-z]+:)?\/\//i.test(value)) return '';
    if (value.includes('..') || value.includes('\\')) return '';
    return value.replace(/^\.\//, '').replace(/^\/+/, '');
  }

  function pageNameFromLocation(){
    try {
      return safeReturnTarget(normalizeAdminPageName() + window.location.search + window.location.hash) || 'admin.html';
    } catch (_) {
      return 'admin.html';
    }
  }

  function isMainAdminHub(){
    return normalizeAdminPageName() === 'admin.html';
  }

  function stripRecursiveReturnTo(target){
    const cleaned = safeReturnTarget(target);
    if (!cleaned) return '';
    try {
      const url = new URL(cleaned, window.location.href || 'https://admin.kalenel.nl/admin.html');
      const name = (url.pathname.split('/').pop() || '').toLowerCase();
      if (name === 'admin.html' || name === 'admin' || !name) return '';
      url.searchParams.delete('return_to');
      const path = url.pathname.replace(/^\/+/, '') || 'admin.html';
      return safeReturnTarget(`${path}${url.search}${url.hash}`);
    } catch (_) {
      return cleaned.includes('return_to=') ? '' : cleaned;
    }
  }

  function redirectToAdminLogin(reason='session_invalid', returnTo=''){
    if (isMainAdminHub()) {
      clearBundle();
      revealProtectedPage();
      return false;
    }
    const here = stripRecursiveReturnTo(returnTo || pageNameFromLocation());
    const suffix = here ? `&return_to=${encodeURIComponent(here)}` : '';
    window.location.href = `./admin.html?reason=${encodeURIComponent(reason)}${suffix}`;
    return true;
  }

  function hasDeviceRemember(){
    return !!(getDevice() && getUsername());
  }

  function hasUsableLocalSession(){
    const token = getToken();
    if (!token) return false;
    const deadline = getDeadline();
    if (!deadline) return true;
    if (Date.now() < deadline) return true;
    return hasDeviceRemember();
  }

  async function issueTrustedDevice(username=''){
    const token = getToken();
    if (!token) throw new Error('Log eerst in voordat dit apparaat kan worden onthouden.');
    let device = getDevice();
    if (!device) device = randomDeviceToken();
    // Persist the device credential before the request so a successful login
    // can navigate immediately while this keepalive request finishes.
    setBundle(token, username || getUsername(), true, device, getDeadline() || '');
    const data = await rpc('admin_issue_trusted_device_v844', {
      admin_session_token_input: token,
      raw_device_token_input: device,
      device_label_input: deviceLabel(),
      device_fingerprint_input: fingerprint(),
      user_agent_hash_input: null
    }, { keepalive:true });
    if (data?.ok !== true) throw new Error(data?.error || 'Dit apparaat kon niet worden onthouden.');
    const nextUser = data?.admin_username || username || getUsername();
    setBundle(token, nextUser, true, device, data?.trusted_until || '');
    return data;
  }

  async function resumeTrustedDevice(){
    const device = getDevice();
    const username = getUsername();
    if (!device || !username) throw new Error('Geen onthouden geverifieerd apparaat gevonden.');
    const data = await rpc('admin_resume_trusted_device_v844', {
      admin_username_input: username,
      raw_device_token_input: device,
      device_fingerprint_input: fingerprint(),
      user_agent_hash_input: null
    });
    if (data?.ok !== true || !data?.admin_session_token) {
      clearBundle();
      throw new Error('De verificatie van dit onthouden apparaat is verlopen. Log opnieuw in met Authenticator.');
    }
    setBundle(
      data.admin_session_token,
      data.admin_username || data.username || username,
      true,
      device,
      data.trusted_until || ''
    );
    return Object.assign({ resumed_from_trusted_device:true }, data);
  }

  async function forgetCurrentDevice(){
    const token = getToken();
    const device = getDevice();
    if (token && device) {
      try {
        await rpc('admin_forget_trusted_device_v844', {
          admin_session_token_input: token,
          raw_device_token_input: device
        });
      } catch (_) {}
    }
    clearBundle();
    return true;
  }

  async function validate(){
    const currentToken = getToken();
    if (lastValidation && currentToken && lastValidation.token === currentToken && (Date.now() - lastValidation.at) < VALIDATION_CACHE_MS) {
      return lastValidation.data;
    }
    if (validatePromise) return validatePromise;
    validatePromise = (async () => {
      let token = getToken();
      const device = getDevice();
      const username = getUsername();

      if (!token) {
        if (device && username) return await resumeTrustedDevice();
        throw new Error('Geen adminsessie gevonden.');
      }

      try {
        const data = await rpc('admin_check_session', { admin_session_token: token });
        if (data?.ok !== true) throw new Error('Adminsessie verlopen.');
        const nextToken = data?.admin_session_token || data?.token || token;
        const nextUser = data?.admin_username || data?.username || username;
        setBundle(nextToken, nextUser, true, device, getDeadline() || '');
        const result = Object.assign({ admin_session_token:nextToken, admin_username:nextUser }, data);
        lastValidation = { token: nextToken, at: Date.now(), data: result };
        return result;
      } catch (error) {
        if (device && username) return await resumeTrustedDevice();
        throw error;
      }
    })();
    try {
      return await validatePromise;
    } finally {
      validatePromise = null;
    }
  }

  async function backgroundValidate(){
    if (!hasUsableLocalSession()) return false;
    try {
      return await validate();
    } catch (_) {
      return false;
    }
  }

  function revealProtectedPage(){
    try {
      document.documentElement.classList.remove('admin-gate-pending');
      document.documentElement.classList.add('admin-gate-ready');
    } catch (_) {}
  }

  async function requirePage(returnTo=''){
    try {
      await validate();
      revealProtectedPage();
      return true;
    } catch (err) {
      clearBundle();
      redirectToAdminLogin('session_invalid', returnTo);
      return false;
    }
  }

  window.addEventListener('storage', (event)=>{
    if (![ADMIN_SESSION_KEY, ADMIN_DEVICE_KEY, ADMIN_USER_KEY, ADMIN_DEADLINE_KEY].includes(event.key || '')) return;
    if (!getToken()) clearBundle();
    else emitUpdate();
  });

  window.GEJAST_ADMIN_SESSION = {
    getToken,
    getUsername,
    getDevice,
    getDeadline,
    hasDeviceRemember,
    hasUsableLocalSession,
    setBundle,
    clearBundle,
    issueTrustedDevice,
    resumeTrustedDevice,
    forgetCurrentDevice,
    validate,
    backgroundValidate,
    requirePage,
    redirectToAdminLogin,
    isMainAdminHub,
    stripRecursiveReturnTo,
    pageNameFromLocation,
    fingerprint,
    deviceLabel,
    rememberMs: REMEMBER_MS,
    trustDays: TRUST_DAYS
  };

  if (protectedAdminPage && typeof setTimeout === 'function') {
    setTimeout(() => {
      const returnTo = pageNameFromLocation();
      if (getToken() && hasUsableLocalSession()) {
        // Fast first paint. Sensitive admin APIs still validate the session server-side.
        revealProtectedPage();
        validate().catch(() => {
          clearBundle();
          redirectToAdminLogin('session_invalid', returnTo);
        });
        return;
      }
      requirePage(returnTo).catch(() => {});
    }, 0);
  }
})();
