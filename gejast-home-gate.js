(function(){
  const gate = window.GEJAST_PUBLIC_PAGE_GATE;
  const cfg = window.GEJAST_CONFIG || {};
  const scope = (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends';
  const returnTo = cfg.currentReturnTarget ? cfg.currentReturnTarget('index.html') : 'index.html';
  if (gate && typeof gate.requirePrivatePage === 'function') {
    gate.requirePrivatePage({ returnTo, scope, hideBeforeAuth: true });
  } else if (cfg.ensurePlayerSessionOrRedirect) {
    cfg.ensurePlayerSessionOrRedirect(returnTo);
  }
})();
