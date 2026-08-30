(() => {
  const PRODUCT_PREVIEWS = {
    '6a877906eb76ae387b05cc0f': 'assets/product-previews/hydrangea-front.webp',
    '6a877d2aeb76ae387b05cfae': 'assets/product-previews/axolotl-front.webp',
    '6a8781c676f52ce62f082d19': 'assets/product-previews/mantis-front.webp',
    '6a877defbecced59b0037078': 'assets/product-previews/queen-annes-lace-front.webp',
    '6a8769e26a41fe0f530b538f': 'assets/product-previews/thistle-front.webp',
    '6a878552828b6188a0031a81': 'assets/product-previews/jellyfish-front.webp',
    '6a871b6035cea7fe2c005ee6': 'assets/product-previews/dragonfly-front-v2.webp'
  };
  const DRAGONFLY_PRODUCT_ID = '6a871b6035cea7fe2c005ee6';

  const catalog = window.BRUIS_CATALOG;
  const products = Array.isArray(catalog) ? catalog : catalog?.products;
  if (!Array.isArray(products)) return;

  products.forEach(product => {
    const id = String(product?.id || '');
    if (id === DRAGONFLY_PRODUCT_ID) {
      product.name = 'Dragonfly Illustration T-Shirt';
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
      background: #fff !important;
      overflow: hidden !important;
      min-height: 0;
    }
    .mockup-rail .mock-front-print img {
      width: 100% !important;
      height: 100% !important;
      aspect-ratio: 1 / 1 !important;
      padding: 0 !important;
      object-fit: contain !important;
      object-position: center !important;
      transform: scale(3.55);
      transform-origin: center;
    }
    /* Dragonfly already fills most of its A3 canvas; use a smaller zoom so
       the complete insect stays visible while still filling the first slide. */
    .mockup-rail .mock-front-print img[src*="dragonfly-front-v2.webp"] {
      transform: scale(1.30);
    }
    @media (max-width: 620px) {
      .mockup-rail .mock-front-print img { transform: scale(3.25); }
      .mockup-rail .mock-front-print img[src*="dragonfly-front-v2.webp"] { transform: scale(1.26); }
    }
  `;
  document.head.appendChild(style);
})();
