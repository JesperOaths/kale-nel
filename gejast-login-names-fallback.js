(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function scope(){ try { return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) { return 'friends'; } }
  function normalize(list){
    var seen = new Set();
    return (Array.isArray(list)?list:[]).map(function(v){
      if (typeof v === 'string') return v;
      return v && (v.display_name || v.public_display_name || v.chosen_username || v.nickname || v.player_name || v.name || v.label || v.desired_name || '') || '';
    }).map(function(v){ return String(v||'').replace(/\s+/g,' ').trim(); }).filter(function(v){ var k=v.toLowerCase(); if(!v||/^Visual(?:A|B|Family)_\d+$/i.test(v)||seen.has(k)) return false; seen.add(k); return true; }).sort(function(a,b){ return a.localeCompare(b,'nl'); });
  }
  function rows(raw){
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    for (var key of ['players','profiles','rows','names','data','items','active_names','activated_names','login_names']) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    return [];
  }
  function staticNames(resolvedScope){
    try {
      var snapshot=window.GEJAST_LOGIN_NAMES_STATIC||{};
      return normalize(snapshot[resolvedScope]||[]);
    } catch(_) { return []; }
  }
  async function rpc(name, body, timeoutMs){
    var base = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
    var key = String(cfg.SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (!base || !key) throw new Error('login_names_config_unavailable');
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try { controller.abort(); } catch(_) {} }, Math.max(800, Number(timeoutMs || 4500))) : null;
    try {
      var res = await fetch(base + '/rest/v1/rpc/' + name, {
        method:'POST', mode:'cors', cache:'no-store',
        headers:(cfg.publicApiHeaders?cfg.publicApiHeaders({'Content-Type':'application/json',Accept:'application/json'}):(function(){var h={'Content-Type':'application/json',Accept:'application/json',apikey:key};if(/^[^.]+\.[^.]+\.[^.]+$/.test(key))h.Authorization='Bearer '+key;return h;})()),
        body:JSON.stringify(body || {}),
        signal:controller ? controller.signal : undefined
      });
      var text = await res.text();
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch(_) { throw new Error(text || ('HTTP '+res.status)); }
      if (!res.ok) throw new Error(data && (data.message || data.error || data.hint) || ('HTTP '+res.status));
      return data && data[name] !== undefined ? data[name] : data;
    } catch(err) {
      if (err && err.name === 'AbortError') throw new Error('login_names_timeout');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function publish(names,resolvedScope){
    var clean=normalize(names);
    if(!clean.length) return clean;
    try { cfg.writeCachedLoginNames && cfg.writeCachedLoginNames(clean,resolvedScope); } catch(_) {}
    try { if(typeof window.dispatchEvent==='function'&&typeof CustomEvent!=='undefined') window.dispatchEvent(new CustomEvent('gejast:login-names-refreshed',{detail:{names:clean,scope:resolvedScope}})); } catch(_) {}
    return clean;
  }
  async function authoritative(resolvedScope){
    var live=normalize(rows(await rpc('get_login_active_names_v687',{site_scope_input:resolvedScope},2500)));
    return publish(live,resolvedScope);
  }
  async function load(requestedScope){
    var resolvedScope=requestedScope==='family'?'family':(requestedScope==='friends'?'friends':scope());
    var cached=[]; try { if(cfg.readCachedLoginNames) cached=normalize(cfg.readCachedLoginNames(resolvedScope)); } catch(_) {}
    var snapshot=staticNames(resolvedScope);
    // The embedded deployment snapshot is newer and deterministic; a stale browser cache must never overwrite it.
    var immediate=snapshot.length?snapshot:cached;
    if(immediate.length){
      // Login already has a deployment snapshot and server-rendered names. Do
      // not compete with page boot or a degraded Supabase data plane. Refresh
      // only later, while visible/online, and never block the selector.
      setTimeout(function(){
        var hidden = typeof document !== 'undefined' && !!document.hidden;
        var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if(hidden || offline) return;
        authoritative(resolvedScope).catch(function(){});
      },60000);
      return immediate;
    }
    try { return await authoritative(resolvedScope); } catch(_) { return []; }
  }
  cfg.fetchScopedActivePlayerNames=load;
  cfg.getActivatedPlayerNamesForScope=load;
  window.GEJAST_LOGIN_NAMES_FALLBACK={load:load,source:'v817-snapshot-authoritative-first-delayed60s-active-name-rpc',staticSource:'gejast-login-names-static.js'};
})();
