(function(){
  const path = String(location.pathname || '').toLowerCase().split('/').pop();
  function onReady(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function isMobile(){ return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches); }
  function injectStyle(id, css){
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  function mobileScopeAwareUrl(target){
    try{
      const params = new URLSearchParams(location.search || '');
      const url = new URL(target, location.href);
      if ((params.get('scope') || '').toLowerCase() === 'family') url.searchParams.set('scope', 'family');
      return `${url.pathname}${url.search}${url.hash}`;
    }catch(_){ return target; }
  }
  function directToLadder(game){
    if (!isMobile()) return;
    try{
      const url = new URL('./ladder.html', location.href);
      url.searchParams.set('game', game);
      const scope = (new URLSearchParams(location.search).get('scope') || '').toLowerCase();
      if (scope === 'family') url.searchParams.set('scope', 'family');
      location.replace(url.toString());
    }catch(_){ }
  }
  function mountMobileDirectNote(label, href){
    if (document.getElementById('gejastMobileDirectNote')) return;
    const iframe = document.querySelector('iframe');
    const sheet = iframe && iframe.closest('.sheet');
    if (!sheet || !iframe) return;
    const box = document.createElement('div');
    box.id = 'gejastMobileDirectNote';
    box.className = 'mobile-direct-note';
    box.innerHTML = `<strong>Mobiele route</strong><span class="muted">Open ${label} direct op mobiel in plaats van via een iframe-wrapper.</span><a href="${href}" style="display:inline-flex;width:max-content;padding:10px 14px;border-radius:999px;background:#111;color:#fff;text-decoration:none;font-weight:800">Open ${label}</a>`;
    iframe.insertAdjacentElement('beforebegin', box);
  }
  function patchHome(){
    injectStyle('gejast-mobile-home-v583', `
      @media (max-width:760px){
        body{display:block !important;padding:calc(14px + env(safe-area-inset-top,0px)) 12px calc(24px + env(safe-area-inset-bottom,0px)) !important;}
        .card{width:100% !important;padding:74px 18px 20px !important;border-radius:24px !important;}
        .logo{top:16px !important;right:16px !important;width:52px !important;}
        .eyebrow{font-size:10px !important;padding:6px 9px !important;}
        .grid{grid-template-columns:1fr !important;margin-top:20px !important;}
      }
    `);
  }
  function patchPlayer(){
    injectStyle('gejast-mobile-player-v583', `
      @media (max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr)) !important;}}
      @media (max-width:760px){
        body{padding:12px !important;}
        .card{padding:18px !important;border-radius:22px !important;}
        .hero{padding-top:0 !important;min-height:0 !important;display:grid;gap:12px !important;}
        .back-btn,.brand-link{position:static !important;}
        .brand-link img{width:56px !important;height:56px !important;}
        .player-identity{grid-template-columns:72px minmax(0,1fr) !important;gap:12px !important;}
        .player-avatar,.player-avatar-fallback{width:72px !important;height:72px !important;}
        .grid{grid-template-columns:1fr !important;}
        .panel{padding:16px !important;}
        .game-tabs{display:grid !important;grid-template-columns:1fr 1fr !important;}
      }
      @media (max-width:520px){.game-tabs{grid-template-columns:1fr !important;}}
    `);
  }
  function patchScore(){
    injectStyle('gejast-mobile-score-v583', `
      @media (max-width:760px){
        body{padding:12px !important;align-items:stretch !important;}
        .main-card,.sheet,.card,.app{padding:18px !important;border-radius:22px !important;}
        .top,.hero,.row,.btn-row,.action-row{flex-direction:column !important;align-items:stretch !important;}
        .grid,.stats,.subgrid,.cards-grid,.list-grid{grid-template-columns:1fr !important;}
      }
    `);
  }
  function patchLegacySheets(){
    injectStyle('gejast-mobile-legacy-sheets-v583', `
      @media (max-width:760px){
        body{padding:12px !important;}
        .wrap{margin:0 auto 20px !important;padding:0 !important;}
        .sheet,.card,.main-card{padding:18px !important;border-radius:22px !important;}
        .top{flex-direction:column !important;align-items:flex-start !important;}
        .links,.toolbar,.panel-actions,.compact-actions,.action-row,.btn-row{width:100% !important;}
        .links a,.toolbar a,.toolbar button{flex:1 1 100% !important;justify-content:center !important;}
        .form-grid,.request-grid,.activation-grid,.activation-meta,.hub-grid,.manual-grid,.stats-grid,.grid,.subgrid,.cards-grid,.list-grid{grid-template-columns:1fr !important;}
        iframe{min-height:72vh !important;}
      }
    `);
  }
  function patchIndex(){
    injectStyle('gejast-mobile-index-v583', `
      @media (max-width:760px){
        .card-top-left{display:none !important;}
        .main-card{padding-top:88px !important;}
        .card-top-right{top:14px !important;right:14px !important;}
        .link-grid,.poll-grid,.ladder-grid,.ladder-grid.six,.lists-grid{grid-template-columns:1fr !important;}
      }
      @media (max-width:560px){
        .main-card{padding-top:84px !important;}
      }
    `);
  }
  function patchScorer(){
    injectStyle('gejast-mobile-scorer-v583', `
      @media (max-width:760px){
        .page{padding-bottom:132px !important;}
        .page-floating-logo{top:10px !important;right:10px !important;width:52px !important;height:52px !important;}
        .manage-match-chip{left:50% !important;right:auto !important;transform:translateX(-50%) !important;bottom:calc(86px + env(safe-area-inset-bottom,0px)) !important;max-width:calc(100vw - 24px);justify-content:center !important;}
      }
    `);
    window.setTimeout(()=>{
      try{
        if (typeof window.scrollActiveTakIntoView === 'function') window.scrollActiveTakIntoView('smooth', 'initial');
      }catch(_){ }
    }, 180);
  }

  function patchBoerenbridge(){
    injectStyle('gejast-mobile-boerenbridge-v583', `
      @media (max-width:760px){
        .overlay{padding:8px !important;align-items:flex-start !important;overflow:auto !important;}
        .modal{max-height:min(calc(100svh - 14px), 760px) !important;}
        .round-grid{grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:8px !important;}
        .player-card{padding:10px !important;border-radius:16px !important;}
        .player-card h3{font-size:15px !important;}
      }
      @media (max-width:340px){
        .round-grid{grid-template-columns:1fr !important;}
      }
    `);
  }
  function patchRad(){
    injectStyle('gejast-mobile-rad-v583', `
      @media (max-width:760px){
        .rad-heading{display:none !important;}
        .top{justify-content:center !important;}
        .rad-top-actions{justify-content:center !important;width:100% !important;}
        .page,.shell{padding-left:10px !important;padding-right:10px !important;}
        .layout{justify-items:center !important;}
        .layout > *{width:100% !important;max-width:520px !important;margin-inline:auto !important;}
        .wheel-wrap,.result,.status,.legend-row,.workflow-item,.result-card{text-align:center !important;justify-items:center !important;}
        .wheel-box{width:min(96vw,460px) !important;margin-inline:auto !important;justify-self:center !important;}
      }
    `);
  }
  function patchProfiles(){
    injectStyle('gejast-mobile-profiles-v583', `
      @media (max-width:760px){
        .rarity-badge{grid-template-rows:auto auto !important;}
        .rarity-badge img{width:min(100%,116px) !important;height:116px !important;}
        .badge-lightbox-card{max-width:min(calc(100vw - 14px), 640px) !important;max-height:min(calc(100svh - 14px), 760px) !important;overflow:auto !important;}
      }
    `);
  }
  function patchBallroom(){
    injectStyle('gejast-mobile-ballroom-v583', `
      @media (max-width:760px){
        .portrait-hint{padding:12px !important;}
        .portrait-hint-card{padding:18px !important;border-radius:20px !important;}
      }
    `);
  }

  function patchLegacyForms(){
    injectStyle('gejast-mobile-forms-v583', `
      @media (max-width:760px){
        body{align-items:flex-start !important;justify-content:flex-start !important;}
        .main-card,.card{margin-top:calc(4px + env(safe-area-inset-top,0px)) !important;}
      }
    `);
  }
  onReady(()=>{
    patchLegacySheets();
    switch(path){
      case 'index.html': patchIndex(); break;
      case 'home.html': patchHome(); break;
      case 'player.html': patchPlayer(); break;
      case 'score.html': patchScore(); break;
      case 'scorer.html': patchScorer(); break;
      case 'boerenbridge.html': patchBoerenbridge(); break;
      case 'rad.html': patchRad(); break;
      case 'profiles.html': patchProfiles(); break;
      case 'ballroom.html': patchBallroom(); break;
      case 'login.html':
      case 'request.html': patchLegacyForms(); break;
      case 'vault.html': mountMobileDirectNote('de klaverjas-ladder', mobileScopeAwareUrl('./ladder.html?game=klaverjas')); directToLadder('klaverjas'); break;
      case 'beerpong_vault.html': mountMobileDirectNote('de beerpong-ladder', mobileScopeAwareUrl('./ladder.html?game=beerpong')); directToLadder('beerpong'); break;
      case 'boerenbridge_vault.html': mountMobileDirectNote('de boerenbridge-ladder', mobileScopeAwareUrl('./ladder.html?game=boerenbridge')); directToLadder('boerenbridge'); break;
      default: break;
    }
  });
})();
