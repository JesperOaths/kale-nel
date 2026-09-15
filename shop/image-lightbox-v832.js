(() => {
  'use strict';

  const SWIPE_THRESHOLD=54;
  let active=null;
  const sourceOf=img=>String(img?.currentSrc||img?.src||'').trim();
  const wrapIndex=(index,length)=>((index%length)+length)%length;

  function galleryFor(sourceImg){
    const card=sourceImg?.closest?.('.product-card');
    if(!card)return {items:[],start:0};
    const items=[...card.querySelectorAll('.mockup img')].map((img,index)=>{
      const label=img.closest('.mockup')?.querySelector('figcaption')?.textContent?.trim()||`View ${index+1}`;
      return {img,src:sourceOf(img),alt:img.alt||'Product image',label};
    }).filter(item=>item.src);
    const direct=items.findIndex(item=>item.img===sourceImg);
    return {items,start:direct>=0?direct:0};
  }

  function fit(){
    if(!active)return;
    active.scale=1;active.panX=0;active.panY=0;active.dragging=false;
    active.image.style.transform='translate3d(0,0,0) scale(1)';
    active.media.classList.remove('is-zoomed');
  }
  function applyView(){
    if(!active)return;
    active.image.style.transform=`translate3d(${active.panX}px,${active.panY}px,0) scale(${active.scale})`;
    active.media.classList.toggle('is-zoomed',active.scale>1.001);
  }
  function zoomTo(nextScale,clientX,clientY){
    if(!active)return;
    const previous=active.scale;
    const next=Math.max(1,Math.min(5,Number(nextScale)||1));
    if(next!==previous&&clientX!=null&&clientY!=null){
      const rect=active.media.getBoundingClientRect();
      const x=clientX-rect.left-rect.width/2,y=clientY-rect.top-rect.height/2,ratio=next/previous;
      active.panX=(active.panX-x)*ratio+x;active.panY=(active.panY-y)*ratio+y;
    }
    active.scale=next;
    if(next===1){active.panX=0;active.panY=0;}
    applyView();
  }
  function render(){
    if(!active)return;
    const item=active.items[active.index];
    fit();active.image.removeAttribute('src');active.image.alt=item.alt;
    active.label.textContent=item.label;
    active.count.textContent=`${active.index+1} / ${active.items.length}`;
    [...active.dots.children].forEach((dot,index)=>{
      dot.classList.toggle('active',index===active.index);
      dot.setAttribute('aria-current',index===active.index?'true':'false');
    });
    const multiple=active.items.length>1;
    active.prev.hidden=!multiple;active.next.hidden=!multiple;active.dots.hidden=!multiple;
    active.image.src=item.src;
    const settle=()=>{if(active&&active.items[active.index]===item)fit();};
    if(active.image.decode)active.image.decode().then(settle).catch(settle);
    else active.image.addEventListener('load',settle,{once:true});
  }
  function goTo(index){if(active&&active.items.length){active.index=wrapIndex(index,active.items.length);render();}}
  function close(){
    if(!active)return;
    const focus=active.focusBefore;active.overlay.remove();document.documentElement.classList.remove('shop-lightbox-open-v832');active=null;focus?.focus?.({preventScroll:true});
  }
  function open(sourceImg){
    if(active)close();
    const {items,start}=galleryFor(sourceImg);if(!items.length)return;
    const overlay=document.createElement('div');
    overlay.className='shop-lightbox-v832';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Product images');
    overlay.innerHTML=`
      <div class="shop-lightbox-v832-stage">
        <button class="shop-lightbox-v832-close" type="button" data-lb-close aria-label="Close">×</button>
        <button class="shop-lightbox-v832-nav shop-lightbox-v832-prev" type="button" data-lb-prev aria-label="Previous image">‹</button>
        <div class="shop-lightbox-v832-media" data-lb-media><img data-lb-image alt="" draggable="false" /></div>
        <button class="shop-lightbox-v832-nav shop-lightbox-v832-next" type="button" data-lb-next aria-label="Next image">›</button>
        <div class="shop-lightbox-v832-meta">
          <span data-lb-label></span>
          <span class="shop-lightbox-v832-zoom"><button type="button" data-lb-zoom-out aria-label="Zoom out">−</button><button type="button" data-lb-fit>Fit</button><button type="button" data-lb-zoom-in aria-label="Zoom in">+</button></span>
          <span data-lb-count></span>
        </div>
        <div class="shop-lightbox-v832-dots" data-lb-dots></div>
      </div>`;
    document.body.appendChild(overlay);
    const media=overlay.querySelector('[data-lb-media]'),image=overlay.querySelector('[data-lb-image]'),dots=overlay.querySelector('[data-lb-dots]'),prev=overlay.querySelector('[data-lb-prev]'),next=overlay.querySelector('[data-lb-next]'),label=overlay.querySelector('[data-lb-label]'),count=overlay.querySelector('[data-lb-count]');
    items.forEach((_,index)=>{const dot=document.createElement('button');dot.type='button';dot.dataset.lbDot=String(index);dot.setAttribute('aria-label',`Show image ${index+1}`);dots.appendChild(dot);});
    active={overlay,media,image,dots,prev,next,label,count,items,index:start,scale:1,panX:0,panY:0,pointerId:null,pointerX:0,pointerY:0,dragging:false,focusBefore:document.activeElement};
    document.documentElement.classList.add('shop-lightbox-open-v832');requestAnimationFrame(()=>overlay.classList.add('is-open'));render();overlay.querySelector('[data-lb-close]')?.focus({preventScroll:true});
  }

  document.addEventListener('click',event=>{
    const source=event.target.closest?.('.product-card .mockup img');
    if(source&&!event.target.closest('.shop-lightbox-v832')){event.preventDefault();open(source);return;}
    if(!active)return;
    const target=event.target;
    if(target.closest?.('[data-lb-close]'))return close();
    if(target.closest?.('[data-lb-prev]'))return goTo(active.index-1);
    if(target.closest?.('[data-lb-next]'))return goTo(active.index+1);
    if(target.closest?.('[data-lb-fit]'))return fit();
    if(target.closest?.('[data-lb-zoom-in]'))return zoomTo(active.scale+.5);
    if(target.closest?.('[data-lb-zoom-out]'))return zoomTo(active.scale-.5);
    const dot=target.closest?.('[data-lb-dot]');if(dot)return goTo(Number(dot.dataset.lbDot));
    if(target===active.overlay)close();
  });
  document.addEventListener('keydown',event=>{if(!active)return;if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='ArrowLeft'){event.preventDefault();goTo(active.index-1);}else if(event.key==='ArrowRight'){event.preventDefault();goTo(active.index+1);}});
  document.addEventListener('wheel',event=>{if(!active||!event.target.closest?.('[data-lb-media]'))return;event.preventDefault();zoomTo(active.scale+(event.deltaY<0?.3:-.3),event.clientX,event.clientY);},{passive:false});
  document.addEventListener('dblclick',event=>{if(!active||!event.target.closest?.('[data-lb-media]'))return;event.preventDefault();if(active.scale>1.001)fit();else zoomTo(2,event.clientX,event.clientY);});
  document.addEventListener('pointerdown',event=>{if(!active||!event.target.closest?.('[data-lb-media]'))return;active.pointerId=event.pointerId;active.pointerX=event.clientX;active.pointerY=event.clientY;active.dragging=active.scale>1.001;active.media.setPointerCapture?.(event.pointerId);});
  document.addEventListener('pointermove',event=>{if(!active||active.pointerId!==event.pointerId||!active.dragging)return;active.panX+=event.movementX||0;active.panY+=event.movementY||0;applyView();});
  function finishPointer(event){if(!active||active.pointerId!==event.pointerId)return;const dx=event.clientX-active.pointerX,dy=event.clientY-active.pointerY,wasDragging=active.dragging;active.pointerId=null;active.dragging=false;if(!wasDragging&&event.type!=='pointercancel'&&Math.abs(dx)>=SWIPE_THRESHOLD&&Math.abs(dx)>Math.abs(dy))goTo(active.index+(dx<0?1:-1));}
  document.addEventListener('pointerup',finishPointer);document.addEventListener('pointercancel',finishPointer);window.addEventListener('resize',()=>{if(active)fit();},{passive:true});

  const style=document.createElement('style');style.dataset.shopLightboxV832='true';style.textContent=`
    html.shop-lightbox-open-v832,html.shop-lightbox-open-v832 body{overflow:hidden!important}
    .product-card .mockup img{cursor:zoom-in}
    .shop-lightbox-v832{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(20,18,16,0);backdrop-filter:blur(0);transition:background .2s ease,backdrop-filter .2s ease}
    .shop-lightbox-v832.is-open{background:rgba(20,18,16,.68);backdrop-filter:blur(7px)}
    .shop-lightbox-v832-stage{position:relative;width:min(94vw,1320px);height:min(92vh,960px);display:grid;grid-template-columns:58px minmax(0,1fr) 58px;grid-template-rows:minmax(0,1fr) auto auto;align-items:center;gap:8px 12px;padding:clamp(14px,2vw,24px);border-radius:22px;background:#ded6ca;box-shadow:0 28px 90px rgba(0,0,0,.36);overflow:hidden}
    .shop-lightbox-v832-media{grid-column:2;grid-row:1;width:100%;height:100%;min-height:0;display:grid;place-items:center;overflow:hidden;padding:clamp(28px,4vw,60px);border-radius:16px;background:#ded6ca;touch-action:none;user-select:none}
    .shop-lightbox-v832-media img{display:block;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;object-position:center!important;background:transparent!important;transform:translate3d(0,0,0) scale(1);transform-origin:center;user-select:none;-webkit-user-drag:none;transition:transform .1s ease-out}
    .shop-lightbox-v832-media.is-zoomed{cursor:grab}.shop-lightbox-v832-media.is-zoomed:active{cursor:grabbing}
    .shop-lightbox-v832-close,.shop-lightbox-v832-nav,.shop-lightbox-v832-zoom button{border:1px solid rgba(31,28,24,.13);background:rgba(255,255,255,.90);color:#1f1c18;box-shadow:0 4px 16px rgba(0,0,0,.10);cursor:pointer}
    .shop-lightbox-v832-close{position:absolute;z-index:3;top:14px;right:14px;width:44px;height:44px;border-radius:999px;font:400 30px/1 system-ui,sans-serif}
    .shop-lightbox-v832-nav{width:50px;height:58px;border-radius:14px;font:300 42px/1 system-ui,sans-serif}.shop-lightbox-v832-prev{grid-column:1;grid-row:1}.shop-lightbox-v832-next{grid-column:3;grid-row:1}
    .shop-lightbox-v832-meta{grid-column:1/-1;grid-row:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;min-height:36px;font:600 13px/1.35 system-ui,sans-serif;color:rgba(31,28,24,.78)}.shop-lightbox-v832-meta>[data-lb-count]{justify-self:end}.shop-lightbox-v832-zoom{display:flex;align-items:center;gap:6px}.shop-lightbox-v832-zoom button{min-width:38px;height:34px;padding:0 10px;border-radius:10px;font:700 14px/1 system-ui,sans-serif}
    .shop-lightbox-v832-dots{grid-column:1/-1;grid-row:3;display:flex;justify-content:center;gap:7px;min-height:12px}.shop-lightbox-v832-dots button{width:8px;height:8px;padding:0;border:0;border-radius:999px;background:rgba(31,28,24,.28);cursor:pointer}.shop-lightbox-v832-dots button.active{width:24px;background:rgba(31,28,24,.82)}
    @media(max-width:700px){.shop-lightbox-v832{padding:8px}.shop-lightbox-v832-stage{width:96vw;height:90dvh;grid-template-columns:42px minmax(0,1fr) 42px;gap:6px;padding:10px;border-radius:18px}.shop-lightbox-v832-nav{width:40px;height:48px;font-size:34px}.shop-lightbox-v832-close{top:10px;right:10px;width:40px;height:40px}.shop-lightbox-v832-media{padding:22px 8px}.shop-lightbox-v832-media img{max-width:100%!important;max-height:100%!important}.shop-lightbox-v832-meta{font-size:12px;grid-template-columns:1fr auto 1fr}}
    @media(prefers-reduced-motion:reduce){.shop-lightbox-v832,.shop-lightbox-v832-media img{transition:none!important}}
  `;document.head.appendChild(style);
  window.BRUIS_LIGHTBOX_V832=Object.freeze({allGalleryImages:true,fitMode:'media-contained',artworkFirstCompatible:true});
})();
