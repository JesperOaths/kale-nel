(function(){
  const CONFIG = {
    VERSION: 'v271',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/h63v9tzv3o1i8hqtx2m5lfugrn5funy6',
    CLAIM_EMAIL_RPC: 'claim_email_jobs_http',
    EMAIL_SUBJECT: 'Activeer je account voor de Kale Nel',
    GOLD: '#9a8241',
    GOLD_HOVER: '#8a7338',
    PLAYER_SESSION_KEYS: ['jas_session_token_v11','jas_session_token_v10'],
    PLAYER_LAST_ACTIVITY_KEY: 'jas_last_activity_at_v1',
    PLAYER_SESSION_IDLE_MS: 6 * 60 * 60 * 1000
  };

  function detectScriptVersion(){
    try {
      const scripts = Array.from(document.scripts || []);
      const match = scripts.map((s)=>s.src||'').find((src)=>/gejast-config\.js\?v\d+/i.test(src));
      const m = match && match.match(/\?v(\d+)/i);
      return m ? `v${m[1]}` : null;
    } catch (_) { return null; }
  }
  function parseVersion(v){ const m=String(v||'').match(/v?(\d+)/i); return m?Number(m[1]):0; }
  const candidates = [detectScriptVersion(), window.GEJAST_PAGE_VERSION, CONFIG.VERSION].filter(Boolean);
  const effectiveVersion = candidates.sort((a,b)=>parseVersion(b)-parseVersion(a))[0] || CONFIG.VERSION;
  const label = `${effectiveVersion} · Made by Bruis`;
  window.GEJAST_PAGE_VERSION = effectiveVersion;

  function applyVersionLabel(){
    const selectors = ['.site-credit-watermark','#versionWatermark','.version-tag','.watermark','[data-version-watermark]'];
    selectors.forEach((selector)=>{ document.querySelectorAll(selector).forEach((node)=>{ node.textContent = label; }); });
    const re = /v\d+\s*[·.-]?\s*Made by Bruis/i;
    document.querySelectorAll('body *').forEach((node)=>{ if (node.children.length) return; const txt=(node.textContent||'').trim(); if (re.test(txt)) node.textContent = label; });
  }

  function getPlayerSessionToken(){
    for(const key of CONFIG.PLAYER_SESSION_KEYS){
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }
  function clearPlayerSessionTokens(){
    for(const key of CONFIG.PLAYER_SESSION_KEYS){
      localStorage.removeItem(key); sessionStorage.removeItem(key);
    }
    localStorage.removeItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY);
    sessionStorage.removeItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY);
  }
  function touchPlayerActivity(){
    if (!getPlayerSessionToken()) return;
    const ts = String(Date.now());
    localStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
    sessionStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
  }
  function lastPlayerActivity(){
    const raw = localStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || sessionStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || '';
    const n = Number(raw || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function isPlayerSessionExpired(){
    const token = getPlayerSessionToken();
    if (!token) return true;
    const last = lastPlayerActivity();
    if (!last) return false;
    return (Date.now() - last) > CONFIG.PLAYER_SESSION_IDLE_MS;
  }
  function buildLoginUrl(returnTo){
    const url = new URL('./login.html', window.location.href);
    if (returnTo) url.searchParams.set('return_to', returnTo);
    return url.toString();
  }
  function ensurePlayerSessionOrRedirect(returnTo){
    if (isPlayerSessionExpired()) clearPlayerSessionTokens();
    const token = getPlayerSessionToken();
    if (!token){
      window.location.href = buildLoginUrl(returnTo || (location.pathname.split('/').pop() || 'index.html'));
      return false;
    }
    touchPlayerActivity();
    return true;
  }
  function installActivityKeepalive(options={}){
    const suppressLogout = !!options.suppressLogout;
    const logoutSelectors = options.logoutSelectors || ['#playerSessionCornerLogout','.player-session-corner-btn.logout','[data-player-logout]'];
    const touch = ()=> touchPlayerActivity();
    ['pointerdown','keydown','scroll','touchstart','mousemove'].forEach((eventName)=>{
      window.addEventListener(eventName, touch, { passive:true });
    });
    document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) touch(); });
    window.addEventListener('focus', touch);
    touch();
    if (suppressLogout){
      logoutSelectors.forEach((selector)=>{
        document.querySelectorAll(selector).forEach((el)=>{
          el.style.display = 'none';
          el.setAttribute('aria-hidden','true');
          el.disabled = true;
        });
      });
    }
  }
  function requireMatchEntrySession(returnTo){
    const ok = ensurePlayerSessionOrRedirect(returnTo);
    if (!ok) return false;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ()=>installActivityKeepalive({ suppressLogout:true }), { once:true });
    } else {
      installActivityKeepalive({ suppressLogout:true });
    }
    return true;
  }

  window.GEJAST_CONFIG = Object.assign({}, window.GEJAST_CONFIG || {}, CONFIG, {
    VERSION: effectiveVersion,
    VERSION_LABEL: label,
    applyVersionLabel,
    getPlayerSessionToken,
    clearPlayerSessionTokens,
    touchPlayerActivity,
    isPlayerSessionExpired,
    ensurePlayerSessionOrRedirect,
    installActivityKeepalive,
    requireMatchEntrySession,
    buildLoginUrl
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  else applyVersionLabel();
})();
