(() => {
  'use strict';

  const POLL_MS = 15 * 1000;
  const FIRST_POLL_MS = 4 * 1000;
  let lastSignature = '';
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

  function reconcileCart(){
    if(!Array.isArray(cart) || !Array.isArray(products)) return;
    let changed = false;
    cart.forEach(item => {
      const product = products.find(candidate =>
        String(candidate?.id || '') === String(item?.id || '') ||
        String(candidate?.name || '').trim().toLowerCase() === String(item?.name || '').trim().toLowerCase()
      );
      if(!product) return;
      const nextPrice = Number(product.price || 0);
      if(nextPrice > 0 && Number(item.price || 0) !== nextPrice){
        item.price = nextPrice;
        changed = true;
      }
      if(product.image && item.image !== product.image){
        item.image = product.image;
        changed = true;
      }
    });
    if(changed) saveCart();
  }

  function applyCatalog(live){
    products = sortByShirtBase(live);
    updateCollectionCounts();
    reconcileCart();
    if(selectedCollection) renderProducts();
    renderCart();
  }

  async function checkCatalog(){
    if(checking || typeof loadLiveCatalog !== 'function') return;
    checking = true;
    try {
      if(!lastSignature && Array.isArray(products) && products.length){
        lastSignature = stableSignature(products);
      }

      const live = await loadLiveCatalog();
      if(!Array.isArray(live) || !live.length) return;
      const signature = stableSignature(live);

      if(!lastSignature){
        lastSignature = signature;
        return;
      }

      if(signature !== lastSignature){
        lastSignature = signature;
        applyCatalog(live);
      }
    } catch {
      // Keep the already-rendered catalog. The next poll retries automatically.
    } finally {
      checking = false;
    }
  }

  window.setTimeout(checkCatalog, FIRST_POLL_MS);
  window.setInterval(checkCatalog, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') checkCatalog();
  });
  window.addEventListener('focus', checkCatalog);
})();
