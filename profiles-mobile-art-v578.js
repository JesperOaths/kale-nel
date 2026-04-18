(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  if (path !== 'profiles.html') return;
  window.GEJAST_PAGE_VERSION = 'v579';
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  onReady(()=>{
    const style = document.createElement('style');
    style.textContent = `@media (max-width:760px){.rarity-badge{grid-template-columns:84px minmax(0,1fr)!important;gap:12px!important;padding:12px!important;align-items:center!important}.rarity-badge img{width:84px!important;height:84px!important;padding:8px!important;border-radius:18px!important}.rarity-badge strong{font-size:15px!important}.rarity-badge small,.rarity-requirement{font-size:13px!important;line-height:1.45!important}.mini-chip{width:52px!important;height:52px!important;border-radius:16px!important}.badge-pill img{width:28px!important;height:28px!important}}`;
    document.head.appendChild(style);
  });
})();
