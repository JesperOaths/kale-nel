(function(){
  function trace(path){const current=(location.pathname.split('/').pop()||'index.html');return{ok:true,target:path||current,current_page:current,note:'Client-side owner trace is limited to loaded page resources. Use repo inspection for full source truth.',loaded_scripts:Array.from(document.scripts||[]).map(s=>s.getAttribute('src')||s.src||'').filter(Boolean)}}
  window.GEJAST_OWNER_TRACE_HELPER={trace};
})();
