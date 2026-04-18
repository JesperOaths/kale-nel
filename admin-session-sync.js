(function(){
  const ADMIN_SESSION_KEY = 'jas_admin_session_v8';
  const ADMIN_DEVICE_KEY = 'jas_admin_device_v1';
  const ADMIN_USER_KEY = 'jas_admin_user_v1';
  const ADMIN_DEADLINE_KEY = 'jas_admin_deadline_v1';
  const ADMIN_TRUSTED_UNTIL_KEY = 'jas_admin_trusted_until_v1';
  const ADMIN_KEEPALIVE_AT_KEY = 'jas_admin_keepalive_at_v1';
  const ACTIVE_SESSION_MS = 24 * 60 * 60 * 1000;
  const TRUSTED_DEVICE_MS = 30 * 24 * 60 * 60 * 1000;
  const KEEPALIVE_MS = 5 * 60 * 1000;
  const VALIDATE_TIMEOUT_MS = 12000;

  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co';
  const SUPABASE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';

  function headers(){
    return {
      apikey: SUPABASE_KEY,
      Authorization:`Bearer ${SUPABASE_KEY}`,
      'Content-Type':'application/json',
      Accept:'application/json'
    };
  }



  async function fetchWithTimeout(url, init, timeoutMs = VALIDATE_TIMEOUT_MS){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch(_) {} }, timeoutMs) : null;
    try {
      return await fetch(url, controller ? { ...(init || {}), signal: controller.signal } : init);
    } catch(error){
      if (controller && error && error.name === 'AbortError') throw new Error(`Adminvalidatie timeout na ${Math.round(timeoutMs/1000)}s`);
      throw error;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  async function parse(res){
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; }
    catch { throw new Error(txt || `HTTP ${res.status}`); }
    if(!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
    return data;
  }

  function getToken(){ return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY) || ''; }
  function getUsername(){ return sessionStorage.getItem(ADMIN_USER_KEY) || localStorage.getItem(ADMIN_USER_KEY) || ''; }
  function getDevice(){ return localStorage.getItem(ADMIN_DEVICE_KEY) || ''; }
  function getDeadline(){ return Number(sessionStorage.getItem(ADMIN_DEADLINE_KEY) || localStorage.getItem(ADMIN_DEADLINE_KEY) || '0'); }
  function getTrustedUntil(){ return Number(localStorage.getItem(ADMIN_TRUSTED_UNTIL_KEY) || '0'); }

  function emitUpdate(){
    try{ window.dispatchEvent(new CustomEvent('gejast:admin-session-updated')); }catch(_){}
  }

  function stampTrustedDevice(deviceToken){
    const token = String(deviceToken || getDevice() || '').trim();
    if (!token) return 0;
    const until = Date.now() + TRUSTED_DEVICE_MS;
    localStorage.setItem(ADMIN_DEVICE_KEY, token);
    localStorage.setItem(ADMIN_TRUSTED_UNTIL_KEY, String(until));
    return until;
  }

  function hasTrustedDevice(){
    const username = String(getUsername() || '').trim();
    const device = String(getDevice() || '').trim();
    const until = getTrustedUntil();
    if (!username || !device || !until) return false;
    if (Date.now() > until){
      try {
        localStorage.removeItem(ADMIN_DEVICE_KEY);
        localStorage.removeItem(ADMIN_TRUSTED_UNTIL_KEY);
      } catch(_) {}
      return false;
    }
    return true;
  }

  function setBundle(token, username='', persist=true, deviceToken=''){
    const nextToken = String(token || getToken() || '').trim();
    const nextUser = String(username || getUsername() || '').trim();
    const nextDevice = String(deviceToken || getDevice() || '').trim();

    if(nextToken){
      sessionStorage.setItem(ADMIN_SESSION_KEY, nextToken);
      if(persist) localStorage.setItem(ADMIN_SESSION_KEY, nextToken);
    }
    if(nextUser){
      sessionStorage.setItem(ADMIN_USER_KEY, nextUser);
      localStorage.setItem(ADMIN_USER_KEY, nextUser);
    }
    if(nextDevice){
      stampTrustedDevice(nextDevice);
    }
    const until = Date.now() + ACTIVE_SESSION_MS;
    sessionStorage.setItem(ADMIN_DEADLINE_KEY, String(until));
    localStorage.setItem(ADMIN_DEADLINE_KEY, String(until));
    emitUpdate();
  }

  function clearBundle(){
    [ADMIN_SESSION_KEY, ADMIN_DEVICE_KEY, ADMIN_USER_KEY, ADMIN_DEADLINE_KEY, ADMIN_TRUSTED_UNTIL_KEY, ADMIN_KEEPALIVE_AT_KEY].forEach((k)=>{
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
    emitUpdate();
  }

  function fingerprint(){
    const p = [
      navigator.userAgent || '',
      navigator.language || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      String(screen?.width || 0),
      String(screen?.height || 0),
      navigator.platform || ''
    ];
    return p.join('|').slice(0,500);
  }

  function safeReturnTarget(raw){
    const value = String(raw || '').trim();
    if(!value) return '';
    if(/^(?:[a-z]+:)?\/\//i.test(value)) return '';
    if(value.includes('..') || value.includes('\\')) return '';
    return value.replace(/^\.\//,'').replace(/^\/+/, '');
  }

  function pageNameFromLocation(){
    try {
      return safeReturnTarget((window.location.pathname.split('/').pop() || 'admin.html') + window.location.search + window.location.hash) || 'admin.html';
    } catch (_) {
      return 'admin.html';
    }
  }

  function redirectToAdminLogin(reason='session_invalid', returnTo=''){
    const here = safeReturnTarget(returnTo || pageNameFromLocation()) || 'admin.html';
    window.location.href = `./admin.html?reason=${encodeURIComponent(reason)}&return_to=${encodeURIComponent(here)}`;
  }

  function isTransientValidationError(error){
    const msg = String(error?.message || error || '').toLowerCase();
    return !msg || msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('http 50') || msg.includes('cors');
  }

  async function validate(){
    const token = String(getToken() || '').trim();
    if(!token) throw new Error('Geen adminsessie gevonden.');

    const deadline = getDeadline();
    const trusted = hasTrustedDevice();
    if(deadline && Date.now() > deadline && !trusted){
      clearBundle();
      throw new Error('Adminsessie verlopen.');
    }

    const username = String(getUsername() || '').trim();
    const device = trusted ? String(getDevice() || '').trim() : '';
    const useDevice = !!(device && username);
    const rpc = useDevice ? 'admin_check_session_with_device' : 'admin_check_session';
    const payload = useDevice
      ? {
          admin_session_token: token,
          admin_username: username,
          raw_device_token: device,
          device_fingerprint: fingerprint()
        }
      : { admin_session_token: token };

    let data = null;
    try {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      data = await parse(res);
    } catch(err){
      if(!isTransientValidationError(err)) clearBundle();
      throw err;
    }

    const nextToken = String(data?.admin_session_token || data?.token || token || '').trim();
    const nextUser = String(data?.admin_username || data?.username || username || '').trim();
    const nextDevice = String(data?.raw_device_token || device || '').trim();

    if(nextToken){
      setBundle(nextToken, nextUser, true, nextDevice);
    }
    return Object.assign({ ok:true, admin_session_token: nextToken, admin_username: nextUser }, data || {});
  }

  function hasUsableLocalSession(){
    const token = String(getToken() || '').trim();
    if (!token) return false;
    const deadline = getDeadline();
    if (deadline && Date.now() > deadline && !hasTrustedDevice()){
      clearBundle();
      return false;
    }
    return true;
  }

  async function backgroundValidate(){
    if (!hasUsableLocalSession()) return false;
    try { await validate(); return true; } catch (_) { return false; }
  }

  async function requirePage(returnTo=''){
    if (hasUsableLocalSession()) {
      setTimeout(()=>{ backgroundValidate().catch(()=>{}); }, 0);
      return true;
    }
    try {
      await validate();
      return true;
    } catch(err){
      redirectToAdminLogin((err && err.message) || 'session_invalid', returnTo);
      return false;
    }
  }

  function consumeLoginResult(result, fallbackUsername='', persist=true){
    const data = Array.isArray(result) ? (result[0] || {}) : (result || {});
    const token = String(data?.admin_session_token || data?.token || '').trim();
    if(!token) throw new Error('Login gaf geen admin-sessie terug');
    const nextUser = String(data?.admin_username || data?.username || fallbackUsername || getUsername() || '').trim();
    const nextDevice = String(data?.raw_device_token || data?.device_token || getDevice() || '').trim();
    setBundle(token, nextUser, persist, nextDevice);
    return Object.assign({}, data, { admin_session_token: token, admin_username: nextUser, raw_device_token: nextDevice });
  }

  function installKeepalive(){
    if (window.__GEJAST_ADMIN_KEEPALIVE_INSTALLED) return;
    window.__GEJAST_ADMIN_KEEPALIVE_INSTALLED = true;

    const tick = async (force=false) => {
      if (!hasUsableLocalSession()) return false;
      if (!force && document.hidden) return false;
      const lastAt = Number(localStorage.getItem(ADMIN_KEEPALIVE_AT_KEY) || '0');
      const now = Date.now();
      if (!force && lastAt && (now - lastAt) < (KEEPALIVE_MS - 15000)) return false;
      localStorage.setItem(ADMIN_KEEPALIVE_AT_KEY, String(now));
      return backgroundValidate();
    };

    setInterval(()=>{ tick(false).catch(()=>{}); }, KEEPALIVE_MS);
    document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) tick(true).catch(()=>{}); });
    window.addEventListener('focus', ()=>{ tick(true).catch(()=>{}); });
    setTimeout(()=>{ tick(true).catch(()=>{}); }, 1200);
  }

  function installFetchCapture(){
    if (window.__GEJAST_ADMIN_FETCH_CAPTURE_INSTALLED) return;
    window.__GEJAST_ADMIN_FETCH_CAPTURE_INSTALLED = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    window.fetch = async function patchedFetch(input, init){
      const response = await originalFetch.call(this, input, init);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!/\/rest\/v1\/rpc\/admin_(login|check_session|check_session_with_device)\b/i.test(String(url))) return response;
        if (!response.ok) return response;
        const clone = response.clone();
        const text = await clone.text();
        if (!text) return response;
        const data = JSON.parse(text);
        const fallbackUser = String(document.getElementById('usernameInput')?.value || getUsername() || '').trim();
        consumeLoginResult(data, fallbackUser, true);
      } catch(_) {}
      return response;
    };
  }

  function installTrustedNote(){
    const loginView = document.getElementById('loginView');
    if (!loginView || document.getElementById('adminTrustedDeviceNote')) return;

    const note = document.createElement('div');
    note.id = 'adminTrustedDeviceNote';
    note.style.cssText = 'margin-top:12px;padding:12px 14px;border-radius:14px;background:rgba(154,130,65,.10);border:1px solid rgba(154,130,65,.22);color:#5c4a1c;font-size:13px;line-height:1.45;';
    const trustedCopy = hasTrustedDevice()
      ? `Dit apparaat staat als vertrouwd gemarkeerd tot ${new Intl.DateTimeFormat('nl-NL',{ day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(getTrustedUntil()))}.`
      : 'Na een geslaagde login wordt deze laptop 30 dagen als vertrouwd onthouden. Terwijl je adminpagina’s gebruikt, wordt de adminsessie stil ververst zodat je niet steeds opnieuw een Google Authenticator-code hoeft in te voeren.';
    note.textContent = trustedCopy;
    loginView.appendChild(note);
  }

  window.addEventListener('storage', (event)=>{
    if (![ADMIN_SESSION_KEY, ADMIN_DEVICE_KEY, ADMIN_USER_KEY, ADMIN_DEADLINE_KEY, ADMIN_TRUSTED_UNTIL_KEY].includes(event.key || '')) return;
    if (!getToken()) clearBundle();
    else emitUpdate();
  });

  installFetchCapture();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installTrustedNote, { once:true });
  } else {
    installTrustedNote();
  }
  installKeepalive();

  window.GEJAST_ADMIN_SESSION = {
    getToken,
    getUsername,
    getDevice,
    getDeadline,
    getTrustedUntil,
    hasTrustedDevice,
    setBundle,
    clearBundle,
    validate,
    backgroundValidate,
    hasUsableLocalSession,
    requirePage,
    redirectToAdminLogin,
    pageNameFromLocation,
    fingerprint,
    consumeLoginResult,
    installKeepalive
  };
})();