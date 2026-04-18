(function(){
  const CONFIG = {
    VERSION:'v581',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/h63v9tzv3o1i8hqtx2m5lfugrn5funy6',
    CLAIM_EMAIL_RPC: 'claim_email_jobs_http',
    EMAIL_SUBJECT: 'Activeer je account voor de Kale Nel',
    GOLD: '#9a8241',
    GOLD_HOVER: '#8a7338',
    PLAYER_SESSION_KEYS: ['jas_session_token_v11','jas_session_token_v10'],
    PLAYER_LAST_ACTIVITY_KEY: 'jas_last_activity_at_v1',
    PLAYER_SESSION_IDLE_MS: 12 * 60 * 60 * 1000,
    WEB_PUSH_PUBLIC_KEY: 'BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4',
    NOTIFICATION_BUTTON_ENABLED: true,
    WEB_PUSH_TEST_RPC: 'queue_test_web_push',
    WEB_PUSH_REGISTER_RPC_V3: 'register_web_push_subscription_v3',
    ACTIVE_PUSH_TOUCH_RPC_V3: 'touch_active_web_push_presence_v3',
    WEB_PUSH_SELF_DIAGNOSTICS_RPC_V3: 'get_web_push_self_diagnostics_v3',
    WEB_PUSH_QUEUE_NEARBY_RPC_V3: 'queue_nearby_verification_pushes_v3',
    WEB_PUSH_CONSUME_ACTION_RPC_V3: 'consume_web_push_action_v3',
    ADMIN_ACTIVE_PUSH_RPC_V3: 'admin_queue_active_web_push_v3',
    ADMIN_PUSH_DIAGNOSTICS_RPC_V3: 'admin_get_web_push_diagnostics_v3'
  };

  function parseVersion(v){ const m=String(v||'').match(/v?(\d+)/i); return m?Number(m[1]):0; }
  function detectScriptVersion(){
    try {
      const scripts = Array.from(document.scripts || []);
      const match = scripts.map((s)=>s.src||'').find((src)=>/gejast-config\.js\?v\d+/i.test(src));
      const m = match && match.match(/\?v(\d+)/i);
      return m ? `v${m[1]}` : null;
    } catch (_) { return null; }
  }
  const candidates = [detectScriptVersion(), window.GEJAST_PAGE_VERSION, CONFIG.VERSION].filter(Boolean);
  const effectiveVersion = candidates.sort((a,b)=>parseVersion(b)-parseVersion(a))[0] || CONFIG.VERSION;
  const effectiveNumber = parseVersion(effectiveVersion) || parseVersion(CONFIG.VERSION) || 580;
  const label = `${effectiveVersion} · Made by Bruis`;
  window.GEJAST_PAGE_VERSION = effectiveVersion;

  function shouldHideWatermark(){
    try{
      if (window.GEJAST_HIDE_WATERMARK) return true;
      const root = document.documentElement;
      const body = document.body;
      const path = String(location.pathname || '').toLowerCase();
      if (root && root.getAttribute('data-hide-version-watermark') === '1') return true;
      if (body && body.getAttribute('data-hide-version-watermark') === '1') return true;
      if (/\/(?:pikken|pikken_live|pikken_stats|paardenrace|paardenrace_live|paardenrace_stats)\.html$/i.test(path)) return true;
    }catch(_){ }
    return false;
  }

  function watermarkStyles(node){
    if (!node || !node.style) return;
    const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: `calc(${compact ? '10px' : '14px'} + env(safe-area-inset-bottom, 0px))`,
      zIndex: '9999',
      padding: compact ? '7px 11px' : '8px 14px',
      borderRadius: '999px',
      background: 'rgba(17,17,17,0.88)',
      border: '1px solid rgba(212,175,55,0.35)',
      color: '#f3e3a6',
      font: compact ? '700 12px/1.2 Inter,system-ui,sans-serif' : '700 13px/1.2 Inter,system-ui,sans-serif',
      letterSpacing: '.03em',
      pointerEvents: 'none',
      userSelect: 'none',
      boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
      textAlign: 'center',
      maxWidth: compact ? 'calc(100vw - 24px)' : 'min(calc(100vw - 28px), 560px)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)'
    });
  }
  function ensureVersionWatermark(){
    if (!document.body || shouldHideWatermark()) return [];
    const selectors = ['[data-version-watermark]','.site-credit-watermark','#versionWatermark','.version-tag','.watermark'];
    let nodes = selectors.flatMap((selector)=>Array.from(document.querySelectorAll(selector))).filter(Boolean);
    if (!nodes.length) {
      const node = document.createElement('div');
      node.setAttribute('data-version-watermark','');
      node.setAttribute('data-version-watermark-source','gejast-config');
      document.body.appendChild(node);
      nodes = [node];
    }
    const seen = new Set();
    return nodes.filter((node)=>{ if (seen.has(node)) return false; seen.add(node); return true; });
  }
  function applyVersionLabel(){
    if (shouldHideWatermark()){
      document.querySelectorAll('[data-version-watermark],.site-credit-watermark,#versionWatermark,.version-tag,.watermark').forEach((node)=>{
        node.style.display = 'none';
        node.setAttribute('aria-hidden','true');
      });
      return;
    }
    const nodes = ensureVersionWatermark();
    nodes.forEach((node)=>{ node.textContent = label; watermarkStyles(node); });
  }

  function purgeStaleClientCaches(){
    const oldSessionKeys = [
      'gejast_homepage_boot_v389','gejast_homepage_boot_v426','gejast_homepage_boot_v448','gejast_homepage_boot_v579','gejast_homepage_boot_v580'
    ];
    const oldLocalKeys = [
      'gejast_homepage_poll_lists_v448','gejast_homepage_poll_lists_v579','gejast_homepage_poll_lists_v580',
      'gejast_drinks_donderdag_lists_v448','gejast_drinks_donderdag_lists_v579','gejast_drinks_donderdag_lists_v580'
    ];
    try {
      if (sessionStorage.getItem('__gejast_cache_purged_v581') === '1') return;
      oldSessionKeys.forEach((key)=>sessionStorage.removeItem(key));
      oldLocalKeys.forEach((key)=>localStorage.removeItem(key));
      sessionStorage.setItem('__gejast_cache_purged_v581','1');
    } catch (_) {}
  }

  function maybeForceFreshShell(){
    try{
      const requested = detectScriptVersion();
      const requestedNum = parseVersion(requested);
      if (!requestedNum || requestedNum >= effectiveNumber) return;
      const params = new URLSearchParams(location.search || '');
      const currentBuster = Number(params.get('__gv') || 0);
      if (currentBuster >= effectiveNumber) return;
      params.set('__gv', String(effectiveNumber));
      const next = `${location.pathname}?${params.toString()}${location.hash || ''}`;
      location.replace(next);
    }catch(_){ }
  }

  function normalizeProfileImageUrl(value){
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    const base = String(CONFIG.SUPABASE_URL || '').trim();
    if (/^storage\/v1\/object\/public\//i.test(raw) && base) return `${base}/${raw.replace(/^\//, '')}`;
    if (/^(public\/)?avatars?\//i.test(raw) && base) return `${base}/storage/v1/object/public/${raw.replace(/^(public\/)?/, '').replace(/^\//, '')}`;
    if (base && /^[A-Za-z0-9._-]+\/.+/.test(raw)) return `${base}/storage/v1/object/public/${raw.replace(/^\//, '')}`;
    return raw;
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
  function inferRuntimeScope(){
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('scope') === 'family') return 'family';
      if ((location.pathname || '').includes('/familie/')) return 'family';
    } catch(_) {}
    return 'friends';
  }
  function sanitizeReturnTarget(raw, fallback=''){
    const value = String(raw || '').trim();
    if (!value) return String(fallback || '').trim();
    if (/^(?:[a-z]+:)?\/\//i.test(value)) return String(fallback || '').trim();
    if (value.includes('..') || value.includes('\\')) return String(fallback || '').trim();
    const normalized = value.replace(/^\.\//,'').replace(/^\//, '');
    return normalized || String(fallback || '').trim();
  }
  function currentReturnTarget(fallback='index.html'){
    try {
      const path = (location.pathname || '').split('/').pop() || fallback || 'index.html';
      const query = location.search || '';
      const hash = location.hash || '';
      return sanitizeReturnTarget(`${path}${query}${hash}`, fallback || 'index.html');
    } catch (_) {
      return sanitizeReturnTarget(fallback || 'index.html', 'index.html');
    }
  }
  function normalizeScope(input){ return String(input || '').trim().toLowerCase() === 'family' ? 'family' : 'friends'; }
  function buildHomeUrl(returnTo, scope){
    const useScope = scope || inferRuntimeScope();
    const url = new URL('./home.html', window.location.href);
    if (useScope === 'family') url.searchParams.set('scope', 'family');
    const target = sanitizeReturnTarget(returnTo, useScope === 'family' ? 'index.html?scope=family' : 'index.html');
    if (target) url.searchParams.set('return_to', target);
    return url.toString();
  }
  function buildLoginUrl(returnTo, scope){
    const useScope = scope || inferRuntimeScope();
    const url = new URL('./login.html', window.location.href);
    if (useScope === 'family') url.searchParams.set('scope', 'family');
    const target = sanitizeReturnTarget(returnTo, useScope === 'family' ? 'index.html?scope=family' : 'index.html');
    if (target) url.searchParams.set('return_to', target);
    return url.toString();
  }
  function buildRequestUrl(returnTo, scope){
    const normalizedScope = normalizeScope(scope || inferRuntimeScope());
    const url = new URL('./request.html', window.location.href);
    const safeTarget = sanitizeReturnTarget(returnTo || '', normalizedScope === 'family' ? 'index.html?scope=family' : 'index.html');
    if (safeTarget) url.searchParams.set('return_to', safeTarget);
    if (normalizedScope === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname}${url.search}${url.hash}`;
  }
  function buildAdminUrl(reason='', returnTo=''){
    const url = new URL('./admin.html', window.location.href);
    if (reason) url.searchParams.set('reason', String(reason));
    const target = sanitizeReturnTarget(returnTo);
    if (target) url.searchParams.set('return_to', target);
    return url.toString();
  }
  function setPlayerSessionToken(token, storage){
    const value = String(token || '').trim();
    if (!value) return '';
    const primaryKey = CONFIG.PLAYER_SESSION_KEYS[0] || 'jas_session_token_v11';
    const target = storage === 'session' ? sessionStorage : localStorage;
    target.setItem(primaryKey, value);
    const other = target === localStorage ? sessionStorage : localStorage;
    other.removeItem(primaryKey);
    touchPlayerActivity();
    return value;
  }
  function ensurePlayerSessionOrRedirect(returnTo){
    if (isPlayerSessionExpired()) clearPlayerSessionTokens();
    const token = getPlayerSessionToken();
    if (!token){
      const target = sanitizeReturnTarget(returnTo || (location.pathname.split('/').pop() || 'index.html'), 'index.html');
      window.location.href = buildHomeUrl(target);
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

  function loadPageModules(){
    try{
      const path = String(location.pathname || '').toLowerCase().split('/').pop();
      const head = document.head || document.documentElement;
      const styles = ['./gejast-mobile-foundation-v581.css'];
      const modules = ['./gejast-mobile-foundation-v581.js','./gejast-mobile-route-fixes-v581.js'];
      if (path === 'index.html' || path === '') modules.push('./home-deep-links-v578.js');
      if (path === 'profiles.html') modules.push('./profiles-mobile-art-v578.js');
      if (path === 'pikken.html' || path === 'pikken_live.html' || path === 'pikken_stats.html') modules.push('./pikken-deep-mobile-v578.js');
      if (path === 'paardenrace.html' || path === 'paardenrace_live.html' || path === 'paardenrace_stats.html') modules.push('./paardenrace-deep-mobile-v578.js');
      styles.forEach((baseHref)=>{
        const href = `${baseHref}?v${effectiveNumber}`;
        if (document.querySelector(`link[data-gejast-style="${baseHref}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute('data-gejast-style', baseHref);
        head.appendChild(link);
      });
      modules.forEach((baseSrc)=>{
        const src = `${baseSrc}?v${effectiveNumber}`;
        if (document.querySelector(`script[data-gejast-module="${baseSrc}"]`)) return;
        const s = document.createElement('script');
        s.src = src;
        s.defer = true;
        s.setAttribute('data-gejast-module', baseSrc);
        head.appendChild(s);
      });
    }catch(_){ }
  }

  window.GEJAST_CONFIG = Object.assign({}, window.GEJAST_CONFIG || {}, CONFIG, {
    VERSION: effectiveVersion,
    VERSION_LABEL: label,
    ensureVersionWatermark,
    applyVersionLabel,
    normalizeProfileImageUrl,
    getPlayerSessionToken,
    clearPlayerSessionTokens,
    touchPlayerActivity,
    isPlayerSessionExpired,
    ensurePlayerSessionOrRedirect,
    installActivityKeepalive,
    requireMatchEntrySession,
    buildHomeUrl,
    buildLoginUrl,
    buildAdminUrl,
    setPlayerSessionToken,
    buildRequestUrl,
    normalizeScope,
    sanitizeReturnTarget,
    currentReturnTarget,
    shouldHideWatermark
  });

  purgeStaleClientCaches();
  maybeForceFreshShell();
  loadPageModules();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  else applyVersionLabel();
})();
