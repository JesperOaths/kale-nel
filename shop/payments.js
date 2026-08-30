(() => {
  'use strict';

  const CART_KEY = 'bruisCartV2';
  const CHECKOUT_URL = window.KALENEL_SHOP_CHECKOUT_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/create-shop-checkout';
  let busy = false;

  function getCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function statusElement() {
    let el = document.querySelector('[data-payment-status]');
    if (el) return el;
    const summary = document.querySelector('.cart-summary');
    if (!summary) return null;
    el = document.createElement('p');
    el.className = 'small-note payment-status';
    el.setAttribute('data-payment-status', '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    summary.appendChild(el);
    return el;
  }

  function setStatus(message, isError = false) {
    const el = statusElement();
    if (!el) return;
    el.textContent = message;
    el.dataset.error = isError ? 'true' : 'false';
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('[data-shop-checkout], [data-mail-order]').forEach((el) => {
      if ('disabled' in el) el.disabled = value;
      el.setAttribute('aria-busy', value ? 'true' : 'false');
    });
  }

  async function startCheckout() {
    if (busy) return;
    const cart = getCart();
    if (!cart.length) {
      setStatus('Your cart is empty.', true);
      return;
    }

    const items = cart.map((item) => ({
      id: String(item.id || ''),
      size: String(item.size || ''),
      qty: Math.max(1, Math.floor(Number(item.qty || 1))),
    }));

    setBusy(true);
    setStatus('Opening secure checkout…');
    try {
      const response = await fetch(CHECKOUT_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Checkout is not available yet.');
      window.location.assign(data.url);
    } catch (error) {
      console.error('Secure checkout failed', error);
      setStatus(`${error?.message || 'Checkout is not available.'} You can still use the order-request link while payments are being activated.`, true);
      const fallback = document.querySelector('[data-mail-order]');
      if (fallback) {
        fallback.textContent = 'Email order request (fallback)';
        fallback.dataset.checkoutFallback = 'true';
      }
      setBusy(false);
    }
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-shop-checkout], [data-mail-order]');
    if (!control) return;
    if (control.matches('[data-mail-order]') && control.dataset.checkoutFallback === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startCheckout();
  }, true);

  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  if (payment === 'success' && params.get('session_id')) {
    localStorage.removeItem(CART_KEY);
    window.addEventListener('DOMContentLoaded', () => setStatus('Checkout completed. Payment is being verified and the Printify order will be created automatically after confirmation.'));
  } else if (payment === 'cancelled') {
    window.addEventListener('DOMContentLoaded', () => setStatus('Checkout was cancelled. Your cart is still here.'));
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-shop-checkout]').forEach((button) => { button.disabled = false; });
  });
})();
