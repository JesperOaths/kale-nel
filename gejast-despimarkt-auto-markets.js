(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const DEFAULT_SCOPE = 'friends';
  function scope(){
    try {
      const qs = new URLSearchParams(location.search || '');
      return String(qs.get('scope') || '').toLowerCase() === 'family' ? 'family' : DEFAULT_SCOPE;
    } catch (_) { return DEFAULT_SCOPE; }
  }
  function headers(){
    return {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '',
      Authorization: `Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || text || `HTTP ${res.status}`);
    return data;
  }
  async function rpc(name, payload){
    if (!cfg.SUPABASE_URL) throw new Error('Supabase URL ontbreekt.');
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {})
    });
    const data = await parseResponse(res);
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function listMarkets(options){
    const input = Object.assign({ site_scope_input: scope(), status_input: 'open', limit_input: 50 }, options || {});
    return rpc('get_despimarkt_auto_markets_v646', input);
  }
  async function createMarket(input){
    const token = cfg.getPlayerSessionToken ? cfg.getPlayerSessionToken() : '';
    return rpc('despimarkt_create_match_market_v646', Object.assign({ session_token: token || null, site_scope_input: scope() }, input || {}));
  }
  async function resolveMarket(input){
    const token = cfg.getPlayerSessionToken ? cfg.getPlayerSessionToken() : '';
    return rpc('despimarkt_resolve_match_market_v646', Object.assign({ session_token: token || null, site_scope_input: scope() }, input || {}));
  }
  function formatOdds(row){
    const odds = row?.odds_payload || row?.odds || {};
    const runners = Array.isArray(odds.runners) ? odds.runners : [];
    if (!runners.length) return 'Geen odds beschikbaar';
    return runners.map((r)=>`${r.name || r.player || 'Speler'}: ${Number(r.probability || 0).toFixed(2)}`).join(' · ');
  }
  function renderMarkets(target, rows){
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    const items = Array.isArray(rows) ? rows : (Array.isArray(rows?.markets) ? rows.markets : []);
    if (!items.length) {
      el.innerHTML = '<div class="dm-auto-empty">Geen automatische Beurs-markten gevonden.</div>';
      return;
    }
    el.innerHTML = items.map((row)=>{
      const title = row.market_title || row.title || `${row.game_key || 'match'} · ${row.match_ref || ''}`;
      const status = row.status || 'open';
      return `<article class="dm-auto-card" data-market-id="${row.id || ''}">
        <div class="dm-auto-card-head"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(status)}</span></div>
        <div class="dm-auto-meta">${escapeHtml(row.game_key || 'game')} · ${escapeHtml(row.match_ref || 'match')}</div>
        <div class="dm-auto-odds">${escapeHtml(formatOdds(row))}</div>
      </article>`;
    }).join('');
  }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  window.GEJAST_DESPIMARKT_AUTO_MARKETS = { rpc, scope, listMarkets, createMarket, resolveMarket, renderMarkets, formatOdds };
})();
