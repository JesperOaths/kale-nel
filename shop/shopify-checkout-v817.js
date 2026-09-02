(() => {
  'use strict';

  const SHOPIFY_DOMAIN = 'n75mh8-bu.myshopify.com';
  const FRONT_PRINT_PREVIEWS = [
    [/^coral$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/coral-front-artwork.png?v=1788359906'],
    [/^orchid$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/orchid-front-artwork.png?v=1788359884'],
    [/^honeysuckle$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/honeysuckle-front-artwork.png?v=1788359866'],
    [/^horseshoe crab$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/horseshoe-crab-front-artwork.png?v=1788359876'],
    [/^lily$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/lily-front-artwork.png?v=1788359898'],
    [/^magnolia$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/magnolia-front-artwork.png?v=1788359890'],
    [/^monstera$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/monstera-front-artwork.png?v=1788359921'],
    [/^daffodil$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/daffodil-front-artwork.png?v=1788359914'],
    [/^seahorse$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seahorse-front-artwork.png?v=1788359936'],
    [/^seaweed$/i, 'https://cdn.shopify.com/s/files/1/1110/0209/1869/files/seaweed-front-artwork.png?v=1788359928'],
    [/hydrangea/i, 'assets/product-previews/hydrangea-front-v5.webp'],
    [/axolotl/i, 'assets/product-previews/axolotl-front-v5.webp'],
    [/mantis/i, 'assets/product-previews/mantis-front-v5.webp'],
    [/thistle/i, 'assets/product-previews/thistle-front-v5.webp'],
    [/jellyfish/i, 'assets/product-previews/jellyfish-front-v7.webp'],
    [/dragonfly/i, 'assets/product-previews/dragonfly-front-v5.webp'],
    [/queen anne/i, 'assets/product-previews/queen-annes-lace-front-v5.webp']
  ];

  const exactMoney = value => `€${Number(value || 0).toFixed(2)}`;
  const numericVariantId = value => {
    const raw = String(value || '').trim();
    const last = raw.includes('/') ? raw.split('/').pop() : raw;
    return /^\d+$/.test(last) ? last : '';
  };
  const optionValue = (variant, optionName) => {
    const target = String(optionName || '').toLowerCase();
    const options = Array.isArray(variant?.options) ? variant.options : [];
    return String(options.find(option => String(option?.name || '').toLowerCase() === target)?.value || '');
  };
  const variantSize = variant => {
    const explicit = optionValue(variant, 'size');
    if(explicit) return explicit;
    return String(variant?.title || '').split('/').map(part => part.trim()).find(part => /^(?:xs|s|m|l|xl|[2-9]xl)$/i.test(part)) || '';
  };
  const variantPrice = variant => Number(variant?.price || 0);
  const variantAvailable = variant => variant?.is_enabled !== false && variant?.is_available !== false;
  const frontPreviewFor = name => FRONT_PRINT_PREVIEWS.find(([pattern]) => pattern.test(String(name || '')))?.[1] || '';
  const escLocal = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  // Wrap the existing catalog normalization before the async live catalog request resolves.
  // This keeps the exact Shopify/Printify-published variant prices and inserts the known
  // transparent high-detail front artwork as slide 1 on live Shopify products too.
  if(typeof normalizeProduct === 'function'){
    const normalizeProductV815 = normalizeProduct;
    normalizeProduct = raw => {
      const product = normalizeProductV815(raw);
      const rawVariants = Array.isArray(raw?.variants) ? raw.variants : [];
      const prices = rawVariants.map(variantPrice).filter(price => Number.isFinite(price) && price > 0);
      if(prices.length){
        product.price = Math.min(...prices);
        product.priceMax = Math.max(...prices);
      } else {
        product.price = Number(raw?.price || product.price || 0);
        product.priceMax = Number(raw?.priceMax || raw?.price || product.priceMax || product.price || 0);
      }

      const preview = frontPreviewFor(product.name);
      if(preview){
        const existing = Array.isArray(product.mockups) ? product.mockups.filter(Boolean) : [];
        product.mockups = [
          { label: 'Front artwork', image: preview },
          ...existing.filter(mockup => mockup?.image !== preview)
        ];
        product.image = preview;
      }
      return product;
    };
  }

  const productForId = id => products.find(product => String(product.id) === String(id));
  const variantForSize = (product, size) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    return variants.find(variant => variantAvailable(variant) && variantSize(variant) === size)
      || variants.find(variant => variantAvailable(variant) && String(variant?.title || '').toLowerCase().includes(String(size || '').toLowerCase()))
      || variants.find(variant => variantAvailable(variant));
  };

  const reconcileCartWithShopify = () => {
    if(!Array.isArray(products) || !products.length || !Array.isArray(cart)) return;
    cart = cart.map(item => {
      const product = productForId(item.productId || item.id);
      if(!product) return null;
      const size = String(item.size || product.sizes?.[0] || 'S');
      const variant = variantForSize(product, size);
      const variantId = numericVariantId(variant?.id || item.variantId);
      if(!variantId) return null;
      return {
        productId: String(product.id),
        variantId,
        name: product.name,
        price: variantPrice(variant) || Number(product.price || 0),
        size: variantSize(variant) || size,
        qty: Math.max(1, Math.min(10, Number(item.qty || 1))),
        image: product.image || product.mockups?.[0]?.image || '',
        collection: product.collection
      };
    }).filter(Boolean);
    saveCart();
  };

  const checkoutUrl = () => {
    if(!Array.isArray(cart) || !cart.length) return '';
    const lines = cart.map(item => {
      const id = numericVariantId(item.variantId);
      const qty = Math.max(1, Math.min(10, Number(item.qty || 1)));
      return id ? `${id}:${qty}` : '';
    });
    if(lines.some(line => !line)) return '';
    return `https://${SHOPIFY_DOMAIN}/cart/${lines.join(',')}?ref=kalenel`;
  };

  // Replace the email-request cart renderer with a Shopify-backed cart summary.
  if(typeof renderCart === 'function'){
    renderCart = () => {
      qsa('[data-cart-count]').forEach(el => el.textContent = cartCount());
      const subtotal = qs('[data-cart-subtotal]');
      if(subtotal) subtotal.textContent = exactMoney(cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0));

      const items = qs('[data-cart-items]');
      if(items){
        if(!cart.length){
          items.innerHTML = '<p class="empty-cart">Your cart is empty.</p>';
        } else {
          items.innerHTML = cart.map((item, index) => `
            <article class="cart-line">
              <img src="${escLocal(item.image)}" alt="${escLocal(item.name)}" />
              <div>
                <strong>${escLocal(item.name)}</strong>
                <span>${escLocal(item.size)} · ${item.qty} × ${exactMoney(item.price)}</span>
                <button type="button" data-remove="${index}">Remove</button>
              </div>
            </article>`).join('');
        }
      }

      const checkout = qs('[data-checkout]');
      if(checkout){
        const url = checkoutUrl();
        checkout.disabled = !url;
        checkout.dataset.checkoutUrl = url;
      }
    };
  }

  // Exact selected-size price on every card. The existing store uses rounded whole euros;
  // the live variant prices are retained in product.variants, so this corrects the display.
  const syncProductCards = () => {
    qsa('[data-size]').forEach(select => {
      if(select.dataset.shopifyPriceBound === 'true') return;
      select.dataset.shopifyPriceBound = 'true';
      const product = productForId(select.dataset.size);
      if(!product) return;

      const sync = () => {
        const variant = variantForSize(product, select.value);
        const value = variantPrice(variant) || Number(product.price || 0);
        const card = select.closest('.product-card');
        const price = card?.querySelector('.price');
        if(price) price.textContent = exactMoney(value);
      };
      sync();
      select.addEventListener('change', sync);
    });
  };

  const productsRoot = qs('[data-products]');
  if(productsRoot){
    new MutationObserver(() => syncProductCards()).observe(productsRoot, { childList: true, subtree: true });
  }

  // Capture add-to-cart before the v815 bubble handler so the exact Shopify variant ID and
  // exact variant price are stored. Shopify's permalink then owns shipping, tax and payment.
  document.addEventListener('click', event => {
    const checkout = event.target.closest('[data-checkout]');
    if(checkout){
      event.preventDefault();
      event.stopImmediatePropagation();
      reconcileCartWithShopify();
      renderCart();
      const url = checkoutUrl();
      if(url) window.location.assign(url);
      return;
    }

    const add = event.target.closest('[data-add]');
    if(!add) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const product = productForId(add.dataset.add);
    if(!product) return;
    const select = qs(`[data-size="${CSS.escape(String(product.id))}"]`);
    const size = select?.value || product.sizes?.[0] || 'S';
    const variant = variantForSize(product, size);
    const variantId = numericVariantId(variant?.id);
    if(!variantId) return;
    const qtyInput = qs(`[data-qty="${CSS.escape(String(product.id))}"]`);
    const qty = Math.max(1, Math.min(9, Number(qtyInput?.value || 1)));
    const price = variantPrice(variant) || Number(product.price || 0);
    const existing = cart.find(item => String(item.variantId || '') === variantId);

    if(existing){
      existing.qty = Math.min(10, Number(existing.qty || 0) + qty);
      existing.price = price;
    } else {
      cart.push({
        productId: String(product.id),
        variantId,
        name: product.name,
        price,
        size: variantSize(variant) || size,
        qty,
        image: product.image || product.mockups?.[0]?.image || '',
        collection: product.collection
      });
    }

    saveCart();
    renderCart();
    openCart();
  }, true);

  // The catalog promise in store.js resolves after this deferred script has loaded, so the
  // overridden renderCart is used there. This observer additionally migrates any old cart
  // entries once product cards appear and keeps size prices exact.
  if(productsRoot){
    new MutationObserver(() => {
      if(products.length){
        reconcileCartWithShopify();
        renderCart();
        syncProductCards();
      }
    }).observe(productsRoot, { childList: true });
  }
})();
