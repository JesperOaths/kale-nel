(function(){
  const CONFIG = {
    VERSION:'v492',
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
    ADMIN_SESSION_REMEMBER_MS: 60 * 24 * 60 * 60 * 1000,
    WEB_PUSH_PUBLIC_KEY: 'BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4',
    NOTIFICATION_BUTTON_ENABLED: true,
    WEB_PUSH_TEST_RPC: 'queue_test_web_push',
    WEB_PUSH_REGISTER_RPC_V3: 'register_web_push_subscription_v3',
    ACTIVE_PUSH_TOUCH_RPC_V3: 'touch_active_web_push_presence_v3',
    WEB_PUSH_SELF_DIAGNOSTICS_RPC_V3: 'get_web_push_self_diagnostics_v3',
    WEB_PUSH_QUEUE_NEARBY_RPC_V3: 'queue_nearby_verification_pushes_v3',
    WEB_PUSH_CONSUME_ACTION_RPC_V3: 'consume_web_push_action_v3',
    ADMIN_ACTIVE_PUSH_RPC_V3: 'admin_queue_active_web_push_v3',
    ADMIN_PUSH_DIAGNOSTICS_RPC_V3: 'admin_get_web_push_diagnostics_v3',
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
  const effectiveVersion = CONFIG.VERSION;
  const label = `${effectiveVersion} · Made by Bruis`;
  window.GEJAST_PAGE_VERSION = effectiveVersion;

  function watermarkStyles(node){
    if (!node || !node.style) return;
    const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    const softGameWatermark = !!(document.body && document.body.dataset && document.body.dataset.gameWatermark === 'soft');
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: compact ? '10px' : '14px',
      zIndex: '9999',
      padding: compact ? '7px 11px' : '8px 14px',
      borderRadius: '999px',
      background: softGameWatermark ? 'rgba(17,17,17,0.66)' : 'rgba(17,17,17,0.88)',
      border: '1px solid rgba(212,175,55,0.35)',
      color: '#f3e3a6',
      font: compact ? '700 12px/1.2 Inter,system-ui,sans-serif' : '700 13px/1.2 Inter,system-ui,sans-serif',
      letterSpacing: '.03em',
      pointerEvents: 'none',
      userSelect: 'none',
      boxShadow: softGameWatermark ? '0 8px 18px rgba(0,0,0,0.12)' : '0 12px 24px rgba(0,0,0,0.18)',
      textAlign: 'center',
      maxWidth: compact ? 'calc(100vw - 24px)' : '',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      opacity: softGameWatermark ? '0.75' : '1'
    });
  }
  function ensureVersionWatermark(){
    if (!document.body) return [];
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
    const nodes = ensureVersionWatermark();
    nodes.forEach((node)=>{ node.textContent = label; watermarkStyles(node); });
    const re = /v\d+\s*[·.-]?\s*Made by Bruis/i;
    document.querySelectorAll('body *').forEach((node)=>{ if (node.children.length) return; const txt=(node.textContent||'').trim(); if (re.test(txt)) { node.textContent = label; watermarkStyles(node); } });
  }


  function normalizeProfileImageUrl(value){
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    const base = String(CONFIG.SUPABASE_URL || '').trim();
    if (/^storage\/v1\/object\/public\//i.test(raw) && base) return `${base}/${raw.replace(/^\/+/, '')}`;
    if (/^(public\/)?avatars?\//i.test(raw) && base) return `${base}/storage/v1/object/public/${raw.replace(/^(public\/)?/, '').replace(/^\/+/, '')}`;
    if (base && /^[A-Za-z0-9._-]+\/.+/.test(raw)) return `${base}/storage/v1/object/public/${raw.replace(/^\/+/, '')}`;
    return raw;
  }


  function normalizePersonName(value){
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
  function uniquePersonNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(normalizePersonName).filter((name)=>{
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scopedNameCacheKey(kind, scope){
    return `gejast_${String(kind||'names')}_${normalizeScope(scope || inferRuntimeScope())}_cache_v490`;
  }
  function readScopedNameCache(kind, scope){
    try {
      const raw = localStorage.getItem(scopedNameCacheKey(kind, scope)) || sessionStorage.getItem(scopedNameCacheKey(kind, scope));
      if (!raw) return { names: [], fresh: false, updated_at: 0 };
      const parsed = JSON.parse(raw);
      const names = uniquePersonNames(Array.isArray(parsed?.names) ? parsed.names : []);
      const updatedAt = Number(parsed?.updated_at || 0) || 0;
      const fresh = updatedAt > 0 && (Date.now() - updatedAt) < (15 * 60 * 1000);
      return { names, fresh, updated_at: updatedAt };
    } catch (_) {
      return { names: [], fresh: false, updated_at: 0 };
    }
  }
  function writeScopedNameCache(kind, scope, names){
    const payload = JSON.stringify({ names: uniquePersonNames(names), updated_at: Date.now() });
    try { localStorage.setItem(scopedNameCacheKey(kind, scope), payload); } catch (_) {}
    try { sessionStorage.setItem(scopedNameCacheKey(kind, scope), payload); } catch (_) {}
  }
  async function fetchScopedActivePlayerNames(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const cached = readScopedNameCache('login_names', resolvedScope);
    const headers = { 'Content-Type':'application/json', apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}` };
    async function callRpc(name, payload){
      const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(payload || {}) });
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      return data && data[name] !== undefined ? data[name] : data;
    }
    function toNames(raw){
      const rows = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.players) ? raw.players : (Array.isArray(raw?.profiles) ? raw.profiles : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.data) ? raw.data : []))));
      let names = uniquePersonNames(rows.map((row)=>{
        if (typeof row === 'string') return row;
        return row?.public_display_name || row?.chosen_username || row?.nickname || row?.display_name || row?.player_name || row?.name || row?.label || row?.desired_name || row?.slug || '';
      }));
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function') names = window.GEJAST_SCOPE_UTILS.filterNames(names, resolvedScope);
      return names;
    }
    const attempts = [
      ['get_login_names_scoped', { site_scope_input: resolvedScope }],
      ['get_all_site_players_public_scoped', { site_scope_input: resolvedScope }],
      ['get_login_names', { site_scope_input: resolvedScope }]
    ];
    for (const [name, payload] of attempts){
      try {
        const raw = await callRpc(name, payload);
        const names = toNames(raw);
        if (names.length) {
          writeScopedNameCache('login_names', resolvedScope, names);
          return names;
        }
      } catch (_) {}
    }
    if (cached.names.length) return cached.names;
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope&status=eq.available&order=display_name.asc`;
      const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store', headers });
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      let rows = Array.isArray(data) ? data : [];
      rows = rows.filter((row)=>{
        const explicitScope = String(row?.site_scope || '').trim().toLowerCase();
        return !explicitScope || explicitScope === resolvedScope;
      });
      const names = toNames(rows);
      if (names.length) {
        writeScopedNameCache('login_names', resolvedScope, names);
        return names;
      }
    } catch (_) {}
    return [];
  }
  async function fetchScopedRequestableNames(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const cached = readScopedNameCache('request_names', resolvedScope);
    const headers = { 'Content-Type':'application/json', apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}` };
    async function callRpc(name, payload){
      const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(payload || {}) });
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      return data && data[name] !== undefined ? data[name] : data;
    }
    function toNames(raw){
      const rows = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.requestable_names) ? raw.requestable_names : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.rows) ? raw.rows : (Array.isArray(raw?.data) ? raw.data : [])))));
      let names = uniquePersonNames(rows.map((row)=>{
        if (typeof row === 'string') return row;
        return row?.display_name || row?.desired_name || row?.name || row?.player_name || row?.public_display_name || row?.chosen_username || row?.slug || '';
      }));
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function') names = window.GEJAST_SCOPE_UTILS.filterNames(names, resolvedScope);
      return names;
    }
    const attempts = [
      ['get_requestable_names_scoped', { site_scope_input: resolvedScope }],
      ['get_requestable_names', { site_scope_input: resolvedScope }]
    ];
    for (const [name, payload] of attempts){
      try {
        const raw = await callRpc(name, payload);
        const names = toNames(raw);
        if (names.length) {
          writeScopedNameCache('request_names', resolvedScope, names);
          return names;
        }
      } catch (_) {}
    }
    if (cached.names.length) return cached.names;
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope&status=eq.available&order=display_name.asc`;
      const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store', headers });
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      let rows = Array.isArray(data) ? data : [];
      rows = rows.filter((row)=>{
        const explicitScope = String(row?.site_scope || '').trim().toLowerCase();
        return !explicitScope || explicitScope === resolvedScope;
      });
      const names = toNames(rows);
      if (names.length) {
        writeScopedNameCache('request_names', resolvedScope, names);
        return names;
      }
    } catch (_) {}
    return [];
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
  function inferRuntimeScope(){ try { const qs = new URLSearchParams(location.search); if (qs.get('scope')==='family') return 'family'; if ((location.pathname||'').includes('/familie/')) return 'family'; } catch(_){} return 'friends'; }

  function sanitizeReturnTarget(raw, fallback=''){
    const value = String(raw || '').trim();
    if (!value) return String(fallback || '').trim();
    if (/^(?:[a-z]+:)?\/\//i.test(value)) return String(fallback || '').trim();
    if (value.includes('..') || value.includes('\\')) return String(fallback || '').trim();
    const normalized = value.replace(/^\.\//,'').replace(/^\/+/, '');
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
function normalizeScope(input){
  return String(input || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
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

  window.GEJAST_CONFIG = Object.assign({}, window.GEJAST_CONFIG || {}, CONFIG, {
    VERSION: effectiveVersion,
    VERSION_LABEL: label,
    ensureVersionWatermark,
    applyVersionLabel,
    normalizeProfileImageUrl,
    fetchScopedActivePlayerNames,
    fetchScopedRequestableNames,
    readScopedNameCache,
    writeScopedNameCache,
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
    currentReturnTarget
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  else applyVersionLabel();
})();
