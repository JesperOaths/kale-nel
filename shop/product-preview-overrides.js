(() => {
  'use strict';

  const PRODUCT_PREVIEWS = {
    '6a877906eb76ae387b05cc0f': 'assets/product-previews/hydrangea-front-v5.webp',
    '6a877d2aeb76ae387b05cfae': 'assets/product-previews/axolotl-front-v5.webp',
    '6a8781c676f52ce62f082d19': 'assets/product-previews/mantis-front-v5.webp',
    '6a877defbecced59b0037078': 'assets/product-previews/queen-annes-lace-front-v5.webp',
    '6a8769e26a41fe0f530b538f': 'assets/product-previews/thistle-front-v5.webp',
    '6a871b6035cea7fe2c005ee6': 'assets/product-previews/dragonfly-front-v5.webp'
  };

  const isArtwork = item => /artwork|print file|design png/i.test(String(item?.label || ''));

  function decorate(product){
    if(!product || typeof product !== 'object') return product;
    const current = Array.isArray(product.mockups) ? product.mockups.filter(item => item?.image) : [];

    // v832 catalog exposes the actual transparent artwork upload from Printify.
    // Always keep that real PNG first when available.
    const serverArtwork = current.find(isArtwork);
    if(serverArtwork){
      const rest = current.filter(item => item !== serverArtwork && String(item.image) !== String(serverArtwork.image));
      product.mockups = [serverArtwork, ...rest];
      product.image = serverArtwork.image;
      return product;
    }

    // Temporary fallback for older cached catalog responses while the v832 edge
    // catalog refreshes. These local previews must also be first, never second.
    const id = String(product.id || '');
    const artwork = PRODUCT_PREVIEWS[id];
    if(!artwork) return product;
    const rest = current.filter(item => String(item.image) !== artwork && !isArtwork(item));
    const artworkView = { label: 'Artwork fallback', image: artwork };
    product.mockups = [artworkView, ...rest];
    product.image = artwork;
    return product;
  }

  if(window.BRUIS_CATALOG){
    const rows = Array.isArray(window.BRUIS_CATALOG) ? window.BRUIS_CATALOG : window.BRUIS_CATALOG.products;
    if(Array.isArray(rows)) rows.forEach(decorate);
  }

  if(typeof normalizeProduct === 'function'){
    const previousNormalizeProduct = normalizeProduct;
    normalizeProduct = raw => decorate(previousNormalizeProduct(raw));
  }

  window.BRUIS_PRODUCT_PREVIEWS_V832 = Object.freeze({
    fallbackCount: Object.keys(PRODUCT_PREVIEWS).length,
    placement: 'first',
    prefersOriginalArtworkPng: true,
    primaryImageIsArtwork: true
  });
})();
