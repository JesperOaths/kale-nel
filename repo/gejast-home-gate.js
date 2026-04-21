(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function getToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function expired(){ try{ return cfg.isPlayerSessionExpired ? cfg.isPlayerSessionExpired() : !getToken(); }catch(_){ return !getToken(); } }
  function currentTarget(){ try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html'; }catch(_){ return 'index.html'; } }
  function currentScope(){
    try{ if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); }catch(_){}
    try{ return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; }catch(_){ return 'friends'; }
  }
  function homeUrl(){
    var target = currentTarget();
    try{ return cfg.buildHomeUrl ? cfg.buildHomeUrl(target, currentScope()) : './home.html'; }catch(_){ return './home.html'; }
  }
  function headers(){ return { 'Content-Type':'application/json', apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''), Authorization:`Bearer ${(cfg.SUPABASE_PUBLISHABLE_KEY||'')}` }; }
  async function parse(res){ var txt=await res.text(); var data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||('HTTP '+res.status)); } if(!res.ok) throw new Error(data&& (data.message||data.error) || ('HTTP '+res.status)); return data; }
  function normalizeName(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
  function uniqueNames(list){ var seen=new Set(); return (Array.isArray(list)?list:[]).map(normalizeName).filter(function(name){ var k=name.toLowerCase(); if(!name||seen.has(k)) return false; seen.add(k); return true; }); }
  function redirectHome(){ location.replace(homeUrl()); }
  async function fetchViewerState(token){
    var rpcList=[['get_public_state',{session_token:token}],['get_gejast_homepage_state',{session_token:token}],['get_jas_app_state',{session_token:token}],['get_public_state',{session_token_input:token}],['get_gejast_homepage_state',{session_token_input:token}],['get_jas_app_state',{session_token_input:token}]];
    for (const entry of rpcList){
      try{
        var res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${entry[0]}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(entry[1])});
        var data=await parse(res);
        var name=normalizeName(data&& (data.my_name || data.display_name || data.player_name || (data.viewer&&data.viewer.display_name) || ''));
        if(name) return { ok:true, name:name, data:data };
        if(data && (data.viewer || data.player || data.session_valid === true || data.is_logged_in === true)) return { ok:true, name:'', data:data };
      }catch(_){ }
    }
    return { ok:false, name:'', data:null };
  }
  async function fetchAllowedNames(scope){
    try{
      var helper=cfg&&typeof cfg.fetchScopedActivePlayerNames==='function'?cfg.fetchScopedActivePlayerNames:null;
      if(helper){ var active=await helper(scope); if(active&&active.length) return active; }
    }catch(_){ }
    var raw=null;
    try{
      var scoped=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/get_login_names_scoped`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify({site_scope_input:scope})});
      raw=await parse(scoped);
    }catch(_){
      try{
        var res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/get_login_names`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify({})});
        raw=await parse(res);
      }catch(_2){ raw={ names:[] }; }
    }
    var rows=Array.isArray(raw)?raw:(Array.isArray(raw&&raw.names)?raw.names:(Array.isArray(raw&&raw.data)?raw.data:[]));
    var names=uniqueNames(rows.map(function(row){ return typeof row==='string' ? row : (row&& (row.display_name||row.name||row.desired_name||row.slug||row.player_name) || ''); }));
    try{ if(window.GEJAST_SCOPE_UTILS&&typeof window.GEJAST_SCOPE_UTILS.filterNames==='function') names=window.GEJAST_SCOPE_UTILS.filterNames(names, scope); }catch(_){ }
    return names;
  }
  async function verifyScopeAndSession(){
    var token=getToken();
    if(!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return { status:'invalid', reason:'missing_prereq' };
    var viewer=null;
    try{
      viewer=cfg.fetchPlayerSessionSnapshot
        ? await cfg.fetchPlayerSessionSnapshot(token)
        : await Promise.race([
            fetchViewerState(token),
            new Promise(function(resolve){ setTimeout(function(){ resolve({ ok:false, name:'', data:null }); }, 4000); })
          ]);
    }catch(_){ viewer={ status:'unknown', ok:false, name:'', names:[], data:null }; }
    var viewerOk = !!(viewer && (viewer.ok || viewer.status==='valid'));
    if(!viewerOk){
      if(viewer && viewer.status==='unknown') return { status:'unknown', reason:'session_lookup_unavailable' };
      return { status:'invalid', reason:'session_invalid' };
    }
    var viewerNames = [];
    try{
      viewerNames = Array.isArray(viewer && viewer.aliases) && viewer.aliases.length
        ? viewer.aliases
        : (cfg.playerSessionNamesFromState ? cfg.playerSessionNamesFromState((viewer && viewer.state) || viewer) : uniqueNames([viewer && viewer.name || '']));
    }catch(_){ viewerNames = uniqueNames([viewer && viewer.name || '']); }
    if(!viewerNames.length) return { status:'valid', reason:'no_viewer_name' };
    var allowed=[];
    try{
      allowed=await Promise.race([
        fetchAllowedNames(currentScope()),
        new Promise(function(resolve){ setTimeout(function(){ resolve([]); }, 4000); })
      ]);
    }catch(_){ return { status:'unknown', reason:'scope_lookup_unavailable' }; }
    if(!allowed.length) return { status:'valid', reason:'scope_open' };
    try{
      if(cfg.playerSessionNamesOverlap ? cfg.playerSessionNamesOverlap(viewerNames, allowed) : viewerNames.some(function(name){ return allowed.indexOf(name)!==-1; })){
        return { status:'valid', reason:'scope_match', names:viewerNames };
      }
    }catch(_){ }
    return { status:'scope_mismatch', reason:'scope_mismatch', names:viewerNames, allowed:allowed };
  }
  if(expired()) clearTokens();
  if(!getToken()){
    redirectHome();
  } else {
    try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:true }); }catch(_){ }
    verifyScopeAndSession().then(function(result){
      var status = result && result.status || 'invalid';
      if(status==='valid' || status==='unknown') return;
      if(status==='scope_mismatch'){
        redirectHome();
        return;
      }
      return;
    }).catch(function(){
      /* transient verification failures should not destroy a still-valid session */
    });
  }
})();
