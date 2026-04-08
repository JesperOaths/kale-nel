(function(){
  function boot(){
    if (!(window.GEJAST_PLAYER_SESSION_UI && typeof window.GEJAST_PLAYER_SESSION_UI.init === 'function')) return;
    const scope = (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends';
    const profileHref = scope === 'family' ? './my_profile.html?scope=family' : './my_profile.html';
    window.GEJAST_PLAYER_SESSION_UI.init({ scope, profileHref });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
