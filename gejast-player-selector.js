(function(){
  const cfg=window.GEJAST_CONFIG||{};
  async function getSelector(scope){
    const resolved=scope==='family'?'family':'friends';
    if(cfg.getActivatedPlayerNamesForScope){try{const names=await cfg.getActivatedPlayerNamesForScope(resolved);return{ok:true,scope:resolved,activated_names:names,requestable_names:[],source:'GEJAST_CONFIG.getActivatedPlayerNamesForScope'};}catch(e){return{ok:false,scope:resolved,error:e.message||String(e)}}}
    return{ok:false,scope:resolved,error:'No selector owner available'};
  }
  window.GEJAST_PLAYER_SELECTOR={getSelector};
})();
