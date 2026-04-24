(function(){
  const VERSION='v667';
  const SELECTOR='input, textarea, select';
  function inUserEditable(el){return !!(el && el.matches && el.matches(SELECTOR));}
  function isFocused(el){return el && document.activeElement===el;}
  function snapshot(){
    const out=[];
    document.querySelectorAll(SELECTOR).forEach((el)=>{
      if(!el || el.type==='hidden') return;
      out.push({el,value:el.value,checked:!!el.checked,selectedIndex:el.selectedIndex});
    });
    return out;
  }
  function restore(snap){
    (snap||[]).forEach((item)=>{
      const el=item.el; if(!el || !document.contains(el)) return;
      if(isFocused(el) || el.dataset.gejastProtectRefresh==='1' || el.closest('[data-gejast-input-guard]')){
        if(el.value!==item.value) el.value=item.value;
        if('checked' in el && el.checked!==item.checked) el.checked=item.checked;
        if('selectedIndex' in el && item.selectedIndex>=0 && el.selectedIndex!==item.selectedIndex) el.selectedIndex=item.selectedIndex;
      }
    });
  }
  function protectNode(el){
    if(!inUserEditable(el) || el.dataset.gejastInputGuardInstalled==='1') return;
    el.dataset.gejastInputGuardInstalled='1';
    ['input','change','focus','keydown','pointerdown','compositionstart'].forEach((ev)=>el.addEventListener(ev,()=>{el.dataset.gejastProtectRefresh='1';}, {passive:true}));
    ['blur','compositionend'].forEach((ev)=>el.addEventListener(ev,()=>{setTimeout(()=>{if(el) el.dataset.gejastProtectRefresh='1';},0);}, {passive:true}));
  }
  function installProtection(root=document){root.querySelectorAll&&root.querySelectorAll(SELECTOR).forEach(protectNode);}
  function guardAsync(fn){
    return async function guardedRefreshWrapper(){
      const snap=snapshot();
      try{return await fn.apply(this, arguments);}finally{restore(snap); setTimeout(()=>restore(snap),0); setTimeout(()=>restore(snap),150);}
    };
  }
  function wrapKnownRefreshGlobals(){
    const names=['refreshState','loadState','renderState','pollState','refreshLobby','loadLobby','loadRoom','refreshRoom'];
    names.forEach((name)=>{
      try{ if(typeof window[name]==='function' && !window[name].__gejastInputGuarded){ const wrapped=guardAsync(window[name]); wrapped.__gejastInputGuarded=true; window[name]=wrapped; } }catch(_){}
    });
  }
  function boot(){
    installProtection();
    wrapKnownRefreshGlobals();
    const mo=new MutationObserver((muts)=>{muts.forEach((m)=>m.addedNodes&&m.addedNodes.forEach((n)=>{if(n.nodeType===1){if(inUserEditable(n)) protectNode(n); installProtection(n);}}));});
    try{mo.observe(document.body,{childList:true,subtree:true});}catch(_){}
    setInterval(wrapKnownRefreshGlobals,1200);
    window.GEJAST_PAARDENRACE_INPUT_GUARD={VERSION,snapshot,restore,installProtection,wrapKnownRefreshGlobals};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
