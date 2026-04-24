(function(){
  const existing = window.GEJAST_BOERENBRIDGE || {};
  function bootSharedStatsWidgets(){
    try {
      if (window.GEJAST_BOERENBRIDGE_SHARED_STATS) {
        document.querySelectorAll('[data-boerenbridge-shared-leaderboard]').forEach((el)=>{
          if (el.__bbSharedMounted) return;
          el.__bbSharedMounted = true;
          window.GEJAST_BOERENBRIDGE_SHARED_STATS.mountLeaderboard(el, { limit: Number(el.getAttribute('data-limit') || 10) });
        });
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSharedStatsWidgets, { once:true });
  else bootSharedStatsWidgets();
  window.GEJAST_BOERENBRIDGE = Object.assign({}, existing, { VERSION:'v643', bootSharedStatsWidgets });
})();
