(() => {
  const PRODUCT_PREVIEWS = {
    '6a877906eb76ae387b05cc0f': 'assets/product-previews/hydrangea-front.webp',
    '6a877d2aeb76ae387b05cfae': 'assets/product-previews/axolotl-front.webp',
    '6a8781c676f52ce62f082d19': 'assets/product-previews/mantis-front.webp',
    '6a877defbecced59b0037078': 'assets/product-previews/queen-annes-lace-front.webp',
    '6a8769e26a41fe0f530b538f': 'assets/product-previews/thistle-front.webp',
    '6a878552828b6188a0031a81': 'assets/product-previews/jellyfish-front.webp',
    '6a871b6035cea7fe2c005ee6': 'assets/product-previews/weevil-front.webp'
  };

  const catalog = window.BRUIS_CATALOG;
  const products = Array.isArray(catalog) ? catalog : catalog?.products;
  if (!Array.isArray(products)) return;

  products.forEach(product => {
    const image = PRODUCT_PREVIEWS[String(product?.id || '')];
    if (!image) return;
    const existing = Array.isArray(product.mockups) ? product.mockups.filter(Boolean) : [];
    product.mockups = [
      { label: 'Front print', image },
      ...existing.filter(mockup => mockup?.image !== image)
    ];
  });
})();
