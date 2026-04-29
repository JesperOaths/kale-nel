(function(){
  const cfg = window.GEJAST_CONFIG || {};
  function headers(){ return { 'Content-Type':'application/json', apikey: cfg.SUPABASE_PUBLISHABLE_KEY || '', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY || ''}`, Accept:'application/json' }; }
  async function rpc(name, payload){
    if (!cfg.SUPABASE_URL) throw new Error('Supabase URL ontbreekt.');
    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify(payload || {}) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(data?.message || data?.error || data?.details || data?.hint || `HTTP ${res.status}`);
    return data && data[name] !== undefined ? data[name] : data;
  }
  function playerName(){ try { return (cfg.getPlayerName && cfg.getPlayerName()) || ''; } catch (_) { return ''; } }
  function scope(){ try { return (cfg.normalizeScope && cfg.normalizeScope(new URLSearchParams(location.search).get('scope'))) || 'friends'; } catch (_) { return 'friends'; } }
  window.GEJAST_BEERPONG = Object.assign({}, window.GEJAST_BEERPONG || {}, { VERSION:'v642', rpc, playerName, scope });
})();
