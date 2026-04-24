(function(){
  'use strict';
  // v652 emergency performance rollback.
  // Health beacons are intentionally disabled on public/player pages. Do not poll or write runtime smoke checks from browsers.
  window.GEJAST_HEALTH_BEACON = Object.assign({}, window.GEJAST_HEALTH_BEACON || {}, {
    version: 'v652',
    enabled: false,
    reason: 'disabled_for_frontend_performance'
  });
})();
