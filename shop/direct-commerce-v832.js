(() => {
  'use strict';

  // v874: catalog and checkout are now called directly by store.js and
  // manual-checkout-v825.js. This file intentionally contains no fetch
  // interception or legacy endpoint rewriting.
  const style=document.createElement('style');
  style.dataset.directCommerceV832='true';
  style.textContent=`
    .mockup-rail{background:transparent!important;overflow:hidden!important}
    .mockup{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
    .mockup img{object-fit:contain!important;object-position:center!important;background:transparent!important}
    .product-card:has(.mockup:only-child) .gallery-controls{display:none!important}
    .cart-line img{object-fit:contain!important;background:transparent!important;border-radius:12px}
    .collection-image,.compact-shape-card img{background:transparent!important}
    .collection-image .collection-merch-image,.compact-shape-card .collection-merch-image{background:transparent!important;object-fit:contain!important}
  `;
  document.head.appendChild(style);

  if(!document.querySelector('script[data-delivery-estimate-v833]')){
    const deliveryScript=document.createElement('script');
    deliveryScript.dataset.deliveryEstimateV833='true';
    deliveryScript.src='delivery-estimate-v833.js?v=20260926-delivery-v871-r1';
    deliveryScript.async=false;
    document.head.appendChild(deliveryScript);
  }

  window.BRUIS_DIRECT_COMMERCE_V832=Object.freeze({
    catalogAuthority:'shop-catalog-v828',
    checkoutAuthority:'shop-manual-checkout-v832',
    deliveryPreview:'shop-delivery-preview-v833',
    pricing:'shirt-production-cost-plus-max-printify-vat-plus-size-margin-rounded-up',
    wholeEuroPricing:true,
    artworkFirstGallery:true,
    usesShopifyCatalogApi:false,
    usesShopifyPriceApi:false,
    legacyFetchBridge:false
  });
})();
