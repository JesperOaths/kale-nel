(function(){
  window.GEJAST_SHARED_STATS_CONFIG={
    version:'v661',
    cache_key:'gejast_shared_stats_cache_v661',
    rpc:{
      summary:'get_shared_stats_summary_v661',
      leaderboard:'get_shared_stats_leaderboard_v661',
      crossGame:'get_cross_game_player_summary_v661',
      klaverjas:'get_klaverjas_shared_stats_v661',
      adminAudit:'admin_get_shared_stats_audit_v661',
      refresh:'refresh_shared_stats_cache_v661'
    },
    defaultScope:'friends',
    defaultLimit:10,
    games:['klaverjas','boerenbridge','beerpong'],
    note:'v661 stats substrate: RPC-backed shared/cross-game/Klaverjas read layer. Live success requires the separate v661 SQL to be run in Supabase.'
  };
})();
