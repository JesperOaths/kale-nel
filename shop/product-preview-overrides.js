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

  function decorate(product){
    if(!product || typeof product !== 'object') return product;
    const id = String(product.id || '');
    const artwork = PRODUCT_PREVIEWS[id];
    if(!artwork) return product;

    const current = Array.isArray(product.mockups) ? product.mockups.filter(item => item?.image) : [];
    const views = current.filter(item => String(item.image) !== artwork && !/^artwork detail$/i.test(String(item.label || '')));
    const artworkView = { label: 'Artwork detail', image: artwork };

    if(views.length){
      product.mockups = [views[0], artworkView, ...views.slice(1)];
      product.image = views[0].image;
    } else {
      product.mockups = [artworkView];
      product.image ||= artwork;
    }
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

  window.BRUIS_PRODUCT_PREVIEWS_V831 = Object.freeze({
    count: Object.keys(PRODUCT_PREVIEWS).length,
    placement: 'after-primary-garment',
    preservesGarmentPrimaryImage: true
  });
})();
