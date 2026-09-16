(() => {
  'use strict';
  const COLORS = Object.freeze(['Black', 'White']);
  const selected = new Map();
  const isTote = product => /\btote\b/i.test(String(product?.name || product?.title || product?.baseLabel || ''));
  const optionValue = (variant, name) => String((Array.isArray(variant?.options) ? variant.options : [])
    .find(option => String(option?.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase())?.value || '').trim();
  const colorOf = variant => String(variant?.handleColor || variant?.color || optionValue(variant, 'color') || '').trim();
  const allowed = value => COLORS.find(color => color.toLowerCase() === String(value || '').trim().toLowerCase()) || '';

  function viewsFor(product, color){
    const variant = (Array.isArray(product?.variants) ? product.variants : []).find(item => colorOf(item) === color);
    const variantId = String(variant?.id || '');
    const all = Array.isArray(product?.allMockups) ? product.allMockups : (Array.isArray(product?.mockups) ? product.mockups : []);
    if(!variantId) return all;
    const exact = all.filter(view => Array.isArray(view?.variantIds) && view.variantIds.map(String).includes(variantId));
    return exact.length ? exact : all;
  }

  function applyMedia(product, color){
    const views = viewsFor(product, color);
    product.mockups = views;
    product.image = views[0]?.image || product.image || '';
  }

  if(typeof normalizeProduct === 'function'){
    const previousNormalize = normalizeProduct;
    normalizeProduct = raw => {
      const product = previousNormalize(raw);
      if(!isTote(product)) return product;
      product.selectorType = 'handle-color';
      product.allMockups = Array.isArray(product.mockups) ? product.mockups.map(view => ({...view})) : [];
      product.variants = (Array.isArray(product.variants) ? product.variants : [])
        .filter(variant => !!allowed(colorOf(variant)))
        .map(variant => {
          const color = allowed(colorOf(variant));
          const physicalSize = String(variant?.size || optionValue(variant, 'size') || '').trim();
          const options = (Array.isArray(variant?.options) ? variant.options : []).map(option =>
            String(option?.name || '').trim().toLowerCase() === 'size'
              ? {...option, value: color}
              : {...option}
          );
          return {...variant, physicalSize, handleColor: color, size: color, options};
        });
      const colors = COLORS.filter(color => product.variants.some(variant => colorOf(variant) === color));
      product.colors = colors;
      product.sizes = colors;
      const current = allowed(selected.get(String(product.id))) || colors[0] || 'Black';
      selected.set(String(product.id), current);
      applyMedia(product, current);
      return product;
    };
  }

  if(typeof renderProducts === 'function'){
    const previousRender = renderProducts;
    renderProducts = function(){
      if(Array.isArray(products)){
        products.filter(isTote).forEach(product => {
          const id = String(product.id);
          const current = allowed(selected.get(id)) || product.sizes?.[0] || 'Black';
          selected.set(id, current);
          applyMedia(product, current);
        });
      }
      previousRender();
      if(!Array.isArray(products)) return;
      products.filter(isTote).forEach(product => {
        const id = String(product.id);
        const select = document.querySelector(`[data-size="${CSS.escape(id)}"]`);
        if(!select) return;
        select.value = allowed(selected.get(id)) || product.sizes?.[0] || 'Black';
        select.dataset.handleColor = 'true';
        const label = select.closest('label');
        if(label && label.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = 'Handle color\n            ';
      });
    };
  }

  document.addEventListener('change', event => {
    const select = event.target.closest?.('select[data-size][data-handle-color="true"]');
    if(!select) return;
    const id = String(select.dataset.size || '');
    const product = Array.isArray(products) ? products.find(item => String(item.id) === id) : null;
    const color = allowed(select.value);
    if(!product || !isTote(product) || !color) return;
    selected.set(id, color);
    applyMedia(product, color);
    renderProducts();
  });

  window.BRUIS_TOTE_HANDLE_COLOR_V838 = Object.freeze({
    release: 'v838',
    selectorLabel: 'Handle color',
    colors: COLORS,
    variantBoundMockups: true,
    exactVariantSelection: true
  });
})();
