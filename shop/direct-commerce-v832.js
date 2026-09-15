(() => {
  'use strict';

  const DIRECT_CATALOG_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v828';
  const CHECKOUT_V832_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v832';
  const previousFetch=window.fetch.bind(window);
  const wholeEuro=value=>Math.ceil(Math.max(0,Number(value||0))-1e-9);

  const inputUrl=input=>{
    try{
      const raw=typeof input==='string'?input:input?.url;
      return raw?new URL(raw,window.location.href):null;
    }catch{return null;}
  };

  function decorateCatalog(payload){
    if(!payload||!Array.isArray(payload.products))return payload;
    return {
      ...payload,
      source:'printify-direct-v832',
      products:payload.products.map(product=>{
        const seen=new Set();
        const mockups=(Array.isArray(product?.mockups)?product.mockups:[]).filter(item=>{
          const image=String(item?.image||'');
          if(!image||seen.has(image))return false;
          seen.add(image);return true;
        });
        const variants=(Array.isArray(product?.variants)?product.variants:[]).map(variant=>({...variant,price:wholeEuro(variant?.price)}));
        const availablePrices=variants.filter(v=>v?.is_available!==false&&v?.is_enabled!==false).map(v=>Number(v.price||0)).filter(p=>Number.isFinite(p)&&p>0);
        const allPrices=variants.map(v=>Number(v.price||0)).filter(p=>Number.isFinite(p)&&p>0);
        const prices=availablePrices.length?availablePrices:allPrices;
        return {
          ...product,
          source:'printify-direct-v832',
          price:prices.length?Math.min(...prices):wholeEuro(product?.price),
          priceMax:prices.length?Math.max(...prices):wholeEuro(product?.priceMax||product?.price),
          variants,
          mockups,
          image:mockups[0]?.image||product?.image||''
        };
      })
    };
  }

  const isLegacyCatalog=url=>!!url&&/\/functions\/v1\/shop-catalog\/?$/.test(url.pathname);
  const isLegacyCheckout=url=>!!url&&/\/functions\/v1\/shop-manual-checkout-v825\/?$/.test(url.pathname);

  window.fetch=async(input,init)=>{
    const url=inputUrl(input);
    if(isLegacyCatalog(url)){
      const response=await previousFetch(DIRECT_CATALOG_URL,{...(init||{}),cache:'no-store'});
      if(!response.ok)return response;
      try{
        const payload=await response.clone().json();
        const headers=new Headers(response.headers);
        headers.set('Content-Type','application/json; charset=utf-8');
        headers.set('X-Kalenel-Catalog-Authority','printify-direct-v832');
        return new Response(JSON.stringify(decorateCatalog(payload)),{status:response.status,statusText:response.statusText,headers});
      }catch{return response;}
    }
    if(isLegacyCheckout(url)){
      return previousFetch(CHECKOUT_V832_URL,{...(init||{}),cache:'no-store'});
    }
    return previousFetch(input,init);
  };

  const style=document.createElement('style');
  style.dataset.directCommerceV832='true';
  style.textContent=`
    .mockup-rail{background:#ded6ca!important;overflow:hidden!important}
    .mockup{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
    .mockup img{object-fit:contain!important;object-position:center!important;background:transparent!important}
    .product-card:has(.mockup:only-child) .gallery-controls{display:none!important}
    .cart-line img{object-fit:contain!important;background:#ded6ca!important;border-radius:12px}
    .collection-image,.compact-shape-card img{background:#ded6ca!important}
    .collection-image .collection-merch-image,.compact-shape-card .collection-merch-image{background:transparent!important;object-fit:contain!important}
  `;
  document.head.appendChild(style);

  window.BRUIS_DIRECT_COMMERCE_V832=Object.freeze({
    catalogAuthority:'printify-direct-v832',
    checkoutAuthority:'shop-manual-checkout-v832',
    pricing:'printify-retail-rounded-up',
    wholeEuroPricing:true,
    artworkFirstGallery:true,
    usesShopifyCatalogApi:false,
    usesShopifyPriceApi:false
  });
})();
