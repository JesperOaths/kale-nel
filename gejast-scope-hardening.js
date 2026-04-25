(function(global){
  if (global.GEJAST_SCOPE_HARDENING && global.GEJAST_SCOPE_HARDENING.version === 'v672') return;
  const cfg = global.GEJAST_CONFIG || {};
  const VERSION = 'v672';
  const STORAGE_KEY = 'gejast_scope_context_v672';
  const MEMBERSHIP_KEY = 'gejast_scope_memberships_cache_v672';
  const AUDIT_KEY = 'gejast_scope_runtime_audit_v672';
  const FAMILY_PAGE_PREFIX_RE = /(^|\/)familie(\/|$)/i;
  const FRIENDS_DEFAULT = 'friends';
  const FAMILY_DEFAULT = 'family';
  const FAMILY_NAMES_DEFAULT = ['Jesper','Emil','Anouk','Lilian','Sierk','Gunnar','Evi','Anna','Caro','Jesper Alberts','Anouk Alberts'];
  const FRIENDS_ONLY_PAGES = new Set([
    'drinks.html','drinks_add.html','drinks_pending.html','drinks_speed.html','drinks_profile.html','drinks_ladder.html','admin_drinks_push_health.html',
    'beerpong.html','beerpong_vault.html','admin_beerpong.html','beerpong_ladder.html',
    'despimarkt.html','beurs.html','despimarkt_market.html','despimarkt_wallet.html','despimarkt_debts.html','despimarkt_ladder.html','despimarkt_stats.html','despimarkt_create.html','admin_despimarkt.html','admin_despimarkt_runtime.html',
    'paardenrace.html','paardenrace_live.html','paardenrace_spectator.html','admin_paardenrace.html',
    'pikken.html','pikken_live.html','pikken_spectator.html','pikken_stats.html','admin_pikken.html'
  ]);
  const FAMILY_ALLOWED_PAGES = new Set([
    'index.html','home.html','login.html','request.html','activate.html','profiles.html','player.html','klaverjas.html','klaverjassen.html','klaverjas_live.html','klaverjas_ladder.html','leaderboard.html','boerenbridge.html','boerenbridge_live.html','boerenbridge_ladder.html','match_control.html'
  ]);
  const RPC_NEVER_TOUCH_RE = /^(admin_|claim_email|queue_|consume_web_push|register_web_push|touch_active_web_push|get_web_push|login_player|activate_player|get_activation|request_claim_action|get_requestable_names|create_account|reset_|password_|mail_|outbound_|make_)/i;
  const RPC_SCOPED_NAME_RE = /(_scoped$|_scoped_|_scope_|homepage_runtime|profiles_runtime|player_runtime|leaderboard_public|get_login_names_scoped|get_public_state|get_gejast_homepage_state|get_jas_app_state)/i;

  function norm(v){ return String(v || '').trim().toLowerCase(); }
  function cleanScope(value){ return norm(value) === FAMILY_DEFAULT ? FAMILY_DEFAULT : FRIENDS_DEFAULT; }
  function pageFile(){ try { return (global.location.pathname || '').split('/').pop().toLowerCase() || 'index.html'; } catch (_) { return 'index.html'; } }
  function urlScope(){
    try {
      const params = new URLSearchParams(global.location.search || '');
      const q = cleanScope(params.get('scope') || '');
      if (params.has('scope')) return q;
      if (FAMILY_PAGE_PREFIX_RE.test(global.location.pathname || '')) return FAMILY_DEFAULT;
    } catch (_) {}
    try {
      const stored = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && stored.scope) return cleanScope(stored.scope);
    } catch (_) {}
    return FRIENDS_DEFAULT;
  }
  function currentScope(){ return cleanScope(urlScope()); }
  function persistScope(scope){ try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scope: cleanScope(scope), at: new Date().toISOString() })); } catch (_) {} }
  function scopeParamSuffix(scope=currentScope()){
    return cleanScope(scope) === FAMILY_DEFAULT ? 'scope=family' : '';
  }
  function scopedUrl(path, scope=currentScope()){
    try {
      const url = new URL(path, global.location.href);
      if (cleanScope(scope) === FAMILY_DEFAULT) url.searchParams.set('scope','family');
      else url.searchParams.delete('scope');
      return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
    } catch (_) { return path; }
  }
  function defaultHome(scope=currentScope()){ return cleanScope(scope) === FAMILY_DEFAULT ? './familie/index.html' : './index.html'; }
  function isAdminPage(file=pageFile()){ return /^admin/i.test(file); }
  function isFriendsOnlyPage(file=pageFile()){ return FRIENDS_ONLY_PAGES.has(String(file || '').toLowerCase()); }
  function isFamilyAllowedPage(file=pageFile()){ return FAMILY_ALLOWED_PAGES.has(String(file || '').toLowerCase()); }
  function readMembershipCache(){
    try {
      const raw = JSON.parse(global.localStorage.getItem(MEMBERSHIP_KEY) || 'null');
      if (raw && raw.at && (Date.now() - Date.parse(raw.at)) < 12 * 60 * 60 * 1000) return raw;
    } catch (_) {}
    return { at:null, family_names:FAMILY_NAMES_DEFAULT.slice(), rows:[] };
  }
  function writeMembershipCache(bundle){
    const payload = {
      at: new Date().toISOString(),
      family_names: Array.isArray(bundle && bundle.family_names) ? bundle.family_names : FAMILY_NAMES_DEFAULT.slice(),
      rows: Array.isArray(bundle && bundle.rows) ? bundle.rows : []
    };
    try { global.localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(payload)); } catch (_) {}
    return payload;
  }
  function membershipRows(){ return readMembershipCache().rows || []; }
  function explicitScopeForName(name){
    const n = norm(name);
    if (!n) return '';
    const rows = membershipRows();
    for (const row of rows) {
      const candidate = norm(row.player_name || row.display_name || row.name);
      if (candidate === n) return cleanScope(row.site_scope || row.scope);
    }
    const family = (readMembershipCache().family_names || FAMILY_NAMES_DEFAULT).some((x)=>norm(x) === n);
    return family ? FAMILY_DEFAULT : '';
  }
  function isAllowedName(name, scope=currentScope()){
    const n = norm(name);
    if (!n) return cleanScope(scope) !== FAMILY_DEFAULT;
    const explicit = explicitScopeForName(n);
    if (explicit) return explicit === cleanScope(scope);
    const family = (readMembershipCache().family_names || FAMILY_NAMES_DEFAULT).some((x)=>norm(x) === n);
    return cleanScope(scope) === FAMILY_DEFAULT ? family : !family;
  }
  function pickName(row){ return row && (row.player_name || row.display_name || row.chosen_username || row.public_display_name || row.nickname || row.real_name || row.name || row.debtor_name || row.creditor_name || row.creator_name || ''); }
  function rowScope(row){
    const raw = row && (row.site_scope || row.scope || row.player_site_scope || row.viewer_scope || row.match_scope);
    const s = norm(raw);
    return s === FAMILY_DEFAULT || s === FRIENDS_DEFAULT ? s : '';
  }
  function filterNames(names, scope=currentScope()){
    const seen = new Set();
    return (Array.isArray(names) ? names : []).filter((name)=>{
      const key = norm(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return isAllowedName(name, scope);
    });
  }
  function filterRows(rows, scope=currentScope()){
    return (Array.isArray(rows) ? rows : []).filter((row)=>{
      const explicit = rowScope(row);
      if (explicit) return explicit === cleanScope(scope);
      const name = pickName(row);
      if (name) return isAllowedName(name, scope);
      return true;
    });
  }
  function audit(kind, detail){
    const item = { at: new Date().toISOString(), version: VERSION, scope: currentScope(), page: pageFile(), kind, detail: detail || {} };
    try {
      const rows = JSON.parse(global.sessionStorage.getItem(AUDIT_KEY) || '[]');
      rows.unshift(item);
      global.sessionStorage.setItem(AUDIT_KEY, JSON.stringify(rows.slice(0, 80)));
    } catch (_) {}
    try { if (detail && detail.warn) console.warn('[GEJAST scope hardening]', kind, detail); } catch (_) {}
    return item;
  }
  function installScopeBadge(){
    if (!global.document || !document.body || document.querySelector('[data-scope-hardening-badge]')) return;
    if (!isAdminPage() && currentScope() !== FAMILY_DEFAULT) return;
    const node = document.createElement('div');
    node.setAttribute('data-scope-hardening-badge','1');
    node.textContent = currentScope() === FAMILY_DEFAULT ? 'familie-scope' : 'vrienden-scope';
    Object.assign(node.style, {
      position:'fixed', right:'12px', bottom:'56px', zIndex:'9998', padding:'7px 10px', borderRadius:'999px',
      font:'800 11px/1 Inter,system-ui,sans-serif', background: currentScope() === FAMILY_DEFAULT ? 'rgba(35,83,116,.92)' : 'rgba(35,31,26,.88)', color:'#fff', border:'1px solid rgba(255,255,255,.24)', pointerEvents:'none'
    });
    document.body.appendChild(node);
  }
  function enforcePagePolicy(){
    const scope = currentScope();
    persistScope(scope);
    const file = pageFile();
    if (isAdminPage(file)) return true;
    if (scope === FAMILY_DEFAULT && isFriendsOnlyPage(file)) {
      audit('blocked_family_friends_only_page', { file, redirect: defaultHome(scope), warn:true });
      try { global.location.replace(defaultHome(scope)); } catch (_) { global.location.href = defaultHome(scope); }
      return false;
    }
    return true;
  }
  function linkScopeRelays(root=document){
    const scope = currentScope();
    if (scope !== FAMILY_DEFAULT) return;
    try {
      Array.from(root.querySelectorAll('a[href]')).forEach((a)=>{
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || /^(mailto:|tel:|https?:|javascript:)/i.test(href)) return;
        const file = href.split(/[?#]/)[0].split('/').pop().toLowerCase();
        if (!file || isFriendsOnlyPage(file)) return;
        const url = new URL(href, global.location.href);
        url.searchParams.set('scope','family');
        a.setAttribute('href', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
      });
    } catch (_) {}
  }
  function installFetchScopeInjector(){
    if (global.__GEJAST_SCOPE_FETCH_PATCH_V672) return;
    const originalFetch = global.fetch;
    if (typeof originalFetch !== 'function') return;
    global.__GEJAST_SCOPE_FETCH_PATCH_V672 = true;
    global.fetch = function(input, init){
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const match = String(url).match(/\/rest\/v1\/rpc\/([^/?#]+)/i);
        if (match && init && String(init.method || 'GET').toUpperCase() === 'POST') {
          const rpcName = decodeURIComponent(match[1] || '');
          if (!RPC_NEVER_TOUCH_RE.test(rpcName) && RPC_SCOPED_NAME_RE.test(rpcName) && init.body) {
            let body = null;
            if (typeof init.body === 'string') body = JSON.parse(init.body);
            if (body && typeof body === 'object' && !Array.isArray(body)) {
              const scope = currentScope();
              if (body.site_scope_input == null) body.site_scope_input = scope;
              if (/_scope_/i.test(rpcName) && body.scope_input == null) body.scope_input = scope;
              init = Object.assign({}, init, { body: JSON.stringify(body) });
              audit('rpc_scope_injected', { rpc: rpcName, scope });
            }
          }
        }
      } catch (err) {
        audit('rpc_scope_inject_failed', { message: String(err && err.message || err) });
      }
      return originalFetch.call(this, input, init);
    };
  }
  async function rpc(name, payload){
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config ontbreekt.');
    const res = await global.fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', mode:'cors', cache:'no-store', headers:{ apikey:cfg.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`, 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(payload || {})
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data && (data.message || data.error || data.details || data.hint) || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function refreshMemberships(){
    try {
      const data = await rpc('get_scope_hardening_bundle_v672', { site_scope_input: currentScope() });
      const rows = Array.isArray(data && data.memberships) ? data.memberships : [];
      const family = Array.isArray(data && data.family_names) ? data.family_names : FAMILY_NAMES_DEFAULT;
      writeMembershipCache({ rows, family_names: family });
      audit('membership_cache_refreshed', { rows: rows.length, family_names: family.length });
      return data;
    } catch (err) {
      audit('membership_cache_refresh_failed', { message: String(err && err.message || err) });
      return null;
    }
  }
  function boot(){
    enforcePagePolicy();
    installFetchScopeInjector();
    installScopeBadge();
    linkScopeRelays(document);
    if (global.MutationObserver) {
      try { new MutationObserver((items)=>items.forEach((item)=>item.addedNodes && Array.from(item.addedNodes).forEach((node)=>{ if (node.nodeType === 1) linkScopeRelays(node); }))).observe(document.documentElement, { childList:true, subtree:true }); } catch (_) {}
    }
    refreshMemberships().catch(()=>{});
  }
  const api = { version:VERSION, currentScope, persistScope, scopedUrl, defaultHome, pageFile, isAllowedName, filterNames, filterRows, enforcePagePolicy, refreshMemberships, audit, readAudit(){ try { return JSON.parse(global.sessionStorage.getItem(AUDIT_KEY) || '[]'); } catch (_) { return []; } }, rpc };
  global.GEJAST_SCOPE_HARDENING = api;
  if (!global.GEJAST_SCOPE_UTILS) global.GEJAST_SCOPE_UTILS = {};
  Object.assign(global.GEJAST_SCOPE_UTILS, {
    getScope: currentScope,
    normalizeScope: cleanScope,
    defaultHome,
    scopedUrl,
    isAllowedName,
    filterNames,
    filterPlayers: filterRows,
    filterMatches: filterRows,
    filterPairRows: filterRows,
    scopeParamSuffix
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(window);
