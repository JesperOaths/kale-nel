(() => {
  'use strict';

  const POLL_MS = 60 * 1000;
  const FIRST_POLL_MS = 12 * 1000;
  let lastSignature = '';
  let pendingReload = false;
  let checking = false;

  const stableSignature = list => JSON.stringify(
    [...(Array.isArray(list) ? list : [])]
      .map(product => ({
        id: String(product?.id || ''),
        name: String(product?.name || ''),
        collection: String(product?.collection || ''),
        price: Number(product?.price || 0),
        priceMax: Number(product?.priceMax || product?.price || 0),
        sizes: Array.isArray(product?.sizes) ? product.sizes.map(String) : [],
        mockups: Array.isArray(product?.mockups) ? product.mockups.map(item => String(item?.image || '')) : [],
        variants: Array.isArray(product?.variants) ? product.variants.map(variant => ({
          id: String(variant?.id || ''),
          title: String(variant?.title || ''),
          price: Number(variant?.price || 0),
          enabled: variant?.is_enabled !== false,
          available: variant?.is_available !== false,
          options: Array.isArray(variant?.options)
            ? variant.options.map(option => `${String(option?.name || '')}:${String(option?.value || '')}`)
            : []
        })) : []
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );

  const safeToReload = () => {
    const cartDrawer = document.querySelector('[data-cart-drawer]');
    const cartOpen = cartDrawer && cartDrawer.getAttribute('aria-hidden') === 'false';
    return document.visibilityState === 'visible' && !cartOpen;
  };

  const maybeReload = () => {
    if(!pendingReload || !safeToReload()) return;
    pendingReload = false;
    window.location.reload();
  };

  async function checkCatalog(){
    if(checking || typeof loadLiveCatalog !== 'function') return;
    checking = true;
    try {
      const live = await loadLiveCatalog();
      if(!Array.isArray(live) || !live.length) return;
      const signature = stableSignature(live);
      if(!lastSignature){
        lastSignature = signature;
        return;
      }
      if(signature !== lastSignature){
        lastSignature = signature;
        pendingReload = true;
      }
      maybeReload();
    } catch {
      // Keep the already-rendered catalog. The next poll retries automatically.
    } finally {
      checking = false;
    }
  }

  window.setTimeout(checkCatalog, FIRST_POLL_MS);
  window.setInterval(checkCatalog, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible'){
      if(pendingReload) maybeReload();
      else checkCatalog();
    }
  });
})();
