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
    try { return (window.GEJAST_SCOPE_UTILS && window.GEJAST_SCOPE_UTILS.getScope && window.GEJAST_SCOPE_UTILS.getScope()) || 'friends'; }
    catch (_) { return 'friends'; }
  }
  function currentSessionToken(){
    try { return (window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken && window.GEJAST_CONFIG.getPlayerSessionToken()) || ''; }
    catch (_) { return ''; }
  }
  function defaultEntryConfig(){ return { klaverjas:{ entryId:'homeKlaverjasEntry', labelId:'homeKlaverjasLabel', copyId:'homeKlaverjasCopy', href:'./scorer.html', label:'Klaverjas' }, boerenbridge:{ entryId:'homeBoerenbridgeEntry', labelId:'homeBoerenbridgeLabel', copyId:'homeBoerenbridgeCopy', href:'./boerenbridge.html', label:'Boerenbridge' } }; }
  function setTopLivePill(state, text){ const pill = document.getElementById('homeLivePill'); if (!pill) return; pill.className = `live-pill ${state}`; pill.textContent = text; }
  function setEntryDefault(key){ const cfg = defaultEntryConfig()[key]; if (!cfg) return; const entry = document.getElementById(cfg.entryId); const label = document.getElementById(cfg.labelId); const copy = document.getElementById(cfg.copyId); if (!entry || !label || !copy) return; entry.classList.remove('is-live'); entry.href = cfg.href; label.textContent = cfg.label; copy.className = 'page-link-copy plus-copy'; copy.innerHTML = '<img class="page-link-plus" src="./plus-icon.png" alt="Plus" />'; }
  function setEntryLive(key, item){ const cfg = defaultEntryConfig()[key]; if (!cfg) return; const entry = document.getElementById(cfg.entryId); const label = document.getElementById(cfg.labelId); const copy = document.getElementById(cfg.copyId); if (!entry || !label || !copy || !item || !item.href) { setEntryDefault(key); return; } entry.classList.add('is-live'); entry.href = item.href; label.textContent = item.label || (key === 'klaverjas' ? 'Klaverjas Kijken' : 'Boerenbridge begluren'); copy.className = 'page-link-copy'; copy.innerHTML = '<span class="page-link-live-row"><span class="live-pill live">Live</span><span class="page-link-live-hint">' + (item.copy || 'Open live scoreblad van jouw huidige potje.') + '</span></span>'; }
  function applyHomepageEntries(entries){ setEntryDefault('klaverjas'); setEntryDefault('boerenbridge'); const source = entries || {}; const hasKlaverjas = !!(source.klaverjas && source.klaverjas.href); const hasBoerenbridge = !!(source.boerenbridge && source.boerenbridge.href); if (hasKlaverjas) setEntryLive('klaverjas', source.klaverjas); if (hasBoerenbridge) setEntryLive('boerenbridge', source.boerenbridge); if (hasKlaverjas || hasBoerenbridge) { const labels = []; if (hasKlaverjas) labels.push('Klaverjas'); if (hasBoerenbridge) labels.push('Boerenbridge'); setTopLivePill('live', labels.join(' + ') + ' live'); } else setTopLivePill('standby', 'Stand-by'); }
  async function loadHomepageEntriesOwner(){ const live = window.GEJAST_LIVE_SUMMARY; if (!live || typeof live.loadHomepageState !== 'function') { applyHomepageEntries({}); return; } try { const entries = await live.loadHomepageState(currentSessionToken(), currentScope()); applyHomepageEntries(entries || {}); } catch(_) { applyHomepageEntries({}); } }
  let timer = null;
  function startLoop(){ if (timer) clearInterval(timer); loadHomepageEntriesOwner(); timer = setInterval(()=>{ if (!document.hidden) loadHomepageEntriesOwner(); }, 20000); }
  function patchIndexPerformanceHints(){
    const body = document.body;
    if (!body) return;
    body.classList.remove('boot-pending');
    const root = document.getElementById('drinksTop5Grid');
    if (root && !root.dataset.gejastCompactCards){ root.dataset.gejastCompactCards = '1'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>{ patchIndexPerformanceHints(); startLoop(); }, { once:true });
  else { patchIndexPerformanceHints(); startLoop(); }
})();