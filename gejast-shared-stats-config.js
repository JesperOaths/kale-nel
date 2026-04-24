(function(){
  window.GEJAST_SHARED_STATS_CONFIG={
    version:'v659',
    cache_key:'gejast_shared_stats_cache_v659',
    rpc:{
      summary:'get_shared_stats_summary_v659',
      leaderboard:'get_shared_stats_leaderboard_v659',
      crossGame:'get_cross_game_player_summary_v659',
      klaverjas:'get_klaverjas_shared_stats_v659',
      adminAudit:'admin_get_shared_stats_audit_v659',
      refresh:'refresh_shared_stats_cache_v659'
    },
    defaultScope:'friends',
    defaultLimit:10,
    games:['klaverjas','boerenbridge','beerpong'],
    note:'v659 stats substrate: RPC-backed shared/cross-game/Klaverjas read layer. Live success requires the separate v659 SQL to be run in Supabase.'
  };
})();
