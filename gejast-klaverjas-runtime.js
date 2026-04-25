(function(global){
  'use strict';
  const cfg = global.GEJAST_CONFIG || {};
  const VERSION = 'v689';
  const DEFAULT_SCOPE = 'friends';
  const SESSION_KEYS = (cfg.PLAYER_SESSION_KEYS || ['jas_session_token_v11','jas_session_token_v10']);

  function getScope(){
    try {
      if (global.GEJAST_SCOPE_CONTEXT && global.GEJAST_SCOPE_CONTEXT.getScope) return global.GEJAST_SCOPE_CONTEXT.getScope();
      if (global.GEJAST_SCOPE_UTILS && global.GEJAST_SCOPE_UTILS.getScope) return global.GEJAST_SCOPE_UTILS.getScope();
      const qs = new URLSearchParams(global.location.search || '');
      return qs.get('scope') === 'family' || (global.location.pathname || '').includes('/familie/') ? 'family' : DEFAULT_SCOPE;
    } catch (_) { return DEFAULT_SCOPE; }
  }
  function getToken(){
    try { if (cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken() || ''); } catch (_) {}
    for (const key of SESSION_KEYS){
      try { const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key); if (value) return String(value); } catch (_) {}
    }
    return '';
  }
  function getAdminToken(){
    for (const key of ['jas_admin_session_v8']){
      try { const value = global.sessionStorage.getItem(key) || global.localStorage.getItem(key); if (value) return String(value); } catch (_) {}
    }
    return '';
  }
  function headers(){
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: 'Bearer ' + (cfg.SUPABASE_PUBLISHABLE_KEY || ''),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || ('HTTP ' + res.status)); }
    if (!res.ok) throw new Error((data && (data.message || data.error || data.details || data.hint)) || text || ('HTTP ' + res.status));
    return data;
  }
  async function rpc(name, payload, opts){
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config ontbreekt.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number((opts && opts.timeoutMs) || 16000));
    try {
      const body = Object.assign({ site_scope_input: getScope() }, payload || {});
      const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + name, {
        method: 'POST', mode: 'cors', cache: 'no-store', headers: headers(), body: JSON.stringify(body), signal: controller.signal
      });
      const raw = await parseResponse(res);
      return raw && raw[name] !== undefined ? raw[name] : raw;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('RPC timeout: ' + name);
      throw err;
    } finally { clearTimeout(timer); }
  }
  function cleanName(value){ return String(value || '').replace(/\s+/g, ' ').trim(); }
  function uniqueNames(values){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(cleanName).filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function normalizeTeam(value){
    if (Array.isArray(value)) return uniqueNames(value);
    return uniqueNames(String(value || '').split(/[,&/]+/g));
  }
  function scopeQuery(){ return getScope() === 'family' ? '?scope=family' : ''; }
  function liveHref(clientMatchId){
    const url = new URL('./klaverjas_live.html', global.location.href);
    if (clientMatchId) url.searchParams.set('client_match_id', clientMatchId);
    if (getScope() === 'family') url.searchParams.set('scope', 'family');
    return url.pathname.split('/').pop() + url.search;
  }
  async function loadNames(){
    try {
      if (cfg.getActivatedPlayerNamesForScope) {
        const rows = await Promise.race([cfg.getActivatedPlayerNamesForScope(getScope()), new Promise((resolve)=>setTimeout(()=>resolve([]), 1600))]);
        if (Array.isArray(rows) && rows.length) return uniqueNames(rows);
      }
    } catch (_) {}
    try {
      const data = await rpc('get_login_active_names_v687', { site_scope_input: getScope() }, { timeoutMs: 1800 });
      const rows = Array.isArray(data) ? data : (Array.isArray(data && data.names) ? data.names : (Array.isArray(data && data.activated_names) ? data.activated_names : []));
      const names = uniqueNames(rows.map((row) => typeof row === 'string' ? row : (row.display_name || row.player_name || row.name || '')));
      if (names.length) return names;
    } catch (_) {}
    try {
      const data = await rpc('get_player_selector_source_v1', { site_scope_input: getScope() }, { timeoutMs: 1800 });
      const rows = Array.isArray(data && data.activated_names) ? data.activated_names : [];
      const names = uniqueNames(rows);
      if (names.length) return names;
    } catch (_) {}
    try {
      const data = await rpc('get_scoped_player_names_v687', { site_scope_input: getScope() }, { timeoutMs: 8000 });
      const rows = Array.isArray(data) ? data : (Array.isArray(data && data.names) ? data.names : []);
      return uniqueNames(rows.map((row) => typeof row === 'string' ? row : (row.display_name || row.player_name || row.name || '')));
    } catch (_) {}
    return [];
  }
  function normalizeMatchInput(input){
    const payload = Object.assign({}, input || {});
    payload.team_a_names = normalizeTeam(payload.team_a_names || payload.teamA || payload.team_a || []);
    payload.team_b_names = normalizeTeam(payload.team_b_names || payload.teamB || payload.team_b || []);
    payload.team_a_score = Number(payload.team_a_score ?? payload.score_a ?? payload.teamAScore ?? 0);
    payload.team_b_score = Number(payload.team_b_score ?? payload.score_b ?? payload.teamBScore ?? 0);
    payload.roem_a = Number(payload.roem_a ?? payload.roemA ?? 0);
    payload.roem_b = Number(payload.roem_b ?? payload.roemB ?? 0);
    payload.mars_team = String(payload.mars_team || '').trim();
    payload.notes = String(payload.notes || '').trim();
    payload.client_match_id = String(payload.client_match_id || ('klaverjas-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8)));
    if (payload.team_a_names.length !== 2 || payload.team_b_names.length !== 2) throw new Error('Klaverjassen verwacht precies twee spelers per team.');
    const all = payload.team_a_names.concat(payload.team_b_names).map((x) => x.toLowerCase());
    if (new Set(all).size !== all.length) throw new Error('Elke speler mag maar één keer meedoen.');
    if (payload.team_a_score === payload.team_b_score) throw new Error('Een Klaverjas-pot kan niet gelijk eindigen.');
    return payload;
  }
  async function saveMatch(input){
    const payload = normalizeMatchInput(input);
    return await rpc('save_klaverjas_match_v687', {
      session_token: getToken() || null,
      session_token_input: getToken() || null,
      client_match_id_input: payload.client_match_id,
      match_payload: payload,
      site_scope_input: getScope()
    });
  }
  async function startLive(input){
    const payload = normalizeMatchInput(Object.assign({ team_a_score: 0, team_b_score: 0 }, input || {}));
    return await rpc('start_klaverjas_live_match_v687', {
      session_token_input: getToken() || null,
      client_match_id_input: payload.client_match_id,
      match_payload: payload,
      site_scope_input: getScope()
    });
  }
  async function updateLive(clientMatchId, patch){
    return await rpc('update_klaverjas_live_match_v687', {
      session_token_input: getToken() || null,
      client_match_id_input: clientMatchId,
      patch_payload: patch || {},
      site_scope_input: getScope()
    });
  }
  async function finishLive(clientMatchId, patch){
    return await rpc('finish_klaverjas_live_match_v687', {
      session_token_input: getToken() || null,
      client_match_id_input: clientMatchId,
      patch_payload: patch || {},
      site_scope_input: getScope()
    });
  }
  async function getLive(clientMatchId){
    return await rpc('get_klaverjas_live_state_public_v687', { client_match_id_input: clientMatchId || null, site_scope_input: getScope() }, { timeoutMs: 9000 });
  }
  async function getLeaderboard(){
    return await rpc('get_klaverjas_leaderboard_public_v687', { site_scope_input: getScope() }, { timeoutMs: 10000 });
  }
  async function getBundle(){
    return await rpc('get_klaverjas_runtime_bundle_v687', { site_scope_input: getScope() }, { timeoutMs: 12000 });
  }
  async function adminAudit(){
    return await rpc('admin_get_klaverjas_runtime_audit_v687', { admin_session_token_input: getAdminToken() || null, site_scope_input: getScope() }, { timeoutMs: 12000 });
  }
  async function adminDelete(matchId){
    return await rpc('admin_delete_klaverjas_match_v687', { admin_session_token_input: getAdminToken() || null, match_id_input: matchId, site_scope_input: getScope() });
  }
  async function adminRebuild(){
    return await rpc('admin_rebuild_klaverjas_ratings_v687', { admin_session_token_input: getAdminToken() || null, site_scope_input: getScope() }, { timeoutMs: 20000 });
  }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function fmtDate(value){
    const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value || '—') : d.toLocaleString('nl-NL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  global.GEJAST_KLAVERJAS_RUNTIME = {
    VERSION, getScope, getToken, getAdminToken, rpc, loadNames, saveMatch, startLive, updateLive, finishLive,
    getLive, getLeaderboard, getBundle, adminAudit, adminDelete, adminRebuild, normalizeMatchInput, liveHref,
    escapeHtml, fmtDate, scopeQuery
  };
})(window);
