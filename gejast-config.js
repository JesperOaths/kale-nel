(function(){
  const CONFIG = {
    VERSION:'v501',
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
    RPC_TIMEOUT_MS: 9000,
    LOGIN_NAME_TIMEOUT_MS: 7000,
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
  const candidates = [detectScriptVersion(), window.GEJAST_PAGE_VERSION, CONFIG.VERSION].filter(Boolean);
  const effectiveVersion = candidates.sort((a,b)=>parseVersion(b)-parseVersion(a))[0] || CONFIG.VERSION;
  const label = `${effectiveVersion} - Made by Bruis`;
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
  const SCOPED_NAME_CACHE_PREFIX = 'gejast_scoped_names_v1:';
  function safeStorageGet(key){
    try { return localStorage.getItem(key); } catch (_) { return ''; }
  }
  function safeStorageSet(key, value){
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function readScopedNameCache(kind, scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const key = `${SCOPED_NAME_CACHE_PREFIX}${kind}:${resolvedScope}`;
    try {
      const raw = safeStorageGet(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const names = uniquePersonNames(Array.isArray(data?.names) ? data.names : []);
      if (!names.length) return null;
      return {
        kind,
        scope: resolvedScope,
        names,
        ts: Number(data?.ts || 0) || 0
      };
    } catch (_) {
      return null;
    }
  }
  function writeScopedNameCache(kind, scope, names){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const cleanNames = uniquePersonNames(names);
    if (!cleanNames.length) return;
    const key = `${SCOPED_NAME_CACHE_PREFIX}${kind}:${resolvedScope}`;
    safeStorageSet(key, JSON.stringify({
      names: cleanNames,
      ts: Date.now(),
      scope: resolvedScope
    }));
  }
  function hasUsablePin(value){
    return String(value ?? '').trim().length > 0 && String(value ?? '').trim().toLowerCase() !== 'null';
  }
  function normalizeMatchKey(value){
    return normalizePersonName(value).toLowerCase();
  }
  function buildPlayerLookup(rows){
    const byId = new Map();
    const byKey = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row)=>{
      if (!row || typeof row !== 'object') return;
      const id = row?.id ?? row?.player_id ?? null;
      if (id !== null && id !== undefined && !byId.has(String(id))) byId.set(String(id), row);
      [
        row?.display_name,
        row?.profile_display_name,
        row?.public_display_name,
        row?.chosen_username,
        row?.player_name,
        row?.username,
        row?.slug
      ].forEach((candidate)=>{
        const key = normalizeMatchKey(candidate);
        if (!key || byKey.has(key)) return;
        byKey.set(key, row);
      });
    });
    return { byId, byKey };
  }
  function resolveAllowedRowPlayer(row, lookup){
    if (!row || !lookup) return null;
    const direct = row?.players;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    const directId = row?.player_id ?? row?.players_id ?? null;
    if (directId !== null && directId !== undefined) {
      const found = lookup.byId.get(String(directId));
      if (found) return found;
    }
    const candidateKeys = [
      row?.display_name,
      row?.username,
      row?.slug,
      row?.player_name,
      row?.name
    ].map(normalizeMatchKey).filter(Boolean);
    for (const key of candidateKeys) {
      const found = lookup.byKey.get(key);
      if (found) return found;
    }
    return null;
  }
  function classifyScopedNamesByPin(allowedRows, playerRows, scope, mode){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const lookup = buildPlayerLookup(playerRows);
    return uniquePersonNames((Array.isArray(allowedRows) ? allowedRows : []).filter((row)=>{
      const rowScope = normalizeScope(row?.site_scope || resolvedScope);
      if (rowScope !== resolvedScope) return false;
      const matchedPlayer = resolveAllowedRowPlayer(row, lookup);
      const active = hasUsablePin(matchedPlayer?.pin_hash);
      return mode === 'inactive' ? !active : active;
    }).map((row)=>row?.display_name || row?.username || row?.slug || ''));
  }
  async function callJsonWithTimeout(url, options, timeoutMs){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, Math.max(600, Number(timeoutMs || CONFIG.RPC_TIMEOUT_MS || 2500))) : null;
    try {
      const res = await fetch(url, Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined }));
      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_) { throw new Error(txt || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('RPC timeout');
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }
  function restHeaders(){
    return {
      'Content-Type':'application/json',
      apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
      Accept:'application/json'
    };
  }
  async function fetchScopedNamesByPin(scope, mode){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const headers = restHeaders();
    const rpcAttempts = mode === 'inactive'
      ? [
          ['get_requestable_names_by_pin_scoped', { site_scope_input: resolvedScope }],
          ['get_requestable_names_by_pin', {}]
        ]
      : [
          ['get_login_names_by_pin_scoped', { site_scope_input: resolvedScope }],
          ['get_login_names_by_pin', {}]
        ];
    for (const [endpoint, body] of rpcAttempts) {
      try {
        const raw = await callJsonWithTimeout(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${endpoint}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(body) }, CONFIG.LOGIN_NAME_TIMEOUT_MS);
        const rows = Array.isArray(raw)
          ? raw
          : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw?.players) ? raw.players : [])));
        const names = uniquePersonNames(rows.map((row)=>{
          if (typeof row === 'string') return row;
          return row?.display_name || row?.public_display_name || row?.chosen_username || row?.username || row?.player_name || row?.name || row?.slug || '';
        }));
        if (names.length) return names;
      } catch (_) {}
    }
    try {
      const [allowedRows, playerRows] = await Promise.all([
        callJsonWithTimeout(
          `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,username,slug,site_scope,player_id&order=display_name.asc&limit=400`,
          { method:'GET', mode:'cors', cache:'no-store', headers:{ apikey: headers.apikey, Authorization: headers.Authorization, Accept:'application/json' } },
          CONFIG.LOGIN_NAME_TIMEOUT_MS
        ),
        callJsonWithTimeout(
          `${CONFIG.SUPABASE_URL}/rest/v1/players?select=id,display_name,profile_display_name,slug,site_scope,pin_hash&limit=400`,
          { method:'GET', mode:'cors', cache:'no-store', headers:{ apikey: headers.apikey, Authorization: headers.Authorization, Accept:'application/json' } },
          CONFIG.LOGIN_NAME_TIMEOUT_MS
        )
      ]);
      return classifyScopedNamesByPin(allowedRows, playerRows, resolvedScope, mode);
    } catch (_) {
      return [];
    }
  }
  function isClaimedActiveStatus(value){
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'active'
      || raw === 'activated'
      || raw === 'claimed'
      || raw === 'claim_complete'
      || raw === 'approved'
      || raw === 'approved_pending_activation'
      || raw === 'pending_activation'
      || raw === 'awaiting_activation'
      || raw === 'waiting';
  }
  function isRequestableStatus(value){
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'available'
      || raw === 'claimable'
      || raw === 'returned_to_claimable'
      || raw === 'claimable_again'
      || raw === 'open';
  }
  async function fetchScopedActivePlayerNames(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const headers = restHeaders();
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
    const mergedNames = [];
    const byPin = await fetchScopedNamesByPin(resolvedScope, 'active').catch(()=>[]);
    if (byPin.length) {
      writeScopedNameCache('login_names', resolvedScope, byPin);
      return byPin;
    }
    try {
      const rows = await callJsonWithTimeout(
        `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,username,status,site_scope&order=display_name.asc&limit=400`,
        { method:'GET', mode:'cors', cache:'no-store', headers:{ apikey: headers.apikey, Authorization: headers.Authorization, Accept:'application/json' } },
        CONFIG.LOGIN_NAME_TIMEOUT_MS
      );
      const canonicalNames = uniquePersonNames((Array.isArray(rows) ? rows : []).filter((row)=>{
        const rowScope = normalizeScope(row?.site_scope || resolvedScope);
        return rowScope === resolvedScope && isClaimedActiveStatus(row?.status);
      }).map((row)=>row?.display_name || ''));
      mergedNames.push(...uniquePersonNames((Array.isArray(rows) ? rows : []).filter((row)=>{
        const rowScope = normalizeScope(row?.site_scope || resolvedScope);
        return rowScope === resolvedScope;
      }).map((row)=>row?.display_name || row?.slug || '')));
      if (canonicalNames.length) return canonicalNames;
    } catch (_) {}
    for (const [endpoint, body] of [
      ['get_login_names_scoped', { site_scope_input: resolvedScope }],
      ['get_login_names', {}],
      ['get_all_site_players_public_scoped', { site_scope_input: resolvedScope }]
    ]) {
      try {
        const names = toNames(await callJsonWithTimeout(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${endpoint}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(body) }, CONFIG.LOGIN_NAME_TIMEOUT_MS));
        if (names.length) {
          mergedNames.push(...names);
          if (endpoint !== 'get_all_site_players_public_scoped') {
            const out = uniquePersonNames(mergedNames);
            writeScopedNameCache('login_names', resolvedScope, out);
            return out;
          }
        }
      } catch (_) {}
    }
    const out = uniquePersonNames(mergedNames);
    if (out.length) writeScopedNameCache('login_names', resolvedScope, out);
    return out;
  }
  async function fetchScopedRequestableNames(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
    const headers = restHeaders();
    function toNames(raw){
      const rows = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.requestable_names) ? raw.requestable_names : (Array.isArray(raw?.names) ? raw.names : (Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.rows) ? raw.rows : (Array.isArray(raw?.data) ? raw.data : [])))));
      let names = uniquePersonNames(rows.map((row)=>{
        if (typeof row === 'string') return row;
        return row?.display_name || row?.desired_name || row?.name || row?.label || row?.slug || '';
      }));
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function') names = window.GEJAST_SCOPE_UTILS.filterNames(names, resolvedScope);
      return names;
    }
    const cached = readScopedNameCache('request_names', resolvedScope);
    const mergedNames = [];
    const byPin = await fetchScopedNamesByPin(resolvedScope, 'inactive').catch(()=>[]);
    if (byPin.length) {
      writeScopedNameCache('request_names', resolvedScope, byPin);
      return byPin;
    }
    try {
      const rows = await callJsonWithTimeout(
        `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,username,slug,status,site_scope&order=display_name.asc&limit=400`,
        { method:'GET', mode:'cors', cache:'no-store', headers:{ apikey: headers.apikey, Authorization: headers.Authorization, Accept:'application/json' } },
        CONFIG.LOGIN_NAME_TIMEOUT_MS
      );
      const canonicalNames = uniquePersonNames((Array.isArray(rows) ? rows : []).filter((row)=>{
        const rowScope = normalizeScope(row?.site_scope || resolvedScope);
        return rowScope === resolvedScope && isRequestableStatus(row?.status);
      }).map((row)=>row?.display_name || row?.slug || ''));
      mergedNames.push(...uniquePersonNames((Array.isArray(rows) ? rows : []).filter((row)=>{
        const rowScope = normalizeScope(row?.site_scope || resolvedScope);
        return rowScope === resolvedScope;
      }).map((row)=>row?.display_name || row?.slug || '')));
      if (canonicalNames.length) {
        writeScopedNameCache('request_names', resolvedScope, canonicalNames);
        return canonicalNames;
      }
    } catch (_) {}
    for (const [endpoint, body] of [
      ['get_requestable_names_scoped', { site_scope_input: resolvedScope }],
      ['get_requestable_names', {}]
    ]) {
      try {
        const names = toNames(await callJsonWithTimeout(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${endpoint}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(body) }, CONFIG.LOGIN_NAME_TIMEOUT_MS));
        if (names.length) {
          mergedNames.push(...names);
          const out = uniquePersonNames(mergedNames);
          writeScopedNameCache('request_names', resolvedScope, out);
          return out;
        }
      } catch (_) {}
    }
    return uniquePersonNames([...(cached?.names || []), ...mergedNames]);
  }

  function getPlayerSessionToken(){
    for(const key of CONFIG.PLAYER_SESSION_KEYS){
      const localValue = localStorage.getItem(key);
      const sessionValue = sessionStorage.getItem(key);
      const value = localValue || sessionValue;
      if (value) {
        const primaryKey = CONFIG.PLAYER_SESSION_KEYS[0] || key;
        try {
          localStorage.setItem(primaryKey, value);
          sessionStorage.setItem(primaryKey, value);
        } catch (_) {}
        return value;
      }
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
  function isPlayerSessionLocallyStale(){
    const token = getPlayerSessionToken();
    if (!token) return true;
    const last = lastPlayerActivity();
    if (!last) return false;
    return (Date.now() - last) > CONFIG.PLAYER_SESSION_SOFT_STALE_MS;
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
  for (const key of CONFIG.PLAYER_SESSION_KEYS) {
    try { localStorage.removeItem(key); } catch (_) {}
    try { sessionStorage.removeItem(key); } catch (_) {}
  }
  try { localStorage.setItem(primaryKey, value); } catch (_) {}
  try { sessionStorage.setItem(primaryKey, value); } catch (_) {}
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
    isPlayerSessionLocallyStale,
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
