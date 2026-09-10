(() => {
  'use strict';

  const CHECKOUT_ENDPOINT='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-manual-checkout-v827';
  const STATUS_ENDPOINT='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/shop-order-status-v825';
  const SESSION_KEY='bruisPendingOrderV827';

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const euros=value=>`€${Number(value||0).toFixed(2)}`;
  const cents=value=>`€${(Number(value||0)/100).toFixed(2)}`;
  const clean=value=>String(value??'').trim();
  const neutral=value=>clean(value).replace(/Printify/gi,'production service').replace(/Shopify/gi,'shop service');
  const randomToken=bytes=>{
    const data=crypto.getRandomValues(new Uint8Array(bytes));
    let binary=''; data.forEach(byte=>{binary+=String.fromCharCode(byte);});
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  };
  const apiHeaders=()=>{
    const key=(typeof SUPABASE_ANON_KEY!=='undefined'&&SUPABASE_ANON_KEY)||'';
    return {'Accept':'application/json','Content-Type':'application/json',...(key?{apikey:key,Authorization:`Bearer ${key}`}:{})};
  };
  const optionValue=(variant,name)=>{
    const target=String(name||'').toLowerCase();
    const options=Array.isArray(variant?.options)?variant.options:[];
    return String(options.find(option=>String(option?.name||'').toLowerCase()===target)?.value||'');
  };
  const variantSize=variant=>{
    const explicit=optionValue(variant,'size');
    if(explicit)return explicit;
    return String(variant?.title||'').split('/').map(part=>part.trim()).find(part=>/^(?:xs|s|m|l|xl|[2-9]xl)$/i.test(part))||'';
  };
  const available=variant=>variant?.is_enabled!==false&&variant?.is_available!==false;
  const productFor=id=>(Array.isArray(products)?products:[]).find(product=>String(product?.id||'')===String(id||''));
  const variantFor=(product,size,variantId='',sku='')=>{
    const variants=Array.isArray(product?.variants)?product.variants:[];
    return variants.find(v=>available(v)&&sku&&String(v?.sku||'')===String(sku))
      ||variants.find(v=>available(v)&&variantId&&String(v?.id||'').split('/').pop()===String(variantId).split('/').pop())
      ||variants.find(v=>available(v)&&variantSize(v).toLowerCase()===String(size||'').toLowerCase())
      ||variants.find(v=>available(v));
  };

  function reconcileCart(){
    if(!Array.isArray(cart))return false;
    if(!Array.isArray(products)||!products.length)return cart.length>0;
    const next=[];
    for(const item of cart){
      const product=productFor(item.productId||item.id)||products.find(p=>String(p?.name||'').toLowerCase()===String(item?.name||'').toLowerCase());
      if(!product)continue;
      const requested=String(item.size||'M');
      const variant=variantFor(product,requested,item.variantId,item.sku);
      if(!variant)continue;
      next.push({
        productId:String(product.id),
        variantId:String(variant?.id||item.variantId||'').split('/').pop(),
        sku:String(variant?.sku||item.sku||'').trim(),
        name:String(product.name||item.name||''),
        price:Number(variant?.price||product.price||0),
        size:variantSize(variant)||requested,
        qty:Math.max(1,Math.min(10,Number(item.qty||1))),
        image:product.image||product.mockups?.[0]?.image||item.image||'',
        collection:product.collection||item.collection||''
      });
    }
    cart=next; saveCart();
    return cart.length>0;
  }

  if(typeof renderCart==='function'){
    const baseRenderCart=renderCart;
    renderCart=()=>{
      baseRenderCart();
      const button=qs('[data-checkout]');
      if(button){
        button.disabled=!cart.length;
        button.textContent='Continue to delivery & payment';
      }
    };
  }

  function syncCard(select){
    const product=productFor(select?.dataset?.size);
    if(!product)return;
    const variant=variantFor(product,select.value);
    const price=Number(variant?.price||product.price||0);
    const node=select.closest('.product-card')?.querySelector('.price');
    if(node&&price>0)node.textContent=euros(price);
  }
  function bindSizes(root=document){
    root.querySelectorAll?.('select[data-size]').forEach(select=>{
      if(select.dataset.priceBoundV827==='true')return;
      select.dataset.priceBoundV827='true';
      syncCard(select);
      select.addEventListener('change',()=>syncCard(select));
    });
  }

  function injectCheckout(){
    if(document.querySelector('[data-manual-checkout-overlay]'))return;
    const style=document.createElement('style');
    style.textContent=`
      .manual-checkout-overlay{position:fixed;inset:0;z-index:12000;background:rgba(15,15,15,.58);display:none;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto}
      .manual-checkout-overlay.open{display:flex}.manual-checkout-dialog{width:min(760px,100%);background:#fff;border-radius:24px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);color:#171717}
      .manual-checkout-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.manual-checkout-head h2{margin:0;font-size:28px}.manual-checkout-head p{margin:7px 0 0;color:#666;line-height:1.45}
      .manual-checkout-close{border:1px solid #ddd;background:#fff;border-radius:999px;width:40px;height:40px;font-size:20px;cursor:pointer}.manual-checkout-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}
      .manual-checkout-grid label{display:grid;gap:6px;font-size:13px;font-weight:700}.manual-checkout-grid input{width:100%;border:1px solid #d7d7d7;border-radius:12px;padding:12px;font:inherit}.manual-checkout-grid .wide{grid-column:1/-1}
      .manual-checkout-note{margin:18px 0 0;padding:14px 16px;border-radius:14px;background:#f5f3ee;line-height:1.5;font-size:14px}.manual-checkout-summary{margin-top:18px;border-top:1px solid #eee;padding-top:16px}.manual-checkout-summary div{display:flex;justify-content:space-between;gap:12px;margin:6px 0}
      .manual-checkout-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.manual-checkout-primary,.manual-checkout-secondary{border:0;border-radius:12px;padding:13px 18px;font:inherit;font-weight:800;cursor:pointer}.manual-checkout-primary{background:#111;color:#fff}.manual-checkout-primary:disabled{opacity:.55}.manual-checkout-secondary{background:#f1f1f1;color:#111}
      .manual-checkout-status{min-height:20px;margin-top:12px;font-size:13px;color:#8a332e}.manual-checkout-success h3{font-size:25px;margin:0 0 8px}.manual-checkout-payment{margin:16px 0;padding:16px;border-radius:16px;background:#f5f3ee}.manual-checkout-payment .reference{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px}.manual-checkout-payment a{display:inline-block;margin-top:12px;background:#111;color:#fff;text-decoration:none;padding:12px 16px;border-radius:11px;font-weight:800}.manual-checkout-order-state{margin-top:14px;padding:12px 14px;border:1px solid #e7e7e7;border-radius:12px;font-size:14px}.manual-checkout-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}
      @media(max-width:640px){.manual-checkout-dialog{padding:18px;border-radius:18px}.manual-checkout-grid{grid-template-columns:1fr}.manual-checkout-grid .wide{grid-column:auto}.manual-checkout-overlay{padding:12px 8px}}
    `;
    document.head.appendChild(style);
    const overlay=document.createElement('div');
    overlay.className='manual-checkout-overlay'; overlay.dataset.manualCheckoutOverlay='true'; overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML=`<section class="manual-checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-checkout-title"><div class="manual-checkout-head"><div><h2 id="manual-checkout-title">Delivery & payment</h2><p>Enter the delivery address. Your order is saved as Pending first; production only starts after the transfer has been manually verified and approved.</p></div><button class="manual-checkout-close" type="button" data-manual-checkout-close aria-label="Close checkout">×</button></div><div data-manual-checkout-body></div></section>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest('[data-manual-checkout-close]'))closeCheckout();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay.classList.contains('open'))closeCheckout();});
  }
  const overlay=()=>document.querySelector('[data-manual-checkout-overlay]');
  const bodyNode=()=>overlay()?.querySelector('[data-manual-checkout-body]');
  function openOverlay(){injectCheckout();overlay().classList.add('open');overlay().setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
  function closeCheckout(){const node=overlay();if(!node)return;node.classList.remove('open');node.setAttribute('aria-hidden','true');document.body.style.overflow='';}

  let attempt=null;
  function renderCheckoutForm(){
    if(!reconcileCart())return;
    renderCart(); closeCart(); openOverlay();
    attempt={checkout_idempotency_key:randomToken(24),confirmation_token:randomToken(48)};
    const subtotal=cart.reduce((sum,item)=>sum+Number(item.price||0)*Number(item.qty||0),0);
    bodyNode().innerHTML=`<form data-manual-checkout-form><div class="manual-checkout-grid">
      <label class="wide">Full name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Phone (optional)<input name="phone" autocomplete="tel" maxlength="40"></label>
      <label class="wide">Address<input name="address1" autocomplete="address-line1" maxlength="160" required></label><label class="wide">Address line 2 (optional)<input name="address2" autocomplete="address-line2" maxlength="100"></label><label>Postcode<input name="zip" autocomplete="postal-code" maxlength="24" required></label><label>City<input name="city" autocomplete="address-level2" maxlength="100" required></label><label>Province / region (optional)<input name="region" autocomplete="address-level1" maxlength="100"></label><label>Country code<input name="country" autocomplete="country" value="NL" minlength="2" maxlength="2" pattern="[A-Za-z]{2}" required></label><label class="manual-checkout-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      </div><div class="manual-checkout-summary"><div><span>Products</span><strong>${euros(subtotal)}</strong></div><div><span>Shipping</span><strong>Calculated after delivery details</strong></div></div><div class="manual-checkout-note">After continuing, the server verifies the current product prices and delivery cost, creates a <strong>Pending</strong> order, and shows the exact payment amount and order reference.</div><div class="manual-checkout-actions"><button class="manual-checkout-primary" type="submit">Create pending order</button><button class="manual-checkout-secondary" type="button" data-manual-checkout-close>Back to cart</button></div><div class="manual-checkout-status" data-manual-checkout-status role="status" aria-live="polite"></div></form>`;
    bodyNode().querySelector('[data-manual-checkout-form]').addEventListener('submit',submitCheckout);
  }

  async function submitCheckout(event){
    event.preventDefault();
    if(!reconcileCart()){bodyNode().querySelector('[data-manual-checkout-status]').textContent='Your cart is empty or no longer available.';return;}
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=form.querySelector('[data-manual-checkout-status]');
    button.disabled=true;button.textContent='Creating order…';status.textContent='';
    const data=new FormData(form);
    const customer={name:clean(data.get('name')),email:clean(data.get('email')),phone:clean(data.get('phone')),address1:clean(data.get('address1')),address2:clean(data.get('address2')),zip:clean(data.get('zip')),city:clean(data.get('city')),region:clean(data.get('region')),country:clean(data.get('country')||'NL').toUpperCase()};
    const payload={customer,website:clean(data.get('website')),items:cart.map(item=>({name:item.name,size:item.size,sku:item.sku||'',qty:item.qty,image:item.image||'',collection:item.collection||''})),...attempt};
    try{
      const response=await fetch(CHECKOUT_ENDPOINT,{method:'POST',mode:'cors',cache:'no-store',headers:apiHeaders(),body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result?.ok)throw new Error(neutral(result?.detail||result?.error||`Checkout failed (${response.status})`));
      const access={order_id:result.order_id,confirmation_token:result.confirmation_token||attempt.confirmation_token,payment_reference:result.payment_reference,saved_at:Date.now()};
      sessionStorage.setItem(SESSION_KEY,JSON.stringify(access));
      cart=[];saveCart();renderCart();renderConfirmation(result,access);
    }catch(error){
      status.textContent=neutral(error?.message||'The pending order could not be created. Nothing was sent to production.');
      button.disabled=false;button.textContent='Create pending order';
    }
  }

  function safePaymentUrl(raw,provider){try{const url=new URL(String(raw||''));if(url.protocol!=='https:')return'';const host=url.hostname.toLowerCase();if(provider==='bunq_me'&&(host==='bunq.me'||host.endsWith('.bunq.me')))return url.toString();if(provider==='tikkie'&&(host==='tikkie.me'||host.endsWith('.tikkie.me')))return url.toString();}catch{}return'';}
  const providerLabel=provider=>provider==='bunq_me'?'Pay with bunq.me':provider==='tikkie'?'Pay with Tikkie':'Payment details';
  function renderConfirmation(result,access){
    openOverlay();
    const provider=String(result.payment_provider||''),paymentUrl=safePaymentUrl(result.payment_url,provider);
    const paymentBlock=paymentUrl?`<p>Pay exactly <strong>${cents(result.total_cents)}</strong> and use <span class="reference">${esc(result.payment_reference)}</span> as the payment description/reference.</p><a href="${esc(paymentUrl)}" target="_blank" rel="noopener noreferrer">${esc(providerLabel(provider))}</a>`:`<p><strong>The payment link is not configured yet.</strong> Your order is safely stored as Pending. Keep this reference: <span class="reference">${esc(result.payment_reference)}</span>.</p>`;
    bodyNode().innerHTML=`<div class="manual-checkout-success"><h3>Order saved as Pending</h3><p>Your order has been received. Production only starts after the bank transfer has been manually verified and approved.</p><div class="manual-checkout-summary"><div><span>Products</span><strong>${cents(result.subtotal_cents)}</strong></div><div><span>Shipping</span><strong>${cents(result.shipping_cents)}</strong></div><div><span>Total</span><strong>${cents(result.total_cents)}</strong></div></div><div class="manual-checkout-payment"><strong>${esc(providerLabel(provider))}</strong>${paymentBlock}</div><p>${result.confirmation_email_sent?'A confirmation email has been sent to the buyer.':'The order is saved, but the confirmation email could not be confirmed as sent.'}</p><p>A second email will be sent automatically when tracking confirms that the clothes are on the way.</p><div class="manual-checkout-order-state" data-manual-order-state>Status: Pending</div><div class="manual-checkout-actions"><button class="manual-checkout-primary" type="button" data-manual-status-check>Check order status</button><button class="manual-checkout-secondary" type="button" data-manual-checkout-close>Continue shopping</button></div></div>`;
    bodyNode().querySelector('[data-manual-status-check]')?.addEventListener('click',()=>refreshStatus(access));
  }
  async function refreshStatus(access){
    const state=bodyNode()?.querySelector('[data-manual-order-state]');if(!state)return;state.textContent='Checking order status…';
    try{const response=await fetch(STATUS_ENDPOINT,{method:'POST',mode:'cors',cache:'no-store',headers:apiHeaders(),body:JSON.stringify({order_id:access.order_id,token:access.confirmation_token})});const result=await response.json().catch(()=>({}));if(!response.ok||!result?.ok)throw new Error(neutral(result?.error||`Status check failed (${response.status})`));const order=result.order||{};const labels={pending:'Pending — awaiting payment verification',paid:'Payment verified',production:'In production',shipped:'Shipped'};const tracking=Array.isArray(order.tracking)&&order.tracking.length?` · Tracking: ${order.tracking.map(item=>item.number||item.carrier||'available').join(', ')}`:'';state.textContent=`Status: ${labels[order.status]||order.status||'Unknown'}${tracking}`;}catch(error){state.textContent=neutral(error?.message||'Could not refresh order status.');}
  }

  document.addEventListener('click',event=>{
    const checkout=event.target.closest('[data-checkout]');
    if(checkout){event.preventDefault();event.stopImmediatePropagation();if(reconcileCart())renderCheckoutForm();return;}
    const add=event.target.closest('[data-add]');
    if(!add)return;
    event.preventDefault();event.stopImmediatePropagation();
    const product=productFor(add.dataset.add);if(!product)return;
    const select=qs(`[data-size="${CSS.escape(String(product.id))}"]`);const size=select?.value||'M';const variant=variantFor(product,size);if(!variant)return;
    const qtyInput=qs(`[data-qty="${CSS.escape(String(product.id))}"]`);const qty=Math.max(1,Math.min(9,Number(qtyInput?.value||1)));const resolvedSize=variantSize(variant)||size;const sku=String(variant?.sku||'').trim();const variantId=String(variant?.id||'').split('/').pop();const price=Number(variant?.price||product.price||0);
    const existing=cart.find(item=>(sku&&item.sku===sku)||(!sku&&String(item.productId||item.id)===String(product.id)&&String(item.size)===resolvedSize));
    if(existing){existing.qty=Math.min(10,Number(existing.qty||0)+qty);existing.price=price;existing.variantId=variantId;existing.sku=sku;}
    else cart.push({productId:String(product.id),variantId,sku,name:product.name,price,size:resolvedSize,qty,image:product.image||product.mockups?.[0]?.image||'',collection:product.collection});
    saveCart();renderCart();openCart();
  },true);

  function boot(){injectCheckout();bindSizes();renderCart();const root=qs('[data-products]');if(root)new MutationObserver(()=>bindSizes(root)).observe(root,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
