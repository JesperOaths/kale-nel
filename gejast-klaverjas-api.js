(function(){
  const cfg = window.GEJAST_CONFIG || {};
  function getScope(){
    try {
      if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope();
    } catch(_){ }
    try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_){ return 'friends'; }
  }
  function sessionToken(){
    try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_) { return ''; }
  }
  async function rpc(name, body={}, options={}){
    const controller = new AbortController();
    const timeoutMs = Math.max(1200, Number(options.timeoutMs || 6500));
    const timer = setTimeout(()=>controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
          Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
          Accept:'application/json'
        },
        body: JSON.stringify(body),
        cache:'no-store',
        signal: controller.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch(_) { data = text; }
      if (!res.ok) {
        const message = data && typeof data === 'object' ? (data.message || data.error || data.details || data.hint || JSON.stringify(data)) : (text || `HTTP ${res.status}`);
        throw new Error(message);
      }
      return data && data[name] !== undefined ? data[name] : data;
    } catch (err) {
      if (err && (err.name === 'AbortError' || /aborted/i.test(String(err)))) throw new Error(`RPC timeout in ${name}`);
      throw err;
    } finally { clearTimeout(timer); }
  }
  function parseNames(value){
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (!value) return [];
    if (typeof value === 'string') return value.split(',').map(v=>v.trim()).filter(Boolean);
    return [];
  }
  async function upsertMatchState({ matchId=null, teamW=[], teamZ=[], rounds=[], snapshotPayload={}, status='active', startedAt=null, teamWIds=[], teamZIds=[] }={}){
    return rpc('klaverjas_upsert_match_state_scoped', {
      session_token: sessionToken() || null,
      match_id_input: matchId || null,
      site_scope_input: getScope(),
      team_w_player_ids_input: teamWIds,
      team_z_player_ids_input: teamZIds,
      team_w_player_names_input: teamW,
      team_z_player_names_input: teamZ,
      rounds_input: rounds,
      payload_snapshot_input: snapshotPayload,
      status_input: status,
      started_at_input: startedAt || null
    }, { timeoutMs: 12000 });
  }
  async function setPresence(matchId, playerName=null, pageKind='scorer'){
    if (!matchId) return null;
    return rpc('klaverjas_set_active_match_presence_scoped', {
      session_token: sessionToken() || null,
      match_id_input: matchId,
      site_scope_input: getScope(),
      player_name_input: playerName || null,
      page_kind_input: pageKind
    }, { timeoutMs: 4000 });
  }
  async function clearPresence(matchId=null){
    return rpc('klaverjas_clear_active_match_presence_scoped', {
      session_token: sessionToken() || null,
      match_id_input: matchId || null
    }, { timeoutMs: 4000 });
  }
  async function getLiveMatch(matchId){
    return rpc('klaverjas_get_live_match_public', { match_id_input: matchId }, { timeoutMs: 7000 });
  }
  async function getQuickStats(matchId, snapshotNo=null){
    return rpc('klaverjas_get_quick_stats_public', { match_id_input: matchId, snapshot_no_input: snapshotNo }, { timeoutMs: 7000 });
  }
  async function getPlayerStats(playerName=null){
    return rpc('klaverjas_get_player_stats_public', {
      site_scope_input: getScope(),
      player_name_input: playerName || null
    }, { timeoutMs: 7000 });
  }
  async function getFunLadders(){
    return rpc('klaverjas_get_fun_ladders_public', { site_scope_input: getScope() }, { timeoutMs: 7000 });
  }
  window.GEJAST_KLAVERJAS_API = {
    rpc, getScope, sessionToken, parseNames,
    upsertMatchState, setPresence, clearPresence,
    getLiveMatch, getQuickStats, getPlayerStats, getFunLadders
  };
})();
