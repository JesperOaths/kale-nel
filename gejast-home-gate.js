(function(){
  var cfg = window.GEJAST_CONFIG || {};
  var blockerId = 'gejast-private-gate-blocker';
  var redirecting = false;

  installBlocker();

  function installBlocker(){
    try{
      if (document.getElementById(blockerId)) return;
      var style = document.createElement('style');
      style.id = blockerId;
      style.textContent = 'html{visibility:hidden !important;opacity:0 !important;background:#efe9dc !important;}body{visibility:hidden !important;opacity:0 !important;}';
      (document.head || document.documentElement || document).appendChild(style);
    }catch(_){
      try{ document.documentElement.style.visibility='hidden'; document.documentElement.style.opacity='0'; }catch(__){}
    }
  }

  function removeBlocker(){
    try{
      var style = document.getElementById(blockerId);
      if (style && style.parentNode) style.parentNode.removeChild(style);
    }catch(_){}
    try{
      document.documentElement.style.visibility='';
      document.documentElement.style.opacity='';
      document.body && (document.body.style.visibility='');
      document.body && (document.body.style.opacity='');
    }catch(_){}
  }

  function scrubDocument(){
    try{
      document.documentElement.style.visibility='hidden';
      document.documentElement.style.opacity='0';
      if (document.body){
        document.body.innerHTML = '';
        document.body.style.visibility='hidden';
        document.body.style.opacity='0';
      }
    }catch(_){}
  }

  function redirect(url){
    if (redirecting) return false;
    redirecting = true;
    scrubDocument();
    try{ window.stop && window.stop(); }catch(_){}
    try{ location.replace(url); }catch(_){ location.href = url; }
    return false;
  }

  function getToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function expired(){ try{ return cfg.isPlayerSessionExpired ? cfg.isPlayerSessionExpired() : !getToken(); }catch(_){ return !getToken(); } }
  function currentTarget(){
    try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html'; }catch(_){ return 'index.html'; }
  }
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

  async function fetchViewerName(token){
    var rpcList=[['get_public_state',{session_token:token}],['get_gejast_homepage_state',{session_token:token}],['get_jas_app_state',{session_token:token}],['get_public_state',{session_token_input:token}],['get_gejast_homepage_state',{session_token_input:token}],['get_jas_app_state',{session_token_input:token}]];
    for (const entry of rpcList){
      try{
        var res=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${entry[0]}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(entry[1])});
        var data=await parse(res);
        var name=normalizeName(data&& (data.my_name || data.display_name || data.player_name || (data.viewer&&data.viewer.display_name) || ''));
        if(name) return name;
      }catch(_){ }
    }
    return '';
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

  async function verifyScope(){
    var token=getToken(); if(!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return true;
    var name=await fetchViewerName(token); if(!name) return true;
    var allowed=await fetchAllowedNames(currentScope());
    return !allowed.length || allowed.indexOf(name)!==-1;
  }

  async function boot(){
    if(expired()) clearTokens();
    if(!getToken()) return redirect(homeUrl());

    try{
      if (cfg.ensurePlayerSessionOrRedirect && !cfg.ensurePlayerSessionOrRedirect(currentTarget(), currentScope())) {
        return redirect(homeUrl());
      }
    }catch(_){
      return redirect(homeUrl());
    }

    try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){}

    try{
      var ok = await verifyScope();
      if(!ok){
        clearTokens();
        return redirect(homeUrl());
      }
    }catch(_){}

    removeBlocker();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      if (!redirecting) scrubDocument();
    }, { once:true });
  } else {
    scrubDocument();
  }

  boot().catch(function(){
    clearTokens();
    redirect(homeUrl());
  });
})();