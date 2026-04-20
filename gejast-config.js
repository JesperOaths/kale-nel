(function(){
  const CONFIG = {
    VERSION:'v503',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/h63v9tzv3o1i8hqtx2m5lfugrn5funy6',
    CLAIM_EMAIL_RPC: 'claim_email_jobs_http',
    EMAIL_SUBJECT: 'Activeer je account voor de Kale Nel',
    GOLD: '#9a8241',
    GOLD_HOVER: '#8a7338',
    PLAYER_SESSION_KEYS: ['jas_session_token_v11','jas_session_token_v10'],
    PLAYER_LAST_ACTIVITY_KEY: 'jas_last_activity_at_v1',
    PLAYER_SESSION_IDLE_MS: 30 * 24 * 60 * 60 * 1000,
    PLAYER_SESSION_SOFT_STALE_MS: 12 * 60 * 60 * 1000,
    RPC_TIMEOUT_MS: 2500,
    LOGIN_NAME_TIMEOUT_MS: 2200,
    WEB_PUSH_PUBLIC_KEY: 'BPqY04jDOB_8RlhNxURgWFl6cMge64Mr7DkrWtgMfG4ARWLJ6S-r6c6JeQJ6o4kysWT0WeR9oVpahP85L8GLl_4',
    NOTIFICATION_BUTTON_ENABLED: true
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

  function watermarkStyles(node){
    if (!node || !node.style) return;
    const compact = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: compact ? '10px' : '14px',
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
      maxWidth: compact ? 'calc(100vw - 24px)' : '',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)'
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
  function normalizePersonName(value){ return String(value || '').replace(/\s+/g, ' ').trim(); }
  function uniquePersonNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(normalizePersonName).filter((name)=>{
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function inferRuntimeScope(){
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('scope') === 'family') return 'family';
      if ((location.pathname || '').includes('/familie/')) return 'family';
    } catch (_) {}
    return 'friends';
  }
  function normalizeScope(input){ return String(input || '').trim().toLowerCase() === 'family' ? 'family' : 'friends'; }

  async function callJson(url, options, timeoutMs){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, Math.max(600, Number(timeoutMs || CONFIG.RPC_TIMEOUT_MS || 2500))) : null;
    try {
      const res = await fetch(url, Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined }));
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchScopedActivePlayerNames(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const headers = { 'Content-Type':'application/json', apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' };
    function toNames(raw){
      const rows = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.players) ? raw.players : (Array.isArray(raw?.profiles) ? raw.profiles : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.data) ? raw.data : []))));
      let names = uniquePersonNames(rows
        .filter((row)=>{
          if (!row || typeof row === 'string') return true;
          const status = String(row.status || row.account_status || row.player_status || '').trim().toLowerCase();
          if (!status) return true;
          return ['active','approved','activated'].includes(status);
        })
        .map((row)=>{
          if (typeof row === 'string') return row;
          return row?.public_display_name || row?.chosen_username || row?.nickname || row?.display_name || row?.player_name || row?.name || row?.label || row?.desired_name || row?.slug || '';
        }));
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function') names = window.GEJAST_SCOPE_UTILS.filterNames(names, resolvedScope);
      return names;
    }

    const calls = [
      callJson(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_login_names_scoped`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify({ site_scope_input: resolvedScope }) }, CONFIG.LOGIN_NAME_TIMEOUT_MS).then(toNames).catch(()=>[]),
      callJson(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_all_site_players_public_scoped`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify({ site_scope_input: resolvedScope }) }, CONFIG.LOGIN_NAME_TIMEOUT_MS).then(toNames).catch(()=>[]),
      callJson(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_profiles_page_bundle_scoped`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify({ site_scope_input: resolvedScope }) }, CONFIG.LOGIN_NAME_TIMEOUT_MS).then(toNames).catch(()=>[]),
      callJson(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_login_names`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify({}) }, CONFIG.LOGIN_NAME_TIMEOUT_MS).then(toNames).catch(()=>[]),
      callJson(`${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope&status=in.(active,approved,activated)&order=display_name.asc&limit=400`, { method:'GET', mode:'cors', cache:'no-store', headers:{ apikey: headers.apikey, Authorization: headers.Authorization, Accept:'application/json' } }, CONFIG.LOGIN_NAME_TIMEOUT_MS).then(toNames).catch(()=>[])
    ];

    const settled = await Promise.allSettled(calls);
    const merged = [];
    settled.forEach((item)=>{
      const names = item.status === 'fulfilled' ? item.value : [];
      if (Array.isArray(names) && names.length) merged.push(...names);
    });
    return uniquePersonNames(merged);
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
  function isPlayerSessionExpired(){
    const token = getPlayerSessionToken();
    if (!token) return true;
    const raw = localStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || sessionStorage.getItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY) || '';
    const last = Number(raw || 0);
    if (!last) return false;
    return (Date.now() - last) > CONFIG.PLAYER_SESSION_IDLE_MS;
  }

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
      return sanitizeReturnTarget(`${path}${location.search || ''}${location.hash || ''}`, fallback || 'index.html');
    } catch (_) { return sanitizeReturnTarget(fallback || 'index.html', 'index.html'); }
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

  window.GEJAST_CONFIG = Object.assign({}, window.GEJAST_CONFIG || {}, CONFIG, {
    VERSION: effectiveVersion,
    VERSION_LABEL: label,
    ensureVersionWatermark,
    applyVersionLabel,
    normalizeProfileImageUrl,
    fetchScopedActivePlayerNames,
    getPlayerSessionToken,
    clearPlayerSessionTokens,
    touchPlayerActivity,
    isPlayerSessionExpired,
    buildHomeUrl,
    buildLoginUrl,
    normalizeScope,
    sanitizeReturnTarget,
    currentReturnTarget
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVersionLabel, { once: true });
  else applyVersionLabel();
})();