(function(){
  const CFG=window.GEJAST_SHARED_STATS_CONFIG||{};
  function localAudit(){let raw=null;try{raw=localStorage.getItem(CFG.cache_key||'gejast_shared_stats_cache_v1')}catch(_){}return{ok:true,cache_key:CFG.cache_key,has_cache:!!raw,cache_bytes:raw?raw.length:0};}
  async function summary(){return{ok:false,items:[],note:'No live SQL RPC called by repair-first helper; verify shared stats SQL before marking implemented.'};}
  async function leaderboard(){return{ok:false,items:[],note:'No live SQL RPC called by repair-first helper; verify game metrics before marking implemented.'};}
  window.GEJAST_SHARED_STATS={localAudit,summary,leaderboard};
})();
