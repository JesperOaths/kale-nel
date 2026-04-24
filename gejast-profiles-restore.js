(function(global){
  'use strict';
  const STATE = { installed:false, lastReport:null };
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true }); else fn(); }
  function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function normalizeName(value){ return String(value || '').replace(/\s+/g,' ').trim(); }
  function initials(name){ return normalizeName(name).split(' ').filter(Boolean).slice(0,2).map((p)=>p[0]).join('').toUpperCase() || 'P'; }
  function ensureAvatarFallbacks(){
    qsa('img').forEach((img)=>{
      const alt = normalizeName(img.getAttribute('alt') || img.dataset.playerName || img.closest('[data-player-name]')?.getAttribute('data-player-name') || '');
      if (img.dataset.gejastAvatarFallback === '1') return;
      img.dataset.gejastAvatarFallback = '1';
      img.addEventListener('error', ()=>{
        const box = document.createElement('span');
        box.className = 'gejast-avatar-fallback';
        box.textContent = initials(alt);
        box.style.cssText = 'display:inline-grid;place-items:center;width:48px;height:48px;border-radius:50%;background:#f4efe4;border:1px solid rgba(154,130,65,.32);color:#5d4820;font-weight:900;';
        img.replaceWith(box);
      }, { once:true });
    });
  }
  function ensureBadgeEmptyStates(){
    const likelyContainers = qsa('[data-badges], [data-badge-list], .badge-list, .badges, .player-badges, #badgesBox, #badgeGrid');
    likelyContainers.forEach((box)=>{
      if (box.dataset.gejastBadgeRestoreChecked === '1') return;
      box.dataset.gejastBadgeRestoreChecked = '1';
      const hasBadge = !!box.querySelector('[data-badge], .badge, .badge-card, .badge-item, li, article');
      if (!hasBadge && !String(box.textContent || '').trim()) {
        const empty = document.createElement('div');
        empty.className = 'gejast-badge-empty-state';
        empty.textContent = 'Nog geen badges zichtbaar voor deze speler.';
        empty.style.cssText = 'padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.72);border:1px solid rgba(0,0,0,.08);color:#6b6257;font-size:13px;';
        box.appendChild(empty);
      }
    });
  }
  function ensureProfileSurfaceMarker(){
    if (document.querySelector('[data-phase5-profile-restore]')) return;
    const marker = document.createElement('div');
    marker.setAttribute('data-phase5-profile-restore','');
    marker.style.cssText = 'display:none';
    marker.textContent = 'phase5 profile restore helper active';
    document.body && document.body.appendChild(marker);
  }
  function browserReport(){
    const report = {
      ok:true,
      page: location.pathname.split('/').pop() || 'unknown',
      profileCards: qsa('[data-player-name], .profile-card, .player-card, .profile-tile').length,
      badgeContainers: qsa('[data-badges], [data-badge-list], .badge-list, .badges, .player-badges, #badgesBox, #badgeGrid').length,
      avatarImages: qsa('img').filter((img)=>/avatar|profile|player/i.test(`${img.className} ${img.id} ${img.alt}`)).length,
      sourceOwners: {
        profileSource: !!global.GEJAST_PROFILE_SOURCE,
        badgeSource: !!global.GEJAST_BADGE_SOURCE,
        badgeProgress: !!global.GEJAST_BADGE_PROGRESS
      },
      checkedAt: new Date().toISOString()
    };
    STATE.lastReport = report;
    return report;
  }
  function install(){
    if (STATE.installed) return;
    STATE.installed = true;
    ensureProfileSurfaceMarker();
    ensureAvatarFallbacks();
    ensureBadgeEmptyStates();
    browserReport();
    try {
      const mo = new MutationObserver(()=>{ ensureAvatarFallbacks(); ensureBadgeEmptyStates(); browserReport(); });
      mo.observe(document.body, { childList:true, subtree:true });
      STATE.observer = mo;
    } catch (_) {}
  }
  global.GEJAST_PROFILES_RESTORE = { install, browserReport, state: STATE };
  ready(install);
})(window);
