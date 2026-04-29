(function(){
  const VERSION='v647';
  function scriptVersions(){ return Array.from(document.scripts || []).map(s=>s.src||'').filter(src=>/\.js\?v\d+/.test(src)).map(src=>{ const m=src.match(/([^\/]+\.js)\?v(\d+)/); return m ? { file:m[1], version:m[2], src } : null; }).filter(Boolean); }
  function pageVersion(){ return String(window.GEJAST_PAGE_VERSION || (window.GEJAST_CONFIG && window.GEJAST_CONFIG.VERSION) || ''); }
  function summarize(){ const scripts=scriptVersions(); const expected=VERSION.replace(/^v/,''); return { expected:VERSION, pageVersion:pageVersion(), scriptCount:scripts.length, mismatchedScripts:scripts.filter(s=>s.version !== expected), hasConfig:!!window.GEJAST_CONFIG, hasSession:!!(window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken), generatedAt:new Date().toISOString() }; }
  window.GEJAST_RUNTIME_SMOKE_TESTS = { VERSION, scriptVersions, pageVersion, summarize };
})();
