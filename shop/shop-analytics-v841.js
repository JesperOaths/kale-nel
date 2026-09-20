(() => {
  'use strict';

  const SUPABASE_URL = 'https://uiqntazgnrxwliaidkmy.supabase.co';
  const SUPABASE_KEY = (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) || 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  const ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc/track_site_event`;
  const VISITOR_KEY = 'gejast_visitor_id_v2';
  const SESSION_KEY = 'gejast_visit_session_id_v2';
  const SHOP_TRACKED_KEY = 'bruis_shop_page_view_v841';
  const PRODUCT_VIEW_KEY = 'bruis_shop_product_views_v841';
  const ATTRIBUTION_KEY = 'bruis_shop_attribution_v841';
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  const text = value => String(value ?? '').trim();
  const clampInt = (value, min = 0, max = 100000000) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
  };
  function randomId(prefix){
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return prefix + Array.from(bytes).map(v => v.toString(16).padStart(2,'0')).join('');
    } catch {
      return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }
  function getOrSet(storage,key,prefix){
    try {
      let value = storage.getItem(key);
      if(!value){ value = randomId(prefix); storage.setItem(key,value); }
      return value;
    } catch { return randomId(prefix); }
  }
  function detectDevice(){
    const ua=navigator.userAgent||'';
    if(/tablet|ipad/i.test(ua)) return 'tablet';
    if(/mobi|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function detectBrowser(){
    const ua=navigator.userAgent||'';
    if(/firefox/i.test(ua)) return 'Firefox';
    if(/edg/i.test(ua)) return 'Edge';
    if(/chrome|crios/i.test(ua)) return 'Chrome';
    if(/safari/i.test(ua) && !/chrome|crios|edg/i.test(ua)) return 'Safari';
    return 'Unknown';
  }
  function detectOS(){
    const ua=navigator.userAgent||'';
    if(/android/i.test(ua)) return 'Android';
    if(/iphone|ipad|ipod/i.test(ua)) return 'iOS';
    if(/windows/i.test(ua)) return 'Windows';
    if(/mac os/i.test(ua)) return 'macOS';
    if(/linux/i.test(ua)) return 'Linux';
    return 'Unknown';
  }
  const visitorId = getOrSet(localStorage,VISITOR_KEY,'vis_');
  const now = Date.now();
  let sessionMeta = null;
  try { sessionMeta = JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null'); } catch {}
  if(!sessionMeta || !sessionMeta.id || !sessionMeta.started_at || now-Number(sessionMeta.last_seen_at||sessionMeta.started_at)>IDLE_TIMEOUT_MS){
    sessionMeta={id:randomId('ses_'),started_at:now,last_seen_at:now};
  } else {
    sessionMeta.last_seen_at=now;
  }
  try { sessionStorage.setItem(SESSION_KEY,JSON.stringify(sessionMeta)); } catch {}

  function currentCart(){
    try {
      const rows=JSON.parse(localStorage.getItem('bruisCartV3')||'[]');
      return Array.isArray(rows)?rows:[];
    } catch { return []; }
  }
  function cartStats(rows=currentCart()){
    return rows.reduce((a,item)=>{
      const qty=clampInt(item?.qty,0,100);
      a.lines += 1;
      a.units += qty;
      a.value_cents += Math.round(Number(item?.price||0)*100)*qty;
      return a;
    },{lines:0,units:0,value_cents:0});
  }
  function attribution(){
    try {
      const cached=JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY)||'null');
      if(cached && cached.session_id===sessionMeta.id) return cached;
    } catch {}
    const q=new URLSearchParams(location.search||'');
    const data={
      session_id:sessionMeta.id,
      utm_source:text(q.get('utm_source')),
      utm_medium:text(q.get('utm_medium')),
      utm_campaign:text(q.get('utm_campaign')),
      utm_content:text(q.get('utm_content')),
      utm_term:text(q.get('utm_term')),
      landing_referrer:document.referrer||''
    };
    try { sessionStorage.setItem(ATTRIBUTION_KEY,JSON.stringify(data)); } catch {}
    return data;
  }
  const attr=attribution();
  const pagePath=location.pathname.replace(/\/+/g,'/') || '/shop/';
  const baseExtra={
    host:location.host,
    search:location.search||'',
    hash:location.hash||'',
    screen_width:window.screen?.width||null,
    screen_height:window.screen?.height||null,
    pixel_ratio:window.devicePixelRatio||1,
    utm_source:attr.utm_source,
    utm_medium:attr.utm_medium,
    utm_campaign:attr.utm_campaign,
    utm_content:attr.utm_content,
    utm_term:attr.utm_term,
    landing_referrer:attr.landing_referrer
  };
  const base={
    page_path:pagePath,
    page_url:location.href,
    page_title:document.title||'',
    referrer_url:document.referrer||'',
    visitor_id:visitorId,
    session_id:sessionMeta.id,
    device_type:detectDevice(),
    browser_name:detectBrowser(),
    os_name:detectOS(),
    viewport_width:window.innerWidth||null,
    viewport_height:window.innerHeight||null,
    language_code:navigator.language||null,
    time_zone:(Intl.DateTimeFormat().resolvedOptions()||{}).timeZone||null,
    user_agent:navigator.userAgent||null,
    is_logged_in:false,
    player_name:null,
    is_admin:false
  };
  function send(name,label='',extra={}){
    const payload={...base,event_name:name,event_category:'shop',event_label:text(label).slice(0,120)||name,extra:{...baseExtra,...extra}};
    return fetch(ENDPOINT,{
      method:'POST',mode:'cors',cache:'no-store',keepalive:true,
      headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(payload)
    }).catch(()=>{});
  }
  function productMeta(card){
    if(!card) return {};
    const select=card.querySelector('[data-size]');
    const id=text(select?.dataset?.size || card.querySelector('[data-add]')?.dataset?.add);
    const name=text(card.querySelector('h3')?.textContent);
    const collection=text(card.dataset.productCollection);
    const size=text(select?.value);
    const qty=clampInt(card.querySelector('[data-qty]')?.value||1,1,10);
    let unitPriceCents=0;
    try {
      const product=Array.isArray(window.products)?window.products.find(p=>String(p.id)===id):null;
      const variant=product?.variants?.find(v=>String(v?.title||'').toLowerCase().includes(size.toLowerCase())) || product?.variants?.find(v=>v?.is_available!==false);
      unitPriceCents=Math.round(Number(variant?.price ?? product?.price ?? 0)*100);
    } catch {}
    return {product_id:id,product_name:name,collection,size,qty,unit_price_cents:unitPriceCents};
  }

  const pageTrackKey=`${sessionMeta.id}|${pagePath}`;
  try {
    if(sessionStorage.getItem(SHOP_TRACKED_KEY)!==pageTrackKey){
      sessionStorage.setItem(SHOP_TRACKED_KEY,pageTrackKey);
      send('page_view',pagePath,{...cartStats()});
    }
  } catch { send('page_view',pagePath,{...cartStats()}); }

  let viewed=new Set();
  try { viewed=new Set(JSON.parse(sessionStorage.getItem(PRODUCT_VIEW_KEY)||'[]')); } catch {}
  const observed=new WeakSet();
  const observer='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting || entry.intersectionRatio<0.5) continue;
      const card=entry.target;
      const meta=productMeta(card);
      if(!meta.product_id || viewed.has(meta.product_id)) continue;
      viewed.add(meta.product_id);
      try { sessionStorage.setItem(PRODUCT_VIEW_KEY,JSON.stringify([...viewed].slice(-500))); } catch {}
      send('product_view',meta.product_name,{...meta,...cartStats()});
    }
  },{threshold:[0.5]}) : null;
  function observeProducts(root=document){
    root.querySelectorAll?.('.product-card').forEach(card=>{
      if(observed.has(card)) return;
      observed.add(card);
      if(observer) observer.observe(card);
      else {
        const meta=productMeta(card);
        if(meta.product_id && !viewed.has(meta.product_id)){
          viewed.add(meta.product_id);
          send('product_view',meta.product_name,{...meta,...cartStats()});
        }
      }
    });
  }
  observeProducts();
  const mo=new MutationObserver(muts=>{
    if(muts.some(m=>m.addedNodes?.length)) observeProducts();
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('button,a');
    if(!target) return;
    const before=currentCart();
    const beforeStats=cartStats(before);

    const collectionButton=target.closest?.('[data-collection]');
    if(collectionButton){
      const collection=text(collectionButton.dataset.collection);
      send('collection_view',collection,{collection,...beforeStats});
      return;
    }
    const add=target.closest?.('[data-add]');
    if(add){
      const card=add.closest('.product-card');
      const meta=productMeta(card);
      send('add_to_cart',meta.product_name,{...meta,cart_value_before_cents:beforeStats.value_cents,cart_value_after_cents:beforeStats.value_cents+meta.unit_price_cents*meta.qty,cart_units_before:beforeStats.units});
      return;
    }
    const remove=target.closest?.('[data-remove]');
    if(remove){
      const idx=clampInt(remove.dataset.remove,0,10000);
      const item=before[idx]||{};
      send('remove_from_cart',text(item.name)||'cart item',{
        product_id:text(item.productId||item.id),product_name:text(item.name),collection:text(item.collection),
        size:text(item.size),qty:clampInt(item.qty,1,10),unit_price_cents:Math.round(Number(item.price||0)*100),...beforeStats
      });
      return;
    }
    if(target.closest?.('[data-open-cart]')){
      send('cart_open','cart',{...beforeStats});
      return;
    }
    if(target.closest?.('[data-checkout]')){
      send('checkout_start','checkout',{...beforeStats});
      return;
    }
    if(target.closest?.('[data-gallery-next],[data-gallery-prev],[data-gallery-dot]')){
      const meta=productMeta(target.closest('.product-card'));
      send('product_image_interaction',meta.product_name,{...meta,control:target.hasAttribute('data-gallery-next')?'next':target.hasAttribute('data-gallery-prev')?'previous':'dot'});
      return;
    }
    if(target.closest?.('[data-manual-status-check]')){
      send('order_status_check','order status',{...cartStats()});
      return;
    }
    const pay=target.closest?.('.manual-checkout-payment a');
    if(pay){
      let provider='';
      try { provider=new URL(pay.href).hostname; } catch {}
      send('payment_link_click','payment',{provider});
    }
  },true);

  document.addEventListener('submit',event=>{
    const form=event.target?.closest?.('[data-manual-checkout-form]');
    if(!form) return;
    const stats=cartStats();
    const country=text(form.elements?.namedItem?.('country')?.value).toUpperCase().slice(0,2);
    send('checkout_submit','checkout',{...stats,country});
  },true);

  window.addEventListener('bruis:order-created',event=>{
    const d=event.detail||{};
    send('order_created','order',{
      order_id:text(d.order_id),
      subtotal_cents:clampInt(d.subtotal_cents),
      shipping_cents:clampInt(d.shipping_cents),
      total_cents:clampInt(d.total_cents),
      payment_provider:text(d.payment_provider),
      item_count:clampInt(d.item_count,0,100),
      units:clampInt(d.units,0,1000)
    });
  });

  window.BRUIS_SHOP_ANALYTICS=Object.freeze({track:(name,extra={})=>send(name,name,extra),visitorId,sessionId:sessionMeta.id});
})();