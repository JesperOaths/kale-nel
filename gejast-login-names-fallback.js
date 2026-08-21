(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function scope(){ try { return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) { return 'friends'; } }
  function normalize(list){
    var seen = new Set();
    return (Array.isArray(list)?list:[]).map(function(v){
      if (typeof v === 'string') return v;
      return v && (v.display_name || v.public_display_name || v.chosen_username || v.nickname || v.player_name || v.name || v.label || v.desired_name || '') || '';
    }).map(function(v){ return String(v||'').replace(/\s+/g,' ').trim(); }).filter(function(v){ var k=v.toLowerCase(); if(!v||seen.has(k)) return false; seen.add(k); return true; }).sort(function(a,b){ return a.localeCompare(b,'nl'); });
  }
  function rows(raw){
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    for (var key of ['players','profiles','rows','names','data','items','active_names','activated_names','login_names']) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    return [];
  }
  async function rpc(name, body){
    var base = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
    var key = String(cfg.SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (!base || !key) throw new Error('login_names_config_unavailable');
    var res = await fetch(base + '/rest/v1/rpc/' + name, {
      method:'POST', mode:'cors', cache:'no-store',
      headers:{'Content-Type':'application/json',Accept:'application/json',apikey:key,Authorization:'Bearer '+key},
      body:JSON.stringify(body || {})
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || ('HTTP '+res.status)); }
    if (!res.ok) throw new Error(data && (data.message || data.error || data.hint) || ('HTTP '+res.status));
    return data && data[name] !== undefined ? data[name] : data;
  }
  async function load(requestedScope){
    var resolvedScope = requestedScope === 'family' ? 'family' : (requestedScope === 'friends' ? 'friends' : scope());
    var attempts = [
      ['get_login_active_names_v687',{site_scope_input:resolvedScope}],
      ['get_player_selector_source_v1',{site_scope_input:resolvedScope}],
      ['get_player_selector_source_v1',{session_token:null,site_scope_input:resolvedScope}]
    ];
    for (var attempt of attempts) {
      try {
        var names = normalize(rows(await rpc(attempt[0], attempt[1])));
        if (names.length) {
          try { cfg.writeCachedLoginNames && cfg.writeCachedLoginNames(names, resolvedScope); } catch(_) {}
          return names;
        }
      } catch(_) {}
    }
    try { if (cfg.readCachedLoginNames) return normalize(cfg.readCachedLoginNames(resolvedScope)); } catch(_) {}
    return [];
  }
  // v812f intentionally removed client SELECT from allowed_usernames. Override the
  // legacy config loaders on the unauthenticated login surface so no code path can
  // fall back to that private relation while preserving the same public RPC contract.
  cfg.fetchScopedActivePlayerNames = load;
  cfg.getActivatedPlayerNamesForScope = load;
  window.GEJAST_LOGIN_NAMES_FALLBACK = { load: load, source:'v813-safe-active-name-rpc' };
})();
