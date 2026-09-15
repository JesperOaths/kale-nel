(() => {
  'use strict';

  function normalizeRail(rail){
    if(!rail || rail.dataset.exactCarouselV832 === 'true') return;
    // Movement is implemented directly in store.js. This layer only marks rails
    // and supplies layout/snap guarantees; it deliberately does not monkey-patch
    // native scrolling, which previously made touch and resize behavior brittle.
    rail.dataset.exactCarouselV832 = 'true';
  }

  function scan(root=document){
    root.querySelectorAll?.('.mockup-rail').forEach(normalizeRail);
  }

  const style=document.createElement('style');
  style.dataset.galleryFixesV832='true';
  style.textContent=`
    .mockup-rail{
      display:flex!important;
      grid-auto-columns:unset!important;
      gap:0!important;
      padding:0!important;
      overflow-x:auto!important;
      overflow-y:hidden!important;
      scroll-snap-type:x mandatory!important;
      scroll-padding:0!important;
      scrollbar-width:none!important;
      background:#ded6ca!important;
    }
    .mockup-rail::-webkit-scrollbar{display:none!important}
    .mockup-rail>.mockup{
      flex:0 0 100%!important;
      width:100%!important;
      min-width:100%!important;
      max-width:100%!important;
      box-sizing:border-box!important;
      margin:0!important;
      padding:12px!important;
      scroll-snap-align:start!important;
      scroll-snap-stop:always!important;
      background:transparent!important;
    }
    .mockup-rail>.mockup>img{
      display:block!important;
      width:100%!important;
      height:auto!important;
      aspect-ratio:1/1!important;
      object-fit:contain!important;
      object-position:center!important;
      margin:0!important;
      padding:8px!important;
      box-sizing:border-box!important;
      background:transparent!important;
    }
  `;
  document.head.appendChild(style);

  const boot=()=>{
    scan(document);
    const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      if(node.matches?.('.mockup-rail')) normalizeRail(node); else scan(node);
    })));
    observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.BRUIS_GALLERY_V832=Object.freeze({oneSlideAtATime:true,partialNextSlide:false});
})();
