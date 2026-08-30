(() => {
  const DRAGONFLY_PRODUCT_ID = '6a871b6035cea7fe2c005ee6';

  const catalog = window.BRUIS_CATALOG;
  const products = Array.isArray(catalog) ? catalog : catalog?.products;
  if (!Array.isArray(products)) return;

  const highRes = image => {
    const value = String(image || '');
    if (!value) return value;
    if (/([?&])s=\d+/.test(value)) return value.replace(/([?&])s=\d+/, '$1s=1200');
    return `${value}${value.includes('?') ? '&' : '?'}s=1200`;
  };

  const frontRank = mockup => {
    const label = String(mockup?.label || '').trim().toLowerCase();
    if (label === 'front') return 0;
    if (label === 'alternate front') return 1;
    if (label.includes('front') && !label.includes('back') && !label.includes('collar') && !label.includes('body')) return 2;
    if (label.includes('front') && !label.includes('back') && !label.includes('collar')) return 3;
    return 99;
  };

  products.forEach(product => {
    const id = String(product?.id || '');
    const existing = Array.isArray(product.mockups) ? product.mockups.filter(mockup => mockup?.image) : [];
    if (!existing.length) return;

    if (id === DRAGONFLY_PRODUCT_ID) {
      product.name = 'Dragonfly Illustration T-Shirt';
    }

    const ranked = existing
      .map((mockup, index) => ({ mockup, index, rank: frontRank(mockup) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    const heroIndex = ranked[0]?.rank < 99 ? ranked[0].index : 0;
    const hero = existing[heroIndex];

    product.mockups = [
      { ...hero, label: 'Front', image: highRes(hero.image) },
      ...existing.filter((_, index) => index !== heroIndex)
    ];
  });

  const style = document.createElement('style');
  style.dataset.shopFrontHero = 'true';
  style.textContent = `
    .mockup-rail {
      grid-auto-columns: 100% !important;
      gap: 0 !important;
      padding: 10px !important;
    }
    .mockup-rail .mockup:first-child {
      background: #fff !important;
    }
    .mockup-rail .mockup:first-child img {
      padding: 0 !important;
      object-fit: cover !important;
      object-position: 50% 48% !important;
      transform: scale(1.26);
      transform-origin: 50% 48%;
    }
    @media (max-width: 620px) {
      .mockup-rail { grid-auto-columns: 100% !important; }
      .mockup-rail .mockup:first-child img { transform: scale(1.22); }
    }
  `;
  document.head.appendChild(style);
})();
