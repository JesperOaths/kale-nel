(function(){
  const existing = window.GEJAST_SHARED_STATS_CONFIG || {};
  const games = Object.assign({}, existing.games || {}, {
    klaverjassen: Object.assign({}, (existing.games && existing.games.klaverjassen) || {}, {
      label: 'Klaverjassen',
      icon: '♣',
      summaryRpc: 'get_klaverjassen_shared_stats_v640',
      leaderboardRpc: 'get_klaverjassen_shared_leaderboard_v640',
      alignmentBundleRpc: 'get_klaverjassen_alignment_bundle_v644',
      ladderAlignmentRpc: 'get_klaverjassen_ladder_alignment_v644',
      adminAuditRpc: 'admin_get_klaverjassen_alignment_audit_v644',
      refreshRpc: 'admin_refresh_klaverjassen_alignment_v644',
      metrics: ['matches_played','wins','win_percentage','avg_score','comeback_wins','avg_opponent_elo','ladder_rank','elo_rating','alignment_status','source_confidence']
    })
  });
  window.GEJAST_SHARED_STATS_CONFIG = Object.assign({}, existing, { VERSION: 'v644', games });
})();
