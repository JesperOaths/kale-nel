(function(root){
  const DRINK_ROUTES = { dashboard:'drinks.html', add:'drinks_add.html', pending:'drinks_pending.html', speed:'drinks_speed.html', speedStats:'drinks_speed_stats.html', stats:'drinks_stats.html', history:'drinks_history.html', player:'drinks_player.html' };
  function scope(){ try { return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; } catch (_) { return 'friends'; } }
  function href(key, extra){
    const path = DRINK_ROUTES[key] || key || DRINK_ROUTES.dashboard;
    const url = new URL(`./${path}`, location.href);
    if (scope() === 'family') url.searchParams.set('scope','family');
    Object.entries(extra || {}).forEach(([k,v])=>{ if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
    return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
  }
  function applyLinks(rootNode){ (rootNode || document).querySelectorAll('[data-drinks-route]').forEach((node)=>{ node.setAttribute('href', href(node.getAttribute('data-drinks-route') || 'dashboard')); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ()=>applyLinks(document), { once:true }); else applyLinks(document);
  root.GEJAST_DRINKS_ROUTING = { routes:DRINK_ROUTES, href, applyLinks, scope };
})(window);
