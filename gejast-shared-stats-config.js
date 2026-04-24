(function(){
  window.GEJAST_SHARED_STATS_CONFIG={
    version:'v660',
    cache_key:'gejast_shared_stats_cache_v660',
    rpc:{
      summary:'get_shared_stats_summary_v660',
      leaderboard:'get_shared_stats_leaderboard_v660',
      crossGame:'get_cross_game_player_summary_v660',
      klaverjas:'get_klaverjas_shared_stats_v660',
      adminAudit:'admin_get_shared_stats_audit_v660',
      refresh:'refresh_shared_stats_cache_v660'
    },
    defaultScope:'friends',
    defaultLimit:10,
    games:['klaverjas','boerenbridge','beerpong'],
    note:'v660 stats substrate: RPC-backed shared/cross-game/Klaverjas read layer. Live success requires the separate v660 SQL to be run in Supabase.'
  };
})();
