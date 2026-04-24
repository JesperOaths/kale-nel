(function(){
  const existing = window.GEJAST_SHARED_STATS_CONFIG || {};
  const games = Object.assign({}, existing.games || {}, {
    beerpong: {
      label: 'Beerpong',
      icon: '🍺',
      summaryRpc: 'get_beerpong_shared_stats_v642',
      leaderboardRpc: 'get_beerpong_shared_leaderboard_v642',
      adminAuditRpc: 'admin_get_beerpong_shared_stats_audit_v642',
      liveOddsRpc: 'get_beerpong_live_odds_v642',
      metrics: [
        'matches_played','wins','win_percentage','point_differential','consistency_score',
        'volatility_score','showed_up_rate','king_of_the_hill_score','loser_streak_risk','chaos_factor'
      ]
    }
  });
  window.GEJAST_SHARED_STATS_CONFIG = Object.assign({}, existing, { VERSION: 'v642', games });
})();
