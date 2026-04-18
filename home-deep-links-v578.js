(function(){
  function scopedHref(path){
    try{
      const url = new URL(path, window.location.href);
      if (new URLSearchParams(window.location.search).get('scope') === 'family') url.searchParams.set('scope','family');
      return `${url.pathname.split('/').pop()}${url.search}`;
    }catch(_){ return path; }
  }
  function ladderRouteForCard(card){
    const title = String(card.querySelector('.ladder-title strong')?.textContent || '').trim().toLowerCase();
    const map = {
      'klaverjassen':'klaverjas',
      'boerenbridge':'boerenbridge',
      'beerpong':'beerpong',
      'paardenrace':'paardenrace',
      'pikken':'pikken',
      'caute coins':'caute-coins'
    };
    const game = map[title];
    return game ? scopedHref(`./ladder.html?game=${encodeURIComponent(game)}`) : '';
  }
  function bindLadderCards(){
    document.querySelectorAll('#ladderGrid .ladder-card, #extraLadderGrid .ladder-card').forEach((card)=>{
      if (card.dataset.deepBound === '1') return;
      const route = ladderRouteForCard(card);
      if (!route) return;
      card.dataset.deepBound = '1';
      card.setAttribute('role','link');
      card.tabIndex = 0;
      card.style.cursor = 'pointer';
      card.addEventListener('click', (event)=>{
        const anchor = event.target.closest('a');
        if (anchor) return;
        window.location.href = route;
      });
      card.addEventListener('keydown', (event)=>{
        if (event.key === 'Enter' || event.key === ' '){
          event.preventDefault();
          window.location.href = route;
        }
      });
    });
  }
  function reinstateBeursCard(){
    const placeholder = Array.from(document.querySelectorAll('.placeholder-link')).find((node)=>
      /beurs/i.test(String(node.textContent || ''))
    );
    if (!placeholder) return;
    const link = document.createElement('a');
    link.className = 'page-link-card login-link';
    link.href = scopedHref('./beurs.html');
    link.innerHTML = '<div class="page-link-label">Beurs d&#39;Espinoza</div><div class="page-link-copy">Open de beurs weer als echte hub met doorverwijzingen naar de werkende routes.</div>';
    placeholder.replaceWith(link);
  }
  function boot(){
    bindLadderCards();
    reinstateBeursCard();
    const grids = [document.getElementById('ladderGrid'), document.getElementById('extraLadderGrid')].filter(Boolean);
    grids.forEach((root)=>{
      const obs = new MutationObserver(()=>bindLadderCards());
      obs.observe(root, { childList:true, subtree:true });
    });
  }
  if ((location.pathname || '').toLowerCase().endsWith('index.html') || /\/$/.test(location.pathname || '')){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
    else boot();
  }
})();