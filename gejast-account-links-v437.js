(function (root) {
  function normalizeScope(value) {
    const scope = String(value || '').trim().toLowerCase();
    return scope === 'family' ? 'family' : 'friends';
  }

  function currentScope() {
    try {
      const params = new URLSearchParams(root.location.search || '');
      const fromUrl = params.get('scope');
      if (fromUrl) return normalizeScope(fromUrl);
    } catch (_) {}
    try {
      if (root.GEJAST_SCOPE_UTILS && typeof root.GEJAST_SCOPE_UTILS.getScope === 'function') {
        return normalizeScope(root.GEJAST_SCOPE_UTILS.getScope());
      }
    } catch (_) {}
    try {
      if (root.GEJAST_ADMIN_RPC && typeof root.GEJAST_ADMIN_RPC.getScope === 'function') {
        return normalizeScope(root.GEJAST_ADMIN_RPC.getScope());
      }
    } catch (_) {}
    return 'friends';
  }

  function scopedUrl(input) {
    const url = new URL(input, root.location.href);
    const scope = currentScope();
    if (scope === 'family') url.searchParams.set('scope', 'family');
    else url.searchParams.delete('scope');
    return url;
  }

  function scopedHref(input) {
    const url = scopedUrl(input);
    const isSameOrigin = url.origin === root.location.origin;
    return isSameOrigin ? `${url.pathname.split('/').pop()}${url.search}${url.hash}` : url.toString();
  }

  function activationBaseUrl() {
    const url = scopedUrl('./activate.html');
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) url.protocol = 'https:';
    return url.toString();
  }

  function applyLinks(doc) {
    const target = doc || root.document;
    if (!target || typeof target.querySelectorAll !== 'function') return;
    const selectors = [
      'a[href="./index.html"]',
      'a[href="./login.html"]',
      'a[href="./request.html"]',
      'a[href="./activate.html"]',
      'a[href="./profiles.html"]',
      'a[href="./admin.html"]'
    ].join(',');
    target.querySelectorAll(selectors).forEach((node) => {
      const href = node.getAttribute('href');
      if (!href) return;
      node.setAttribute('href', scopedHref(href));
    });
  }

  root.GEJAST_ACCOUNT_LINKS = {
    currentScope,
    scopedUrl,
    scopedHref,
    activationBaseUrl,
    applyLinks
  };
})(window);
