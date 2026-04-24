(function(){
  const TARGET='v660', TARGET_RE=/[?&]v660(?:\b|$)/i;
  function report(){const scripts=Array.from(document.scripts||[]).map(s=>s.getAttribute('src')||s.src||'').filter(Boolean);const withVersion=scripts.filter(s=>/[?&]v\d+/i.test(s));const stale=withVersion.filter(s=>!TARGET_RE.test(s));const missing=scripts.filter(s=>!/[?&]v\d+/i.test(s)&&!/^(?:https?:)?\/\//i.test(s));return{ok:stale.length===0,target:TARGET,checked:withVersion.length,stale,missing_local_cache_busters:missing,scripts};}
  function normalizeDomOnly(){const planned=[];Array.from(document.scripts||[]).forEach(s=>{const src=s.getAttribute('src')||'';if(/[?&]v\d+/i.test(src)&&!TARGET_RE.test(src))planned.push({from:src,to:src.replace(/([?&])v\d+/i,'$1v660')});});return{ok:planned.length===0,planned_changes:planned,note:'DOM-only report; source files are changed by the uploaded patch.'};}
  window.GEJAST_SCRIPT_VERSION_NORMALIZER={report,normalizeDomOnly};
})();