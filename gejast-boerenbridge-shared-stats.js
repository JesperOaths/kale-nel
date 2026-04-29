(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const shared = window.GEJAST_SHARED_STATS || {};
  const GAME = 'boerenbridge';
  function token(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || localStorage.getItem('jas_session_token_v11') || sessionStorage.getItem('jas_session_token_v11') || ''; } catch(_) { return ''; } }
  function scope(){ try { return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); } catch(_) { return 'friends'; } }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) });
    const txt = await res.text(); let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch(_) { throw new Error(txt || `HTTP ${res.status}`); }
    if(!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function rowMetric(row, key){
    const metrics = row && typeof row.metrics === 'object' ? row.metrics : {};
    return row?.[key] ?? metrics?.[key] ?? null;
  }
  function renderRows(rows, target){
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if(!el) return;
    const list = Array.isArray(rows) ? rows : [];
    if(!list.length){ el.innerHTML = '<div class="shared-empty">Nog geen Boerenbridge shared stats gevonden.</div>'; return; }
    el.innerHTML = list.map((row, idx)=>{
      const name = row.player_name || row.display_name || row.name || '—';
      const winPct = Number(rowMetric(row,'win_percentage') || 0).toFixed(1);
      const avgScore = Number(rowMetric(row,'avg_score') || 0).toFixed(1);
      const shame = Number(rowMetric(row,'wall_of_shame_score') || rowMetric(row,'under_100_count') || 0);
      const consistency = Number(rowMetric(row,'consistency_score') || 0).toFixed(1);
      return `<div class="shared-stat-row"><span class="shared-rank">${idx+1}</span><strong>${name}</strong><span>${winPct}% winst</span><span>${avgScore} gem.</span><span>${shame} shame</span><span>${consistency} steady</span></div>`;
    }).join('');
  }
  async function getLeaderboard(limit){
    return await rpc('get_boerenbridge_shared_leaderboard_v643', { site_scope_input: scope(), limit_input: Number(limit || 25) });
  }
  async function getPlayer(playerName){
    return await rpc('get_boerenbridge_shared_stats_v643', { site_scope_input: scope(), player_name_input: playerName || null, session_token: token() || null, session_token_input: token() || null });
  }
  async function mountLeaderboard(target, options){
    try { renderRows(await getLeaderboard(options?.limit || 25), target); }
    catch(err){ const el = typeof target === 'string' ? document.querySelector(target) : target; if(el) el.innerHTML = `<div class="shared-error">${String(err.message || err)}</div>`; }
  }
  window.GEJAST_BOERENBRIDGE_SHARED_STATS = { GAME, rpc, getLeaderboard, getPlayer, mountLeaderboard, renderRows };
})();
