(() => {
  'use strict';

  const CART_KEY = 'bruisCartV3';
  const PENDING_KEY = 'bruisPendingCheckoutV2';
  const API_BASE = window.KALENEL_SHOP_API_BASE || 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1';
  const CHECKOUT_URL = `${API_BASE}/create-shop-checkout-v2`;
  const STATUS_URL = `${API_BASE}/shop-order-status-v2`;
  let busy = false;

  function getCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function statusElement() {
    return document.querySelector('[data-payment-status]');
  }

  function setStatus(message, isError = false) {
    const el = statusElement();
    if (!el) return;
    el.textContent = message;
    el.dataset.error = isError ? 'true' : 'false';
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('[data-shop-checkout]').forEach((el) => {
      if ('disabled' in el) el.disabled = value;
      el.setAttribute('aria-busy', value ? 'true' : 'false');
    });
  }

  async function startCheckout() {
    if (busy) return;
    const cart = getCart();
    if (!cart.length) return setStatus('Your cart is empty.', true);
    const items = cart.map((item) => ({
      id: String(item.id || ''),
      size: String(item.size || ''),
      qty: Math.max(1, Math.min(9, Math.floor(Number(item.qty || 1)))),
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
      if (!response.ok || !data.url || !data.order_id || !data.status_token) {
        throw new Error(data.error || 'Secure checkout is not available yet.');
      }
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        order_id: data.order_id,
        status_token: data.status_token,
        created_at: Date.now(),
      }));
      window.location.assign(data.url);
    } catch (error) {
      console.error('Secure checkout failed', error);
      setStatus(error?.message || 'Secure checkout is not available yet.', true);
      setBusy(false);
    }
  }

  function pendingCheckout() {
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      if (!pending?.order_id || !pending?.status_token) return null;
      return pending;
    } catch { return null; }
  }

  async function getOrderStatus(pending) {
    const url = new URL(STATUS_URL);
    url.searchParams.set('order', pending.order_id);
    url.searchParams.set('token', pending.status_token);
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not verify payment status.');
    return data;
  }

  async function verifyReturnedPayment() {
    const pending = pendingCheckout();
    if (!pending) {
      setStatus('Returned from checkout. This tab no longer has the private verification token, so your cart was left untouched.', true);
      return;
    }
    setStatus('Verifying payment…');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const order = await getOrderStatus(pending);
        if (order.paid) {
          sessionStorage.removeItem(PENDING_KEY);
          window.dispatchEvent(new CustomEvent('bruis:cart-clear'));
          if (order.needs_attention) {
            setStatus('Payment received. The order is saved, but fulfilment needs review before production.', true);
          } else if (['shipped', 'delivered'].includes(order.fulfillment_status)) {
            setStatus(`Payment received. Order status: ${order.fulfillment_status}.`);
          } else {
            setStatus('Payment received. Your Printify fulfilment is being prepared automatically.');
          }
          return;
        }
        if (['failed', 'expired'].includes(order.payment_status)) {
          setStatus(`Payment ${order.payment_status}. Your cart has been kept.`, true);
          return;
        }
      } catch (error) {
        if (attempt === 11) setStatus(error?.message || 'Payment verification is taking longer than expected.', true);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setStatus('Payment verification is still processing. Your cart has not been cleared yet.');
  }

  document.addEventListener('click', (event) => {
    const checkout = event.target.closest('[data-shop-checkout]');
    if (!checkout) return;
    event.preventDefault();
    startCheckout();
  });

  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment === 'success' && params.get('session_id')) verifyReturnedPayment();
    else if (payment === 'cancelled') setStatus('Checkout was cancelled. Your cart is still here.');
  });
})();
