(() => {
  'use strict';

  function selectMedium(root=document){
    root.querySelectorAll?.('select[data-size]').forEach(select=>{
      if(select.dataset.defaultSizeV827==='true') return;
      select.dataset.defaultSizeV827='true';
      const option=[...select.options].find(item=>/^m$/i.test(String(item.value||item.textContent||'').trim()));
      if(option){
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
      }
    });
  }

  function scrubSupplierNames(root=document){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node=>{
      const value=node.nodeValue||'';
      const next=value
        .replace(/Printify/gi,'production service')
        .replace(/Shopify/gi,'shop service');
      if(next!==value) node.nodeValue=next;
    });
  }

  function boot(){
    selectMedium();
    scrubSupplierNames(document.body);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1) return;
      selectMedium(node);
      scrubSupplierNames(node);
    }))).observe(document.body,{childList:true,subtree:true});
  }

  const style=document.createElement('style');
  style.dataset.shopUiV827='true';
  style.textContent=`
    .mockup-rail {
      grid-auto-columns: 100% !important;
      gap: 0 !important;
      padding: 12px !important;
      background: #ded6ca !important;
    }
    .mockup {
      border-color: transparent !important;
      background: #ded6ca !important;
      box-shadow: none !important;
    }
    .mockup img {
      width: 100% !important;
      aspect-ratio: 1 / 1 !important;
      padding: 8px !important;
      object-fit: contain !important;
      object-position: center !important;
      background: #ded6ca !important;
    }
    .shop-lightbox-stage {
      width: min(92vw, 1080px) !important;
      height: min(87vh, 820px) !important;
      background: #ded6ca !important;
    }
    .shop-lightbox-media {
      padding: clamp(24px, 4.5vw, 64px) !important;
      background: #ded6ca !important;
    }
    .shop-lightbox-media img {
      width: 88% !important;
      height: 88% !important;
      max-width: 88% !important;
      max-height: 88% !important;
      object-fit: contain !important;
      object-position: center !important;
      margin: auto !important;
      background: #ded6ca !important;
    }
    @media(max-width:640px){
      .shop-lightbox-stage{width:96vw !important;height:84vh !important;}
      .shop-lightbox-media{padding:22px !important;}
      .shop-lightbox-media img{width:92% !important;height:92% !important;max-width:92% !important;max-height:92% !important;}
    }
  `;
  document.head.appendChild(style);

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
