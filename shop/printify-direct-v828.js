(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  const DIRECT_CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';

  function isLegacyCatalogRequest(input){
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if(!raw) return false;
      const url = new URL(raw, window.location.href);
      return /\/functions\/v1\/shop-catalog\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  window.fetch = (input, init) => {
    if(!isLegacyCatalogRequest(input)) return previousFetch(input, init);
    return previousFetch(DIRECT_CATALOG_URL, {
      ...(init || {}),
      cache: 'no-store'
    });
  };

  window.BRUIS_PRINTIFY_DIRECT_V828 = Object.freeze({
    version: 'v828',
    catalog: DIRECT_CATALOG_URL,
    authority: 'printify-direct',
    usesShopifyApi: false
  });
})();
