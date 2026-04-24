(function(){
  window.GEJAST_SHARED_STATS_CONFIG={
    version:'v657',
    cache_key:'gejast_shared_stats_cache_v657',
    rpc:{
      summary:'get_shared_stats_summary_v657',
      leaderboard:'get_shared_stats_leaderboard_v657',
      crossGame:'get_cross_game_player_summary_v657',
      klaverjas:'get_klaverjas_shared_stats_v657',
      adminAudit:'admin_get_shared_stats_audit_v657',
      refresh:'refresh_shared_stats_cache_v657'
    },
    defaultScope:'friends',
    defaultLimit:10,
    games:['klaverjas','boerenbridge','beerpong'],
    note:'v657 stats substrate: RPC-backed shared/cross-game/Klaverjas read layer. Live success requires the separate v657 SQL to be run in Supabase.'
  };
})();
