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
      try{
        document.documentElement.style.visibility='hidden';
        document.documentElement.style.opacity='0';
      }catch(__){}
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
      if (document.body){
        document.body.style.visibility='';
        document.body.style.opacity='';
      }
    }catch(_){}
  }

  function scrubDocumentForRedirect(){
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
    scrubDocumentForRedirect();
    try{ window.stop && window.stop(); }catch(_){}
    try{ location.replace(url); }catch(_){ location.href = url; }
    return false;
  }

  function getToken(){ return String((cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || '').trim(); }
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
  function headers(){
    return {
      'Content-Type':'application/json',
      apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''),
      Authorization:`Bearer ${(cfg.SUPABASE_PUBLISHABLE_KEY||'')}`,
      Accept:'application/json'
    };
  }
  async function parse(res){
    var txt = await res.text();
    var data = null;
    try{ data = txt ? JSON.parse(txt) : null; }catch(_){ throw new Error(txt || ('HTTP ' + res.status)); }
    if(!res.ok) throw new Error((data && (data.message || data.error || data.hint)) || ('HTTP ' + res.status));
    return data;
  }
  function normalizeName(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
  function uniqueNames(list){ var seen=new Set(); return (Array.isArray(list)?list:[]).map(normalizeName).filter(function(name){ var k=name.toLowerCase(); if(!name||seen.has(k)) return false; seen.add(k); return true; }); }

  async function callViewerRpc(rpcName, payload){
    var res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers:headers(),
      body:JSON.stringify(payload)
    });
    var data = await parse(res);
    return data && data[rpcName] ? data[rpcName] : data;
  }

  async function fetchViewerState(token){
    if (!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return { ok:false, reason:'missing-config-or-token' };
    var attempts = [
      ['get_public_state', { session_token: token }],
      ['get_gejast_homepage_state', { session_token: token }],
      ['get_jas_app_state', { session_token: token }],
      ['get_public_state', { session_token_input: token }],
      ['get_gejast_homepage_state', { session_token_input: token }],
      ['get_jas_app_state', { session_token_input: token }]
    ];
    var lastError = '';
    for (const entry of attempts){
      try{
        var data = await callViewerRpc(entry[0], entry[1]);
        var name = normalizeName(data && (data.my_name || data.display_name || data.player_name || (data.viewer && data.viewer.display_name) || ''));
        var isLoggedIn = !!(data && (
          data.is_logged_in === true ||
          data.logged_in === true ||
          data.session_valid === true ||
          data.viewer_logged_in === true ||
          (data.viewer && (data.viewer.is_logged_in === true || data.viewer.session_valid === true))
        ));
        if (name || isLoggedIn){
          return { ok:true, state:data, viewerName:name, loggedIn:true };
        }
        if (data && typeof data === 'object'){
          return { ok:false, reason:'viewer-not-logged-in', state:data };
        }
      }catch(err){
        lastError = (err && err.message) || String(err || '');
      }
    }
    return { ok:false, reason:lastError || 'viewer-rpcs-unavailable' };
  }

  async function fetchAllowedNames(scope){
    try{
      var helper = cfg && typeof cfg.fetchScopedActivePlayerNames === 'function' ? cfg.fetchScopedActivePlayerNames : null;
      if(helper){
        var active = await helper(scope);
        if(active && active.length) return active;
      }
    }catch(_){}
    var raw = null;
    try{
      raw = await callViewerRpc('get_login_names_scoped', { site_scope_input: scope });
    }catch(_){
      try{
        raw = await callViewerRpc('get_login_names', {});
      }catch(_2){
        raw = { names:[] };
      }
    }
    var rows = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.names) ? raw.names : (Array.isArray(raw && raw.data) ? raw.data : []));
    var names = uniqueNames(rows.map(function(row){
      return typeof row === 'string' ? row : (row && (row.display_name || row.name || row.desired_name || row.slug || row.player_name) || '');
    }));
    try{
      if(window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.filterNames === 'function'){
        names = window.GEJAST_SCOPE_UTILS.filterNames(names, scope);
      }
    }catch(_){}
    return names;
  }

  async function verifyPrivateAccess(){
    var token = getToken();
    if (!token) return { ok:false, reason:'missing-token' };

    var viewer = await fetchViewerState(token);
    if (!viewer.ok) return viewer;

    var allowed = await fetchAllowedNames(currentScope());
    if (allowed.length && allowed.indexOf(viewer.viewerName) === -1){
      return { ok:false, reason:'scope-mismatch', viewerName:viewer.viewerName };
    }

    return { ok:true, viewerName:viewer.viewerName, state:viewer.state };
  }

  async function boot(){
    if (expired()) clearTokens();
    if (!getToken()) return redirect(homeUrl());

    var access = await verifyPrivateAccess().catch(function(err){
      return { ok:false, reason:(err && err.message) || 'private-gate-failed' };
    });

    if (!access.ok){
      clearTokens();
      return redirect(homeUrl());
    }

    try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){}
    removeBlocker();
  }

  boot().catch(function(){
    clearTokens();
    redirect(homeUrl());
  });
})();