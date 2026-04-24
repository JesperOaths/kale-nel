(function(){
  const CONFIG = {
    VERSION:'v669',
    SUPABASE_URL: 'https://uiqntazgnrxwliaidkmy.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA',
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/h63v9tzv3o1i8hqtx2m5lfugrn5funy6',
    CLAIM_EMAIL_RPC: 'claim_email_jobs_http',
    EMAIL_SUBJECT: 'Activeer je account voor de Kale Nel',
    GOLD: '#9a8241',
    GOLD_HOVER: '#8a7338',
    PLAYER_SESSION_KEYS: ['jas_session_token_v11','jas_session_token_v10'],
    PLAYER_LAST_ACTIVITY_KEY: 'jas_last_activity_at_v1',
    PLAYER_LAST_SERVER_TOUCH_KEY: 'jas_last_server_touch_at_v1',
    PLAYER_SESSION_IDLE_MS: 30 * 24 * 60 * 60 * 1000,
    PLAYER_SESSION_ACTIVITY_THROTTLE_MS: 15 * 1000,
    PLAYER_SESSION_SERVER_TOUCH_MS: 5 * 60 * 1000,
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
    DRINKS_CONTRACT_READ_RPC_V664: 'contract_drinks_read_v669',
    DRINKS_CONTRACT_WRITE_RPC_V664: 'contract_drinks_write_v669',
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
  async function fetchScopedActivePlayerNames_ORIGINAL(scope){
    const resolvedScope = normalizeScope(scope || inferRuntimeScope());
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
      ['get_all_site_players_public_scoped', { site_scope_input: resolvedScope }],
      ['get_profiles_page_bundle_scoped', { site_scope_input: resolvedScope }],
      ['get_login_names_scoped', { site_scope_input: resolvedScope }],
      ['get_login_names', {}]
    ];
    for (const [name, payload] of attempts){
      try {
        const raw = await callRpc(name, payload);
        const names = toNames(raw);
        if (names.length) return names;
      } catch (_) {}
    }
    return [];
  }


function loginNamesCacheKey(scope){
  return `gejast_login_names_cache_${normalizeScope(scope || inferRuntimeScope())}_v1`;
}
function readCachedLoginNames(scope){
  try {
    const raw = localStorage.getItem(loginNamesCacheKey(scope)) || sessionStorage.getItem(loginNamesCacheKey(scope)) || '';
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const names = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.names) ? parsed.names : []);
    return uniquePersonNames(names);
  } catch (_) {
    return [];
  }
}
function writeCachedLoginNames(names, scope){
  const clean = uniquePersonNames(names);
  const payload = JSON.stringify({ names: clean, written_at: new Date().toISOString() });
  try { localStorage.setItem(loginNamesCacheKey(scope), payload); } catch (_) {}
  try { sessionStorage.setItem(loginNamesCacheKey(scope), payload); } catch (_) {}
  return clean;
}
function rowStatusValue(row){
  const status = row && (row.status || row.activation_status || row.account_status || row.state || row.player_status || row.request_status);
  return String(status || '').trim().toLowerCase();
}
function rowHasPinSignal(row){
  if (!row || typeof row !== 'object') return false;
  return !!(
    row.has_pin || row.pin_is_set || row.pin_set || row.has_password || row.password_set ||
    row.activation_completed || row.is_activated || row.activated || row.is_active || row.account_activated
  );
}
function rowIsScoped(row, scope){
  const expected = normalizeScope(scope || inferRuntimeScope());
  if (!row || typeof row !== 'object') return true;
  const raw = row.site_scope || row.scope || row.site_scope_input || row.scope_input || row.group_scope;
  if (!raw) return true;
  return normalizeScope(raw) === expected;
}
function rowNameValue(row){
  if (typeof row === 'string') return row;
  if (!row || typeof row !== 'object') return '';
  return row.public_display_name || row.chosen_username || row.nickname || row.display_name || row.player_name || row.name || row.label || row.desired_name || row.slug || '';
}
function extractRowsDeep(raw){
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const out = [];
  const queue = [raw];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const key of ['players','profiles','rows','names','data','items','results','leaderboard']) {
      if (Array.isArray(value[key])) out.push(...value[key]);
    }
    if (value.viewer && typeof value.viewer === 'object') queue.push(value.viewer);
    if (value.player && typeof value.player === 'object') queue.push(value.player);
    if (value.bundle && typeof value.bundle === 'object') queue.push(value.bundle);
  }
  return out;
}
function activatedNamesFromRows(rows, scope){
  const strong = [];
  const weak = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!rowIsScoped(row, scope)) continue;
    const name = normalizePersonName(rowNameValue(row));
    if (!name) continue;
    weak.push(name);
    const status = rowStatusValue(row);
    if (rowHasPinSignal(row) || ['active','approved','activated'].includes(status)) strong.push(name);
  }
  return { strong: uniquePersonNames(strong), weak: uniquePersonNames(weak) };
}
async function fetchJson(url, options){
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
  if (!res.ok) throw new Error(data?.message || data?.error || data?.hint || `HTTP ${res.status}`);
  return data;
}
async function fetchAllowedUsernamesStrong(scope){
  const normalizedScope = normalizeScope(scope || inferRuntimeScope());
  const headers = { apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept: 'application/json' };
  const urls = [
    `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope,has_pin,pin_is_set,activated,is_active&order=display_name.asc`,
    `${CONFIG.SUPABASE_URL}/rest/v1/allowed_usernames?select=display_name,slug,status,site_scope&order=display_name.asc`
  ];
  for (const url of urls) {
    try {
      const rows = await fetchJson(url, { method:'GET', mode:'cors', cache:'no-store', headers });
      const filtered = activatedNamesFromRows(Array.isArray(rows) ? rows : [], normalizedScope).strong;
      if (filtered.length) return filtered;
    } catch (_) {}
  }
  return [];
}
async function fetchScopedActivePlayerNames(scope){
  const resolvedScope = normalizeScope(scope || inferRuntimeScope());
  const cached = readCachedLoginNames(resolvedScope);
  const headers = { 'Content-Type':'application/json', apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' };
  async function callRpc(name, payload){
    const data = await fetchJson(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(payload || {}) });
    return data && data[name] !== undefined ? data[name] : data;
  }
  try {
    const allowed = await fetchAllowedUsernamesStrong(resolvedScope);
    if (allowed.length) {
      writeCachedLoginNames(allowed, resolvedScope);
      return allowed;
    }
  } catch (_) {}
  const strong = [];
  const weak = [];
  const attempts = [
    ['get_all_site_players_public_scoped', { site_scope_input: resolvedScope }],
    ['get_profiles_page_bundle_scoped', { site_scope_input: resolvedScope }],
    ['get_player_profiles_public_scoped', { site_scope_input: resolvedScope }],
    ['get_login_names_scoped', { site_scope_input: resolvedScope }],
    ['get_login_names', {}]
  ];
  for (const [name, payload] of attempts){
    try {
      const raw = await callRpc(name, payload);
      const rows = extractRowsDeep(raw);
      const extracted = activatedNamesFromRows(rows, resolvedScope);
      strong.push(...extracted.strong);
      weak.push(...extracted.weak);
      if (extracted.strong.length) {
        const clean = uniquePersonNames(strong);
        writeCachedLoginNames(clean, resolvedScope);
        return clean;
      }
    } catch (_) {}
  }
  const fallback = uniquePersonNames(weak.length ? weak : cached);
  if (fallback.length) writeCachedLoginNames(fallback, resolvedScope);
  return fallback;
}
function getActivatedPlayerNamesForScope(scope){
  return fetchScopedActivePlayerNames(scope);
}
function getPlayerName(){
  try {
    const snapshot = playerSessionNamesFromState(window.__GEJAST_LAST_SESSION_STATE || {});
    if (snapshot.length) return snapshot[0];
  } catch (_) {}
  try {
    const cached = readCachedLoginNames(inferRuntimeScope());
    if (cached.length === 1) return cached[0];
  } catch (_) {}
  return '';
}

