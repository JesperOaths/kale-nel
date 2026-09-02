(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const PRICE_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-price-v818';

  const TRANSPARENT_FALLBACKS = [
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

  const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ');
  const titleKey = value => cleanName(value).toLowerCase();
  const imageUrl = item => String(item?.image || item?.url || '').trim();
  const variantSku = variant => String(variant?.sku || '').trim();
  const isTransparentAsset = url => /\.(?:png|webp)(?:[?#]|$)/i.test(String(url || '')) || /front-artwork/i.test(String(url || ''));

  function fallbackFor(name){
    const clean = cleanName(name);
    const match = TRANSPARENT_FALLBACKS.find(([pattern]) => pattern.test(clean));
    return match ? match[1] : '';
  }

  function galleryMedia(product, liveProduct){
    const canonicalName = cleanName(liveProduct?.name || product?.name || product?.title);
    const fallback = fallbackFor(canonicalName);
    const live = Array.isArray(liveProduct?.mockups) ? liveProduct.mockups : [];
    const catalog = Array.isArray(product?.mockups) ? product.mockups : [];
    const candidates = [
      ...(fallback ? [{ label: 'Front artwork', image: fallback }] : []),
      ...live,
      ...catalog
    ];

    const seen = new Set();
    return candidates
      .map((item, index) => ({
        label: String(item?.label || (index === 0 ? 'Front artwork' : `View ${index + 1}`)),
        image: imageUrl(item),
        transparent: isTransparentAsset(imageUrl(item)),
        index
      }))
      .filter(item => {
        if(!item.image || seen.has(item.image)) return false;
        seen.add(item.image);
        return true;
      })
      .sort((a, b) => Number(b.transparent) - Number(a.transparent) || a.index - b.index)
      .map(({ label, image }) => ({ label, image }));
  }

  function mergeCatalog(catalogPayload, pricePayload){
    const catalogProducts = Array.isArray(catalogPayload)
      ? catalogPayload
      : (Array.isArray(catalogPayload?.products) ? catalogPayload.products : []);
    const liveProducts = Array.isArray(pricePayload?.products) ? pricePayload.products : [];
    const byId = new Map(liveProducts.map(item => [String(item?.id || ''), item]));
    const byTitle = new Map(liveProducts.map(item => [titleKey(item?.name), item]));
    const bySku = new Map();

    liveProducts.forEach(item => {
      (Array.isArray(item?.variants) ? item.variants : []).forEach(variant => {
        const sku = variantSku(variant);
        if(sku && !bySku.has(sku)) bySku.set(sku, item);
      });
    });

    const liveFor = product => {
      const id = String(product?.id || product?.source_product_id || '');
      const name = cleanName(product?.name || product?.title);
      const exact = byId.get(id) || byTitle.get(titleKey(name));
      if(exact) return exact;

      const variants = Array.isArray(product?.variants) ? product.variants : [];
      for(const variant of variants){
        const sku = variantSku(variant);
        if(sku && bySku.has(sku)) return bySku.get(sku);
      }
      return null;
    };

    const merged = catalogProducts.map(product => {
      const id = String(product?.id || product?.source_product_id || '');
      const live = liveFor(product);
      const media = galleryMedia(product, live);
      const next = {
        ...product,
        mockups: media,
        image: media[0]?.image || product?.image || ''
      };

      if(live){
        next.id = String(live.id || id);
        next.name = String(live.name || product?.name || product?.title || '');
        next.price = Number(live.price || product?.price || 0);
        next.priceMax = Number(live.priceMax || live.price || product?.priceMax || product?.price || 0);
        next.variants = Array.isArray(live.variants) ? live.variants : (Array.isArray(product?.variants) ? product.variants : []);
        next.updatedAt = live.updatedAt || product?.updatedAt || null;
        next.priceAuthority = 'shopify-storefront';
      }
      return next;
    });

    if(Array.isArray(catalogPayload)) return merged;
    return {
      ...(catalogPayload || {}),
      priceAuthority: liveProducts.length ? 'shopify-storefront' : (catalogPayload?.priceAuthority || null),
      products: merged
    };
  }

  async function loadPriceAuthority(){
    try {
      const response = await nativeFetch(PRICE_URL, {
        cache: 'no-store',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if(!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function isCatalogRequest(input){
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if(!raw) return false;
      const url = new URL(raw, window.location.href);
      return /\/functions\/v1\/shop-catalog\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  window.fetch = async (input, init) => {
    if(!isCatalogRequest(input)) return nativeFetch(input, init);

    const catalogPromise = nativeFetch(input, init);
    const pricePromise = loadPriceAuthority();
    const [catalogResponse, pricePayload] = await Promise.all([catalogPromise, pricePromise]);
    if(!catalogResponse.ok) return catalogResponse;

    try {
      const catalogPayload = await catalogResponse.clone().json();
      const merged = mergeCatalog(catalogPayload, pricePayload);
      const headers = new Headers(catalogResponse.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Cache-Control', 'private, no-store, max-age=0');
      headers.set('X-Kalenel-Price-Authority', pricePayload?.products?.length ? 'shopify-storefront' : 'catalog-fallback');
      return new Response(JSON.stringify(merged), {
        status: catalogResponse.status,
        statusText: catalogResponse.statusText,
        headers
      });
    } catch {
      return catalogResponse;
    }
  };

  const style = document.createElement('style');
  style.dataset.shopListingsV819 = 'true';
  style.textContent = `
    .mockup-rail {
      grid-auto-columns: 100% !important;
      gap: 0 !important;
      padding: 12px !important;
      background: #ded6ca !important;
    }
    .mockup {
      background: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
    }
    .mockup img {
      width: 100% !important;
      aspect-ratio: 1 / 1 !important;
      object-fit: contain !important;
      object-position: center !important;
      padding: 8px !important;
      background: transparent !important;
    }
    .product-card:has(.mockup:only-child) .gallery-controls {
      display: none !important;
    }
    .cart-line img {
      object-fit: contain !important;
      background: #ded6ca !important;
      border-radius: 12px;
    }
    .collection-image,
    .compact-shape-card img {
      background: #ded6ca !important;
    }
    .collection-image .collection-merch-image,
    .compact-shape-card .collection-merch-image {
      background: transparent !important;
      object-fit: contain !important;
    }
  `;
  document.head.appendChild(style);
})();
