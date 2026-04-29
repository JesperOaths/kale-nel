(function(){
  const blockedStylePrefixes = ['gejast-mobile-foundation-'];
  const blockedModulePrefixes = ['gejast-mobile-foundation-','gejast-mobile-route-fixes-','home-deep-links-','profiles-mobile-art-','pikken-deep-mobile-','paardenrace-deep-mobile-'];
  function shouldBlock(name, prefixes){
    const value = String(name || '').replace(/^\.\//,'').toLowerCase();
    return prefixes.some((prefix)=>value.startsWith(prefix));
  }
  function strip(){
    try {
      document.querySelectorAll('link[data-gejast-style]').forEach((node)=>{
        const name = node.getAttribute('data-gejast-style') || '';
        if (shouldBlock(name, blockedStylePrefixes)) node.remove();
      });
      document.querySelectorAll('script[data-gejast-module]').forEach((node)=>{
        const name = node.getAttribute('data-gejast-module') || '';
        if (shouldBlock(name, blockedModulePrefixes)) node.remove();
      });
      document.documentElement.removeAttribute('data-gejast-mobile');
      if (document.body) {
        document.body.removeAttribute('data-gejast-mobile');
        document.body.classList.remove('drawer-open','gejast-keyboard-active');
      }
    } catch(_){}
  }
  strip();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', strip, { once:true });
  } else {
    strip();
  }
})();
