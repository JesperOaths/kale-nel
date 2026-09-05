(() => {
  'use strict';

  const SHOPIFY_DOMAIN = 'n75mh8-bu.myshopify.com';
  const SHOPIFY_API_VERSION = '2026-07';
  const PAYMENT_URL = `https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const CACHE_MS = 60 * 1000;
  const TIMEOUT_MS = 8000;
  const PAYMENT_QUERY = `
    query KalenelPaymentReadiness {
      shop {
        paymentSettings {
          acceptedCardBrands
          supportedDigitalWallets
          countryCode
          currencyCode
        }
      }
    }
  `;

  let cached = null;
  let inFlight = null;
  let bypassNextCheckoutClick = false;

  function statusNode(){
    const summary = document.querySelector('.cart-summary');
    if(!summary) return null;
    let node = summary.querySelector('[data-payment-readiness]');
    if(node) return node;
    node = document.createElement('p');
    node.dataset.paymentReadiness = 'true';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.hidden = true;
    summary.insertBefore(node, summary.querySelector('[data-checkout]'));
    return node;
  }

  function setStatus(message = '', state = ''){
    const node = statusNode();
    if(!node) return;
    node.textContent = message;
    node.dataset.state = state;
    node.hidden = !message;
  }

  async function requestPaymentReadiness(force = false){
    const now = Date.now();
    if(!force && cached && now - cached.checkedAt < CACHE_MS) return cached;
    if(inFlight) return inFlight;

    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(PAYMENT_URL, {
          method: 'POST',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query: PAYMENT_QUERY })
        });
        const payload = await response.json().catch(() => ({}));
        if(!response.ok || Array.isArray(payload?.errors)){
          const detail = Array.isArray(payload?.errors)
            ? payload.errors.map(error => String(error?.message || '')).filter(Boolean).join('; ')
            : `HTTP ${response.status}`;
          throw new Error(detail || 'Shopify payment readiness request failed');
        }

        const settings = payload?.data?.shop?.paymentSettings;
        if(!settings) throw new Error('Shopify returned no payment settings');
        const acceptedCardBrands = Array.isArray(settings.acceptedCardBrands)
          ? settings.acceptedCardBrands.map(value => String(value || '').trim()).filter(Boolean)
          : [];
        const supportedDigitalWallets = Array.isArray(settings.supportedDigitalWallets)
          ? settings.supportedDigitalWallets.map(value => String(value || '').trim()).filter(Boolean)
          : [];

        cached = {
          checkedAt: Date.now(),
          cardsAvailable: acceptedCardBrands.length > 0,
          acceptedCardBrands,
          supportedDigitalWallets,
          countryCode: String(settings.countryCode || ''),
          currencyCode: String(settings.currencyCode || '')
        };
        return cached;
      } finally {
        clearTimeout(timer);
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function restoreCheckoutButton(button, label){
    button.removeAttribute('aria-busy');
    button.textContent = label;
    button.disabled = !button.dataset.checkoutUrl;
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-checkout]');
    if(!button || bypassNextCheckoutClick) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const originalLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Checking secure payment…';
    setStatus('');

    try {
      const readiness = await requestPaymentReadiness(true);
      if(!readiness.cardsAvailable){
        button.dataset.paymentBlocked = 'cards-unavailable';
        setStatus(
          'Checkout is temporarily blocked because Shopify is not advertising an active card processor. No order has been submitted.',
          'blocked'
        );
        restoreCheckoutButton(button, originalLabel);
        return;
      }

      delete button.dataset.paymentBlocked;
      setStatus('');
      restoreCheckoutButton(button, originalLabel);

      // The existing v817 listener owns exact variant reconciliation and the final
      // Shopify cart permalink. Re-dispatch exactly once after payment readiness
      // succeeds so no card/order logic is duplicated here.
      bypassNextCheckoutClick = true;
      button.click();
      bypassNextCheckoutClick = false;
    } catch (error) {
      button.dataset.paymentBlocked = 'verification-failed';
      setStatus(
        'Checkout is temporarily blocked because the secure Shopify payment gateway could not be verified. No order has been submitted.',
        'error'
      );
      console.error('v824 payment readiness check failed', error);
      restoreCheckoutButton(button, originalLabel);
    }
  }, true);

  window.BRUIS_PAYMENT_READINESS_V824 = {
    check: () => requestPaymentReadiness(true)
  };
})();
