(function(){
  if (window.GEJAST_PIKKEN_CONTRACT && window.GEJAST_PIKKEN_CONTRACT.VERSION === 'v684') return;
  const cfg = window.GEJAST_CONFIG || {};
  const scopeUtils = window.GEJAST_SCOPE_UTILS || {};
  const PLAYER_KEYS = Array.isArray(cfg.PLAYER_SESSION_KEYS) && cfg.PLAYER_SESSION_KEYS.length ? cfg.PLAYER_SESSION_KEYS : ['jas_session_token_v11','jas_session_token_v10'];
  const RPC = {
    state: cfg.PIKKEN_CONTRACT_READ_RPC_V666 || 'pikken_get_state_scoped',
    create: cfg.PIKKEN_CREATE_LOBBY_RPC_V666 || 'pikken_create_lobby_scoped',
    join: cfg.PIKKEN_JOIN_LOBBY_RPC_V666 || 'pikken_join_lobby_scoped',
    ready: cfg.PIKKEN_READY_RPC_V666 || 'pikken_set_ready_scoped',
    start: cfg.PIKKEN_START_RPC_V666 || 'pikken_start_game_scoped',
    bid: cfg.PIKKEN_BID_RPC_V666 || 'pikken_place_bid_scoped',
    reject: cfg.PIKKEN_REJECT_RPC_V666 || 'pikken_reject_bid_scoped',
    vote: cfg.PIKKEN_VOTE_RPC_V666 || 'pikken_cast_vote_scoped',
    leave: cfg.PIKKEN_LEAVE_RPC_V666 || 'pikken_leave_game_scoped',
    destroy: cfg.PIKKEN_DESTROY_RPC_V666 || 'pikken_destroy_game_scoped',
    openLobbies: 'get_pikken_open_lobbies_fast_v684',
    liveMatches: 'get_pikken_live_matches_fast_v684',
    myActive: 'pikken_find_my_active_game_scoped',
    createFast: 'pikken_create_lobby_fast_v684',
    joinFast: 'pikken_join_lobby_fast_v684',
    destroyFast: 'pikken_destroy_game_fast_v684',
    stats: 'pikken_get_deep_stats_scoped'
  };
  function scope(){
    try { return (scopeUtils.getScope && scopeUtils.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }
    catch (_) { return 'friends'; }
  }
  function sessionToken(){
    try { if (cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken() || '').trim(); } catch (_) {}
    for (const key of PLAYER_KEYS) {
      try { const v = localStorage.getItem(key) || sessionStorage.getItem(key); if (v) return String(v).trim(); } catch (_) {}
    }
    return '';
  }
  function headers(){ return { apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload, timeoutMs){
    if (!cfg.SUPABASE_URL) throw new Error('Supabase URL ontbreekt.');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(()=>{ try{ controller.abort(); }catch(_){} }, Number(timeoutMs || 5200)) : null;
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}), signal:controller?controller.signal:undefined });
      const raw = await parse(res);
      return raw && raw[name] !== undefined ? raw[name] : raw;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('Pikken RPC timeout: server reageert niet snel genoeg. Controleer v684 SQL / Supabase.');
      throw err;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function rpcFirst(calls, timeoutMs){ let last=null; for(const call of calls){ try{ return await rpc(call.name, call.payload, call.timeoutMs || timeoutMs || 3600); }catch(err){ last=err; if(!/could not find|schema cache|function|does not exist/i.test(String(err && err.message || err))) break; } } throw last || new Error('Pikken RPC mislukt.'); }
  function cleanCode(v){ return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8); }
  function requireSession(){
    const token = sessionToken();
    if (!token) {
      const target = `pikken.html${scope()==='family'?'?scope=family':''}`;
      throw new Error(`Niet ingelogd. Log eerst in via login.html?return_to=${encodeURIComponent(target)}.`);
    }
    return token;
  }
  function tokenPayload(extra){ return Object.assign({ session_token: sessionToken() || null, session_token_input: sessionToken() || null, site_scope_input: scope() }, extra || {}); }
  async function createLobby(config){ requireSession(); const payload=tokenPayload({ config_input: config || {} }); return rpcFirst([{name:RPC.createFast,payload},{name:RPC.create,payload}], 7200); }
  async function joinLobby(code){ requireSession(); const payload=tokenPayload({ lobby_code_input: cleanCode(code) }); return rpcFirst([{name:RPC.joinFast,payload},{name:RPC.join,payload}], 7200); }
  async function getState(gameId, code){ return rpc(RPC.state, tokenPayload({ game_id_input: gameId || null, game_id: gameId || null, lobby_code_input: code ? cleanCode(code) : null }), 3600); }
  async function setReady(gameId, ready){ requireSession(); return rpc(RPC.ready, tokenPayload({ game_id_input: gameId, ready_input: !!ready }), 3600); }
  async function startGame(gameId){ requireSession(); return rpc(RPC.start, tokenPayload({ game_id_input: gameId }), 3600); }
  async function placeBid(gameId, count, face){ requireSession(); return rpc(RPC.bid, tokenPayload({ game_id_input: gameId, bid_count_input: Number(count), bid_face_input: Number(face) }), 3600); }
  async function rejectBid(gameId){ requireSession(); return rpc(RPC.reject, tokenPayload({ game_id_input: gameId }), 3600); }
  async function castVote(gameId, vote){ requireSession(); return rpc(RPC.vote, tokenPayload({ game_id_input: gameId, vote_input: !!vote }), 3600); }
  async function leaveGame(gameId){ requireSession(); return rpc(RPC.leave, tokenPayload({ game_id_input: gameId }), 3600); }
  async function destroyGame(gameId){ requireSession(); const payload=tokenPayload({ game_id_input: gameId }); return rpcFirst([{name:RPC.destroyFast,payload},{name:RPC.destroy,payload}], 3600); }
  async function openLobbies(){ return rpc(RPC.openLobbies, { site_scope_input: scope() }, 3200); }
  async function liveMatches(){ return rpc(RPC.liveMatches, { site_scope_input: scope() }, 3200); }
  async function myActive(){ return rpc(RPC.myActive, tokenPayload({})); }
  async function stats(){ return rpc(RPC.stats, { site_scope_input: scope(), session_token: sessionToken() || null }); }
  window.GEJAST_PIKKEN_CONTRACT = { VERSION:'v684', scope, sessionToken, requireSession, rpc, cleanCode, createLobby, joinLobby, getState, setReady, startGame, placeBid, rejectBid, castVote, leaveGame, destroyGame, rpcFirst, openLobbies, liveMatches, myActive, stats };
})();
