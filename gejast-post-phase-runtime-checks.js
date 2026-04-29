(function(global){
  function pageVersion(){ return String(global.GEJAST_PAGE_VERSION || (global.GEJAST_CONFIG && global.GEJAST_CONFIG.VERSION) || '').trim(); }
  function localScriptVersions(){ return Array.from(document.scripts || []).map(s=>s.src||'').filter(src=>/\.js\?v\d+/i.test(src)).map(src=>({ src, version:(src.match(/\?v(\d+)/i)||[])[1]||'' })); }
  function findVersionDrift(){ const current=pageVersion().replace(/^v/i,''); return localScriptVersions().filter(row=>current && row.version && row.version !== current); }
  function report(){
    const drift=findVersionDrift();
    return { version:pageVersion(), script_count:localScriptVersions().length, drift_count:drift.length, drift };
  }
  global.GEJAST_POST_PHASE_RUNTIME_CHECKS = { pageVersion, localScriptVersions, findVersionDrift, report };
})(window);
