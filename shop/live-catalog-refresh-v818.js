(() => {
  'use strict';

  // The storefront is static-first. Live reconciliation is a low-priority
  // enhancement and must never become a high-frequency Supabase poller.
  if(window.__BRUIS_LIVE_CATALOG_REFRESH_V818_R5__) return;
  window.__BRUIS_LIVE_CATALOG_REFRESH_V818_R5__ = true;

  // Render the generated catalog immediately, then reconcile its product list
  // against the authoritative Printify cache after first paint and while browsing.
  // One request per browser every 20 minutes maximum; hidden tabs do not poll.
  const SHARED_MIN_REFRESH_MS = 20 * 60 * 1000;
  const SHARED_CHECK_KEY = 'bruisCatalogLiveCheckAtV4';
  const SHARED_OWNER_KEY = 'bruisCatalogLiveCheckOwnerV4';
  const TAB_ID = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  let lastSignature = '';
  let checking = false;
  let lastCheckedAt = 0;

  function sharedLastCheckedAt(){
    try { return Number(localStorage.getItem(SHARED_CHECK_KEY) || 0) || 0; } catch { return 0; }
  }
  function claimSharedRefresh(now){
    try {
      const shared = sharedLastCheckedAt();
      if(shared && now - shared < SHARED_MIN_REFRESH_MS) return false;
      localStorage.setItem(SHARED_CHECK_KEY, String(now));
      localStorage.setItem(SHARED_OWNER_KEY, TAB_ID);
      return true;
    } catch {
      return !lastCheckedAt || now - lastCheckedAt >= SHARED_MIN_REFRESH_MS;
    }
  }

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

  const idTail = value => {
    const raw = String(value || '').trim();
    return raw.includes('/') ? raw.split('/').pop() : raw;
  };

  const variantSize = variant => {
    const options = Array.isArray(variant?.options) ? variant.options : [];
    const explicit = options.find(option => /size/i.test(String(option?.name || '')))?.value;
    if(explicit) return String(explicit);
    return String(variant?.title || '').split('/').map(part => part.trim()).find(part => /^(?:xs|s|m|l|xl|[2-9]xl)$/i.test(part)) || '';
  };

  const currentVariantFor = (product, item) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const wantedId = idTail(item?.variantId);
    if(wantedId){
      const exact = variants.find(variant => idTail(variant?.id) === wantedId);
      if(exact) return exact;
    }
    const wantedSize = String(item?.size || '').trim().toLowerCase();
    if(wantedSize){
      const bySize = variants.find(variant => variantSize(variant).toLowerCase() === wantedSize);
      if(bySize) return bySize;
    }
    return variants.find(variant => variant?.is_enabled !== false && variant?.is_available !== false) || variants[0] || null;
  };

  function reconcileCart(){
    if(!Array.isArray(cart) || !Array.isArray(products)) return;
    let changed = false;
    cart.forEach(item => {
      const wantedProductId = String(item?.productId || item?.id || '');
      const product = products.find(candidate =>
        String(candidate?.id || '') === wantedProductId ||
        String(candidate?.name || '').trim().toLowerCase() === String(item?.name || '').trim().toLowerCase()
      );
      if(!product) return;

      const variant = currentVariantFor(product, item);
      const nextPrice = Number(variant?.price || product.price || 0);
      const nextVariantId = idTail(variant?.id || item?.variantId);
      const nextSize = variantSize(variant) || item?.size;

      if(nextPrice > 0 && Number(item.price || 0) !== nextPrice){
        item.price = nextPrice;
        changed = true;
      }
      if(nextVariantId && String(item.variantId || '') !== nextVariantId){
        item.variantId = nextVariantId;
        changed = true;
      }
      if(nextSize && item.size !== nextSize){
        item.size = nextSize;
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
    saveLastGoodCatalog(products);
    updateCollectionCounts();
    reconcileCart();
    if(selectedCollection) renderProducts();
    renderCart();
  }

  async function checkCatalog(){
    if(checking || typeof loadLiveCatalog !== 'function' || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    const now = Date.now();
    if(lastCheckedAt && now - lastCheckedAt < SHARED_MIN_REFRESH_MS) return;
    if(!claimSharedRefresh(now)) return;
    checking = true;
    lastCheckedAt = now;
    try {
      if(!lastSignature && Array.isArray(products) && products.length){
        lastSignature = stableSignature(products);
      }

      const live = await loadLiveCatalog();
      if(!Array.isArray(live) || !live.length) return;
      const signature = stableSignature(live);

      if(!lastSignature){
        lastSignature = signature;
        if(!Array.isArray(products) || !products.length) applyCatalog(live);
        return;
      }

      if(signature !== lastSignature){
        lastSignature = signature;
        applyCatalog(live);
      }
    } catch {
      // Keep the already-rendered catalog. A later visibility check retries.
    } finally {
      checking = false;
    }
  }

  // Initial reconciliation is deferred until after the first page render.
  // The shared lease limits repeated network traffic across tabs.
  function startAutomaticReconciliation(){
    void checkCatalog();
    window.setInterval(() => { void checkCatalog(); }, SHARED_MIN_REFRESH_MS);
  }
  if(document.readyState === 'complete') startAutomaticReconciliation();
  else window.addEventListener('load', startAutomaticReconciliation, { once:true });
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') void checkCatalog();
  });
  window.addEventListener('online', () => { void checkCatalog(); });

  window.BRUIS_LIVE_CATALOG_REFRESH_V818 = Object.freeze({
    refreshNow: () => checkCatalog(),
    mode: 'static-first-automatic-20m-r9'
  });
  window.addEventListener('storage', event => {
    if(event.key !== catalogCacheKey || !event.newValue) return;
    try {
      const fresh = readLastGoodCatalog({ allowExpired: true });
      if(!fresh.length) return;
      const signature = stableSignature(fresh);
      if(signature === lastSignature) return;
      lastSignature = signature;
      applyCatalog(fresh);
    } catch {}
  });
})();
