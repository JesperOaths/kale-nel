(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function scope(){ try { return new URLSearchParams(window.location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch(_) { return 'friends'; } }
  function normalize(list){
    var seen = new Set();
    return (Array.isArray(list)?list:[]).map(function(v){ return String(v||'').replace(/\s+/g,' ').trim(); }).filter(function(v){ var k=v.toLowerCase(); if(!v||seen.has(k)) return false; seen.add(k); return true; }).sort(function(a,b){ return a.localeCompare(b,'nl'); });
  }
  async function load(){
    try {
      if (cfg.fetchScopedActivePlayerNames) {
        var names = await cfg.fetchScopedActivePlayerNames(scope());
        return normalize(names);
      }
    } catch(_) {}
    try {
      if (cfg.readCachedLoginNames) return normalize(cfg.readCachedLoginNames(scope()));
    } catch(_) {}
    return [];
  }
  window.GEJAST_LOGIN_NAMES_FALLBACK = { load: load };
})();
