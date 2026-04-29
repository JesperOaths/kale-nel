(function(){
  const api = window.GEJAST_PIKKEN_SHARED_STATS;
  if (!api) return;
  async function boot(){
    const roots = Array.from(document.querySelectorAll('[data-pikken-probability]'));
    if (!roots.length) return;
    const params = new URLSearchParams(location.search || '');
    const gameId = params.get('game_id') || params.get('client_match_id') || params.get('id') || '';
    for (const root of roots){
      try {
        root.innerHTML = '<div class="pikken-empty">Probability laden…</div>';
        const data = await api.probability({ gameId });
        api.renderProbability(root, data);
      } catch (err) {
        root.innerHTML = `<div class="pikken-empty">${String(err && err.message || err || 'Probability kon niet laden')}</div>`;
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
