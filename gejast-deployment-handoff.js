(function(){
  function buildDeploymentHandoff(){
    return {
      version: window.GEJAST_PAGE_VERSION || (window.GEJAST_CONFIG && window.GEJAST_CONFIG.VERSION) || '',
      generated_at: new Date().toISOString(),
      url: location.href,
      user_agent: navigator.userAgent,
      scope: (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends',
      notes: [
        'v650 is a verification/control package, not a gameplay rewrite.',
        'SQL success means database accepted the objects; browser success still needs deployed-page testing.',
        'Keep SQL separate from upload zips and preserve Made by Bruis/version discipline.'
      ]
    };
  }
  window.GEJAST_DEPLOYMENT_HANDOFF = { buildDeploymentHandoff };
})();
