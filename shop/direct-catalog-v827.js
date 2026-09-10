(() => {
  'use strict';

  const DIRECT_ENDPOINT = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v827';
  const nativeFetch = window.fetch.bind(window);

  const roundUpEuro = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
  };

  const directImage = raw => {
    try {
      const url = new URL(String(raw || ''), window.location.href);
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (host === 'images.printify.com' || host.endsWith('.printify.com'));
    } catch {
      return false;
    }
  };

  function sanitizeProduct(raw){
    const name = String(raw?.name || raw?.title || '').trim();
    const variants = (Array.isArray(raw?.variants) ? raw.variants : []).map(variant => ({
      ...variant,
      price: roundUpEuro(variant?.price)
    }));

    const seen = new Set();
    let mockups = (Array.isArray(raw?.mockups) ? raw.mockups : [])
      .map(item => ({ label: String(item?.label || 'View'), image: String(item?.image || item?.src || '').trim() }))
      .filter(item => item.image && directImage(item.image) && !seen.has(item.image) && seen.add(item.image));

    // The first Jellyfish image was explicitly retired from the storefront gallery.
    if(/jellyfish/i.test(name) && mockups.length > 1) mockups = mockups.slice(1);

    const prices = variants
      .filter(variant => variant?.is_enabled !== false && variant?.is_available !== false)
      .map(variant => roundUpEuro(variant?.price))
      .filter(price => price > 0);
    const fallback = roundUpEuro(raw?.price);
    const price = prices.length ? Math.min(...prices) : fallback;
    const priceMax = prices.length ? Math.max(...prices) : Math.max(price, roundUpEuro(raw?.priceMax));

    return {
      ...raw,
      name,
      source: 'direct-catalog-v827',
      price,
      priceMax,
      variants,
      mockups,
      image: mockups[0]?.image || ''
    };
  }

  function sanitizePayload(payload){
    if(Array.isArray(payload)) return payload.map(sanitizeProduct).filter(item => item.name && item.price > 0 && item.mockups.length);
    const products = (Array.isArray(payload?.products) ? payload.products : [])
      .map(sanitizeProduct)
      .filter(item => item.name && item.price > 0 && item.mockups.length);
    return { ...(payload || {}), source: 'direct-catalog-v827', products };
  }

  if(window.BRUIS_CATALOG){
    window.BRUIS_CATALOG = sanitizePayload(window.BRUIS_CATALOG);
  }

  function isLegacyCatalogRequest(input){
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if(!raw) return false;
      const path = new URL(raw, window.location.href).pathname;
      return /\/functions\/v1\/shop-catalog\/?$/.test(path)
        || /\/functions\/v1\/shop-catalog-v822\/?$/.test(path);
    } catch {
      return false;
    }
  }

  window.fetch = async (input, init) => {
    if(!isLegacyCatalogRequest(input)) return nativeFetch(input, init);

    try {
      const response = await nativeFetch(DIRECT_ENDPOINT, {
        ...(init || {}),
        cache: 'no-store',
        method: 'GET'
      });
      if(!response.ok){
        return new Response(JSON.stringify({ products: [] }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      const payload = await response.json().catch(() => ({ products: [] }));
      return new Response(JSON.stringify(sanitizePayload(payload)), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Kalenel-Catalog-Authority': 'direct-v827'
        }
      });
    } catch {
      // Never fall through to the retired commerce catalog. store.js will use the
      // bundled direct-image catalog until the server connection is available.
      return new Response(JSON.stringify({ products: [] }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  };

  window.BRUIS_DIRECT_CATALOG_V827 = { sanitizePayload, endpoint: DIRECT_ENDPOINT };
})();
