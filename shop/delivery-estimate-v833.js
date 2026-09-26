(() => {
  'use strict';

  const PREVIEW_ENDPOINT = 'https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-delivery-preview-v833';
  const ADDRESS_FIELDS = ['address1', 'address2', 'zip', 'city', 'region', 'country'];
  const EU_COUNTRIES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
  let debounceTimer = 0;
  let requestSerial = 0;
  let lastQuotedSignature = '';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const centsMoney = value => `€${(Number(value || 0) / 100).toFixed(2)}`;
  const titleCase = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  const apiHeaders = () => {
    const key = (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) || '';
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {})
    };
  };

  function cartItems(){
    if(typeof cart === 'undefined' || !Array.isArray(cart)) return [];
    return cart.map(item => ({
      product_id: String(item.productId || item.id || ''),
      variant_id: String(item.variantId || ''),
      name: String(item.name || ''),
      size: String(item.size || ''),
      sku: String(item.sku || ''),
      qty: Math.max(1, Math.min(10, Number(item.qty || 1)))
    }));
  }

  function formAddress(form){
    const data = new FormData(form);
    return {
      address1: String(data.get('address1') || '').trim(),
      address2: String(data.get('address2') || '').trim(),
      zip: String(data.get('zip') || '').trim(),
      city: String(data.get('city') || '').trim(),
      region: String(data.get('region') || '').trim(),
      country: String(data.get('country') || 'NL').trim().toUpperCase()
    };
  }

  function addressReady(address){
    return address.address1.length >= 2 && address.zip.length >= 2 && address.city.length >= 2 && /^[A-Z]{2}$/.test(address.country);
  }

  function signatureFor(address, items){
    return JSON.stringify({ address, items: items.map(item => [item.product_id, item.variant_id, item.sku, item.qty]) });
  }

  function injectStyle(){
    if(document.querySelector('style[data-delivery-estimate-v833]')) return;
    const style = document.createElement('style');
    style.dataset.deliveryEstimateV833 = 'true';
    style.textContent = `
      .manual-delivery-preview{margin-top:16px;padding:15px 16px;border:1px solid #dfddd8;border-radius:15px;background:#fbfaf7}
      .manual-delivery-preview-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
      .manual-delivery-preview-head strong{font-size:15px}
      .manual-delivery-preview-button{border:1px solid #d5d2cb;background:#fff;border-radius:10px;padding:8px 11px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
      .manual-delivery-preview-button:disabled{opacity:.55;cursor:not-allowed}
      .manual-delivery-preview-output{display:grid;gap:7px;font-size:13px;line-height:1.45;color:#303030}
      .manual-delivery-preview-row{display:grid;grid-template-columns:minmax(105px,.34fr) 1fr;gap:12px}
      .manual-delivery-preview-row span:first-child{color:#6b6b6b}
      .manual-delivery-preview-note{margin-top:3px;color:#737373;font-size:12px}
      .manual-delivery-preview-warning{margin-top:8px;padding:10px 12px;border:1px solid #d8b36c;border-radius:10px;background:#fff7e7;color:#6b4200;font-size:12px;font-weight:800}\n      .manual-shipping-breakdown{margin-top:9px;padding:10px 12px;border:1px solid #ddd8cf;border-radius:10px;background:#fff}\n      .manual-shipping-breakdown-row{display:flex;justify-content:space-between;gap:12px;margin:5px 0}\n      .manual-shipping-breakdown-items{color:#6b6b6b;font-size:12px;font-weight:400}
      @media(max-width:560px){.manual-delivery-preview-row{grid-template-columns:1fr;gap:2px}}
    `;
    document.head.appendChild(style);
  }

  function outputNode(form){
    return form.querySelector('[data-delivery-preview-output]');
  }

  function waitingMessage(form, message = 'Enter your delivery address so we can calculate shipping and delivery time.'){
    const output = outputNode(form);
    if(output) output.innerHTML = `<div class="manual-delivery-preview-note">${esc(message)}</div>`;
  }

  function customsWarning(form, result){
    if(String(result?.customs_notice || '').trim()) return String(result.customs_notice).trim();
    const destination = String(form?.elements?.namedItem('country')?.value || '').trim().toUpperCase();
    const origins = Array.isArray(result?.origins) ? result.origins : [];
    if(!destination || !origins.length) return '';

    const unknownOrigin = origins.some(origin => !origin?.exact || !String(origin?.country_code || '').trim());
    const originCountries = [...new Set(origins.map(origin => String(origin?.country_code || '').trim().toUpperCase()).filter(Boolean))];
    const crossesCustomsBorder = originCountries.some(origin => origin !== destination && !(EU_COUNTRIES.has(origin) && EU_COUNTRIES.has(destination)));

    if(!crossesCustomsBorder && !unknownOrigin) return '';
    if(originCountries.includes('GB') && EU_COUNTRIES.has(destination)){
      return 'Import-cost warning: this route ships from the United Kingdom into the EU. Import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in the displayed shipping price.';
    }
    if(EU_COUNTRIES.has(destination) && originCountries.some(origin => !EU_COUNTRIES.has(origin))){
      return 'Import-cost warning: this route ships into the EU from outside the EU customs area. Import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in the displayed shipping price.';
    }
    if(destination === 'GB' && originCountries.some(origin => EU_COUNTRIES.has(origin))){
      return 'Import-cost warning: this route ships from the EU into the United Kingdom. UK import VAT, customs duties where applicable, and carrier handling fees may be charged on arrival; these costs are not included in the displayed shipping price.';
    }
    if(crossesCustomsBorder){
      return 'Import-cost warning: we need to send this order across a customs border. Import taxes, customs duties, and carrier handling fees may be charged by the destination country; these costs are not included in the displayed shipping price.';
    }
    return 'Import-cost warning: we will confirm the exact production location after ordering. If we send your order from outside your customs area, import VAT or taxes, customs duties, and carrier handling fees may apply and are not included in the displayed shipping price.';
  }

  function renderResult(form, result){
    const output = outputNode(form);
    if(!output) return;
    const origins = Array.isArray(result.origins) && result.origins.length
      ? result.origins.map(origin => esc(origin.label || origin.provider || 'Bruis production network')).join('<br>')
      : 'Production location unavailable';
    const delivery = result.delivery || {};
    const eta = Number.isFinite(Number(delivery.min_business_days)) && Number.isFinite(Number(delivery.max_business_days))
      ? `${Number(delivery.min_business_days)}–${Number(delivery.max_business_days)} business days after payment verification`
      : 'We will confirm the exact delivery range when your production location is assigned';
    const groups = Array.isArray(result.shipping_breakdown) ? result.shipping_breakdown : [];
    const groupRows = groups.map(group => {
      const items = Array.isArray(group.items) ? group.items.map(item => `${Number(item.quantity || 1)}× ${esc(item.name || 'Shirt')}${item.size ? ` (${esc(item.size)})` : ''}`).join(', ') : '';
      const label = esc(group.origin || group.provider || 'Bruis production location');
      return `<div class="manual-shipping-breakdown-row"><span><strong>${label}</strong><br><span class="manual-shipping-breakdown-items">${items}</span></span><strong>${centsMoney(group.shipping_cents)}</strong></div>`;
    }).join('');
    const breakdown = groupRows
      ? `<div class="manual-shipping-breakdown"><strong>Where your shipping fee comes from</strong>${groupRows}<div class="manual-shipping-breakdown-row"><span><strong>Total shipping</strong></span><strong>${centsMoney(result.shipping_cents)}</strong></div></div>`
      : '';
    const split = result.shipping_stacks || result.may_arrive_separately
      ? `<div class="manual-delivery-preview-warning">Stacked shipping: we need to send this order in ${Number(result.provider_groups || groups.length || 2)} separate parcels from different production locations. Each parcel has its own shipping charge, so the amounts above are added together and parcels may arrive separately.</div>`
      : (groups.some(group => (group.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0) > 1)
        ? '<div class="manual-delivery-preview-note">When we send multiple pieces together, shipping uses one base charge plus a smaller additional-item charge. Shipping therefore rises with quantity, but usually by less than another full base charge.</div>'
        : '');
    const importWarning = customsWarning(form, result);
    const customs = importWarning ? `<div class="manual-delivery-preview-warning">${esc(importWarning)}</div>` : '';
    output.innerHTML = `
      <div class="manual-delivery-preview-row"><span>Prepared in</span><strong>${origins}</strong></div>
      <div class="manual-delivery-preview-row"><span>Estimated arrival</span><strong>${esc(eta)}</strong></div>
      <div class="manual-delivery-preview-row"><span>Shipping</span><strong>${centsMoney(result.shipping_cents)} · ${esc(titleCase(result.shipping_method || 'standard'))}</strong></div>
      ${breakdown}
      ${split}
      ${customs}
      <div class="manual-delivery-preview-note">${esc(result.note || 'Delivery dates are estimates and can change if we move production or a carrier is delayed.')}</div>`;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function fetchPreview(payload){
    let lastResponse = null;
    let lastError = null;
    for(let attempt=1; attempt<=2; attempt++){
      try{
        const response = await fetch(PREVIEW_ENDPOINT,{
          method:'POST',
          mode:'cors',
          cache:'no-store',
          headers:apiHeaders(),
          body:JSON.stringify(payload)
        });
        lastResponse = response;
        if(response.ok || (response.status < 500 && response.status !== 429)) return response;
      }catch(error){
        lastError = error;
      }
      if(attempt < 2) await sleep(650);
    }
    if(lastResponse) return lastResponse;
    throw lastError || new Error('delivery_preview_network_error');
  }

  async function calculate(form, force = false){
    const address = formAddress(form);
    const items = cartItems();
    if(!addressReady(address) || !items.length){
      waitingMessage(form);
      return;
    }
    const signature = signatureFor(address, items);
    if(!force && signature === lastQuotedSignature) return;

    const button = form.querySelector('[data-delivery-preview-button]');
    const output = outputNode(form);
    const serial = ++requestSerial;
    if(button){ button.disabled = true; button.textContent = 'Calculating…'; }
    if(output) output.innerHTML = '<div class="manual-delivery-preview-note">We are finding the best available shipping route and delivery window…</div>';

    try {
      const response = await fetchPreview({ customer: address, items });
      const result = await response.json().catch(() => ({}));
      if(serial !== requestSerial) return;
      if(!response.ok || !result?.ok) throw new Error(result?.detail || result?.error || `Delivery estimate failed (${response.status})`);
      lastQuotedSignature = signature;
      renderResult(form, result);
    } catch(error) {
      if(serial !== requestSerial) return;
      if(output) output.innerHTML = `<div class="manual-delivery-preview-note">${esc(error?.message || 'Delivery estimate is temporarily unavailable. The final shipping cost will still be verified securely when the Pending order is created.')}</div>`;
    } finally {
      if(serial === requestSerial && button){ button.disabled = false; button.textContent = 'Refresh estimate'; }
    }
  }

  function schedule(form){
    clearTimeout(debounceTimer);
    const address = formAddress(form);
    if(!addressReady(address)){
      lastQuotedSignature = '';
      waitingMessage(form);
      return;
    }
    debounceTimer = setTimeout(() => calculate(form), 750);
  }

  function ensurePanel(){
    injectStyle();
    const form = document.querySelector('[data-manual-checkout-form]');
    if(!form || form.querySelector('[data-delivery-preview-v833]')) return;
    const summary = form.querySelector('.manual-checkout-summary');
    if(!summary) return;

    const panel = document.createElement('section');
    panel.className = 'manual-delivery-preview';
    panel.dataset.deliveryPreviewV833 = 'true';
    panel.innerHTML = `
      <div class="manual-delivery-preview-head">
        <strong>Delivery estimate</strong>
        <button class="manual-delivery-preview-button" type="button" data-delivery-preview-button>Calculate delivery</button>
      </div>
      <div class="manual-delivery-preview-output" data-delivery-preview-output>
        <div class="manual-delivery-preview-note">Enter your delivery address so we can calculate shipping and delivery time.</div>
      </div>`;
    summary.insertAdjacentElement('afterend', panel);

    panel.querySelector('[data-delivery-preview-button]')?.addEventListener('click', () => calculate(form, true));
    for(const name of ADDRESS_FIELDS){
      const input = form.elements.namedItem(name);
      if(input instanceof HTMLElement){
        input.addEventListener('input', () => schedule(form));
        input.addEventListener('change', () => schedule(form));
      }
    }
    schedule(form);
  }

  const observer = new MutationObserver(() => ensurePanel());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', ensurePanel, { once: true });
  ensurePanel();
})();
