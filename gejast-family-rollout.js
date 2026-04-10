(function(global){
  const cfg = global.GEJAST_CONFIG || {};
  const EXCLUDED_RE = /^(?:drinks(?:[_a-z]*)|beerpong(?:[_a-z]*))(?:\.html)?$/i;
  const EXCLUDED_TEXT_RE = /(drinks?|beerpong)/i;
  const CARD_SELECTOR = '.page-link-card,.hub-link,.toolbar-card,.card,.item,.summary-card,.btn,a';

  function normalizeScope(value){
    if (cfg.normalizeScope) return cfg.normalizeScope(value);
    return String(value || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
  }

  function currentScope(){
    try {
      const qs = new URLSearchParams(global.location.search || '');
      if (qs.has('scope')) return normalizeScope(qs.get('scope'));
    } catch (_) {}
    if (global.GEJAST_SCOPE_CONTEXT && typeof global.GEJAST_SCOPE_CONTEXT.getScope === 'function') {
      return normalizeScope(global.GEJAST_SCOPE_CONTEXT.getScope());
    }
    if (cfg.inferRuntimeScope) return normalizeScope(cfg.inferRuntimeScope());
    return 'friends';
  }

  function currentPath(){
    try { return (global.location.pathname || '').split('/').pop() || 'index.html'; }
    catch (_) { return 'index.html'; }
  }

  function sameOrigin(url){
    try { return new URL(url, global.location.href).origin === global.location.origin; }
    catch (_) { return false; }
  }

  function withFamilyScope(href){
    try {
      const url = new URL(href, global.location.href);
      if (url.origin !== global.location.origin) return href;
      if (!/^https?:$/i.test(url.protocol)) return href;
      url.searchParams.set('scope', 'family');
      return url.pathname.split('/').pop() + url.search + url.hash;
    } catch (_) {
      return href;
    }
  }

  function familyHome(){ return './index.html?scope=family'; }
  function familyAdmin(){ return './admin.html?scope=family'; }

  function redirectIfExcluded(){
    if (currentScope() !== 'family') return;
    const path = currentPath();
    if (!EXCLUDED_RE.test(path)) return;
    const target = /^admin_/i.test(path) || /admin/i.test(path) ? familyAdmin() : familyHome();
    if (global.location.href.indexOf(target) === -1) global.location.replace(target);
  }

  function hideNode(node){
    const target = node.closest(CARD_SELECTOR) || node;
    if (!target || target.dataset.familyHidden === '1') return;
    target.dataset.familyHidden = '1';
    target.style.display = 'none';
  }

  function preserveLinks(scope){
    if (scope !== 'family') return;
    global.document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      if (!sameOrigin(href)) return;
      a.setAttribute('href', withFamilyScope(href));
    });
  }

  function hideExcluded(scope){
    if (scope !== 'family') return;
    global.document.querySelectorAll('.drinks-home-section,.drinks-home-top5-section,[data-family-hide]').forEach(hideNode);
    global.document.querySelectorAll('a[href],button,[data-route],[data-href]').forEach((node) => {
      const href = node.getAttribute('href') || node.dataset.route || node.dataset.href || '';
      const text = String(node.textContent || '');
      if (EXCLUDED_TEXT_RE.test(href) || EXCLUDED_TEXT_RE.test(text)) hideNode(node);
    });
  }

  function annotate(scope){
    const body = global.document.body;
    if (!body) return;
    body.dataset.siteScope = scope;
    body.classList.toggle('family-scope', scope === 'family');
    body.classList.toggle('friends-scope', scope !== 'family');
    if (scope !== 'family' || global.document.querySelector('[data-family-scope-badge]')) return;
    const badge = global.document.createElement('div');
    badge.setAttribute('data-family-scope-badge', '1');
    badge.textContent = 'Familie-scope';
    badge.style.cssText = 'position:fixed;top:14px;left:14px;z-index:9998;padding:8px 12px;border-radius:999px;background:rgba(154,130,65,.92);color:#171717;font:800 12px/1.1 Inter,system-ui,sans-serif;box-shadow:0 10px 20px rgba(0,0,0,.12)';
    body.appendChild(badge);
  }

  function apply(){
    const scope = currentScope();
    redirectIfExcluded();
    annotate(scope);
    preserveLinks(scope);
    hideExcluded(scope);
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', apply, { once:true });
  else apply();
  if (typeof MutationObserver !== 'undefined') {
    const obs = new MutationObserver(() => apply());
    const start = () => { try { obs.observe(global.document.body, { childList:true, subtree:true }); } catch (_) {} };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once:true });
    else start();
    global.setTimeout(() => { try { obs.disconnect(); } catch (_) {} }, 6000);
  }
})(window);
