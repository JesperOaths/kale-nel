(function(){
  function toScoped(path){
    try{
      const url = new URL(path, window.location.href);
      const scope = (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends';
      if (scope === 'family') url.searchParams.set('scope', 'family');
      return `${url.pathname.split('/').pop()}${url.search}`;
    }catch(_){ return path; }
  }

  function currentScope(){
    try {
      return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends';
    } catch (_) {
      return 'friends';
    }
  }

  function currentSessionToken(){
    try {
      return (window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken && window.GEJAST_CONFIG.getPlayerSessionToken()) || '';
    } catch (_) {
      return '';
    }
  }

  function defaultEntryConfig(){
    return {
      klaverjas: {
        entryId: 'homeKlaverjasEntry',
        labelId: 'homeKlaverjasLabel',
        copyId: 'homeKlaverjasCopy',
        href: './scorer.html',
        label: 'Klaverjas'
      },
      boerenbridge: {
        entryId: 'homeBoerenbridgeEntry',
        labelId: 'homeBoerenbridgeLabel',
        copyId: 'homeBoerenbridgeCopy',
        href: './boerenbridge.html',
        label: 'Boerenbridge'
      }
    };
  }

  function setTopLivePill(state, text){
    const pill = document.getElementById('homeLivePill');
    if (!pill) return;
    pill.className = `live-pill ${state}`;
    pill.textContent = text;
  }

  function setEntryDefault(key){
    const cfg = defaultEntryConfig()[key];
    if (!cfg) return;
    const entry = document.getElementById(cfg.entryId);
    const label = document.getElementById(cfg.labelId);
    const copy = document.getElementById(cfg.copyId);
    if (!entry || !label || !copy) return;
    entry.classList.remove('is-live');
    entry.href = cfg.href;
    label.textContent = cfg.label;
    copy.className = 'page-link-copy plus-copy';
    copy.innerHTML = '<img class="page-link-plus" src="./plus-icon.png" alt="Plus" />';
  }

  function setEntryLive(key, item){
    const cfg = defaultEntryConfig()[key];
    if (!cfg) return;
    const entry = document.getElementById(cfg.entryId);
    const label = document.getElementById(cfg.labelId);
    const copy = document.getElementById(cfg.copyId);
    if (!entry || !label || !copy || !item || !item.href) {
      setEntryDefault(key);
      return;
    }
    entry.classList.add('is-live');
    entry.href = item.href;
    label.textContent = item.label || (key === 'klaverjas' ? 'Klaverjas Kijken' : 'Boerenbridge begluren');
    copy.className = 'page-link-copy';
    copy.innerHTML = '<span class="page-link-live-row"><span class="live-pill live">Live</span><span class="page-link-live-hint">' + (item.copy || 'Open live scoreblad van jouw huidige potje.') + '</span></span>';
  }

  function applyHomepageEntries(entries){
    setEntryDefault('klaverjas');
    setEntryDefault('boerenbridge');
    const source = entries || {};
    const hasKlaverjas = !!(source.klaverjas && source.klaverjas.href);
    const hasBoerenbridge = !!(source.boerenbridge && source.boerenbridge.href);
    if (hasKlaverjas) setEntryLive('klaverjas', source.klaverjas);
    if (hasBoerenbridge) setEntryLive('boerenbridge', source.boerenbridge);
    if (hasKlaverjas || hasBoerenbridge) {
      const labels = [];
      if (hasKlaverjas) labels.push('Klaverjas');
      if (hasBoerenbridge) labels.push('Boerenbridge');
      setTopLivePill('live', labels.join(' + ') + ' live');
    } else {
      setTopLivePill('standby', 'Stand-by');
    }
  }

  async function loadHomepageEntriesOwner(){
    const live = window.GEJAST_LIVE_SUMMARY;
    if (!live || typeof live.loadHomepageState !== 'function') {
      applyHomepageEntries({});
      return;
    }
    try {
      const entries = await live.loadHomepageState(currentSessionToken(), currentScope());
      applyHomepageEntries(entries || {});
    } catch (_) {
      applyHomepageEntries({});
    }
  }

  function wireCards(){
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

  function boot(){
    wireCards();
    loadHomepageEntriesOwner();
    window.setInterval(loadHomepageEntriesOwner, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();