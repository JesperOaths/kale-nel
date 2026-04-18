(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  if (path && path !== 'index.html') return;
  window.GEJAST_PAGE_VERSION = 'v581';

  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function scope(){ try{ return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || (new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'); }catch(_){ return 'friends'; } }
  function scopedHref(base){ try{ const url = new URL(base, location.href); if (scope() === 'family') url.searchParams.set('scope', 'family'); return `${url.pathname.split('/').pop()}${url.search}`; }catch(_){ return base; } }
  function setLivePill(state, text){ const pill = document.getElementById('homeLivePill'); if (!pill) return; pill.className = `live-pill ${state || 'standby'}`; pill.textContent = text || 'Stand-by'; }

  function patchOfflineMessaging(){
    const original = window.setHomepageLiveState;
    window.setHomepageLiveState = function(state, text){
      const normalizedState = String(state || '').toLowerCase();
      const normalizedText = String(text || '').toLowerCase();
      if (normalizedState === 'offline' || normalizedText.includes('offline')) {
        if (typeof original === 'function') return original.call(this, 'standby', 'Stand-by');
        return setLivePill('standby', 'Stand-by');
      }
      if (typeof original === 'function') return original.call(this, state, text);
      return setLivePill(state, text);
    };
  }

  function patchBeursCard(){
    const placeholders = Array.from(document.querySelectorAll('.page-link-card.placeholder-link'));
    const target = placeholders.find((card)=>/beurs d['’]espinoza/i.test(card.textContent || ''));
    if (!target) return;
    const anchor = document.createElement('a');
    anchor.className = 'page-link-card login-link';
    anchor.href = scopedHref('./beurs.html');
    anchor.innerHTML = '<div class="page-link-label">Beurs d\'Espinoza</div><div class="page-link-copy">Open het beurs-overzicht en spring door naar de werkende onderdelen.</div>';
    target.replaceWith(anchor);
  }

  function bindLadderCards(){
    const map = {
      'klaverjassen':'klaverjas',
      'boerenbridge':'boerenbridge',
      'beerpong':'beerpong',
      'paardenrace':'paardenrace',
      'pikken':'pikken',
      'caute coins':'caute-coins'
    };
    document.querySelectorAll('#ladderGrid .ladder-card, #extraLadderGrid .ladder-card').forEach((card)=>{
      if (!card.dataset.route) {
        const title = String(card.querySelector('.ladder-title strong')?.textContent || '').trim().toLowerCase();
        const key = map[title];
        if (key) card.dataset.route = scopedHref(`./ladder.html?game=${encodeURIComponent(key)}`);
      }
      if (!card.dataset.route || card.dataset.routeBound === '1') return;
      card.dataset.routeBound = '1';
      card.style.cursor = 'pointer';
      const go = ()=>{ location.href = card.dataset.route; };
      card.addEventListener('click', (ev)=>{ if (ev.target && ev.target.closest && ev.target.closest('a')) return; go(); });
      card.addEventListener('keydown', (ev)=>{ if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
      if (!card.hasAttribute('tabindex')) card.tabIndex = 0;
      if (!card.getAttribute('role')) card.setAttribute('role', 'link');
    });
  }

  function countRows(obj){ if (!obj || typeof obj !== 'object') return 0; return Object.values(obj).reduce((sum, value)=>sum + (Array.isArray(value) ? value.length : 0), 0); }
  function hasAnyLiveEntries(entries){ if (!entries || typeof entries !== 'object') return false; return Object.values(entries).some((item)=>!!(item && (item.href || item.client_match_id || item.match_ref || item.live || item.status === 'live'))); }

  function applyBundle(bundle){
    if (!bundle || typeof bundle !== 'object') return;
    try { if (bundle.homepage_state && typeof window.renderState === 'function') window.renderState(bundle.homepage_state); } catch(_){}
    try { if (bundle.extra_poll_state && typeof window.renderExtraPollState === 'function') window.renderExtraPollState(bundle.extra_poll_state); } catch(_){}
    try { if (bundle.ladders && typeof window.renderHomepageLadders === 'function') window.renderHomepageLadders(bundle.ladders); } catch(_){}
    try { if (bundle.drinks_home && typeof window.applyDrinksHomePayload === 'function') window.applyDrinksHomePayload(bundle.drinks_home); } catch(_){}
    try { if (bundle.drinks_top5 && typeof window.applyDrinksTop5Payload === 'function') window.applyDrinksTop5Payload(bundle.drinks_top5); } catch(_){}
    try { if (bundle.live_entries && typeof window.applyHomepageLiveEntries === 'function') window.applyHomepageLiveEntries(bundle.live_entries); } catch(_){}
    const laddersVisible = countRows(bundle.ladders || {}) > 0;
    const liveVisible = hasAnyLiveEntries(bundle.live_entries || {});
    if (laddersVisible || liveVisible) setLivePill('live', 'Live');
    else setLivePill('standby', 'Stand-by');
    bindLadderCards();
  }

  async function refreshHomepageBundle(){
    const readers = window.GEJAST_COMBINED_READERS;
    if (readers && typeof readers.loadHomepageBootBundle === 'function') {
      const bundle = await readers.loadHomepageBootBundle();
      applyBundle(bundle || {});
      return;
    }
    if (typeof window.loadHomepageLadders === 'function') {
      try { await window.loadHomepageLadders(); } catch(_) {}
    }
    bindLadderCards();
  }

  function init(){
    patchOfflineMessaging();
    patchBeursCard();
    bindLadderCards();
    refreshHomepageBundle().catch(()=>{ setLivePill('standby', 'Stand-by'); bindLadderCards(); });
    window.setInterval(()=>{ patchBeursCard(); bindLadderCards(); }, 2000);
    window.setInterval(()=>{ refreshHomepageBundle().catch(()=>{}); }, 15000);
  }

  onReady(init);
})();
