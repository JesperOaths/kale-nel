(() => {
  'use strict';

  const DIRECT_CATALOG_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
  const CHECKOUT_V828_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v828';
  const previousFetch = window.fetch.bind(window);

  const FRONT_PREVIEWS = [
    [/^coral$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/coral-front-artwork.png?v=1788359906'],
    [/^orchid$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/orchid-front-artwork.png?v=1788359884'],
    [/^honeysuckle$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/honeysuckle-front-artwork.png?v=1788359866'],
    [/^horseshoe crab$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/horseshoe-crab-front-artwork.png?v=1788359876'],
    [/^lily$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/lily-front-artwork.png?v=1788359898'],
    [/^magnolia$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/magnolia-front-artwork.png?v=1788359890'],
    [/^monstera$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/monstera-front-artwork.png?v=1788359921'],
    [/^daffodil$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/daffodil-front-artwork.png?v=1788359914'],
    [/^seahorse$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seahorse-front-artwork.png?v=1788359936'],
    [/^seaweed$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seaweed-front-artwork.png?v=1788359928'],
    [/^snowdrop$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/snowdrop-front-artwork.png?v=1788361662'],
    [/^dogwood$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/dogwood-front-artwork.png?v=1788361669'],
    [/despinoza/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/despinoza-dd-front-artwork-sharp.png?v=1788362436'],
    [/hydrangea/i, 'assets/product-previews/hydrangea-front-v5.webp'],
    [/axolotl/i, 'assets/product-previews/axolotl-front-v5.webp'],
    [/mantis/i, 'assets/product-previews/mantis-front-v5.webp'],
    [/thistle/i, 'assets/product-previews/thistle-front-v5.webp'],
    [/jellyfish/i, 'assets/product-previews/jellyfish-front-v7.webp'],
    [/dragonfly/i, 'assets/product-previews/dragonfly-front-v5.webp'],
    [/(?:wild\s*carrot|queen\s*anne)/i, 'assets/product-previews/queen-annes-lace-front-v5.webp']
  ];

  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  const inputUrl = input => {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      return raw ? new URL(raw, window.location.href) : null;
    } catch {
      return null;
    }
  };
  const frontPreviewFor = name => FRONT_PREVIEWS.find(([pattern]) => pattern.test(clean(name)))?.[1] || '';

  function decorateCatalog(payload){
    if(!payload || !Array.isArray(payload.products)) return payload;
    return {
      ...payload,
      source: 'printify-direct-v828',
      products: payload.products.map(product => {
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
          source: 'printify-direct-v828',
          mockups,
          image: mockups[0]?.image || product?.image || ''
        };
      })
    };
  }

  function isLegacyCatalog(url){
    return !!url && /\/functions\/v1\/shop-catalog\/?$/.test(url.pathname);
  }
  function isLegacyCheckout(url){
    return !!url && /\/functions\/v1\/shop-manual-checkout-v825\/?$/.test(url.pathname);
  }

  window.fetch = async (input, init) => {
    const url = inputUrl(input);

    if(isLegacyCatalog(url)){
      const response = await previousFetch(DIRECT_CATALOG_URL, {
        ...(init || {}),
        cache: 'no-store'
      });
      if(!response.ok) return response;
      try {
        const payload = await response.clone().json();
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'application/json; charset=utf-8');
        headers.set('X-Kalenel-Catalog-Authority', 'printify-direct-v828');
        return new Response(JSON.stringify(decorateCatalog(payload)), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch {
        return response;
      }
    }

    if(isLegacyCheckout(url)){
      return previousFetch(CHECKOUT_V828_URL, {
        ...(init || {}),
        cache: 'no-store'
      });
    }

    return previousFetch(input, init);
  };

  const style = document.createElement('style');
  style.dataset.directCommerceV828 = 'true';
  style.textContent = `
    .mockup-rail { grid-auto-columns: 100% !important; gap: 0 !important; padding: 12px !important; background: #ded6ca !important; }
    .mockup { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
    .mockup img { width: 100% !important; aspect-ratio: 1 / 1 !important; object-fit: contain !important; object-position: center !important; padding: 8px !important; background: transparent !important; }
    .product-card:has(.mockup:only-child) .gallery-controls { display: none !important; }
    .cart-line img { object-fit: contain !important; background: #ded6ca !important; border-radius: 12px; }
    .collection-image, .compact-shape-card img { background: #ded6ca !important; }
    .collection-image .collection-merch-image, .compact-shape-card .collection-merch-image { background: transparent !important; object-fit: contain !important; }
  `;
  document.head.appendChild(style);

  window.BRUIS_DIRECT_COMMERCE_V828 = Object.freeze({
    catalogAuthority: 'printify-direct-v828',
    checkoutAuthority: 'shop-manual-checkout-v828',
    usesShopifyCatalogApi: false,
    usesShopifyPriceApi: false
  });
})();
