(() => {
  'use strict';

  const ARTWORK_ONLY_RE = /(?:front\s*(?:artwork|print)|standalone\s*(?:artwork|print)|artwork\s*only|print\s*only)/i;
  const wholeEuro = value => Math.ceil(Math.max(0, Number(value || 0)) - 1e-9);

  function sanitizeProduct(product){
    if(!product || typeof product !== 'object') return product;
    product.price = wholeEuro(product.price);
    product.priceMax = wholeEuro(product.priceMax || product.price);
    if(Array.isArray(product.variants)){
      product.variants = product.variants.map(variant => ({
        ...variant,
        price: wholeEuro(variant?.price)
      }));
    }

    const original = Array.isArray(product.mockups) ? product.mockups.filter(item => item?.image) : [];
    const garmentViews = original.filter(item => {
      const label = String(item?.label || '');
      const image = String(item?.image || '');
      return !ARTWORK_ONLY_RE.test(label) && !/(?:^|[-_/])front-artwork(?:[-_.?/]|$)/i.test(image);
    });
    if(garmentViews.length){
      product.mockups = garmentViews;
      product.image = garmentViews[0].image;
    }
    return product;
  }

  // Apply the rule to every present and future catalog normalization pass. This
  // deliberately sits after legacy preview decorators so artwork-only previews
  // can never displace the actual garment as the product image.
  if(typeof normalizeProduct === 'function'){
    const previousNormalizeProduct = normalizeProduct;
    normalizeProduct = raw => sanitizeProduct(previousNormalizeProduct(raw));
  }

  function normalizeCurrentState(){
    try{
      if(typeof products !== 'undefined' && Array.isArray(products) && products.length){
        products = products.map(sanitizeProduct);
        if(typeof updateCollectionCounts === 'function') updateCollectionCounts();
        if(typeof renderProducts === 'function') renderProducts();
      }
    } catch {}

    try{
      if(typeof cart !== 'undefined' && Array.isArray(cart)){
        let changed = false;
        cart = cart.map(item => {
          const next = wholeEuro(item?.price);
          if(next !== Number(item?.price || 0)) changed = true;
          return { ...item, price: next };
        });
        if(changed && typeof saveCart === 'function') saveCart();
        if(typeof renderCart === 'function') renderCart();
      }
    } catch {}
  }

  function setText(node, value){
    if(node && node.textContent !== value) node.textContent = value;
  }

  function polishCheckout(root = document){
    const overlay = root.matches?.('[data-manual-checkout-overlay]')
      ? root
      : root.querySelector?.('[data-manual-checkout-overlay]') || document.querySelector('[data-manual-checkout-overlay]');
    if(!overlay) return;

    setText(overlay.querySelector('.manual-checkout-head p'), 'Enter your delivery details, then review shipping and payment before placing your order.');

    const note = overlay.querySelector('.manual-checkout-note');
    if(note){
      setText(note, 'Shipping is calculated from your delivery address. Your payment amount and order reference are shown on the next step.');
    }

    overlay.querySelectorAll('.manual-checkout-summary > div').forEach(row => {
      const label = row.querySelector('span')?.textContent?.trim();
      const value = row.querySelector('strong');
      if(label === 'Shipping' && /^Calculated securely/i.test(value?.textContent || '')){
        setText(value, 'Calculated at checkout');
      }
      if(label === 'Products' && value){
        const match = value.textContent.trim().match(/^€(\d+)\.00$/);
        if(match) setText(value, `€${match[1]}`);
      }
    });

    overlay.querySelectorAll('button').forEach(button => {
      if(button.textContent.trim() === 'Create pending order') setText(button, 'Continue to payment');
    });

    const success = overlay.querySelector('.manual-checkout-success');
    if(success){
      const heading = success.querySelector('h3');
      if(heading && /Order saved as Pending/i.test(heading.textContent)) setText(heading, 'Order received');

      success.querySelectorAll(':scope > p').forEach(p => {
        const text = p.textContent.trim();
        if(/will not be sent to production until|transfer has been manually verified/i.test(text)){
          setText(p, 'We’ve received your order. Production begins once payment has been confirmed.');
        } else if(/confirmation email has been sent|confirmation email could not be confirmed/i.test(text)){
          p.hidden = true;
        } else if(/second email will be sent automatically|tracking confirms that the clothes are on the way/i.test(text)){
          setText(p, 'We’ll email you when your order ships.');
        }
      });
    }

    const state = overlay.querySelector('[data-manual-order-state]');
    if(state){
      const current = state.textContent.trim();
      if(/^Status:\s*Pending(?:\s*[—-].*)?$/i.test(current)) setText(state, 'Status: Awaiting payment');
    }
  }

  normalizeCurrentState();
  polishCheckout(document);

  const observer = new MutationObserver(records => {
    let shouldPolish = false;
    for(const record of records){
      if(record.type === 'characterData') { shouldPolish = true; break; }
      if(record.addedNodes?.length) { shouldPolish = true; break; }
    }
    if(shouldPolish) requestAnimationFrame(() => polishCheckout(document));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pageshow', normalizeCurrentState, { once: true });
  window.BRUIS_STOREFRONT_V830 = Object.freeze({
    wholeEuroPricing: true,
    garmentFirstGallery: true,
    customerCopyPolish: true
  });
})();
