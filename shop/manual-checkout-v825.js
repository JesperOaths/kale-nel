(() => {
  'use strict';

  const CHECKOUT_ENDPOINT = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v825';
  const STATUS_ENDPOINT = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825';
  const SESSION_ORDER_KEY = 'bruisPendingOrderV825';
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

  const escLocal = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const exactMoney = value => `€${Number(value || 0).toFixed(2)}`;
  const centsMoney = value => `€${(Number(value || 0) / 100).toFixed(2)}`;
  const INTERNAL_FULFILLMENT_PROVIDER = ['pri','ntify'].join('');
  const customerSafeMessage = value => String(value ?? '').replace(new RegExp(INTERNAL_FULFILLMENT_PROVIDER, 'gi'), 'production service');
  const optionValue = (variant, optionName) => {
    const target = String(optionName || '').toLowerCase();
    const options = Array.isArray(variant?.options) ? variant.options : [];
    return String(options.find(option => String(option?.name || '').toLowerCase() === target)?.value || '');
  };
  const variantSize = variant => {
    const explicit = optionValue(variant, 'size');
    if(explicit) return explicit;
    return String(variant?.title || '').split('/').map(part => part.trim())
      .find(part => /^(?:xs|s|m|l|xl|[2-9]xl)$/i.test(part)) || '';
  };
  const variantPrice = variant => Number(variant?.price || 0);
  const variantAvailable = variant => variant?.is_enabled !== false && variant?.is_available !== false;
  const frontPreviewFor = name => FRONT_PRINT_PREVIEWS.find(([pattern]) => pattern.test(String(name || '')))?.[1] || '';
  const randomToken = bytes => {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    let binary = '';
    data.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const apiHeaders = () => {
    const key = (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) || '';
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {})
    };
  };
  const productForId = id => (Array.isArray(products) ? products : []).find(product => String(product.id) === String(id));
  const variantForSize = (product, size) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    return variants.find(variant => variantAvailable(variant) && variantSize(variant) === size)
      || variants.find(variant => variantAvailable(variant) && String(variant?.title || '').toLowerCase().includes(String(size || '').toLowerCase()))
      || variants.find(variant => variantAvailable(variant));
  };
  const safePaymentUrl = (raw, provider) => {
    try {
      const url = new URL(String(raw || ''));
      if(url.protocol !== 'https:') return '';
      const host = url.hostname.toLowerCase();
      if(provider === 'bunq_me' && (host === 'bunq.me' || host.endsWith('.bunq.me'))) return url.toString();
      if(provider === 'tikkie' && (host === 'tikkie.me' || host.endsWith('.tikkie.me'))) return url.toString();
    } catch {}
    return '';
  };

  if(typeof normalizeProduct === 'function'){
    const normalizeProductBeforeV825 = normalizeProduct;
    normalizeProduct = raw => {
      const product = normalizeProductBeforeV825(raw);
      const rawVariants = Array.isArray(raw?.variants) ? raw.variants : [];
      const prices = rawVariants.map(variantPrice).filter(price => Number.isFinite(price) && price > 0);
      if(prices.length){
        product.price = Math.min(...prices);
        product.priceMax = Math.max(...prices);
      }
      const preview = frontPreviewFor(product.name);
      if(preview){
        const existing = Array.isArray(product.mockups) ? product.mockups.filter(Boolean) : [];
        product.mockups = [{ label: 'Front artwork', image: preview }, ...existing.filter(mockup => mockup?.image !== preview)];
        product.image = preview;
      }
      return product;
    };
  }

  const reconcileCart = () => {
    if(!Array.isArray(cart)) return false;
    if(!Array.isArray(products) || !products.length) return cart.length > 0;
    const next = [];
    for(const item of cart){
      const product = productForId(item.productId || item.id);
      if(!product) continue;
      const requestedSize = String(item.size || product.sizes?.[0] || 'S');
      const variant = variantForSize(product, requestedSize);
      if(!variant) continue;
      const price = variantPrice(variant) || Number(product.price || 0);
      next.push({
        productId: String(product.id),
        variantId: String(variant?.id || item.variantId || ''),
        sku: String(variant?.sku || item.sku || '').trim(),
        name: String(product.name || item.name || ''),
        price,
        size: variantSize(variant) || requestedSize,
        qty: Math.max(1, Math.min(10, Number(item.qty || 1))),
        image: product.image || product.mockups?.[0]?.image || item.image || '',
        collection: product.collection || item.collection || ''
      });
    }
    cart = next;
    saveCart();
    return cart.length > 0;
  };

  function injectCheckoutUi(){
    if(document.querySelector('[data-manual-checkout-overlay]')) return;
    const style = document.createElement('style');
    style.textContent = `
      .manual-checkout-overlay{position:fixed;inset:0;z-index:12000;background:rgba(15,15,15,.58);display:none;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto}
      .manual-checkout-overlay.open{display:flex}
      .manual-checkout-dialog{width:min(760px,100%);background:#fff;border-radius:24px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);color:#171717}
      .manual-checkout-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
      .manual-checkout-head h2{margin:0;font-size:28px;letter-spacing:-.03em}
      .manual-checkout-head p{margin:7px 0 0;color:#666;line-height:1.45}
      .manual-checkout-close{border:1px solid #ddd;background:#fff;border-radius:999px;width:40px;height:40px;font-size:20px;cursor:pointer}
      .manual-checkout-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}
      .manual-checkout-grid label{display:grid;gap:6px;font-size:13px;font-weight:700}
      .manual-checkout-grid input{width:100%;border:1px solid #d7d7d7;border-radius:12px;padding:12px;font:inherit}
      .manual-checkout-grid .wide{grid-column:1/-1}
      .manual-checkout-note{margin:18px 0 0;padding:14px 16px;border-radius:14px;background:#f5f3ee;line-height:1.5;font-size:14px}
      .manual-checkout-summary{margin-top:18px;border-top:1px solid #eee;padding-top:16px}
      .manual-checkout-summary div{display:flex;justify-content:space-between;gap:12px;margin:6px 0}
      .manual-checkout-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
      .manual-checkout-primary,.manual-checkout-secondary{border:0;border-radius:12px;padding:13px 18px;font:inherit;font-weight:800;cursor:pointer}
      .manual-checkout-primary{background:#111;color:#fff}.manual-checkout-primary:disabled{opacity:.55;cursor:not-allowed}
      .manual-checkout-secondary{background:#f1f1f1;color:#111}
      .manual-checkout-status{min-height:20px;margin-top:12px;font-size:13px;color:#8a332e}
      .manual-checkout-success{padding:8px 0 0}
      .manual-checkout-success h3{font-size:25px;margin:0 0 8px}
      .manual-checkout-payment{margin:16px 0;padding:16px;border-radius:16px;background:#f5f3ee}
      .manual-checkout-payment .reference{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}
      .manual-checkout-payment a{display:inline-block;margin-top:12px;background:#111;color:#fff;text-decoration:none;padding:12px 16px;border-radius:11px;font-weight:800}
      .manual-checkout-order-state{margin-top:14px;padding:12px 14px;border:1px solid #e7e7e7;border-radius:12px;font-size:14px}
      .manual-checkout-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}
      @media(max-width:640px){.manual-checkout-dialog{padding:18px;border-radius:18px}.manual-checkout-grid{grid-template-columns:1fr}.manual-checkout-grid .wide{grid-column:auto}.manual-checkout-overlay{padding:12px 8px}}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'manual-checkout-overlay';
    overlay.dataset.manualCheckoutOverlay = 'true';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="manual-checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-checkout-title">
        <div class="manual-checkout-head">
          <div>
            <h2 id="manual-checkout-title">Delivery & payment</h2>
            <p>Enter the delivery address. Your order is saved as Pending first; no production starts until the transfer has been manually verified.</p>
          </div>
          <button class="manual-checkout-close" type="button" data-manual-checkout-close aria-label="Close checkout">×</button>
        </div>
        <div data-manual-checkout-body></div>
      </section>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if(event.target === overlay || event.target.closest('[data-manual-checkout-close]')) closeCheckout();
    });
    document.addEventListener('keydown', event => {
      if(event.key === 'Escape' && overlay.classList.contains('open')) closeCheckout();
    });
  }

  const overlay = () => document.querySelector('[data-manual-checkout-overlay]');
  const bodyNode = () => overlay()?.querySelector('[data-manual-checkout-body]');
  function openOverlay(){
    injectCheckoutUi();
    const node = overlay();
    node.classList.add('open');
    node.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeCheckout(){
    const node = overlay();
    if(!node) return;
    node.classList.remove('open');
    node.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  let activeAttempt = null;
  const newAttempt = () => ({
    checkout_idempotency_key: randomToken(24),
    confirmation_token: randomToken(48)
  });

  function renderCheckoutForm(){
    reconcileCart();
    openOverlay();
    activeAttempt = newAttempt();
    const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
    bodyNode().innerHTML = `
      <form data-manual-checkout-form>
        <div class="manual-checkout-grid">
          <label class="wide">Full name<input name="name" autocomplete="name" maxlength="120" required></label>
          <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
          <label>Phone (optional)<input name="phone" autocomplete="tel" maxlength="40"></label>
          <label class="wide">Address<input name="address1" autocomplete="address-line1" maxlength="160" required></label>
          <label class="wide">Address line 2 (optional)<input name="address2" autocomplete="address-line2" maxlength="100"></label>
          <label>Postcode<input name="zip" autocomplete="postal-code" maxlength="24" required></label>
          <label>City<input name="city" autocomplete="address-level2" maxlength="100" required></label>
          <label>Province / region (optional)<input name="region" autocomplete="address-level1" maxlength="100"></label>
          <label>Country code<input name="country" autocomplete="country" value="NL" minlength="2" maxlength="2" pattern="[A-Za-z]{2}" required></label>
          <label class="manual-checkout-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        </div>
        <div class="manual-checkout-summary">
          <div><span>Products</span><strong>${exactMoney(subtotal)}</strong></div>
          <div><span>Shipping</span><strong>Calculated securely after address validation</strong></div>
        </div>
        <div class="manual-checkout-note">
          After continuing, the server verifies the current product price and shipping cost, creates a <strong>Pending</strong> order, and shows your exact payment amount and order reference. The price shown in the browser is never trusted.
        </div>
        <div class="manual-checkout-actions">
          <button class="manual-checkout-primary" type="submit">Create pending order</button>
          <button class="manual-checkout-secondary" type="button" data-manual-checkout-close>Back to cart</button>
        </div>
        <div class="manual-checkout-status" data-manual-checkout-status role="status" aria-live="polite"></div>
      </form>`;
    const form = bodyNode().querySelector('[data-manual-checkout-form]');
    form.addEventListener('submit', submitCheckout);
  }

  async function submitCheckout(event){
    event.preventDefault();
    if(!reconcileCart()){
      bodyNode().querySelector('[data-manual-checkout-status]').textContent = 'Your cart is empty or could not be reconciled with the live catalog.';
      return;
    }
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-manual-checkout-status]');
    submit.disabled = true;
    submit.textContent = 'Creating order…';
    status.textContent = '';
    const data = new FormData(form);
    const customer = {
      name: String(data.get('name') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      address1: String(data.get('address1') || '').trim(),
      address2: String(data.get('address2') || '').trim(),
      zip: String(data.get('zip') || '').trim(),
      city: String(data.get('city') || '').trim(),
      region: String(data.get('region') || '').trim(),
      country: String(data.get('country') || 'NL').trim().toUpperCase()
    };
    const payload = {
      customer,
      website: String(data.get('website') || ''),
      items: cart.map(item => ({
        name: item.name,
        size: item.size,
        sku: item.sku || '',
        qty: item.qty,
        image: item.image || '',
        collection: item.collection || ''
      })),
      ...activeAttempt
    };
    try {
      const response = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: apiHeaders(),
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if(!response.ok || !result?.ok){
        throw new Error(customerSafeMessage(result?.detail || result?.error || `Checkout failed (${response.status})`));
      }
      const sessionRecord = {
        order_id: result.order_id,
        confirmation_token: result.confirmation_token || activeAttempt.confirmation_token,
        payment_reference: result.payment_reference,
        saved_at: Date.now()
      };
      sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(sessionRecord));
      cart = [];
      saveCart();
      renderCart();
      renderConfirmation(result, sessionRecord);
    } catch (error) {
      status.textContent = customerSafeMessage(error?.message || 'The pending order could not be created. Nothing was sent to production.');
      submit.disabled = false;
      submit.textContent = 'Create pending order';
    }
  }

  function providerLabel(provider){
    if(provider === 'bunq_me') return 'Pay with bunq.me';
    if(provider === 'tikkie') return 'Pay with Tikkie';
    return 'Payment details';
  }

  function renderConfirmation(result, access){
    openOverlay();
    const provider = String(result.payment_provider || '');
    const paymentUrl = safePaymentUrl(result.payment_url, provider);
    const paymentBlock = paymentUrl
      ? `<p>Pay exactly <strong>${centsMoney(result.total_cents)}</strong> and use <span class="reference">${escLocal(result.payment_reference)}</span> as the payment description/reference.</p>
         <a href="${escLocal(paymentUrl)}" target="_blank" rel="noopener noreferrer">${escLocal(providerLabel(provider))}</a>`
      : `<p><strong>The payment link is not configured yet.</strong> Your order is safely stored as Pending. Keep this reference: <span class="reference">${escLocal(result.payment_reference)}</span>.</p>
         <p>Do not make a different payment until Bruis provides the configured payment link.</p>`;
    bodyNode().innerHTML = `
      <div class="manual-checkout-success">
        <h3>Order saved as Pending</h3>
        <p>Your order has been received. It will not enter production until the bank transfer has been manually verified.</p>
        <div class="manual-checkout-summary">
          <div><span>Products</span><strong>${centsMoney(result.subtotal_cents)}</strong></div>
          <div><span>Shipping</span><strong>${centsMoney(result.shipping_cents)}</strong></div>
          <div><span>Total</span><strong>${centsMoney(result.total_cents)}</strong></div>
        </div>
        <div class="manual-checkout-payment">
          <strong>${escLocal(providerLabel(provider))}</strong>
          ${paymentBlock}
        </div>
        <p>${result.confirmation_email_sent ? 'A confirmation email has been sent to the buyer.' : 'The order is saved, but the confirmation email could not be confirmed as sent.'}</p>
        <p>A second email will be sent automatically when tracking confirms that the clothes are on the way.</p>
        <div class="manual-checkout-order-state" data-manual-order-state>Status: Pending</div>
        <div class="manual-checkout-actions">
          <button class="manual-checkout-primary" type="button" data-manual-status-check>Check order status</button>
          <button class="manual-checkout-secondary" type="button" data-manual-checkout-close>Continue shopping</button>
        </div>
      </div>`;
    bodyNode().querySelector('[data-manual-status-check]')?.addEventListener('click', () => refreshStatus(access));
  }

  async function refreshStatus(access){
    const state = bodyNode()?.querySelector('[data-manual-order-state]');
    if(!state) return;
    state.textContent = 'Checking order status…';
    try {
      const response = await fetch(STATUS_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: apiHeaders(),
        body: JSON.stringify({ order_id: access.order_id, token: access.confirmation_token })
      });
      const result = await response.json().catch(() => ({}));
      if(!response.ok || !result?.ok) throw new Error(customerSafeMessage(result?.detail || result?.error || `Status check failed (${response.status})`));
      const order = result.order || {};
      const labels = { pending:'Pending — awaiting payment verification', paid:'Payment verified', production:'In production', shipped:'Shipped' };
      const tracking = Array.isArray(order.tracking) && order.tracking.length
        ? ` · Tracking: ${order.tracking.map(item => item.number || item.carrier || 'available').join(', ')}`
        : '';
      state.textContent = `Status: ${labels[order.status] || order.status || 'Unknown'}${tracking}`;
    } catch (error) {
      state.textContent = customerSafeMessage(error?.message || 'Could not refresh order status.');
    }
  }

  if(typeof renderCart === 'function'){
    renderCart = () => {
      qsa('[data-cart-count]').forEach(el => { el.textContent = cartCount(); });
      const subtotal = qs('[data-cart-subtotal]');
      if(subtotal) subtotal.textContent = exactMoney(cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0));
      const items = qs('[data-cart-items]');
      if(items){
        items.innerHTML = !cart.length
          ? '<p class="empty-cart">Your cart is empty.</p>'
          : cart.map((item, index) => `
              <article class="cart-line">
                <img src="${escLocal(item.image)}" alt="${escLocal(item.name)}" />
                <div>
                  <strong>${escLocal(item.name)}</strong>
                  <span>${escLocal(item.size)} · ${item.qty} × ${exactMoney(item.price)}</span>
                  <button type="button" data-remove="${index}">Remove</button>
                </div>
              </article>`).join('');
      }
      const checkout = qs('[data-checkout]');
      if(checkout){
        checkout.disabled = !cart.length;
        checkout.textContent = 'Continue to delivery & payment';
      }
    };
  }

  const syncProductCards = () => {
    qsa('[data-size]').forEach(select => {
      if(select.dataset.manualPriceBound === 'true') return;
      select.dataset.manualPriceBound = 'true';
      const product = productForId(select.dataset.size);
      if(!product) return;
      const sync = () => {
        const variant = variantForSize(product, select.value);
        const value = variantPrice(variant) || Number(product.price || 0);
        const price = select.closest('.product-card')?.querySelector('.price');
        if(price) price.textContent = exactMoney(value);
      };
      sync();
      select.addEventListener('change', sync);
    });
  };

  document.addEventListener('click', event => {
    const checkout = event.target.closest('[data-checkout]');
    if(checkout){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(reconcileCart()){
        renderCart();
        closeCart();
        renderCheckoutForm();
      }
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
    if(!variant) return;
    const qtyInput = qs(`[data-qty="${CSS.escape(String(product.id))}"]`);
    const qty = Math.max(1, Math.min(9, Number(qtyInput?.value || 1)));
    const resolvedSize = variantSize(variant) || size;
    const sku = String(variant?.sku || '').trim();
    const variantId = String(variant?.id || '');
    const price = variantPrice(variant) || Number(product.price || 0);
    const existing = cart.find(item =>
      (sku && item.sku === sku) ||
      (!sku && String(item.productId || item.id) === String(product.id) && String(item.size) === resolvedSize)
    );
    if(existing){
      existing.qty = Math.min(10, Number(existing.qty || 0) + qty);
      existing.price = price;
      existing.variantId = variantId;
      existing.sku = sku;
    } else {
      cart.push({
        productId: String(product.id),
        variantId,
        sku,
        name: product.name,
        price,
        size: resolvedSize,
        qty,
        image: product.image || product.mockups?.[0]?.image || '',
        collection: product.collection
      });
    }
    saveCart();
    renderCart();
    openCart();
  }, true);

  const productsRoot = qs('[data-products]');
  if(productsRoot){
    new MutationObserver(() => {
      if(Array.isArray(products) && products.length){
        reconcileCart();
        renderCart();
        syncProductCards();
      }
    }).observe(productsRoot, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', injectCheckoutUi, { once:true });
  if(document.readyState !== 'loading') injectCheckoutUi();

  window.BRUIS_MANUAL_CHECKOUT_V825 = {
    open: renderCheckoutForm,
    refreshLastOrder: () => {
      try {
        const access = JSON.parse(sessionStorage.getItem(SESSION_ORDER_KEY) || 'null');
        if(access?.order_id && access?.confirmation_token){
          openOverlay();
          bodyNode().innerHTML = '<div class="manual-checkout-order-state" data-manual-order-state>Checking order status…</div>';
          return refreshStatus(access);
        }
      } catch {}
      return false;
    }
  };
})();