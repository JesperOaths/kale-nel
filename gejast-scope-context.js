(function(global){
  const PLAYER_SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10'];
  const ADMIN_SESSION_KEYS = ['jas_admin_session_v8', 'gejast_admin_session_token', 'admin_session_token'];

  function readFirst(keys){
    for (const key of keys) {
      const fromLocal = global.localStorage ? global.localStorage.getItem(key) : '';
      const fromSession = global.sessionStorage ? global.sessionStorage.getItem(key) : '';
      if (fromLocal) return fromLocal;
      if (fromSession) return fromSession;
    }
    return '';
  }

  function getPlayerSessionToken(){
    if (global.GEJAST_CONFIG && typeof global.GEJAST_CONFIG.getPlayerSessionToken === 'function') {
      return global.GEJAST_CONFIG.getPlayerSessionToken() || '';
    }
    return readFirst(PLAYER_SESSION_KEYS);
  }

  function getAdminSessionToken(){
    if (global.GEJAST_ADMIN_SESSION && typeof global.GEJAST_ADMIN_SESSION.getToken === 'function') {
      return global.GEJAST_ADMIN_SESSION.getToken() || '';
    }
    return readFirst(ADMIN_SESSION_KEYS);
  }

  function getScope(){
    if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
      return global.GEJAST_SCOPE_UTILS.getScope();
    }
    return (global.location && /\/familie\//i.test(global.location.pathname || '')) ? 'family' : 'friends';
  }

  function pagePath(){
    const loc = global.location || {};
    return `${loc.pathname || ''}${loc.search || ''}${loc.hash || ''}`;
  }

  global.GEJAST_SCOPE_CONTEXT = global.GEJAST_SCOPE_CONTEXT || {
    getPlayerSessionToken,
    getAdminSessionToken,
    getScope,
    pagePath
  };
})(window);
