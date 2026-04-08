(function(global){
  const cfg = global.GEJAST_CONFIG || {};

  function normalizeScope(input){
    const raw = String(
      input ||
      new URLSearchParams(global.location.search).get('scope') ||
      (global.location.pathname.toLowerCase().includes('/familie/') ? 'family' : 'friends')
    ).trim().toLowerCase();
    return raw === 'family' ? 'family' : 'friends';
  }

  function sanitizeReturnTarget(input, fallback){
    const target = String(input || '').trim();
    if (cfg.sanitizeReturnTarget) {
      const safe = cfg.sanitizeReturnTarget(target);
      return safe || String(fallback || '').trim();
    }
    if (!target || /^https?:\/\//i.test(target) || target.startsWith('//')) return String(fallback || '').trim();
    return target.replace(/^\.\//, '') || String(fallback || '').trim();
  }

  function currentReturnTarget(fallback){
    if (cfg.currentReturnTarget) {
      return sanitizeReturnTarget(cfg.currentReturnTarget(fallback), fallback);
    }
    const params = new URLSearchParams(global.location.search);
    return sanitizeReturnTarget(params.get('return_to') || params.get('next') || fallback || '', fallback);
  }

  function getToken(){
    return cfg.getPlayerSessionToken ? String(cfg.getPlayerSessionToken() || '') : '';
  }

  function clearExpiredSessionIfNeeded(){
    const token = getToken();
    if (!token) return '';
    if (cfg.isPlayerSessionExpired && cfg.isPlayerSessionExpired()) {
      if (cfg.clearPlayerSessionTokens) cfg.clearPlayerSessionTokens();
      return '';
    }
    return token;
  }

  function defaultPrivateTarget(scope){
    return normalizeScope(scope) === 'family' ? 'index.html?scope=family' : 'index.html';
  }

  function buildHomeUrl(returnTo, scope){
    const safeTarget = sanitizeReturnTarget(returnTo, defaultPrivateTarget(scope));
    if (cfg.buildHomeUrl) return cfg.buildHomeUrl(safeTarget, normalizeScope(scope));
    const url = new URL('./home.html', global.location.href);
    if (safeTarget) url.searchParams.set('return_to', safeTarget);
    if (normalizeScope(scope) === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function buildLoginUrl(returnTo, scope){
    const safeTarget = sanitizeReturnTarget(returnTo, defaultPrivateTarget(scope));
    if (cfg.buildLoginUrl) return cfg.buildLoginUrl(safeTarget, normalizeScope(scope));
    const url = new URL('./login.html', global.location.href);
    if (safeTarget) url.searchParams.set('return_to', safeTarget);
    if (normalizeScope(scope) === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function buildRequestUrl(returnTo, scope){
    const safeTarget = sanitizeReturnTarget(returnTo, defaultPrivateTarget(scope));
    if (cfg.buildRequestUrl) return cfg.buildRequestUrl(safeTarget, normalizeScope(scope));
    const url = new URL('./request.html', global.location.href);
    if (safeTarget) url.searchParams.set('return_to', safeTarget);
    if (normalizeScope(scope) === 'family') url.searchParams.set('scope', 'family');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function setLinkHref(target, href){
    if (!target || !href) return;
    if (typeof target === 'string') {
      const node = global.document.getElementById(target) || global.document.querySelector(target);
      if (node) node.href = href;
      return;
    }
    target.href = href;
  }

  function revealDocument(){
    global.document.documentElement.style.display = '';
    global.document.documentElement.style.visibility = '';
  }

  async function requirePrivatePage(options){
    const opts = Object.assign({ returnTo: '', scope: '', hideBeforeAuth: true }, options || {});
    const scope = normalizeScope(opts.scope);
    const returnTo = sanitizeReturnTarget(
      opts.returnTo || global.location.pathname.replace(/^\//, '') + global.location.search + global.location.hash,
      defaultPrivateTarget(scope)
    );
    if (opts.hideBeforeAuth) {
      global.document.documentElement.style.visibility = 'hidden';
    }
    const token = clearExpiredSessionIfNeeded();
    if (!token) {
      global.location.replace(buildHomeUrl(returnTo, scope));
      return false;
    }
    if (cfg.ensurePlayerSessionOrRedirect) {
      const ok = await cfg.ensurePlayerSessionOrRedirect(returnTo, scope);
      if (!ok) return false;
    }
    if (cfg.touchPlayerActivity) {
      try { cfg.touchPlayerActivity(); } catch (_) {}
    }
    revealDocument();
    return true;
  }

  function bootPublicEntryPage(options){
    const opts = Object.assign({
      scope: '',
      returnTo: '',
      loginLinkTarget: null,
      requestLinkTarget: null,
      redirectIfLoggedIn: true,
      fallbackPrivateTarget: ''
    }, options || {});
    const scope = normalizeScope(opts.scope);
    const defaultTarget = sanitizeReturnTarget(opts.fallbackPrivateTarget || defaultPrivateTarget(scope), defaultPrivateTarget(scope));
    const returnTo = sanitizeReturnTarget(opts.returnTo || currentReturnTarget(defaultTarget), defaultTarget);
    setLinkHref(opts.loginLinkTarget, buildLoginUrl(returnTo, scope));
    setLinkHref(opts.requestLinkTarget, buildRequestUrl(returnTo, scope));
    const token = clearExpiredSessionIfNeeded();
    if (opts.redirectIfLoggedIn && token) {
      global.location.replace(returnTo || defaultTarget);
      return false;
    }
    revealDocument();
    return true;
  }

  function bindProtectedLinks(selector, options){
    const opts = Object.assign({ scope: '', returnTo: '' }, options || {});
    const scope = normalizeScope(opts.scope);
    global.document.querySelectorAll(selector).forEach((node) => {
      if (!node || node.dataset.publicGateBound === '1') return;
      node.dataset.publicGateBound = '1';
      node.addEventListener('click', function(event){
        if (clearExpiredSessionIfNeeded()) return;
        event.preventDefault();
        const href = String(node.getAttribute('href') || opts.returnTo || '').trim();
        const target = sanitizeReturnTarget(href.replace(/^\.\//, ''), defaultPrivateTarget(scope));
        global.location.href = buildHomeUrl(target, scope);
      });
    });
  }

  global.GEJAST_PUBLIC_PAGE_GATE = {
    normalizeScope,
    sanitizeReturnTarget,
    currentReturnTarget,
    buildHomeUrl,
    buildLoginUrl,
    buildRequestUrl,
    requirePrivatePage,
    bootPublicEntryPage,
    bindProtectedLinks,
    revealDocument,
    clearExpiredSessionIfNeeded
  };
})(window);
