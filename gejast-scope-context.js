(function(global){
  const cfg = global.GEJAST_CONFIG || {};
  function getPlayerSessionToken(){
    if (cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken() || '');
    const keys = ['jas_session_token_v11','jas_session_token_v10'];
    for (const key of keys){
      const value = global.localStorage.getItem(key) || global.sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }
  function getAdminSessionToken(){
    const keys = ['jas_admin_session_v8'];
    for (const key of keys){
      const value = global.sessionStorage.getItem(key) || global.localStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }
  function getScope(){
    try {
      if (global.GEJAST_SCOPE_UTILS && global.GEJAST_SCOPE_UTILS.getScope) return global.GEJAST_SCOPE_UTILS.getScope();
      const qs = new URLSearchParams(global.location.search);
      return qs.get('scope') === 'family' || (global.location.pathname || '').includes('/familie/') ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function pagePath(){
    try { return (global.location.pathname || '').split('/').pop() || 'index.html'; }
    catch (_) { return 'index.html'; }
  }
  global.GEJAST_SCOPE_CONTEXT = { getPlayerSessionToken, getAdminSessionToken, getScope, pagePath };
  if (!global.CTX) global.CTX = global.GEJAST_SCOPE_CONTEXT;
})(window);
