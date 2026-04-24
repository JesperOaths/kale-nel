(function(){
  window.GEJAST_SHARED_STATS_CONFIG={
    version:'v658',
    cache_key:'gejast_shared_stats_cache_v658',
    rpc:{
      summary:'get_shared_stats_summary_v658',
      leaderboard:'get_shared_stats_leaderboard_v658',
      crossGame:'get_cross_game_player_summary_v658',
      klaverjas:'get_klaverjas_shared_stats_v658',
      adminAudit:'admin_get_shared_stats_audit_v658',
      refresh:'refresh_shared_stats_cache_v658'
    },
    defaultScope:'friends',
    defaultLimit:10,
    games:['klaverjas','boerenbridge','beerpong'],
    note:'v658 stats substrate: RPC-backed shared/cross-game/Klaverjas read layer. Live success requires the separate v658 SQL to be run in Supabase.'
  };
})();
