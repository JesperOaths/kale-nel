#!/usr/bin/env node
import assert from 'node:assert/strict';

const SHOP_URL='https://kalenel.nl/shop/';
const CATALOG_HEALTH='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-catalog-v827?health=1';
const CHECKOUT_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v827';
const STATUS_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825?health=1';
const ADMIN_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-admin-orders-v825';
const WEBHOOK_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-printify-webhook-v825';
const CONNECTION_URL='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-production-connection-v827';
const TIMEOUT_MS=Number(process.env.GEJAST_SHOP_TIMEOUT_MS||15000);

async function fetchWithTimeout(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  const started=Date.now();
  try{
    const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store',headers:{'User-Agent':'GEJAST-Live-Shop-Health/1.2',...(options.headers||{})}});
    return{response,elapsed:Date.now()-started};
  }finally{clearTimeout(timer);}
}
async function health(url,label,expectedMode){
  const{response,elapsed}=await fetchWithTimeout(url,{method:'GET'});
  assert.equal(response.status,200,`${label} health must return HTTP 200, got ${response.status}`);
  const payload=await response.json();
  assert.equal(payload?.ok,true,`${label} must report ok=true`);
  assert.equal(payload?.mode,expectedMode,`${label} returned unexpected mode ${payload?.mode}`);
  console.log(`${label}: health PASS, ${elapsed}ms`);
}

// Deliberately read-only: no checkout POST, payment write, production release or webhook simulation.
const{response:pageResponse,elapsed:pageElapsed}=await fetchWithTimeout(SHOP_URL);
assert.equal(pageResponse.status,200,`Live shop page must return HTTP 200, got ${pageResponse.status}`);
const html=await pageResponse.text();
assert.match(html,/version-watermark[^>]*>v827</,'Live shop must expose v827 watermark');
assert.match(html,/direct-catalog-v827\.js/,'Live shop must load direct catalog adapter');
assert.match(html,/manual-checkout-v827\.js/,'Live shop must load v827 checkout');
assert.match(html,/mockup-background-v827\.js/,'Live shop must load v827 mockup background normalizer');
assert.match(html,/shop-ui-v827\.js/,'Live shop must load v827 UI refinements');
for(const retired of ['shop-runtime-v819.js','catalog-recovery-v822.js','product-preview-overrides.js','front-lightbox-fit-v821.js','front-detail-overrides-v817.js','payment-readiness-v824.js','shopify-checkout-v817.js']){
  assert.ok(!html.includes(retired),`Retired shop layer must not be active: ${retired}`);
}
assert.doesNotMatch(html,/\b(?:Printify|Shopify)\b/i,'Shop HTML must not expose supplier/platform names');
console.log(`shop page: HTTP 200, v827 direct architecture present, ${pageElapsed}ms`);

await health(CATALOG_HEALTH,'shop-catalog-v827','direct-catalog-v827');
await health(CHECKOUT_URL,'shop-manual-checkout-v827','manual-payment-v827');
await health(STATUS_URL,'shop-order-status-v825','order-status-v825');
await health(ADMIN_URL,'shop-admin-orders-v825','admin-orders-v825');
await health(WEBHOOK_URL,'shop-printify-webhook-v825','printify-webhook-v825');
await health(CONNECTION_URL,'shop-production-connection-v827','production-connection-v827');

console.log('RESULT=V827_LIVE_SHOP_DIRECT_PAYMENT_PASS');
