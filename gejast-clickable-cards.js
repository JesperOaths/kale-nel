(function(global){
  function navigateTo(target){
    const href = String(target || '').trim();
    if (!href) return;
    global.location.href = href;
  }

  function findRoute(node){
    return String(
      node.getAttribute('data-route') ||
      node.getAttribute('data-href') ||
      node.getAttribute('data-click-route') ||
      ''
    ).trim();
  }

  function isInteractiveOrigin(event){
    const target = event.target;
    return !!target.closest('a,button,input,select,textarea,label');
  }

  function bind(root){
    const scope = root || global.document;
    scope.querySelectorAll('[data-route],[data-href],[data-click-route]').forEach((node) => {
      if (!node || node.dataset.clickableBound === '1') return;
      const route = findRoute(node);
      if (!route) return;
      node.dataset.clickableBound = '1';
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
      if (!node.hasAttribute('role')) node.setAttribute('role', 'link');
      node.addEventListener('click', (event) => {
        if (isInteractiveOrigin(event)) return;
        navigateTo(route);
      });
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        navigateTo(route);
      });
    });
  }

  function bindBackLinks(root){
    const scope = root || global.document;
    scope.querySelectorAll('[data-back-link]').forEach((node) => {
      if (!node || node.dataset.backLinkBound === '1') return;
      node.dataset.backLinkBound = '1';
      if (!node.hasAttribute('type') && node.tagName === 'BUTTON') node.setAttribute('type', 'button');
      node.addEventListener('click', () => {
        if (global.history.length > 1) {
          global.history.back();
          return;
        }
        const fallback = String(node.getAttribute('data-fallback') || './index.html').trim();
        navigateTo(fallback);
      });
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        node.click();
      });
    });
  }

  function upgradeJavascriptVoidLinks(root){
    const scope = root || global.document;
    scope.querySelectorAll('a[href="javascript:void(0)"]').forEach((node) => {
      if (node.dataset.voidUpgraded === '1') return;
      const fallback = String(node.getAttribute('data-fallback') || './index.html').trim();
      node.dataset.voidUpgraded = '1';
      node.setAttribute('href', fallback);
      node.addEventListener('click', (event) => {
        if (global.history.length > 1) {
          event.preventDefault();
          global.history.back();
        }
      });
    });
  }

  global.GEJAST_CLICKABLE_CARDS = {
    bind,
    bindBackLinks,
    upgradeJavascriptVoidLinks
  };
})(window);
