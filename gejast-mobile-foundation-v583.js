(function(){
  const MOBILE_QUERY = '(max-width: 760px)';
  const mq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
  function isMobile(){ return !!(mq && mq.matches); }
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function ensureViewport(){
    try{
      let meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        (document.head || document.documentElement).appendChild(meta);
      }
      const parts = String(meta.content || 'width=device-width, initial-scale=1.0').split(',').map((s)=>s.trim()).filter(Boolean);
      const filtered = parts.filter((part)=>!/^(maximum-scale|minimum-scale|user-scalable)\s*=|^user-scalable$/i.test(part));
      const normalized = [];
      const pushUnique = (value)=>{ if (!normalized.some((item)=>item.toLowerCase() === value.toLowerCase())) normalized.push(value); };
      filtered.forEach(pushUnique);
      pushUnique('width=device-width');
      pushUnique('initial-scale=1.0');
      pushUnique('viewport-fit=cover');
      meta.content = normalized.join(', ');
    }catch(_){ }
  }
  function markMobile(){
    try{
      if (isMobile()) {
        document.documentElement.setAttribute('data-gejast-mobile', '1');
        document.body && document.body.setAttribute('data-gejast-mobile', '1');
      } else {
        document.documentElement.removeAttribute('data-gejast-mobile');
        document.body && document.body.removeAttribute('data-gejast-mobile');
      }
    }catch(_){ }
  }
  function trackKeyboard(){
    try{
      const target = document.body;
      if (!target) return;
      const active = document.activeElement;
      const editable = !!(active && /^(input|textarea|select)$/i.test(active.tagName));
      target.classList.toggle('gejast-keyboard-active', editable);
      if (editable && typeof active.scrollIntoView === 'function') {
        window.setTimeout(()=>{ try{ active.scrollIntoView({ block:'center', inline:'nearest', behavior:'smooth' }); }catch(_){ } }, 120);
      }
    }catch(_){ }
  }
  function relaxBackgroundAttachment(){
    try{
      if (!isMobile() || !document.body) return;
      document.body.style.setProperty('background-attachment', 'scroll', 'important');
      document.body.style.setProperty('overflow-y', 'auto', 'important');
      document.body.style.setProperty('overflow-x', 'hidden', 'important');
    }catch(_){ }
  }
  function bindViewportResync(){
    try{
      const handler = ()=>{ markMobile(); relaxBackgroundAttachment(); trackKeyboard(); };
      window.addEventListener('resize', handler, { passive:true });
      window.addEventListener('orientationchange', handler, { passive:true });
      if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', handler, { passive:true });
      }
    }catch(_){ }
  }
  onReady(()=>{
    ensureViewport();
    markMobile();
    relaxBackgroundAttachment();
    document.addEventListener('focusin', trackKeyboard, true);
    document.addEventListener('focusout', ()=>window.setTimeout(trackKeyboard, 50), true);
    trackKeyboard();
    bindViewportResync();
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', ()=>{ markMobile(); relaxBackgroundAttachment(); });
    else if (mq && typeof mq.addListener === 'function') mq.addListener(()=>{ markMobile(); relaxBackgroundAttachment(); });
  });
})();
