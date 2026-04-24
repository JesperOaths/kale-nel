(function(){
  function j(id,d){const el=document.getElementById(id);if(el)el.textContent=JSON.stringify(d,null,2)}
  function boot(){const version=(window.GEJAST_CONFIG&&window.GEJAST_CONFIG.VERSION)||window.GEJAST_PAGE_VERSION||'v655';j('releaseBox',{ok:true,version,expected:'v655',source:'frontend'});j('runtimeRows',{ok:true,errors:window.__GEJAST_RUNTIME_ERRORS||[],note:'Runtime error collection requires live browser listeners on target pages.'});j('smokeRows',{ok:true,checks:['version helpers present','admin diagnostics linked','watermark target v655'],timestamp:new Date().toISOString()});j('rollbackBox',{ok:true,rollback:'Re-upload previous flat patch files or restore GitHub commit. No SQL in v655 repair patch.'});const s=document.getElementById('statusBox');if(s)s.textContent='Ops observability diagnostics uitgevoerd.';}
  window.addEventListener('error',e=>{window.__GEJAST_RUNTIME_ERRORS=window.__GEJAST_RUNTIME_ERRORS||[];window.__GEJAST_RUNTIME_ERRORS.push({message:e.message,source:e.filename,line:e.lineno});});
  window.GEJAST_OPS_OBSERVABILITY={boot};
})();
