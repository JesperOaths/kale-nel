(function(){
  const existing = window.GEJAST_KLAVERJASSEN || {};
  const alignment = window.GEJAST_KLAVERJASSEN_ALIGNMENT || {};
  window.GEJAST_KLAVERJASSEN = Object.assign({}, existing, {
    VERSION:'v776',
    alignment,
    getAlignmentBundle: alignment.getAlignmentBundle,
    getLadderAlignment: alignment.getLadderAlignment
  });
})();
