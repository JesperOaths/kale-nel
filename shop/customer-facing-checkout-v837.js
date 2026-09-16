(() => {
  'use strict';

  const VERSION = 'v837';
  const MONEY_RE = /€\s*([0-9]+(?:[.,][0-9]{1,2})?)/;
  let applying = false;

  function customerCopy(value){
    return String(value ?? '')
      .replace(
        /Stacked shipping:\s*Printify is creating\s+(\d+)\s+separate fulfillment shipments,?\s*so each factory adds its own shipping charge\.?/gi,
        'Stacked shipping: we need to send this order in $1 separate parcels from different production locations. Each parcel has its own shipping charge.'
      )
      .replace(/\bPrintify\b/gi, 'Bruis')
      .replace(/\bfactories\b/gi, 'production locations')
      .replace(/\bfactory\b/gi, 'production location');
  }

  function sanitizeTextNode(node){
    const before = node.nodeValue || '';
    if(!/printify|factor(?:y|ies)/i.test(before)) return;
    const after = customerCopy(before);
    if(after !== before) node.nodeValue = after;
  }

  function sanitizeElementAttributes(element){
    for(const name of ['title', 'aria-label', 'alt', 'placeholder']){
      if(!element.hasAttribute?.(name)) continue;
      const before = element.getAttribute(name) || '';
      if(!/printify|factor(?:y|ies)/i.test(before)) continue;
      const after = customerCopy(before);
      if(after !== before) element.setAttribute(name, after);
    }
  }

  function sanitizeTree(root = document.body){
    if(!root) return;
    if(root.nodeType === Node.TEXT_NODE){
      sanitizeTextNode(root);
      return;
    }
    if(root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if(root.nodeType === Node.ELEMENT_NODE) sanitizeElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while((node = walker.nextNode())){
      if(node.nodeType === Node.TEXT_NODE) sanitizeTextNode(node);
      else sanitizeElementAttributes(node);
    }
  }

  function parseEuro(value){
    const match = String(value || '').match(MONEY_RE);
    if(!match) return NaN;
    return Number(match[1].replace(',', '.'));
  }

  function money(value){
    return `€${Number(value || 0).toFixed(2)}`;
  }

  function rowByLabel(container, selector, label){
    return [...container.querySelectorAll(selector)].find(row => {
      const first = row.querySelector('span');
      return String(first?.textContent || '').trim().toLowerCase() === label.toLowerCase();
    }) || null;
  }

  function ensureGrandTotal(form){
    let node = form.querySelector('[data-checkout-grand-total-v837]');
    if(node) return node;
    node = document.createElement('div');
    node.className = 'manual-checkout-grand-total';
    node.dataset.checkoutGrandTotalV837 = 'true';
    node.hidden = true;
    const actions = form.querySelector('.manual-checkout-actions');
    if(actions) actions.insertAdjacentElement('beforebegin', node);
    else form.appendChild(node);
    return node;
  }

  function updateCheckoutTotal(form){
    const subtotalRow = rowByLabel(form, '.manual-checkout-summary > div', 'Products');
    const shippingRow = rowByLabel(form, '.manual-delivery-preview-row', 'Shipping');
    const subtotal = parseEuro(subtotalRow?.querySelector('strong')?.textContent);
    const shipping = parseEuro(shippingRow?.querySelector('strong')?.textContent);
    const totalNode = ensureGrandTotal(form);

    if(!Number.isFinite(subtotal) || !Number.isFinite(shipping)){
      if(!totalNode.hidden) totalNode.hidden = true;
      if(totalNode.childNodes.length) totalNode.replaceChildren();
      delete totalNode.dataset.totalSignature;
      return;
    }

    const summaryShippingRow = rowByLabel(form, '.manual-checkout-summary > div', 'Shipping');
    const summaryShippingValue = summaryShippingRow?.querySelector('strong');
    if(summaryShippingValue && parseEuro(summaryShippingValue.textContent) !== shipping){
      summaryShippingValue.textContent = money(shipping);
    }

    const signature = `${subtotal.toFixed(2)}|${shipping.toFixed(2)}`;
    if(totalNode.dataset.totalSignature === signature && !totalNode.hidden) return;

    const total = subtotal + shipping;
    const left = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = 'Total incl. shipping';
    const detail = document.createElement('small');
    detail.textContent = `Products ${money(subtotal)} + shipping ${money(shipping)}`;
    left.append(label, detail);
    const amount = document.createElement('strong');
    amount.className = 'manual-checkout-grand-total-amount';
    amount.textContent = money(total);
    totalNode.replaceChildren(left, amount);
    totalNode.dataset.totalSignature = signature;
    totalNode.hidden = false;
  }

  function updateAll(){
    if(applying) return;
    applying = true;
    try{
      sanitizeTree(document.body);
      document.querySelectorAll('[data-manual-checkout-form]').forEach(updateCheckoutTotal);
    } finally {
      applying = false;
    }
  }

  function injectStyle(){
    if(document.querySelector('style[data-customer-facing-checkout-v837]')) return;
    const style = document.createElement('style');
    style.dataset.customerFacingCheckoutV837 = 'true';
    style.textContent = `
      .manual-checkout-grand-total{margin-top:18px;padding:14px 0 2px;border-top:2px solid #1a1a1a;display:flex;align-items:flex-end;justify-content:space-between;gap:18px;color:#171717}
      .manual-checkout-grand-total[hidden]{display:none!important}
      .manual-checkout-grand-total>span{display:grid;gap:3px}
      .manual-checkout-grand-total>span>strong{font-size:16px}
      .manual-checkout-grand-total small{font-size:12px;font-weight:500;color:#6b6b6b}
      .manual-checkout-grand-total-amount{font-size:21px;line-height:1;white-space:nowrap}
      @media(max-width:520px){.manual-checkout-grand-total{align-items:flex-start}.manual-checkout-grand-total-amount{font-size:19px}}
    `;
    document.head.appendChild(style);
  }

  injectStyle();
  const observer = new MutationObserver(() => queueMicrotask(updateAll));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'alt', 'placeholder'] });
  document.addEventListener('DOMContentLoaded', updateAll, { once: true });
  updateAll();
  window.BRUIS_CUSTOMER_FACING_CHECKOUT = Object.freeze({ version: VERSION, shippingInclusiveTotal: true, supplierBrandingHidden: true });
})();