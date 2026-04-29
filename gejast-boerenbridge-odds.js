(function(){
  const cfg = window.GEJAST_CONFIG || {};
  function scope(){ try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) { return 'friends'; } }
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function rpc(name, payload){
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) });
    const txt = await res.text(); let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch(_) { throw new Error(txt || `HTTP ${res.status}`); }
    if(!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || txt || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function renderOdds(rows, target){
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if(!el) return;
    const list = Array.isArray(rows) ? rows : [];
    if(!list.length){ el.innerHTML = '<div class="bb-odds-empty">Nog geen odds beschikbaar.</div>'; return; }
    el.innerHTML = list.map((row)=>{
      const pct = Math.round(Number(row.win_probability || row.probability || 0) * 1000) / 10;
      return `<div class="bb-odds-row"><strong>${row.player_name || '—'}</strong><span>${pct}%</span><small>${row.reason || row.source || 'cached shared stats'}</small></div>`;
    }).join('');
  }
  async function getOdds(players){
    return await rpc('get_boerenbridge_live_odds_v643', { site_scope_input: scope(), players_input: Array.isArray(players) ? players : [] });
  }
  async function mount(target, players){
    try { renderOdds(await getOdds(players), target); }
    catch(err){ const el = typeof target === 'string' ? document.querySelector(target) : target; if(el) el.innerHTML = `<div class="bb-odds-error">${String(err.message || err)}</div>`; }
  }
  window.GEJAST_BOERENBRIDGE_ODDS = { rpc, getOdds, renderOdds, mount };
})();
