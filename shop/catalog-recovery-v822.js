(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  const PRIMARY_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v822';
  const PRICE_FALLBACK_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-price-v818';
  const BOXY_TITLES = new Set([
    'coral', 'daffodil', 'dragonfly', 'honeysuckle', 'horseshoe crab', 'seahorse', 'seaweed'
  ]);

  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  const classify = name => {
    const key = clean(name).toLowerCase();
    if(key.includes('despinoza')) return 'merch';
    return BOXY_TITLES.has(key) ? 'boxy' : 'normal';
  };

  function isLegacyCatalogRequest(input){
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if(!raw) return false;
      return /\/functions\/v1\/shop-catalog\/?$/.test(new URL(raw, window.location.href).pathname);
    } catch {
      return false;
    }
  }

  async function fetchJson(url, init){
    const response = await previousFetch(url, {
      ...(init || {}),
      cache: 'no-store',
      headers: {
        ...(init?.headers || {}),
        apikey: typeof SUPABASE_ANON_KEY === 'string' ? SUPABASE_ANON_KEY : undefined,
        Authorization: typeof SUPABASE_ANON_KEY === 'string' ? `Bearer ${SUPABASE_ANON_KEY}` : undefined
      }
    });
    if(!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && Array.isArray(payload.products) && payload.products.length ? payload : null;
  }

  function normalizePriceFallback(payload){
    const products = (Array.isArray(payload?.products) ? payload.products : []).map(product => ({
      ...product,
      collection: classify(product?.name),
      sizes: Array.isArray(product?.variants)
        ? [...new Set(product.variants.flatMap(variant => (Array.isArray(variant?.options) ? variant.options : [])
            .filter(option => /size/i.test(String(option?.name || '')))
            .map(option => String(option?.value || '').trim())
            .filter(Boolean)))]
        : [],
      baseKey: product?.baseKey || 'shopify',
      baseLabel: product?.baseLabel || 'T-Shirt'
    }));
    return { ...payload, source: 'shopify-price-fallback', products };
  }

  window.fetch = async (input, init) => {
    if(!isLegacyCatalogRequest(input)) return previousFetch(input, init);

    try {
      const primary = await fetchJson(PRIMARY_URL, init);
      if(primary){
        return new Response(JSON.stringify(primary), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Kalenel-Catalog-Authority': 'shop-catalog-v822'
          }
        });
      }
    } catch {}

    try {
      const priceFallback = await fetchJson(PRICE_FALLBACK_URL, init);
      if(priceFallback){
        return new Response(JSON.stringify(normalizePriceFallback(priceFallback)), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Kalenel-Catalog-Authority': 'shop-price-v818-fallback'
          }
        });
      }
    } catch {}

    // Preserve the original request as a last network attempt. store.js then falls
    // back to bundled catalog-data.js if this response is unavailable/non-200.
    return previousFetch(input, init);
  };
})();
