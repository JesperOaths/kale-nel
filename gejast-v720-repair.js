(function(){
  const VERSION = 'v720';
  const TERMINAL = new Set(['finished','closed','deleted','abandoned','archived']);
  function onReady(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, {once:true}); else fn(); }
  function text(v){ return String(v == null ? '' : v); }
  function normRoom(raw){
    let v = text(raw).trim();
    if (!v) return '';
    v = v.replace(/\+/g, ' ');
    for (let i=0; i<4 && /%[0-9a-f]{2}/i.test(v); i++) {
      try { const d = decodeURIComponent(v); if (d === v) break; v = d; } catch(_) { break; }
      v = v.replace(/\+/g, ' ');
    }
    return v.toUpperCase().replace(/\s+/g,' ').replace(/[^A-Z0-9 _-]/g,'').trim();
  }
  window.GEJAST_NORMALIZE_ROOM_CODE_V720 = normRoom;

  function clearPikkenStoredGame(){
    try { localStorage.removeItem('gejast_pikken_participant_v687'); localStorage.removeItem('gejast_pikken_participant_v632'); } catch(_) {}
  }
  function patchPikkenContract(){
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || api.__v720Patched) return;
    api.__v720Patched = true;
    const oldGetState = api.getState && api.getState.bind(api);
    if (oldGetState) api.getState = async function(gameId, code){
      const payload = await oldGetState(gameId, code);
      const ph = text(payload?.game?.state?.phase || payload?.game?.status || payload?.game?.status || '').toLowerCase();
      if (TERMINAL.has(ph)) {
        clearPikkenStoredGame();
        try { window.__GEJAST_PIKKEN_TERMINAL_GAME_V720 = { gameId, phase: ph, at: Date.now() }; } catch(_) {}
      }
      return payload;
    };
  }
  function monitorPikkenLive(){
    if (!/pikken_live\.html/i.test(location.pathname)) return;
    const hideStatusLayer = () => {
      document.querySelectorAll('section, .panel, div').forEach((node)=>{
        const h = node.querySelector && node.querySelector('h2');
        if (h && /pikken\s+statuslaag/i.test(h.textContent || '')) node.style.display = 'none';
      });
      const mc = document.getElementById('mobileContext'); if (mc) mc.style.display = 'none';
    };
    const check = () => {
      hideStatusLayer();
      const phase = text(document.getElementById('phasePill')?.textContent).trim().toLowerCase();
      const meta = text(document.getElementById('metaLine')?.textContent).toLowerCase();
      const body = text(document.body && document.body.innerText).toLowerCase();
      if (TERMINAL.has(phase) || /\bfinished\b|\bgesloten\b|\babandoned\b/.test(meta)) {
        clearPikkenStoredGame();
        const status = document.getElementById('metaLine');
        if (status) status.textContent = 'Match is afgelopen; terug naar de lobby...';
        setTimeout(()=>{ location.replace('./pikken.html'); }, 1200);
      }
      if (/column\s+gp\.is_ready\s+does\s+not\s+exist/i.test(body)) {
        const status = document.getElementById('metaLine');
        if (status) status.textContent = 'Pikken SQL gebruikt nog gp.is_ready; run GEJAST_v720_pikken_ready_terminal_cleanup.sql.';
      }
    };
    onReady(check); setInterval(check, 900);
  }
  function ensurePikkenDiceSelector(){
    if (!/pikken\.html/i.test(location.pathname)) return;
    function add(){
      const sticky = document.getElementById('pkLobbySticky');
      if (!sticky || document.getElementById('pkStartDice')) return;
      const field = document.createElement('div');
      field.className = 'field';
      field.id = 'pkLobbyDiceField';
      field.style.maxWidth = '280px';
      field.style.marginTop = '0';
      field.innerHTML = '<label>Startdobbelstenen</label><select id="pkStartDice"><option value="1">1 dobbelsteen</option><option value="2">2 dobbelstenen</option><option value="3">3 dobbelstenen</option><option value="4">4 dobbelstenen</option><option value="5">5 dobbelstenen</option><option value="6" selected>6 dobbelstenen</option><option value="7">7 dobbelstenen</option><option value="8">8 dobbelstenen</option></select>';
      const actions = sticky.querySelector('.sticky-lobby-actions');
      sticky.insertBefore(field, actions || null);
    }
    onReady(add); setInterval(add, 1500);
  }
  function patchPaardenraceApi(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || api.__v720Patched) return;
    api.__v720Patched = true;
    const oldScope = api.scope || (()=>'friends');
    api.normalizeRoomCode = normRoom;
    const oldSet = api.setStoredRoomCode && api.setStoredRoomCode.bind(api);
    api.setStoredRoomCode = function(code){ return oldSet ? oldSet(normRoom(code)) : undefined; };
    const oldGet = api.getStoredRoomCode && api.getStoredRoomCode.bind(api);
    api.getStoredRoomCode = function(){ return normRoom(oldGet ? oldGet() : ''); };
    api.liveHref = function(room){
      const code = normRoom(room);
      const url = new URL('./paardenrace_live.html', window.location.href);
      if (code) { url.searchParams.set('room', code); url.searchParams.set('live', code); }
      try { if (oldScope() === 'family') url.searchParams.set('scope','family'); } catch(_) {}
      return `${url.pathname.split('/').pop()}${url.search}`;
    };
    api.gotoLive = function(room, options={}){ const href = api.liveHref(room); if(options && options.replace) location.replace(href); else location.href = href; };
  }
  function normalizePaardenraceLocation(){
    if (!/paardenrace(_live)?\.html/i.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const raw = params.get('room') || params.get('live') || '';
    const clean = normRoom(raw);
    if (clean) {
      try { localStorage.setItem('gejast_paardenrace_room_code_v687', clean); localStorage.removeItem('gejast_paardenrace_room_code_v506'); } catch(_) {}
      const roomInput = document.getElementById('roomCodeInput'); if (roomInput) roomInput.value = clean;
      if (raw && clean !== raw) {
        params.set('room', clean); params.set('live', clean);
        const qs = params.toString();
        history.replaceState(null, '', `${location.pathname.split('/').pop()}?${qs}${location.hash || ''}`);
      }
    }
    document.querySelectorAll('a[href*="paardenrace_live.html"]').forEach((a)=>{
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        const c = normRoom(u.searchParams.get('room') || u.searchParams.get('live'));
        if (c) { u.searchParams.set('room', c); u.searchParams.set('live', c); a.setAttribute('href', `${u.pathname.split('/').pop()}${u.search}`); }
      } catch(_) {}
    });
  }
  function hideManualJoinControls(){
    const ids = ['pkJoinFieldWrap','pkJoinWrap','pkJoinCode','pkJoinLobbyBtn','joinBtn'];
    ids.forEach((id)=>{ const el=document.getElementById(id); if(el) { el.classList.add('hidden'); el.style.display='none'; } });
    const roomInput = document.getElementById('roomCodeInput');
    if (roomInput) { roomInput.readOnly = true; roomInput.setAttribute('aria-readonly','true'); roomInput.style.display='none'; }
  }
  function installBadgeLayoutCss(){
    if (!/profiles\.html/i.test(location.pathname) || document.getElementById('gejast-v720-badge-css')) return;
    const s=document.createElement('style'); s.id='gejast-v720-badge-css';
    s.textContent = '.badge-list{display:grid!important;grid-template-columns:1fr!important;gap:16px!important;padding:0 16px 16px!important}.badge-row{display:grid!important;grid-template-columns:1fr!important;gap:12px!important;align-items:start!important;min-height:0!important}.badge-icon{width:min(220px,100%)!important;height:auto!important;aspect-ratio:1/1!important;object-fit:contain!important;justify-self:center!important;border-radius:18px!important}.badge-title{display:grid!important;grid-template-columns:1fr!important;gap:6px!important}.badge-pill{justify-self:start!important}.badge-desc,.badge-req{font-size:13px!important;line-height:1.35!important}';
    document.head.appendChild(s);
  }
  function boot(){
    patchPikkenContract();
    patchPaardenraceApi();
    normalizePaardenraceLocation();
    hideManualJoinControls();
    installBadgeLayoutCss();
    ensurePikkenDiceSelector();
    monitorPikkenLive();
  }
  onReady(boot);
  setInterval(boot, 700);
})();