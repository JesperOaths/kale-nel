(function(global){
  'use strict';
  const cfg = global.GEJAST_CONFIG || {};
  const VERSION = 'v690';
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
  function isMissingRpcError(err){
    return /schema cache|could not find the function|does not exist|not found/i.test(String(err && err.message || err || ''));
  }
  function uuid(){
    try { if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID(); } catch (_) {}
    return '10000000-1000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  }
  function isUuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }
  function isNumericId(value){
    return /^\d+$/.test(String(value || ''));
  }
  function isLegacyId(value){
    return isUuid(value) || isNumericId(value);
  }
  function legacyRound(payload, patch){
    const source = Object.assign({}, payload || {}, patch || {});
    return {
      round: Number(source.round_no || source.roundNo || 1) || 1,
      roundNo: Number(source.round_no || source.roundNo || 1) || 1,
      team: 'W',
      bid: 80,
      suit: 'S',
      baseW: Number(source.team_a_score ?? source.score_a ?? source.teamAScore ?? 0) || 0,
      baseZ: Number(source.team_b_score ?? source.score_b ?? source.teamBScore ?? 0) || 0,
      roemW: Number(source.roem_a ?? source.roemA ?? 0) || 0,
      roemZ: Number(source.roem_b ?? source.roemB ?? 0) || 0,
      fw: Number(source.team_a_score ?? source.score_a ?? source.teamAScore ?? 0) || 0,
      fz: Number(source.team_b_score ?? source.score_b ?? source.teamBScore ?? 0) || 0,
      note: String(source.note || source.notes || '')
    };
  }
  function legacyPayload(input, status, patch){
    const payload = Object.assign({}, input || {});
    const round = legacyRound(payload, patch);
    const teamA = normalizeTeam(payload.team_a_names || payload.teamA || payload.team_a || []);
    const teamB = normalizeTeam(payload.team_b_names || payload.teamB || payload.team_b || []);
    const id = isNumericId(payload.client_match_id) ? Number(payload.client_match_id) : (isUuid(payload.client_match_id) ? payload.client_match_id : null);
    return {
      session_token: getToken() || null,
      match_id_input: id,
      site_scope_input: getScope(),
      team_w_player_ids_input: [],
      team_z_player_ids_input: [],
      team_w_player_names_input: teamA,
      team_z_player_names_input: teamB,
      rounds_input: (status === 'active' && !patch) ? [] : [round],
      payload_snapshot_input: Object.assign({}, payload, patch || {}, {
        client_match_id: id || payload.client_match_id || null,
        team_a_names: teamA,
        team_b_names: teamB,
        team_a_score: round.fw,
        team_b_score: round.fz,
        note: String((patch && patch.note) || payload.note || payload.notes || '')
      }),
      status_input: status,
      started_at_input: payload.started_at || null
    };
  }
  function legacyMatchToLive(data){
    const match = data && (data.match || data.live_match || data);
    if (!match || typeof match !== 'object') return { live_matches: [] };
    const payload = match.payload_snapshot || {};
    const row = {
      client_match_id: payload.client_match_id || match.client_match_id || match.id,
      status: match.status || 'active',
      updated_at: match.updated_at || match.started_at || match.finished_at,
      team_a_names: match.team_w_player_names || payload.team_a_names || [],
      team_b_names: match.team_z_player_names || payload.team_b_names || [],
      team_a_score: match.final_score_w ?? payload.team_a_score ?? 0,
      team_b_score: match.final_score_z ?? payload.team_b_score ?? 0,
      round_no: match.total_rounds_played || payload.round_no || 0,
      payload: payload
    };
    return { live_match: row, live_matches: [row] };
  }
  function legacyInputFromMatch(data, clientMatchId){
    const match = data && (data.match || data.live_match || data);
    const payload = (match && match.payload_snapshot) || {};
    return {
      client_match_id: payload.client_match_id || clientMatchId,
      team_a_names: (match && match.team_w_player_names) || payload.team_a_names || [],
      team_b_names: (match && match.team_z_player_names) || payload.team_b_names || [],
      team_a_score: (match && match.final_score_w) ?? payload.team_a_score ?? 0,
      team_b_score: (match && match.final_score_z) ?? payload.team_b_score ?? 0,
      roem_a: (match && match.total_roem_w) ?? payload.roem_a ?? 0,
      roem_b: (match && match.total_roem_z) ?? payload.roem_b ?? 0,
      notes: payload.note || payload.notes || ''
    };
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
  function normalizeMatchInput(input, options){
    const allowTie = Boolean(options && options.allowTie);
    const payload = Object.assign({}, input || {});
    payload.team_a_names = normalizeTeam(payload.team_a_names || payload.teamA || payload.team_a || []);
    payload.team_b_names = normalizeTeam(payload.team_b_names || payload.teamB || payload.team_b || []);
    payload.team_a_score = Number(payload.team_a_score ?? payload.score_a ?? payload.teamAScore ?? 0);
    payload.team_b_score = Number(payload.team_b_score ?? payload.score_b ?? payload.teamBScore ?? 0);
    payload.roem_a = Number(payload.roem_a ?? payload.roemA ?? 0);
    payload.roem_b = Number(payload.roem_b ?? payload.roemB ?? 0);
    payload.mars_team = String(payload.mars_team || '').trim();
    payload.notes = String(payload.notes || '').trim();
    payload.client_match_id = String(payload.client_match_id || uuid());
    if (payload.team_a_names.length !== 2 || payload.team_b_names.length !== 2) throw new Error('Klaverjassen verwacht precies twee spelers per team.');
    const all = payload.team_a_names.concat(payload.team_b_names).map((x) => x.toLowerCase());
    if (new Set(all).size !== all.length) throw new Error('Elke speler mag maar één keer meedoen.');
    if (!allowTie && payload.team_a_score === payload.team_b_score) throw new Error('Een Klaverjas-pot kan niet gelijk eindigen.');
    return payload;
  }
  async function saveMatch(input){
    const payload = normalizeMatchInput(input);
    try {
      return await rpc('save_klaverjas_match_v687', {
        session_token: getToken() || null,
        session_token_input: getToken() || null,
        client_match_id_input: payload.client_match_id,
        match_payload: payload,
        site_scope_input: getScope()
      });
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      return await rpc('klaverjas_upsert_match_state_scoped', legacyPayload(payload, 'finished'), { timeoutMs: 12000 });
    }
  }
  async function startLive(input){
    const payload = normalizeMatchInput(Object.assign({ team_a_score: 0, team_b_score: 0 }, input || {}), { allowTie: true });
    try {
      return await rpc('start_klaverjas_live_match_v687', {
        session_token_input: getToken() || null,
        client_match_id_input: payload.client_match_id,
        match_payload: payload,
        site_scope_input: getScope()
      });
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      return legacyMatchToLive(await rpc('klaverjas_upsert_match_state_scoped', legacyPayload(payload, 'active'), { timeoutMs: 12000 }));
    }
  }
  async function updateLive(clientMatchId, patch){
    try {
      return await rpc('update_klaverjas_live_match_v687', {
        session_token_input: getToken() || null,
        client_match_id_input: clientMatchId,
        patch_payload: patch || {},
        site_scope_input: getScope()
      });
    } catch (err) {
      if (!isMissingRpcError(err) || !isLegacyId(clientMatchId)) throw err;
      const current = await rpc('klaverjas_get_live_match_public', { match_id_input: clientMatchId }, { timeoutMs: 7000 });
      return legacyMatchToLive(await rpc('klaverjas_upsert_match_state_scoped', legacyPayload(legacyInputFromMatch(current, clientMatchId), 'active', patch || {}), { timeoutMs: 12000 }));
    }
  }
  async function finishLive(clientMatchId, patch){
    try {
      return await rpc('finish_klaverjas_live_match_v687', {
        session_token_input: getToken() || null,
        client_match_id_input: clientMatchId,
        patch_payload: patch || {},
        site_scope_input: getScope()
      });
    } catch (err) {
      if (!isMissingRpcError(err) || !isLegacyId(clientMatchId)) throw err;
      const current = await rpc('klaverjas_get_live_match_public', { match_id_input: clientMatchId }, { timeoutMs: 7000 });
      return legacyMatchToLive(await rpc('klaverjas_upsert_match_state_scoped', legacyPayload(legacyInputFromMatch(current, clientMatchId), 'finished', patch || {}), { timeoutMs: 12000 }));
    }
  }
  async function getLive(clientMatchId){
    try {
      return await rpc('get_klaverjas_live_state_public_v687', { client_match_id_input: clientMatchId || null, site_scope_input: getScope() }, { timeoutMs: 9000 });
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      if (!isLegacyId(clientMatchId)) return { live_matches: [] };
      return legacyMatchToLive(await rpc('klaverjas_get_live_match_public', { match_id_input: clientMatchId }, { timeoutMs: 7000 }));
    }
  }
  async function getLeaderboard(){
    const data = await rpc('get_public_ladder_page_scoped', { game_key: 'klaverjas', site_scope_input: getScope() }, { timeoutMs: 10000 });
    const rows = Array.isArray(data?.ladder) ? data.ladder : [];
    return Object.assign({}, data || {}, { leaderboard: rows });
  }
  async function getBundle(){
    try {
      return await rpc('get_klaverjas_runtime_bundle_v687', { site_scope_input: getScope() }, { timeoutMs: 12000 });
    } catch (err) {
      if (!isMissingRpcError(err)) throw err;
      return { recent_matches: [] };
    }
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
