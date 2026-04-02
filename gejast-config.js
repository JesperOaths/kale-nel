(function(){
  const CONFIG = {
    VERSION: 'v273',
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

  const PLAYER_SESSION_CYCLE_KEY = 'jas_session_cycle_start_v1';
  function currentCycleStart(ts=Date.now()){
    const d = new Date(ts);
    const start = new Date(d);
    if (d.getHours() < 6) start.setDate(start.getDate() - 1);
    start.setHours(6,0,0,0);
    return start.getTime();
  }
  function currentCycleEnd(ts=Date.now()){
    const end = new Date(currentCycleStart(ts));
    end.setDate(end.getDate() + 1);
    return end.getTime();
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
    [CONFIG.PLAYER_LAST_ACTIVITY_KEY, PLAYER_SESSION_CYCLE_KEY].forEach((key)=>{
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }
  function touchPlayerActivity(){
    if (!getPlayerSessionToken()) return;
    const ts = String(Date.now());
    localStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
    sessionStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
    const cycle = String(currentCycleStart());
    if (!(localStorage.getItem(PLAYER_SESSION_CYCLE_KEY) || sessionStorage.getItem(PLAYER_SESSION_CYCLE_KEY))) {
      localStorage.setItem(PLAYER_SESSION_CYCLE_KEY, cycle);
      sessionStorage.setItem(PLAYER_SESSION_CYCLE_KEY, cycle);
    }
  }
  function lastPlayerActivity(){
    const raw = localStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || sessionStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || '';
    const n = Number(raw || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function getPlayerSessionExpiryAt(){
    const raw = localStorage.getItem(PLAYER_SESSION_CYCLE_KEY) || sessionStorage.getItem(PLAYER_SESSION_CYCLE_KEY) || '';
    const cycleStart = Number(raw || currentCycleStart());
    const start = Number.isFinite(cycleStart) && cycleStart > 0 ? cycleStart : currentCycleStart();
    const expiry = new Date(start);
    expiry.setDate(expiry.getDate() + 1);
    expiry.setHours(6,0,0,0);
    return expiry.getTime();
  }
  function isPlayerSessionExpired(){
    const token = getPlayerSessionToken();
    if (!token) return true;
    const expiryAt = getPlayerSessionExpiryAt();
    return Date.now() >= expiryAt;
  }
  function shouldSuppressVerifyFloat(){
    const path = String((window.location && window.location.pathname) || '').toLowerCase();
    return ['drinks_add.html','drinks_speed.html','scorer.html','boerenbridge.html','beerpong.html','match_control.html','admin_match_control.html'].some((name)=>path.endsWith('/'+name) || path.endsWith(name));
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
    buildLoginUrl,
    shouldSuppressVerifyFloat,
    getPlayerSessionExpiryAt,
    currentCycleStart,
    currentCycleEnd
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  else applyVersionLabel();
})();
