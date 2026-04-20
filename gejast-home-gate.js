(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function getToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function currentTarget(){ try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html'; }catch(_){ return 'index.html'; } }
  function currentScope(){
    try{ if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); }catch(_){}
    try{ return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; }catch(_){ return 'friends'; }
  }
  function homeUrl(){
    var target = currentTarget();
    try{ return cfg.buildHomeUrl ? cfg.buildHomeUrl(target, currentScope()) : './home.html'; }catch(_){ return './home.html'; }
  }
  function headers(){ return { 'Content-Type':'application/json', apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''), Authorization:'Bearer ' + (cfg.SUPABASE_PUBLISHABLE_KEY||'') }; }
  async function safeJson(res){
    var txt = await res.text();
    var data = null;
    try{ data = txt ? JSON.parse(txt) : null; }catch(_){ return { ok:false, data:null, text:txt||'' }; }
    return { ok: !!res.ok, data:data, text:txt||'' };
  }
  function redirectHome(){ location.replace(homeUrl()); }

  async function probeRpc(name, payload, timeoutMs){
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return { status:'unknown' };
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(_){} }, timeoutMs || 1800) : null;
    try{
      var res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + name, {
        method:'POST', mode:'cors', cache:'no-store', headers:headers(),
        body:JSON.stringify(payload || {}), signal: controller ? controller.signal : undefined
      });
      var parsed = await safeJson(res);
      var data = parsed.data || null;
      var raw = String((data && (data.message || data.error || data.details || data.hint)) || parsed.text || '');
      if(parsed.ok){
        if(data && (data.viewer || data.player || data.my_name || data.display_name || data.player_name || data.session_valid === true || data.is_logged_in === true)) return { status:'valid' };
        if(data && (data.session_valid === false || data.is_logged_in === false)) return { status:'soft_invalid' };
        return { status:'unknown' };
      }
      if(/invalid session|session.*expired|not logged in|unauthorized|JWT|auth/i.test(raw)) return { status:'hard_invalid' };
      return { status:'unknown' };
    }catch(_){
      return { status:'unknown' };
    }finally{ if(timer) clearTimeout(timer); }
  }

  async function verifySessionSoft(token){
    if(!token) return { status:'hard_invalid' };
    var checks = [
      ['get_public_state', { session_token: token }],
      ['get_public_state', { session_token_input: token }],
      ['get_gejast_homepage_state', { session_token: token }],
      ['get_jas_app_state', { session_token: token }]
    ];
    var softInvalids = 0;
    for (var i = 0; i < checks.length; i += 1) {
      var pair = checks[i];
      var result = await probeRpc(pair[0], pair[1], 1800);
      if (result.status === 'valid') return { status:'valid' };
      if (result.status === 'hard_invalid') return { status:'hard_invalid' };
      if (result.status === 'soft_invalid') softInvalids += 1;
    }
    if (softInvalids >= 2) return { status:'hard_invalid' };
    return { status:'unknown' };
  }

  var token = getToken();
  if(!token){ redirectHome(); return; }
  try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:true }); }catch(_){}
  verifySessionSoft(token).then(function(result){
    var status = result && result.status || 'unknown';
    if(status === 'hard_invalid'){
      clearTokens();
      redirectHome();
      return;
    }
    if(status === 'valid'){
      try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:true }); }catch(_){}
    }
  }).catch(function(){});
})();
