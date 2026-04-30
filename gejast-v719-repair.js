(function(){
  'use strict';
  const VERSION = 'v719';
  const PIKKEN_KEYS = ['gejast_pikken_participant_v687','gejast_pikken_participant_v632'];
  const PAARDEN_KEYS = ['gejast_paardenrace_room_code_v687','gejast_paardenrace_room_code_v506'];
  const TERMINAL = new Set(['finished','deleted','closed','abandoned','archived']);
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const qs = (id)=>document.getElementById(id);
  function page(){ return String(location.pathname||'').split('/').pop().toLowerCase(); }
  function isPage(name){ return page() === String(name||'').toLowerCase(); }
  function decodeLoop(value){
    let out = String(value || '').trim();
    for (let i = 0; i < 5; i += 1) {
      try {
        const next = decodeURIComponent(out);
        if (next === out) break;
        out = next;
      } catch (_) { break; }
    }
    return out;
  }
  function normCode(value){
    return decodeLoop(value).toUpperCase().replace(/%2520/gi,' ').replace(/%20/gi,' ').replace(/\+/g,' ').replace(/\s+/g,' ').replace(/[^A-Z0-9 _-]/g,'').trim();
  }
  function displayDespinoza(value){ return normCode(value).replace(/^DESPINOZA\s+(\d+)$/i, 'Despinoza $1'); }
  function setVersionGlobals(){
    window.GEJAST_SITE_VERSION = VERSION;
    window.GEJAST_PAGE_VERSION = VERSION;
    if (window.GEJAST_CONFIG) {
      window.GEJAST_CONFIG.VERSION = VERSION;
      window.GEJAST_CONFIG.VERSION_LABEL = `${VERSION}  -  Made by Bruis`;
    }
  }
  function applyWatermark(){
    setVersionGlobals();
    const label = `${VERSION}  -  Made by Bruis`;
    document.querySelectorAll('[data-version-watermark],.site-credit-watermark,#versionWatermark,.watermark,.version-tag').forEach((node)=>{ node.textContent = label; });
  }
  function clearKeys(keys){ keys.forEach((key)=>{ try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (_) {} }); }
  function stripQuery(keys){
    try {
      const url = new URL(location.href);
      let changed = false;
      keys.forEach((key)=>{ if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; } });
      if (changed) history.replaceState(null, '', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
    } catch (_) {}
  }
  function hideManualJoinSurfaces(){
    if (!document.getElementById('gejast-v719-repair-css')) {
      const style = document.createElement('style');
      style.id = 'gejast-v719-repair-css';
      style.textContent = `
        #pkJoinFieldWrap,#pkJoinWrap,#joinBtn{display:none!important;visibility:hidden!important;}
        #roomCodeInput{position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;}
        #roomCodeInput[data-v719-hidden="1"]{display:none!important;}
        .gejast-v719-hidden-field{display:none!important;}
        .gejast-v719-terminal-note{margin:12px 0;padding:12px 14px;border-radius:16px;background:#fff4f2;border:1px solid rgba(138,16,34,.2);color:#8a1022;font-weight:900;}
        .badge-list{display:grid!important;grid-template-columns:1fr!important;gap:14px!important;}
        .badge-row{display:grid!important;grid-template-columns:1fr!important;align-items:stretch!important;gap:12px!important;min-height:0!important;padding:14px!important;}
        .badge-row .badge-icon,.badge-icon{display:block!important;width:100%!important;max-width:360px!important;height:auto!important;max-height:260px!important;aspect-ratio:auto!important;object-fit:contain!important;justify-self:center!important;border-radius:16px!important;}
        .badge-title{display:grid!important;grid-template-columns:1fr!important;gap:6px!important;}
        .badge-pill{justify-self:start!important;width:max-content!important;}
        .badge-desc,.badge-req{font-size:13px!important;line-height:1.42!important;}
        @media (max-width:700px){.badge-row .badge-icon,.badge-icon{max-width:100%!important;max-height:220px!important;}}
      `;
      document.head.appendChild(style);
    }
    ['pkJoinFieldWrap','pkJoinWrap'].forEach((id)=>{ const el = qs(id); if (el) { el.classList.add('hidden'); el.style.display = 'none'; } });
    const joinBtn = qs('joinBtn'); if (joinBtn) { joinBtn.classList.add('hidden'); joinBtn.style.display = 'none'; }
    const roomInput = qs('roomCodeInput');
    if (roomInput) {
      const cleaned = normCode(roomInput.value || '');
      if (cleaned) roomInput.value = cleaned;
      roomInput.readOnly = true;
      roomInput.tabIndex = -1;
      roomInput.setAttribute('aria-hidden','true');
      roomInput.setAttribute('data-v719-hidden','1');
      const field = roomInput.closest('.field');
      if (field) field.classList.add('gejast-v719-hidden-field');
    }
    document.querySelectorAll('.small,.muted').forEach((node)=>{
      const txt = String(node.textContent || '');
      if (/Maak of join een room|join een room|Vul een lobbycode/i.test(txt)) node.textContent = 'Maak een lobby of join via de Join-knop op een zichtbare lobbykaart.';
    });
  }
  function terminalPhase(payload){
    const status = String(payload?.game?.status || payload?.room?.stage || '').toLowerCase();
    const phase = String(payload?.game?.state?.phase || payload?.game?.phase || payload?.phase || '').toLowerCase();
    return TERMINAL.has(status) || TERMINAL.has(phase);
  }
  function normalizeReadyPayload(payload){
    if (!payload || typeof payload !== 'object') return payload;
    if (payload.viewer && typeof payload.viewer === 'object') {
      if (payload.viewer.is_ready == null && payload.viewer.ready != null) payload.viewer.is_ready = !!payload.viewer.ready;
      if (payload.viewer.ready == null && payload.viewer.is_ready != null) payload.viewer.ready = !!payload.viewer.is_ready;
    }
    if (Array.isArray(payload.players)) {
      payload.players.forEach((p)=>{
        if (!p || typeof p !== 'object') return;
        if (p.is_ready == null && p.ready != null) p.is_ready = !!p.ready;
        if (p.ready == null && p.is_ready != null) p.ready = !!p.is_ready;
      });
    }
    return payload;
  }
  function redirectToPikkenLobby(reason){
    clearKeys(PIKKEN_KEYS);
    const msg = encodeURIComponent(reason || 'closed');
    setTimeout(()=>{ location.replace(`./pikken.html?cleared_game=1&reason=${msg}`); }, 180);
  }
  function installPikkenContractPatch(){
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || api.__v719_patched) return false;
    api.__v719_patched = true;
    const origRpc = api.rpc;
    if (typeof origRpc === 'function') {
      api.rpc = function(name, payload, timeoutMs){
        return origRpc.call(api, name, payload, timeoutMs).then((out)=>normalizeReadyPayload(out));
      };
    }
    const origGetState = api.getState;
    if (typeof origGetState === 'function') {
      api.getState = async function(gameId, code){
        const payload = normalizeReadyPayload(await origGetState.call(api, gameId, code));
        if (terminalPhase(payload)) {
          clearKeys(PIKKEN_KEYS);
          if (isPage('pikken_live.html')) redirectToPikkenLobby('finished');
        }
        return payload;
      };
    }
    ['openLobbies','liveMatches'].forEach((fn)=>{
      const orig = api[fn];
      if (typeof orig !== 'function') return;
      api[fn] = async function(){
        const out = await orig.apply(api, arguments);
        const rows = Array.isArray(out) ? out : (out?.rows || out?.items || out?.lobbies || out?.matches || []);
        const clean = rows.filter((r)=>!TERMINAL.has(String(r.status || r.phase || '').toLowerCase()));
        if (Array.isArray(out)) return clean;
        return Object.assign({}, out || {}, { rows: clean, items: clean, lobbies: clean, matches: clean });
      };
    });
    if (typeof api.updateLobbyConfig !== 'function' && typeof api.rpc === 'function') {
      api.updateLobbyConfig = function(gameId, config){
        const token = api.sessionToken ? api.sessionToken() : '';
        return api.rpc('pikken_update_lobby_config_v715', {
          session_token: token || null,
          session_token_input: token || null,
          game_id_input: gameId,
          config_input: config || {},
          site_scope_input: api.scope ? api.scope() : 'friends'
        }, 3200);
      };
    }
    api.startGameV719 = function(gameId){
      const token = api.sessionToken ? api.sessionToken() : '';
      return api.rpc('pikken_start_game_scoped_v719', {
        session_token: token || null,
        session_token_input: token || null,
        game_id_input: gameId,
        site_scope_input: api.scope ? api.scope() : 'friends'
      }, 4200);
    };
    return true;
  }
  function installPikkenPageGuards(){
    if (!isPage('pikken.html') && !isPage('pikken_live.html')) return;
    hideManualJoinSurfaces();
    const clearReason = new URLSearchParams(location.search).get('cleared_game');
    if (clearReason) {
      clearKeys(PIKKEN_KEYS);
      stripQuery(['game_id','client_match_id','cleared_game','reason']);
      const st = qs('pkStatus') || qs('metaLine');
      if (st) st.textContent = 'Gesloten/afgeronde Pikken-match is gewist; je wordt niet meer automatisch teruggestuurd.';
    }
    if (isPage('pikken_live.html')) {
      hidePikkenStatusLayer();
      const pill = qs('phasePill');
      const meta = qs('metaLine');
      if (/finished|closed|deleted|abandoned/i.test(`${pill?.textContent || ''} ${meta?.textContent || ''}`)) redirectToPikkenLobby('finished');
      setInterval(()=>{
        hidePikkenStatusLayer();
        const text = `${qs('phasePill')?.textContent || ''} ${qs('metaLine')?.textContent || ''}`;
        if (/finished|closed|deleted|abandoned/i.test(text)) redirectToPikkenLobby('finished');
      }, 700);
    }
  }
  function hidePikkenStatusLayer(){
    document.querySelectorAll('section,.panel,div').forEach((node)=>{
      if (node.dataset && node.dataset.v719HiddenStatusLayer) return;
      const h = node.querySelector && node.querySelector('h2');
      const text = String(h?.textContent || '').trim().toLowerCase();
      if (text === 'pikken statuslaag') {
        node.dataset.v719HiddenStatusLayer = '1';
        node.style.display = 'none';
      }
    });
  }
  function normalizePaardenraceUrl(){
    if (!isPage('paardenrace_live.html')) return '';
    try {
      const url = new URL(location.href);
      const raw = url.searchParams.get('room') || url.searchParams.get('live') || '';
      const clean = normCode(raw);
      if (clean) {
        let changed = false;
        if (url.searchParams.get('room') !== clean) { url.searchParams.set('room', clean); changed = true; }
        if (url.searchParams.get('live') !== clean) { url.searchParams.set('live', clean); changed = true; }
        if (changed) history.replaceState(null, '', `${url.pathname.split('/').pop()}${url.search}${url.hash}`);
      }
      return clean;
    } catch (_) { return ''; }
  }
  function redirectToPaardenLobby(reason){
    clearKeys(PAARDEN_KEYS);
    const msg = encodeURIComponent(reason || 'closed');
    setTimeout(()=>{ location.replace(`./paardenrace.html?cleared_room=1&reason=${msg}`); }, 220);
  }
  function installPaardenApiPatch(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || api.__v719_patched) return false;
    api.__v719_patched = true;
    const origSet = api.setStoredRoomCode;
    const origGet = api.getStoredRoomCode;
    api.setStoredRoomCode = function(code){ return origSet ? origSet.call(api, normCode(code)) : undefined; };
    api.getStoredRoomCode = function(){ return normCode(origGet ? origGet.call(api) : ''); };
    api.liveHref = function(room){
      const code = normCode(room);
      const url = new URL('./paardenrace_live.html', window.location.href);
      url.searchParams.set('room', code);
      url.searchParams.set('live', code);
      try { if (api.scope && api.scope() === 'family') url.searchParams.set('scope','family'); } catch (_) {}
      return `${url.pathname.split('/').pop()}${url.search}`;
    };
    api.gotoLive = function(room, options={}){ const href = api.liveHref(room); options && options.replace ? location.replace(href) : location.assign(href); };
    const origRpc = api.rpc;
    if (typeof origRpc === 'function') {
      api.rpc = async function(fn, args={}, options={}){
        const payload = Object.assign({}, args || {});
        ['room_code_input','room','live'].forEach((key)=>{ if (payload[key]) payload[key] = normCode(payload[key]); });
        const out = await origRpc.call(api, fn, payload, options);
        if (out?.room?.room_code) out.room.room_code = normCode(out.room.room_code);
        if (isPage('paardenrace_live.html') && fn && /state|room/i.test(fn)) {
          const stage = String(out?.room?.stage || '').toLowerCase();
          if (!out?.room || TERMINAL.has(stage)) redirectToPaardenLobby(stage || 'closed');
        }
        return out;
      };
    }
    return true;
  }
  function installPaardenPageGuards(){
    if (!isPage('paardenrace.html') && !isPage('paardenrace_live.html')) return;
    hideManualJoinSurfaces();
    if (new URLSearchParams(location.search).get('cleared_room')) {
      clearKeys(PAARDEN_KEYS);
      stripQuery(['room','live','cleared_room','reason']);
      const status = qs('statusBox');
      if (status) status.textContent = 'Gesloten Paardenrace-room is gewist; join opnieuw via een zichtbare lobbykaart.';
    }
    const clean = normalizePaardenraceUrl();
    if (clean) {
      try { localStorage.setItem(PAARDEN_KEYS[0], clean); } catch (_) {}
    }
    setInterval(()=>{
      hideManualJoinSurfaces();
      const rc = qs('roomCodeInput');
      if (rc && /%/.test(rc.value || '')) rc.value = normCode(rc.value);
      const status = qs('statusBox');
      const text = String(status?.textContent || '');
      if (isPage('paardenrace_live.html') && /Deze lobby is gesloten|Room sync loopt achter|opnieuw laden/i.test(text)) {
        const room = normCode(new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('live') || '');
        if (!room || /Deze lobby is gesloten/i.test(text)) redirectToPaardenLobby('closed');
      }
    }, 700);
  }
  function upgradeBadgeGallery(){
    if (!isPage('profiles.html')) return;
    hideManualJoinSurfaces();
    document.querySelectorAll('.badge-row').forEach((row)=>{
      const img = row.querySelector('img');
      if (img) {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.objectFit = 'contain';
      }
    });
  }
  function tick(){
    setVersionGlobals();
    installPikkenContractPatch();
    installPikkenPageGuards();
    installPaardenApiPatch();
    installPaardenPageGuards();
    upgradeBadgeGallery();
    applyWatermark();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once:true }); else tick();
  const timer = setInterval(tick, 600);
  window.addEventListener('load', tick);
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) tick(); });
  window.GEJAST_V719_REPAIR = { VERSION, normCode, clearPikken:()=>clearKeys(PIKKEN_KEYS), clearPaardenrace:()=>clearKeys(PAARDEN_KEYS), stop:()=>clearInterval(timer) };
})();
