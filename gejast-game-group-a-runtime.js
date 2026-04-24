(function(){
  if (window.GEJAST_GAME_GROUP_A_RUNTIME) return;
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v668';
  const RPC = {
    beerpongSave: 'save_beerpong_match',
    beerpongLeaderboard: 'get_beerpong_leaderboard_public',
    beerpongPussycup: 'get_beerpong_pussycup_ranking_public',
    boerenbridgeSave: 'save_boerenbridge_match',
    beerpongBundle: 'get_beerpong_runtime_bundle_v668',
    boerenbridgeBundle: 'get_boerenbridge_runtime_bundle_v668',
    groupBundle: 'get_game_group_a_runtime_bundle_v668',
    adminAudit: 'admin_get_game_group_a_runtime_audit_v668',
    adminDelete: 'admin_delete_game_group_a_match_v668',
    adminRebuild: 'admin_rebuild_game_group_a_ratings_v668'
  };
  function normScope(input){
    const raw = String(input || '').trim().toLowerCase();
    if (raw === 'family') return 'family';
    try { const qs = new URLSearchParams(location.search || ''); if (qs.get('scope') === 'family') return 'family'; } catch (_) {}
    return 'friends';
  }
  function normGame(input){
    const raw = String(input || '').trim().toLowerCase();
    if (raw.includes('boeren')) return 'boerenbridge';
    if (raw.includes('beer')) return 'beerpong';
    try { const qs = new URLSearchParams(location.search || ''); const q = String(qs.get('game') || '').toLowerCase(); if (q.includes('boeren')) return 'boerenbridge'; if (q.includes('beer')) return 'beerpong'; } catch (_) {}
    const path = String(location.pathname || '').toLowerCase();
    return path.includes('boeren') ? 'boerenbridge' : 'beerpong';
  }
  function token(){
    try { if (cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken() || '').trim(); } catch (_) {}
    return localStorage.getItem('jas_session_token_v11') || localStorage.getItem('jas_session_token_v10') || sessionStorage.getItem('jas_session_token_v11') || sessionStorage.getItem('jas_session_token_v10') || '';
  }
  function adminToken(){
    try { if (window.GEJAST_ADMIN_SESSION && window.GEJAST_ADMIN_SESSION.getToken) return String(window.GEJAST_ADMIN_SESSION.getToken() || '').trim(); } catch (_) {}
    return localStorage.getItem('jas_admin_session_v8') || sessionStorage.getItem('jas_admin_session_v8') || '';
  }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function parse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, body){
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase config ontbreekt.');
    const raw = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(body || {}) }).then(parse);
    return raw && raw[name] !== undefined ? raw[name] : raw;
  }
  function esc(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  async function saveBeerpong(payload, clientMatchId){ return rpc(RPC.beerpongSave, { session_token: token() || null, client_match_id: clientMatchId || payload?.client_match_id || `beerpong-${Date.now()}`, payload: payload || {} }); }
  async function saveBoerenbridge(matchPayload, opts={}){ return rpc(RPC.boerenbridgeSave, { session_token: token() || null, client_match_id: opts.clientMatchId || matchPayload?.client_match_id || `bb-${Date.now()}`, rules_version: opts.rulesVersion || matchPayload?.rules_version || 'boerenbridge_rules_v1', app_version: opts.appVersion || matchPayload?.app_version || VERSION, match_payload: matchPayload || {} }); }
  async function loadBundle(opts={}){
    const game = normGame(opts.game || opts.gameKey || opts.game_key);
    const payload = { site_scope_input: normScope(opts.scope), limit_input: Math.max(1, Math.min(100, Number(opts.limit || 25) || 25)) };
    return rpc(game === 'boerenbridge' ? RPC.boerenbridgeBundle : RPC.beerpongBundle, payload);
  }
  async function loadGroupBundle(opts={}){ return rpc(RPC.groupBundle, { site_scope_input:normScope(opts.scope), game_key_input:normGame(opts.game || opts.gameKey), limit_input:Math.max(1,Math.min(100,Number(opts.limit||25)||25)) }); }
  async function audit(opts={}){ return rpc(RPC.adminAudit, { admin_session_token: adminToken(), site_scope_input:normScope(opts.scope), limit_input:Math.max(1,Math.min(100,Number(opts.limit||25)||25)) }); }
  async function deleteMatch(opts={}){ return rpc(RPC.adminDelete, { admin_session_token: adminToken(), game_key_input:normGame(opts.game), match_id_input: opts.matchId || null, client_match_id_input: opts.clientMatchId || null, reason_input: opts.reason || 'admin_delete' }); }
  async function rebuild(opts={}){ return rpc(RPC.adminRebuild, { admin_session_token: adminToken(), game_key_input:normGame(opts.game), site_scope_input:normScope(opts.scope) }); }
  function renderBundle(data, target){
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    if (!data || data.ok === false) { el.innerHTML = `<div style="padding:12px;border-radius:14px;background:#fff3f0;color:#8b2d20">${esc(data?.error || 'Geen game data beschikbaar.')}</div>`; return; }
    const totals = data.totals || {};
    const leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
    const recent = Array.isArray(data.recent_matches) ? data.recent_matches : [];
    const title = data.game_key === 'boerenbridge' ? 'Boerenbridge runtime' : 'Beerpong runtime';
    el.innerHTML = `<section class="gga-runtime-panel" style="margin:14px 0;padding:14px;border:1px solid rgba(154,130,65,.24);border-radius:18px;background:#fffdf8;box-shadow:0 8px 18px rgba(0,0,0,.035)">
      <h2 style="margin:0 0 10px;font-size:18px">${title}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px">
        <div><b>${esc(totals.players || 0)}</b><br><span>spelers</span></div>
        <div><b>${esc(totals.matches || 0)}</b><br><span>matches</span></div>
        <div><b>${esc(totals.avg_rating || totals.avg_elo || 0)}</b><br><span>gem. rating</span></div>
        <div><b>${esc(data.source || VERSION)}</b><br><span>bron</span></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
        <div><strong>Top spelers</strong>${leaderboard.length ? leaderboard.slice(0,8).map((r,i)=>`<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid rgba(0,0,0,.06);padding:7px 0"><span>#${i+1} ${esc(r.player_name || r.name || '—')}</span><b>${esc(Math.round(Number(r.rating || r.elo_rating || 1000)))}</b></div>`).join('') : '<div style="color:#6b6257;margin-top:8px">Nog geen ratings.</div>'}</div>
        <div><strong>Recent</strong>${recent.length ? recent.slice(0,8).map((m)=>`<div style="border-top:1px solid rgba(0,0,0,.06);padding:7px 0"><b>${esc(m.summary || m.winner_text || m.client_match_id || 'match')}</b><div style="color:#6b6257;font-size:13px">${esc(m.played_at || m.finished_at || '')}</div></div>`).join('') : '<div style="color:#6b6257;margin-top:8px">Nog geen matches.</div>'}</div>
      </div>
    </section>`;
  }
  function ensureHost(){
    let host = document.getElementById('gejastGameGroupARuntimeHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'gejastGameGroupARuntimeHost';
    const container = document.querySelector('.shell') || document.querySelector('.sheet') || document.querySelector('main') || document.body;
    container.appendChild(host);
    return host;
  }
  async function bootPanel(opts={}){
    const host = ensureHost();
    try { renderBundle(await loadBundle(opts), host); } catch (err) { renderBundle({ ok:false, error:err.message || String(err) }, host); }
  }
  window.GEJAST_GAME_GROUP_A_RUNTIME = { VERSION, RPC, normScope, normGame, token, adminToken, rpc, saveBeerpong, saveBoerenbridge, loadBundle, loadGroupBundle, audit, deleteMatch, rebuild, renderBundle, bootPanel };
})();