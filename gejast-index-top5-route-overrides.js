(function(){
  function toScoped(path){
    try{
      const url = new URL(path, window.location.href);
      const scope = (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends';
      if (scope === 'family') url.searchParams.set('scope', 'family');
      return `${url.pathname.split('/').pop()}${url.search}`;
    }catch(_){ return path; }
  }
  function wire(){
    const main = document.getElementById('ladderGrid');
    const extra = document.getElementById('extraLadderGrid');
    [main, extra].forEach((root)=>{
      if (!root) return;
      root.querySelectorAll('.ladder-card').forEach((card)=>{
        if (card.dataset.gejastOverrideBound === '1') return;
        card.dataset.gejastOverrideBound = '1';
        const title = (card.querySelector('.ladder-title strong')?.textContent || '').trim().toLowerCase();
        let route = '';
        if (title.includes('klaverjas')) route = toScoped('./ladder.html?game=klaverjas');
        else if (title.includes('boerenbridge')) route = toScoped('./ladder.html?game=boerenbridge');
        else if (title.includes('beerpong')) route = toScoped('./ladder.html?game=beerpong');
        else if (title.includes('paardenrace')) route = toScoped('./ladder.html?game=paardenrace');
        else if (title.includes('pikken')) route = toScoped('./ladder.html?game=pikken');
        else if (title.includes('caute coins')) route = toScoped('./caute_coins.html');
        if (!route) return;
        card.setAttribute('role','link');
        card.setAttribute('tabindex','0');
        card.addEventListener('click', ()=>{ window.location.href = route; });
        card.addEventListener('keydown', (ev)=>{ if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = route; } });
      });
    });
    const drinks = document.getElementById('drinksTop5Grid');
    if (drinks) {
      drinks.querySelectorAll('.ladder-card').forEach((card)=>{
        if (card.dataset.gejastOverrideBound === '1') return;
        card.dataset.gejastOverrideBound = '1';
        const title = (card.querySelector('.ladder-title strong')?.textContent || '').trim().toLowerCase();
        let route = toScoped('./drinks.html');
        if (title.includes('grootste speler')) route = toScoped('./profiles.html');
        card.setAttribute('role','link');
        card.setAttribute('tabindex','0');
        card.addEventListener('click', ()=>{ window.location.href = route; });
        card.addEventListener('keydown', (ev)=>{ if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = route; } });
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once:true });
  else wire();
})();