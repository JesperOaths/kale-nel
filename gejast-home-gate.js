(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function getToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function currentTarget(){ try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html'; }catch(_){ return 'index.html'; } }
  function currentScope(){ try{ return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }catch(_){ return 'friends'; } }
  function homeUrl(){ try{ return cfg.buildHomeUrl ? cfg.buildHomeUrl(currentTarget(), currentScope()) : './home.html'; }catch(_){ return './home.html'; } }
  async function verifySoft(token){
    if(!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return 'missing';
    const headers = { 'Content-Type':'application/json', apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''), Authorization:'Bearer ' + (cfg.SUPABASE_PUBLISHABLE_KEY||'') };
    const tries = [['get_public_state',{session_token:token}],['get_public_state',{session_token_input:token}],['get_gejast_homepage_state',{session_token:token}],['get_jas_app_state',{session_token:token}]];
    let soft=0;
    for (const [rpc,payload] of tries){
      try{
        const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${rpc}`, { method:'POST', mode:'cors', cache:'no-store', headers, body: JSON.stringify(payload) });
        const txt = await res.text();
        let data = null; try{ data = txt ? JSON.parse(txt) : null; }catch(_){ data = null; }
        if (res.ok && (data?.viewer || data?.player || data?.session_valid === true || data?.is_logged_in === true || data?.my_name || data?.display_name || data?.player_name)) return 'valid';
        const raw = String((data && (data.message || data.error || data.details || data.hint)) || txt || '');
        if (/invalid session|session.*expired|not logged in|unauthorized|jwt|auth/i.test(raw)) return 'invalid';
        if (data && (data.session_valid === false || data.is_logged_in === false)) soft += 1;
      }catch(_){ }
    }
    return soft >= 2 ? 'invalid' : 'unknown';
  }
  var token = getToken();
  if (!token){ location.replace(homeUrl()); return; }
  try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){}
  verifySoft(token).then(function(status){
    if(status === 'valid'){
      try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){}
      return;
    }
    if(status === 'invalid' || status === 'unknown' || status === 'missing'){
      try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){}
    }
  }).catch(function(){});
})();
