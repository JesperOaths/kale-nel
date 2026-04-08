(function (global) {
  const SESSION_KEYS = ['jas_session_token_v11', 'jas_session_token_v10', 'gejast_session_token'];
  const ADMIN_KEYS = ['jas_admin_session_token_v1', 'gejast_admin_session_token', 'admin_session_token'];

  function getPlayerSessionToken() {
    for (const key of SESSION_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    try {
      if (global.GEJAST_CONFIG && typeof global.GEJAST_CONFIG.getPlayerSessionToken === 'function') {
        return global.GEJAST_CONFIG.getPlayerSessionToken() || '';
      }
    } catch (_) {}
    return '';
  }

  function getAdminSessionToken() {
    for (const key of ADMIN_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function getScope() {
    if (global.GEJAST_SCOPE_UTILS && typeof global.GEJAST_SCOPE_UTILS.getScope === 'function') {
      return global.GEJAST_SCOPE_UTILS.getScope();
    }
    const params = new URLSearchParams(location.search || '');
    if ((params.get('scope') || '').toLowerCase() === 'family') return 'family';
    return location.pathname.toLowerCase().includes('/familie/') ? 'family' : 'friends';
  }

  function pagePath() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  global.GEJAST_SCOPE_CONTEXT = {
    getPlayerSessionToken,
    getAdminSessionToken,
    getScope,
    pagePath
  };
})(window);
