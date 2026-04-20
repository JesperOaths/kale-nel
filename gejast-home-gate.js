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
  async function safeJson(res){ var txt=await res.text(); var data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ return null; } return res.ok ? data : null; }
  function redirectHome(){ location.replace(homeUrl()); }
  async function verifySessionSoft(token){
    if(!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return { status:'unknown' };
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(_){} }, 2200) : null;
    try{
      var res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/get_public_state', {
        method:'POST', mode:'cors', cache:'no-store', headers:headers(),
        body:JSON.stringify({ session_token: token }), signal: controller ? controller.signal : undefined
      });
      var data = await safeJson(res);
      if(!data) return { status:'unknown' };
      if(data.session_valid === false || data.is_logged_in === false) return { status:'invalid' };
      if(data.viewer || data.player || data.my_name || data.display_name || data.player_name || data.session_valid === true || data.is_logged_in === true) return { status:'valid' };
      return { status:'unknown' };
    }catch(_){ return { status:'unknown' }; }
    finally { if(timer) clearTimeout(timer); }
  }

  var token = getToken();
  if(!token){ redirectHome(); return; }
  try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:true }); }catch(_){}
  verifySessionSoft(token).then(function(result){
    var status = result && result.status || 'unknown';
    if(status === 'invalid'){
      clearTokens();
      redirectHome();
    }
  }).catch(function(){});
})();
