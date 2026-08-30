(() => {
  const PRODUCT_PREVIEWS = {
    '6a877906eb76ae387b05cc0f': 'assets/product-previews/hydrangea-front-v5.webp',
    '6a877d2aeb76ae387b05cfae': 'assets/product-previews/axolotl-front-v5.webp',
    '6a8781c676f52ce62f082d19': 'assets/product-previews/mantis-front-v5.webp',
    '6a877defbecced59b0037078': 'assets/product-previews/queen-annes-lace-front-v5.webp',
    '6a8769e26a41fe0f530b538f': 'assets/product-previews/thistle-front-v5.webp',
    '6a878552828b6188a0031a81': 'assets/product-previews/jellyfish-front-v7.webp',
    '6a871b6035cea7fe2c005ee6': 'assets/product-previews/dragonfly-front-v5.webp'
  };
  const DRAGONFLY_PRODUCT_ID = '6a871b6035cea7fe2c005ee6';

  const catalog = window.BRUIS_CATALOG;
  const products = Array.isArray(catalog) ? catalog : catalog?.products;
  if (!Array.isArray(products)) return;

  products.forEach(product => {
    const id = String(product?.id || '');
    if (id === DRAGONFLY_PRODUCT_ID) {
      product.name = 'Dragonfly Illustration T-Shirt';
      product.collection = 'boxy';
    }

    const image = PRODUCT_PREVIEWS[id];
    if (!image) return;
    const existing = Array.isArray(product.mockups) ? product.mockups.filter(Boolean) : [];
    product.mockups = [
      { label: 'Front print', image },
      ...existing.filter(mockup => mockup?.image !== image)
    ];
  });

  const style = document.createElement('style');
  style.dataset.shopFrontArtworkZoom = 'true';
  style.textContent = `
    .mockup-rail {
      grid-auto-columns: 100% !important;
      gap: 0 !important;
      padding: 8px !important;
    }
    .mockup-rail .mock-front-print {
      background: transparent !important;
      border-color: transparent !important;
      overflow: hidden !important;
      min-height: 0;
    }
    .mockup-rail .mock-front-print img {
      width: 100% !important;
      height: 100% !important;
      aspect-ratio: 1 / 1 !important;
      padding: 0 !important;
      background: transparent !important;
      object-fit: contain !important;
      object-position: center !important;
      transform: none !important;
    }
  `;
  document.head.appendChild(style);
})();
