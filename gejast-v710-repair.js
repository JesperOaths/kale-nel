/* GEJAST v710 repair runtime
   Repair-first overlay for the v709 line.
   Owns only temporary browser repair behavior; stored truth remains in Supabase/RPC. */
(function(){
  'use strict';
  if (window.__GEJAST_V710_REPAIR_RUNTIME__) return;
  window.__GEJAST_V710_REPAIR_RUNTIME__ = true;

  const VERSION = 'v710';
  const $ = (id)=>document.getElementById(id);
  const qs = (sel, root=document)=>root.querySelector(sel);
  const qsa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
  const page = String(location.pathname || '').split('/').pop().toLowerCase() || 'index.html';
  const esc = (v)=>String(v ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  function injectCss(css){
    if (!css || document.getElementById('gejast-v710-repair-css')) return;
    const style = document.createElement('style');
    style.id = 'gejast-v710-repair-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function afterDom(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once:true });
    else fn();
  }

  function isShotKey(value){
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return /(^|[^a-z0-9])(shot|shots|shotje|shotjes|shooter|shooters|borrel|borrels)([^a-z0-9]|$)/i.test(raw);
  }

  function normalizeRows(raw){
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    for (const key of ['rows','data','items','leaderboard','leaderboards','speed_leaderboards']) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    return [];
  }

  function cleanSpeedSets(sets){
    return normalizeRows(sets).map((set)=>({
      key: String(set.key || set.speed_type_key || set.event_type_key || set.drink_type_key || '').trim(),
      label: String(set.label || set.speed_type_label || set.event_type_label || set.drink_type_label || set.key || '').trim(),
      rows: normalizeRows(set.rows || set.attempts || set.leaderboard || [])
    })).filter((set)=>set.key && !isShotKey(set.key) && !isShotKey(set.label));
  }

  function currentScope(){
    try {
      const qsObj = new URLSearchParams(location.search || '');
      if (qsObj.get('scope') === 'family') return 'family';
      if ((location.pathname || '').includes('/familie/')) return 'family';
    } catch (_) {}
    return 'friends';
  }

  function rpcFetch(name, payload, timeoutMs){
    const cfg = window.GEJAST_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) return Promise.reject(new Error('Supabase config ontbreekt.'));
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(()=>{ try { controller.abort(); } catch (_) {} }, timeoutMs || 6500) : null;
    return fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method:'POST',
      mode:'cors',
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
        Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY}`,
        Accept:'application/json'
      },
      body: JSON.stringify(payload || {}),
      signal: controller ? controller.signal : undefined
    }).then(async(res)=>{
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { throw new Error(text || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error((data && (data.message || data.error || data.details || data.hint)) || text || `HTTP ${res.status}`);
      return data && data[name] !== undefined ? data[name] : data;
    }).finally(()=>{ if (timer) clearTimeout(timer); });
  }

  function canStartPikken(payload){
    if (!payload || !payload.game) return { ok:null, reason:'' };
    const phase = String(payload.game?.state?.phase || payload.game?.status || 'lobby').toLowerCase();
    const viewer = payload.viewer || {};
    const players = Array.isArray(payload.players) ? payload.players : [];
    if (!viewer.is_host) return { ok:false, reason:'Alleen de host mag Pikken starten.' };
    if (phase !== 'lobby') return { ok:false, reason:'Deze Pikken-game is niet meer in de lobbyfase.' };
    if (players.length < 2) return { ok:false, reason:'Pikken heeft minstens 2 spelers nodig.' };
    const notReady = players.filter((p)=>!p.is_ready).map((p)=>p.name || p.player_name || 'speler');
    if (notReady.length) return { ok:false, reason:`Nog niet iedereen is ready: ${notReady.join(', ')}.` };
    if (payload.game && payload.game.can_start === false) return { ok:false, reason:'De backend zegt dat deze Pikken-lobby nog niet kan starten.' };
    return { ok:true, reason:'' };
  }

  function canStartPaardenrace(payload){
    if (!payload || !payload.room) return { ok:null, reason:'' };
    const viewer = payload.viewer || {};
    const room = payload.room || {};
    const players = Array.isArray(payload.players) ? payload.players : [];
    if (!viewer.is_host) return { ok:false, reason:'Alleen de host mag de Paardenrace starten.' };
    if (String(room.stage || 'lobby').toLowerCase() !== 'lobby') return { ok:false, reason:'Deze Paardenrace is niet meer in de lobbyfase.' };
    if (players.length < 2) return { ok:false, reason:'Paardenrace heeft minstens 2 spelers nodig.' };
    const notReady = players.filter((p)=>!p.is_ready).map((p)=>p.player_name || p.name || 'speler');
    if (notReady.length) return { ok:false, reason:`Nog niet iedereen is ready: ${notReady.join(', ')}.` };
    const unverified = players.filter((p)=>Number(p.wager_bakken || 0) > 0 && !p.wager_verified).map((p)=>p.player_name || p.name || 'speler');
    if (unverified.length) return { ok:false, reason:`Nog niet alle wagers zijn geverifieerd: ${unverified.join(', ')}.` };
    const suits = [...new Set(players.map((p)=>String(p.selected_suit || '').trim().toLowerCase()).filter(Boolean))];
    if (suits.length <= 1 && players.length > 1) return { ok:false, reason:'De race kan niet starten als iedereen hetzelfde paard heeft gekozen.' };
    if (room.can_start === false) return { ok:false, reason:'De backend zegt dat deze Paardenrace nog niet kan starten.' };
    return { ok:true, reason:'' };
  }

  function setButtonStartState(button, check){
    if (!button || !check || check.ok === null) return;
    button.disabled = !check.ok;
    button.title = check.ok ? '' : check.reason;
    button.setAttribute('aria-disabled', String(!check.ok));
  }

  function patchPikkenContract(){
    const api = window.GEJAST_PIKKEN_CONTRACT;
    if (!api || api.__v710Patched) return !!api;
    api.__v710Patched = true;
    const originalGetState = api.getState;
    if (typeof originalGetState === 'function') {
      api.getState = async function(...args){
        const payload = await originalGetState.apply(this, args);
        window.__GEJAST_V710_PIKKEN_STATE = payload;
        afterDom(()=>setButtonStartState($('pkStartBtn'), canStartPikken(payload)));
        return payload;
      };
    }
    const originalStart = api.startGame;
    if (typeof originalStart === 'function') {
      api.startGame = async function(...args){
        const check = canStartPikken(window.__GEJAST_V710_PIKKEN_STATE);
        if (check.ok === false) throw new Error(check.reason);
        return originalStart.apply(this, args);
      };
    }
    return true;
  }

  function patchPaardenraceApi(){
    const api = window.GEJAST_PAARDENRACE;
    if (!api || api.__v710Patched) return !!api;
    api.__v710Patched = true;
    const originalRpc = api.rpc;
    if (typeof originalRpc === 'function') {
      api.rpc = async function(name, payload, options){
        const rpcName = String(name || '');
        if (/^start_paardenrace_countdown_safe$/i.test(rpcName)) {
          const check = canStartPaardenrace(window.__GEJAST_V710_PAARDENRACE_STATE);
          if (check.ok === false) throw new Error(check.reason);
        }
        const out = await originalRpc.call(this, name, payload, options);
        if (/paardenrace_room_state|join_paardenrace_room|create_paardenrace_room|save_paardenrace|set_paardenrace_ready|verify_paardenrace_wager|reject_paardenrace_wager|start_paardenrace_countdown/i.test(rpcName)) {
          if (out && out.room) {
            window.__GEJAST_V710_PAARDENRACE_STATE = out;
            afterDom(()=>setButtonStartState($('startBtn'), canStartPaardenrace(out)));
          }
        }
        return out;
      };
    }
    return true;
  }

  function bootApiPatchers(){
    let ticks = 0;
    const timer = setInterval(()=>{
      ticks += 1;
      const donePk = page === 'pikken.html' ? patchPikkenContract() : true;
      const donePr = page === 'paardenrace.html' ? patchPaardenraceApi() : true;
      if ((donePk && donePr) || ticks > 80) clearInterval(timer);
    }, 50);
  }

  function repairPikkenLiveDock(){
    if (page !== 'pikken_live.html') return;
    injectCss(`
      body[data-game-watermark="soft"]{padding-bottom:92px!important;}
      .dock.v710-live-dock{position:sticky!important;top:8px!important;bottom:auto!important;z-index:60!important;margin:10px 0 14px!important;box-shadow:0 14px 30px rgba(0,0,0,.13)!important;}
      .dock.v710-live-dock .field-inline{align-items:stretch!important;}
      .dock.v710-live-dock select,.dock.v710-live-dock .btn{min-height:46px!important;}
      .dock.v710-live-dock .dock-main{display:flex!important;justify-content:flex-end!important;gap:8px!important;}
      .dock.v710-live-dock .dock-right{margin-left:0!important;}
      #mobileContext{display:none!important;}
      @media(max-width:700px){
        .dock.v710-live-dock{top:6px!important;padding:9px!important;border-radius:18px!important;gap:8px!important;}
        .dock.v710-live-dock .field-inline{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;}
        .dock.v710-live-dock .field-inline select{grid-column:1/-1!important;width:100%!important;min-width:0!important;}
        .dock.v710-live-dock .btn{width:100%!important;padding:10px 9px!important;font-size:13px!important;}
        .dock.v710-live-dock .dock-main,.dock.v710-live-dock .dock-right{display:grid!important;grid-template-columns:1fr 1fr!important;width:100%!important;}
        .dock.v710-live-dock .dock-right .btn{min-width:0!important;}
      }
    `);
    const dock = qs('.dock');
    const topbar = qs('.topbar');
    if (dock && topbar && dock.previousElementSibling !== topbar) {
      dock.classList.add('v710-live-dock');
      topbar.parentNode.insertBefore(dock, topbar.nextSibling);
    } else if (dock) {
      dock.classList.add('v710-live-dock');
    }
    const statusBox = $('mobileContext');
    if (statusBox) statusBox.remove();
  }

  function repairProfileBadges(){
    if (page !== 'profiles.html' && !location.pathname.toLowerCase().endsWith('/familie/profiles.html')) return;
    injectCss(`
      .badge-gallery-accordion img,
      #badgeGalleryPanel img,
      .badge-icon,
      [data-badge-key] img{
        width:48px!important;height:48px!important;min-width:48px!important;max-width:48px!important;max-height:48px!important;
        object-fit:contain!important;object-position:center!important;aspect-ratio:1/1!important;display:inline-block!important;flex:0 0 48px!important;
      }
      .badge-gallery-accordion summary img{width:36px!important;height:36px!important;min-width:36px!important;flex-basis:36px!important;}
      .badge-gallery-accordion .badge-row,
      #badgeGalleryPanel .badge-row{display:flex!important;align-items:center!important;gap:10px!important;}
    `);
  }

  function renderSpeedRows(container, set){
    const rows = normalizeRows(set && set.rows).filter((row)=>!isShotKey(row.speed_type_key || row.event_type_key || row.drink_type_key || set.key || set.label));
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<div class="note">Nog geen geverifieerde speedpogingen voor dit dranktype.</div>';
      return;
    }
    container.innerHTML = rows.map((row, index)=>{
      const name = row.player_name || row.display_name || row.name || 'Onbekend';
      const seconds = Number(row.duration_seconds || row.seconds || row.best_seconds || 0);
      const date = row.verified_at || row.created_at || row.attempted_at || '';
      const meta = [set.label || row.speed_type_label || 'Drank', date ? new Date(date).toLocaleDateString('nl-NL') : 'geverifieerd'].filter(Boolean).join(' · ');
      return `<div class="item"><div><strong>${index + 1}. ${esc(name)}</strong><div class="muted">${esc(meta)}</div></div><strong>${Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}s` : '—'}</strong></div>`;
    }).join('');
  }

  async function repairDrinksSpeedDropdown(){
    if (page !== 'drinks.html') return;
    injectCss(`#speedTypeSelect option[data-shot="1"]{display:none!important;}`);
    const select = $('speedTypeSelect');
    const box = $('speedHighlights');
    if (!select || !box) return;

    function pruneExistingOptions(){
      qsa('option', select).forEach((opt)=>{
        if (isShotKey(opt.value) || isShotKey(opt.textContent)) opt.remove();
      });
    }
    pruneExistingOptions();
    const obs = new MutationObserver(()=>pruneExistingOptions());
    obs.observe(select, { childList:true, subtree:true });

    try {
      const payload = await rpcFetch('get_verified_speed_leaderboards_v710', { site_scope_input: currentScope() }, 6500);
      const sets = cleanSpeedSets(payload && (payload.leaderboards || payload.rows || payload));
      if (!sets.length) return;
      select.innerHTML = sets.map((set, i)=>`<option value="${esc(set.key)}" ${i===0?'selected':''}>${esc(set.label || set.key)}</option>`).join('');
      const byKey = new Map(sets.map((set)=>[set.key, set]));
      const draw = ()=>renderSpeedRows(box, byKey.get(select.value) || sets[0]);
      select.onchange = draw;
      draw();
    } catch (_) {
      pruneExistingOptions();
    }
  }

  function boot(){
    bootApiPatchers();
    afterDom(()=>{
      repairPikkenLiveDock();
      repairProfileBadges();
      repairDrinksSpeedDropdown();
    });
  }

  boot();
})();
