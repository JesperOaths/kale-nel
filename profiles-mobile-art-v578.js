(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  if (path !== 'profiles.html') return;
  window.GEJAST_PAGE_VERSION='v635';
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  onReady(()=>{
    const style = document.createElement('style');
    style.textContent = `@media (max-width:760px){.rarity-badge{grid-template-columns:96px minmax(0,1fr)!important;gap:14px!important;padding:14px!important;align-items:center!important}.rarity-badge img{width:96px!important;height:96px!important;padding:8px!important;border-radius:18px!important}.rarity-badge strong{font-size:16px!important}.rarity-badge small,.rarity-requirement{font-size:13px!important;line-height:1.45!important}.mini-chip{width:56px!important;height:56px!important;border-radius:16px!important}.badge-pill img{width:30px!important;height:30px!important}}`;
    document.head.appendChild(style);
  });
})();
