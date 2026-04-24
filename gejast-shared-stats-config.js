(function(){
  const existing = window.GEJAST_SHARED_STATS_CONFIG || {};
  const games = Object.assign({}, existing.games || {}, {
    boerenbridge: {
      label: 'Boerenbridge',
      icon: '🌉',
      summaryRpc: 'get_boerenbridge_shared_stats_v643',
      leaderboardRpc: 'get_boerenbridge_shared_leaderboard_v643',
      adminAuditRpc: 'admin_get_boerenbridge_shared_stats_audit_v643',
      liveOddsRpc: 'get_boerenbridge_live_odds_v643',
      metrics: [
        'matches_played','wins','win_percentage','avg_score','under_100_count','wall_of_shame_score',
        'consistency_score','volatility_score','biggest_upset_score','probability_defied_score','chaos_factor','avg_opponent_elo'
      ]
    }
  });
  window.GEJAST_SHARED_STATS_CONFIG = Object.assign({}, existing, { VERSION: 'v643', games });
})();
