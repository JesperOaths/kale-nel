(function(){
  function getPersistentMatchIdentity(game){
    if (!game || typeof game !== 'object') return { client_match_id:'', match_ref:'' };
    if (!game.client_match_id || !game.match_ref) {
      const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      game.client_match_id = game.client_match_id || `klaverjas-${seed}`;
      game.match_ref = game.match_ref || game.client_match_id;
      try {
        const key = 'current_match_v67';
        sessionStorage.setItem(key, JSON.stringify(game));
      } catch(_) {}
    }
    return {
      client_match_id: String(game.client_match_id || ''),
      match_ref: String(game.match_ref || game.client_match_id || '')
    };
  }

  function patchSummary(){
    if (typeof window.summaryPayload !== 'function' || !window.game) return;
  }

  function buildLiveLink(){
    try {
      const g = window.game || {};
      const ids = getPersistentMatchIdentity(g);
      if (!ids.client_match_id && !ids.match_ref) return '';
      const url = new URL('./klaverjas_live.html', window.location.href);
      if (ids.client_match_id) url.searchParams.set('client_match_id', ids.client_match_id);
      if (ids.match_ref) url.searchParams.set('match_ref', ids.match_ref);
      if (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope() === 'family') {
        url.searchParams.set('scope', 'family');
      }
      return url.pathname.split('/').pop() + url.search;
    } catch(_) { return ''; }
  }

  function injectLiveLink(){
    const strip = document.querySelector('.contract-actions');
    if (!strip || document.getElementById('scorerLiveLinkBtn')) return;
    const href = buildLiveLink();
    if (!href) return;
    const a = document.createElement('a');
    a.id = 'scorerLiveLinkBtn';
    a.className = 'text-btn';
    a.href = href;
    a.textContent = 'Open live';
    a.style.background = '#fff';
    a.style.color = '#111';
    strip.appendChild(a);
  }

  function patchGameLifecycle(){
    const originalFreshGame = window.freshGame;
    if (typeof originalFreshGame === 'function' && !window.__gejastFreshGamePatched) {
      window.__gejastFreshGamePatched = true;
      window.freshGame = function(){
        const g = originalFreshGame.apply(this, arguments);
        const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
        g.client_match_id = `klaverjas-${seed}`;
        g.match_ref = g.client_match_id;
        return g;
      };
      try { freshGame = window.freshGame; } catch(_) {}
    }
    if (window.game) getPersistentMatchIdentity(window.game);
  }

  function patchLiveSummary(){
    if (window.__gejastLiveSummaryV505Patched) return;
    window.__gejastLiveSummaryV505Patched = true;

    const oldSummaryPayload = window.summaryPayload;
    if (typeof oldSummaryPayload === 'function') {
      window.summaryPayload = function(isFinished){
        const payload = oldSummaryPayload.call(this, isFinished);
        const ids = getPersistentMatchIdentity(window.game || {});
        payload.client_match_id = ids.client_match_id;
        payload.summary = payload.summary || {};
        payload.summary.match_ref = ids.match_ref;
        payload.summary.client_match_id = ids.client_match_id;
        payload.summary.live_state = Object.assign({}, payload.summary.live_state || {}, {
          status: isFinished ? 'finished' : 'live',
          updated_at: new Date().toISOString()
        });
        return payload;
      };
      try { summaryPayload = window.summaryPayload; } catch(_) {}
    }

    if (typeof window.ensureLiveSummaryBinding === 'function') {
      const oldEnsure = window.ensureLiveSummaryBinding;
      window.ensureLiveSummaryBinding = function(){
        const out = oldEnsure.apply(this, arguments);
        try {
          if (window.liveSummaryIntervalId) clearInterval(window.liveSummaryIntervalId);
        } catch(_) {}
        try {
          window.liveSummaryIntervalId = window.setInterval(()=>{
            if (document.visibilityState === 'visible' && typeof window.pushSummary === 'function') {
              window.pushSummary(false, false);
            }
          }, 30000);
        } catch(_) {}
        return out;
      };
    }
  }

  function run(){
    patchGameLifecycle();
    patchLiveSummary();
    injectLiveLink();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();