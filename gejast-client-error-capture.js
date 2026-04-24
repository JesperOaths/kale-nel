(function(){
  'use strict';
  // v652 emergency performance rollback.
  // Client error capture is intentionally disabled until it is reintroduced behind an explicit admin-only flag.
  window.GEJAST_CLIENT_ERROR_CAPTURE = Object.assign({}, window.GEJAST_CLIENT_ERROR_CAPTURE || {}, {
    version: 'v652',
    enabled: false,
    reason: 'disabled_for_frontend_performance'
  });
})();
