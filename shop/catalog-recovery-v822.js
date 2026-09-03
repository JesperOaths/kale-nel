(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  const PRIMARY_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v822';
  const PRICE_FALLBACK_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-price-v818';
  const BOXY_TITLES = new Set([
    'coral', 'daffodil', 'dragonfly', 'honeysuckle', 'horseshoe crab', 'seahorse', 'seaweed'
  ]);
  const FRONT_PREVIEWS = [
    [/axolotl/i, 'assets/product-previews/axolotl-front-v5.webp'],
    [/dragonfly/i, 'assets/product-previews/dragonfly-front-v5.webp'],
    [/hydrangea/i, 'assets/product-previews/hydrangea-front-v5.webp'],
    [/jellyfish/i, 'assets/product-previews/jellyfish-front-v7.webp'],
    [/(?:orchid|flower).*mantis|mantis/i, 'assets/product-previews/mantis-front-v5.webp'],
    [/thistle/i, 'assets/product-previews/thistle-front-v5.webp'],
    [/(?:wild\s*carrot|queen\s*anne)/i, 'assets/product-previews/queen-annes-lace-front-v5.webp'],
    [/coral/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/coral-front-artwork.png?v=1788359906'],
    [/daffodil/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/daffodil-front-artwork.png?v=1788359914'],
    [/despinoza/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/despinoza-dd-front-artwork-sharp.png?v=1788362436'],
    [/dogwood/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/dogwood-front-artwork.png?v=1788361669'],
    [/honeysuckle/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/honeysuckle-front-artwork.png?v=1788359866'],
    [/horseshoe\s*crab/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/horseshoe-crab-front-artwork.png?v=1788359876'],
    [/\blily\b/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/lily-front-artwork.png?v=1788359898'],
    [/magnolia/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/magnolia-front-artwork.png?v=1788359890'],
    [/monstera/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/monstera-front-artwork.png?v=1788359921'],
    [/\borchid\b/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/orchid-front-artwork.png?v=1788359884'],
    [/seahorse/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seahorse-front-artwork.png?v=1788359936'],
    [/seaweed|kelp/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seaweed-front-artwork.png?v=1788359928'],
    [/snowdrop/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/snowdrop-front-artwork.png?v=1788361662']
  ];

  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  const classify = name => {
    const key = clean(name).toLowerCase();
    if(key.includes('despinoza')) return 'merch';
    return BOXY_TITLES.has(key) ? 'boxy' : 'normal';
  };
  const frontPreviewFor = name => FRONT_PREVIEWS.find(([pattern]) => pattern.test(clean(name)))?.[1] || '';

  function decoratePayload(payload){
    const products = (Array.isArray(payload?.products) ? payload.products : []).map(product => {
      const preview = frontPreviewFor(product?.name);
      const existing = Array.isArray(product?.mockups) ? product.mockups.filter(item => item?.image) : [];
      const seen = new Set();
      const mockups = [
        ...(preview ? [{ label: 'Front artwork', image: preview }] : []),
        ...existing
      ].filter(item => {
        const image = String(item?.image || '');
        if(!image || seen.has(image)) return false;
        seen.add(image);
        return true;
      });
      return {
        ...product,
        collection: product?.collection || classify(product?.name),
        mockups,
        image: mockups[0]?.image || product?.image || ''
      };
    });
    return { ...payload, products };
  }

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
    const inheritedHeaders = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : (init?.headers || {});
    const authHeaders = typeof SUPABASE_ANON_KEY === 'string'
      ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      : {};
    const response = await previousFetch(url, {
      ...(init || {}),
      cache: 'no-store',
      headers: { ...inheritedHeaders, ...authHeaders }
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
    return decoratePayload({ ...payload, source: 'shopify-price-fallback', products });
  }

  window.fetch = async (input, init) => {
    if(!isLegacyCatalogRequest(input)) return previousFetch(input, init);

    try {
      const primary = await fetchJson(PRIMARY_URL, init);
      if(primary){
        return new Response(JSON.stringify(decoratePayload(primary)), {
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
