(function(){
  function boot(){
    if (!/profiles\.html$/i.test(location.pathname || '')) return;
    const style = document.createElement('style');
    style.textContent = `
      @media (max-width:760px){
        .mini-chip{width:54px !important;height:54px !important;border-radius:16px !important;padding:5px !important}
        .rarity-badge{grid-template-columns:76px minmax(0,1fr) !important;gap:12px !important;padding:12px !important}
        .rarity-badge img{width:76px !important;height:76px !important;padding:7px !important;border-radius:16px !important}
        .rarity-badge strong{font-size:15px !important}
        .rarity-summary-main h3{font-size:19px !important}
      }`;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();