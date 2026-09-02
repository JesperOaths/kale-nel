(() => {
  'use strict';

  if(typeof normalizeProduct !== 'function') return;
  const previousNormalizeProduct = normalizeProduct;
  const preview = 'assets/product-previews/queen-annes-lace-front-v5.webp';

  normalizeProduct = raw => {
    const product = previousNormalizeProduct(raw);
    if(!/(?:wild carrot|queen anne)/i.test(String(product?.name || ''))) return product;

    const existing = Array.isArray(product.mockups) ? product.mockups.filter(Boolean) : [];
    product.mockups = [
      { label: 'Front print', image: preview },
      ...existing.filter(mockup => mockup?.image !== preview)
    ];
    product.image = preview;
    return product;
  };
})();
