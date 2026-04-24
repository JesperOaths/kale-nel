(function(){
  const TARGET='v655';
  function report(){const scripts=Array.from(document.scripts||[]).map(s=>s.getAttribute('src')||s.src||'').filter(Boolean);const withVersion=scripts.filter(s=>/[?&]v\d+/i.test(s));const stale=withVersion.filter(s=>!/[?&]v655(?:|$)/i.test(s));return{ok:stale.length===0,target:TARGET,checked:withVersion.length,stale,scripts};}
  window.GEJAST_SCRIPT_VERSION_NORMALIZER={report};
})();