function playerSessionKeys(){
  const seen = new Set();
  return []
    .concat(Array.isArray(CONFIG.PLAYER_SESSION_KEYS) ? CONFIG.PLAYER_SESSION_KEYS : [])
    .concat(['jas_session_token_v11','jas_session_token_v10'])
    .map((value)=>String(value || '').trim())
    .filter((value)=>{
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}
function mirrorPlayerSessionToken(value){
  const token = String(value || '').trim();
  if (!token) return '';
  for (const key of playerSessionKeys()){
    localStorage.setItem(key, token);
    sessionStorage.setItem(key, token);
  }
  return token;
}
function getPlayerSessionToken(){
  for (const key of playerSessionKeys()){
    const value = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (value) {
      mirrorPlayerSessionToken(value);
      return String(value).trim();
    }
  }
  return '';
}
function clearPlayerSessionTokens(){
  for (const key of playerSessionKeys()){
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
  localStorage.removeItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY);
  sessionStorage.removeItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY);
  localStorage.removeItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY);
  sessionStorage.removeItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY);
}
let playerActivityTouchedAt = 0;
async function touchPlayerSessionServer(force){
  const token = getPlayerSessionToken();
  if (!token || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) return null;
  const now = Date.now();
  const lastRaw = localStorage.getItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY) || sessionStorage.getItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY) || '0';
  const last = Number(lastRaw || 0) || 0;
  if (!force && last && (now - last) < CONFIG.PLAYER_SESSION_SERVER_TOUCH_MS) return null;
  const headers = {
    'Content-Type':'application/json',
    apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
    Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
    Accept:'application/json'
  };
  const payloads = [
    { input_token: token },
    { session_token: token },
    { token }
  ];
  for (const payload of payloads){
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, 4000) : null;
    try {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/player_touch_session`, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers,
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (res.ok) {
        const stamp = String(now);
        localStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
        sessionStorage.setItem(CONFIG.PLAYER_LAST_SERVER_TOUCH_KEY, stamp);
        return data;
      }
      const raw = String((data && (data.message || data.error || data.hint)) || text || `HTTP ${res.status}`);
      if (!/schema cache|could not find the function|no function matches|does not exist|rpc/i.test(raw)) break;
    } catch (_) {
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }
  return null;
}
function touchPlayerActivity(options){
  const token = getPlayerSessionToken();
  if (!token) return;
  const force = !!(options && (options.force || options.forceServerTouch));
  const now = Date.now();
  if (!force && playerActivityTouchedAt && (now - playerActivityTouchedAt) < CONFIG.PLAYER_SESSION_ACTIVITY_THROTTLE_MS) {
    return;
  }
  playerActivityTouchedAt = now;
  const ts = String(now);
  localStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
  sessionStorage.setItem(CONFIG.PLAYER_LAST_ACTIVITY_KEY, ts);
  Promise.resolve(touchPlayerSessionServer(force)).catch(()=>{});
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
function normalizePlayerSessionName(value){
  return String(value || '').replace(/\s+/g, ' ').trim();
}
function uniquePlayerSessionNames(values){
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map(normalizePlayerSessionName).filter((name)=>{
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function playerSessionNamesFromState(state){
  const viewer = state && typeof state === 'object' ? (state.viewer || {}) : {};
  const player = state && typeof state === 'object' ? (state.player || {}) : {};
  return uniquePlayerSessionNames([
    state && state.my_name,
    state && state.display_name,
    state && state.player_name,
    state && state.public_display_name,
    state && state.chosen_username,
    state && state.username,
    state && state.nickname,
    state && state.slug,
    viewer && viewer.my_name,
    viewer && viewer.display_name,
    viewer && viewer.player_name,
    viewer && viewer.public_display_name,
    viewer && viewer.chosen_username,
    viewer && viewer.username,
    viewer && viewer.nickname,
    viewer && viewer.slug,
    player && player.display_name,
    player && player.player_name,
    player && player.public_display_name,
    player && player.chosen_username,
    player && player.username,
    player && player.nickname,
    player && player.slug
  ]);
}
function playerSessionNamesOverlap(left, right){
  const rhs = new Set(uniquePlayerSessionNames(right).map((name)=>name.toLowerCase()));
  return uniquePlayerSessionNames(left).some((name)=>rhs.has(name.toLowerCase()));
}
async function fetchPlayerSessionSnapshot(token){
  const value = String(token || '').trim();
  if (!value || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) return { status:'missing', state:null, aliases:[] };
  const headers = {
    'Content-Type':'application/json',
    apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY || '',
    Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY || ''}`,
    Accept:'application/json'
  };
  const attempts = [
    ['get_public_state', { session_token: value }],
    ['get_gejast_homepage_state', { session_token: value }],
    ['get_jas_app_state', { session_token: value }],
    ['get_public_state', { session_token_input: value }],
    ['get_gejast_homepage_state', { session_token_input: value }],
    ['get_jas_app_state', { session_token_input: value }]
  ];
  let hadResponse = false;
  for (const [name, payload] of attempts){
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = controller ? window.setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, 4000) : null;
      try {
        const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method:'POST',
          mode:'cors',
          cache:'no-store',
          headers,
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
        hadResponse = true;
        if (!res.ok) continue;
        const aliases = playerSessionNamesFromState(data);
        if (aliases.length || (data && (data.viewer || data.player || data.session_valid === true || data.is_logged_in === true))) {
          return { status:'valid', state:data, aliases };
        }
      } finally {
        if (timeout) window.clearTimeout(timeout);
      }
    } catch (_) {}
  }
  return { status: hadResponse ? 'invalid' : 'unknown', state:null, aliases:[] };
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
  mirrorPlayerSessionToken(value);
  touchPlayerActivity({ force:true });
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
    if (window.__GEJAST_ACTIVITY_KEEPALIVE_INSTALLED) return;
    window.__GEJAST_ACTIVITY_KEEPALIVE_INSTALLED = true;
    const suppressLogout = !!options.suppressLogout;
    const logoutSelectors = options.logoutSelectors || ['#playerSessionCornerLogout','.player-session-corner-btn.logout','[data-player-logout]'];
    const touch = ()=> touchPlayerActivity();
    ['pointerdown','keydown','scroll','touchstart','mousemove'].forEach((eventName)=>{
      window.addEventListener(eventName, touch, { passive:true });
    });
    document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) touchPlayerActivity({ force:true }); });
    window.addEventListener('focus', ()=>touchPlayerActivity({ force:true }));
    touchPlayerActivity({ force:true });
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
  function shouldAutoInstallActivityKeepalive(){
    try {
      const file = String((location.pathname || '').split('/').pop() || '').toLowerCase();
      if (!file) return true;
      if (/^admin/i.test(file)) return false;
      return !['home.html','login.html','request.html','activate.html'].includes(file);
    } catch (_) {
      return true;
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
    getActivatedPlayerNamesForScope,
    readCachedLoginNames,
    writeCachedLoginNames,
    getPlayerName,
    getPlayerSessionToken,
    clearPlayerSessionTokens,
    touchPlayerActivity,
    touchPlayerSessionServer,
    fetchPlayerSessionSnapshot,
    playerSessionNamesFromState,
    playerSessionNamesOverlap,
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

  function ensureSiteAnnouncementRuntime(){
    try {
      const path = String((location && location.pathname) || '').toLowerCase();
      if (/\/admin/.test(path)) return;
      if (document.querySelector('script[data-despimarkt-announcements]')) return;
      const script = document.createElement('script');
      script.src = `./gejast-site-announcements.js?${effectiveVersion}`;
      script.async = false;
      script.setAttribute('data-despimarkt-announcements','1');
      document.head.appendChild(script);
    } catch (_) {}
  }

  function afterDomReady(){
    applyVersionLabel();
    ensureSiteAnnouncementRuntime();
    if (getPlayerSessionToken() && shouldAutoInstallActivityKeepalive()) installActivityKeepalive();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', afterDomReady, { once: true });
  } else {
    afterDomReady();
  }
})();
