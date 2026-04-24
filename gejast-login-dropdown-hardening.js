(function(global){
  'use strict';
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function setStatus(message, tone){
    const el = document.getElementById('statusBox');
    if (!el || !message) return;
    const current = String(el.textContent || '').trim();
    if (current && !/namen|lijst|laden|schema|rpc|backend/i.test(current)) return;
    el.className = `status ${tone || ''}`.trim();
    el.textContent = message;
  }
  function currentScope(){
    try {
      if (global.GEJAST_PLAYER_SELECTOR) return global.GEJAST_PLAYER_SELECTOR.normalizeScope();
      return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends';
    } catch (_) { return 'friends'; }
  }
  function optionValues(select){
    return Array.from(select.options || []).map((o)=>String(o.value || '').trim()).filter(Boolean);
  }
  function preserveSelection(select, fn){
    const previous = select.value;
    fn();
    if (previous) {
      const match = optionValues(select).find((name)=>name.toLowerCase() === previous.toLowerCase());
      if (match) select.value = match;
    }
  }
  async function harden(){
    const selector = global.GEJAST_PLAYER_SELECTOR;
    const select = document.getElementById('playerNameInput') || document.querySelector('select[name="username"]');
    if (!selector || !select || select.dataset.gejastLoginDropdownHardened === '1') return;
    select.dataset.gejastLoginDropdownHardened = '1';
    const scope = currentScope();

    const cached = selector.readCache('activated', scope, 24 * 60 * 60 * 1000);
    if (cached.length && optionValues(select).length <= 1) {
      preserveSelection(select, ()=>selector.fillSelect(select, cached, { placeholder:'Kies je naam', preserveOnEmpty:true }));
    }

    try {
      const data = await selector.getSelector(scope, { cacheTtlMs: 10 * 60 * 1000 });
      const names = selector.uniqueNames(data.activated_names || []);
      if (names.length) {
        preserveSelection(select, ()=>selector.fillSelect(select, names, { placeholder:'Kies je naam', preserveOnEmpty:true }));
        if (data.cached) setStatus('Namenlijst geladen vanuit veilige cache; live selector wordt later opnieuw geprobeerd.', 'warn');
      } else {
        const current = optionValues(select);
        if (!current.length) setStatus('Geen actieve namen gevonden voor deze scope.', 'warn');
      }
    } catch (error) {
      const fallback = selector.readCache('activated', scope, 24 * 60 * 60 * 1000);
      if (fallback.length) {
        preserveSelection(select, ()=>selector.fillSelect(select, fallback, { placeholder:'Kies je naam', preserveOnEmpty:true }));
        setStatus('Namenlijst behouden uit cache omdat live ophalen mislukte.', 'warn');
      }
    }

    select.addEventListener('focus', async ()=>{
      try {
        const names = await selector.getActivatedNames(scope, { useCache:false });
        if (names.length) preserveSelection(select, ()=>selector.fillSelect(select, names, { placeholder:'Kies je naam', preserveOnEmpty:true }));
      } catch (_) {}
    });
  }
  ready(harden);
})(window);
