(function(){
  var cfg = window.GEJAST_CONFIG || {};
  function getToken(){ return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function expired(){ try{ return cfg.isPlayerSessionExpired ? cfg.isPlayerSessionExpired() : !getToken(); }catch(_){ return !getToken(); } }
  function currentTarget(){
    try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html'; }catch(_){ return 'index.html'; }
  }
  function homeUrl(){
    var target = currentTarget();
    try{ return cfg.buildHomeUrl ? cfg.buildHomeUrl(target) : './home.html'; }catch(_){ return './home.html'; }
  }
  if(expired()) clearTokens();
  if(!getToken()){
    try{ document.documentElement.style.display='none'; }catch(_){ }
    location.replace(homeUrl());
  } else {
    try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity(); }catch(_){ }
  }
})();
