(function(){
  if (window.__GEJAST_FLOAT_VERIFY__) return;
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || '';
  const SESSION_KEYS = ['jas_session_token_v11','jas_session_token_v10'];
  const COOLDOWN_MS = 5 * 60 * 1000;
  const POLL_MS = 15000;
  const HIDDEN_POLL_MS = 20000;
  const DISMISS_KEY = 'gejast_verify_float_dismiss';
  const APPROVED_KEY = 'gejast_verify_float_last_approved';
  const LAST_ALERT_KEY = 'gejast_verify_float_last_alert';
  let activePromptId = null;
  let activePromptKind = null;
  let activePromptItem = null;
  let activePromptSeenAt = 0;
  let activePromptGraceUntil = 0;
  let pollBusy = false;
  const SHOULD_SUPPRESS = !!(cfg && typeof cfg.shouldSuppressVerifyFloat === 'function' && cfg.shouldSuppressVerifyFloat());
  if (SHOULD_SUPPRESS) return;
  window.__GEJAST_FLOAT_VERIFY__ = true;
  let lastHiddenPollAt = 0;
  let lastNotificationId = '';

  function token(){ for (const key of SESSION_KEYS){ const value = localStorage.getItem(key) || sessionStorage.getItem(key); if (value) return value; } return ''; }
  function isSecretKingLike(item){ const raw=String(item?.event_type_key||item?.event_type_label||item?.label||item?.request_kind||'').toLowerCase(); return raw.includes('koning')||raw.includes('king')||raw.includes('balzaal')||raw.includes('ballroom'); }
  function headers(){ return {'Content-Type':'application/json', apikey:KEY, Authorization:`Bearer ${KEY}`, Accept:'application/json'}; }
  async function parse(res){ const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { throw new Error(t || `HTTP ${res.status}`); } if (!res.ok) throw new Error(d?.message || d?.error || `HTTP ${res.status}`); return d; }

  function ensureGeoButton(){
    return (window.GEJAST_GEO && window.GEJAST_GEO.ensureCornerTools && window.GEJAST_GEO.ensureCornerTools()) || null;
  }

  function setGeoButtonState(ready){
    try { window.GEJAST_GEO && window.GEJAST_GEO.setButtonState && window.GEJAST_GEO.setButtonState(!!ready); } catch(_){}
  }

  function shouldPromptNotifications(){ return false; }

  function ensureNotificationPrompt(){ return null; }

  async function maybeAskNotificationPermission(){ return null; }

  async function notifyIfNeeded(item){
    if (!item || document.visibilityState !== 'hidden') return;
    const id = `${item.kind||'drink'}:${item.id}`;
    if (id === lastNotificationId) return;
    lastNotificationId = id;
    try {
      if (window.GEJAST_GEO && window.GEJAST_GEO.showNotificationFromServiceWorker) {
        const ok = await window.GEJAST_GEO.showNotificationFromServiceWorker(item.kind === 'speed' ? 'Snelheid te verifiëren' : 'Drankje te verifiëren', {
          body: `${item.player_name||'Speler'} · ${item.event_type_label || item.speed_type_label || ''}`.trim(),
          tag: id,
          data: { url: item.kind === 'speed' ? './drinks_speed.html' : './drinks_pending.html', itemId: item.id, kind: item.kind || 'drink' },
          renotify: true
        });
        if (ok) return;
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(item.kind === 'speed' ? 'Snelheid te verifiëren' : 'Drankje te verifiëren', {
          body: `${item.player_name||'Speler'} · ${item.event_type_label || item.speed_type_label || ''}`.trim(),
          silent: false
        });
      }
    } catch(_){}
  }

  function ensureBox(){
    let box = document.getElementById('globalDrinksVerifyFloat');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'globalDrinksVerifyFloat';
    box.innerHTML = '<div class="gdf-card"><div class="gdf-title" id="gdfTitle">Verificatie</div><div id="gdfBody" class="gdf-body"></div><div class="gdf-actions"><button id="gdfVerifyBtn" class="gdf-btn">Bevestigen</button><button id="gdfRejectBtn" class="gdf-btn alt">Afkeuren</button><button id="gdfOpenBtn" class="gdf-btn alt">Open pagina</button><button id="gdfDismissBtn" class="gdf-btn alt">Later</button></div></div>';
    const style = document.createElement('style');
    style.textContent = '#globalDrinksVerifyFloat{position:fixed;right:14px;bottom:74px;z-index:10000;max-width:340px;opacity:0;transform:translate3d(160%,48px,0) scale(.92);pointer-events:none}#globalDrinksVerifyFloat.show{opacity:1;transform:translate3d(0,0,0) scale(1);pointer-events:auto;animation:gdf-in .52s cubic-bezier(.2,.9,.2,1)}@keyframes gdf-in{0%{opacity:0;transform:translate3d(160%,58px,0) scale(.88)}65%{opacity:1;transform:translate3d(-10px,-4px,0) scale(1.02)}100%{opacity:1;transform:translate3d(0,0,0) scale(1)}}.gdf-card{background:rgba(17,17,17,.95);color:#fff;border:1px solid rgba(212,175,55,.34);border-radius:18px;padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.34);backdrop-filter:blur(8px)}.gdf-title{font-weight:900;margin-bottom:8px}.gdf-body{font-size:14px;line-height:1.4;color:rgba(255,255,255,.92)}.gdf-meta{font-size:12px;color:rgba(255,255,255,.72);margin-top:6px}.gdf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gdf-btn{appearance:none;border:0;border-radius:999px;padding:9px 12px;font:inherit;font-weight:800;background:#9a8241;color:#111;cursor:pointer}.gdf-btn[disabled]{opacity:.6;cursor:wait}.gdf-btn.alt{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.12)}@media(max-width:640px){#globalDrinksVerifyFloat{left:10px;right:10px;bottom:88px;max-width:none}}';
    document.body.appendChild(style);
    document.body.appendChild(box);
    return box;
  }

  function showBox(){ const box = ensureBox(); box.classList.remove('show'); void box.offsetWidth; requestAnimationFrame(()=> box.classList.add('show')); }
  function hideBox(){ const box = document.getElementById('globalDrinksVerifyFloat'); if (box) box.classList.remove('show'); activePromptId = null; activePromptKind = null; activePromptItem = null; activePromptSeenAt = 0; activePromptGraceUntil = 0; }

  function showApprovedToast(){
    const raw = localStorage.getItem(APPROVED_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (!payload || Date.now() - payload.at > 15000) return;
      activePromptId = '__approved__';
      const box = ensureBox();
    const notifyPermission = window.GEJAST_GEO && window.GEJAST_GEO.notificationPermission ? window.GEJAST_GEO.notificationPermission() : 'unsupported';
      document.getElementById('gdfBody').innerHTML = `<strong>Verificatie goedgekeurd</strong><div class="gdf-meta">${payload.text || 'Je bevestiging is gebruikt.'}</div>`;
      document.getElementById('gdfVerifyBtn').style.display = 'none';
      document.getElementById('gdfRejectBtn').style.display = 'none';
      document.getElementById('gdfOpenBtn').onclick = () => { location.href = './drinks_speed.html'; };
      document.getElementById('gdfDismissBtn').onclick = () => { hideBox(); localStorage.removeItem(APPROVED_KEY); };
      showBox();
    } catch {}
  }

  function canShowFor(eventKey){
    if (!eventKey) return false;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return true;
    try {
      const data = JSON.parse(raw);
      if (data.id !== eventKey) return true;
      return (Date.now() - data.at) > COOLDOWN_MS;
    } catch { return true; }
  }

  function dismissEvent(eventKey){
    localStorage.setItem(DISMISS_KEY, JSON.stringify({id:eventKey, at:Date.now()}));
    hideBox();
  }

  async function getGeoForPolling(forceFresh=false){
    const helper = window.GEJAST_GEO;
    if (!helper) return null;
    try {
      const pos = await helper.ensure(forceFresh, { silent: !forceFresh });
      if (pos) helper.startMonitor({ intervalMs: HIDDEN_POLL_MS });
      setGeoButtonState(!!pos);
      return pos || helper.cached();
    } catch {
      const cached = helper.cached(60*60*1000);
      setGeoButtonState(!!cached);
      return cached;
    }
  }

  async function verifyDrinkEvent(item, approve=true){
    const helper = window.GEJAST_GEO;
    if (!helper) throw new Error('Geolocatie helper ontbreekt.');
    const verifyBtn = document.getElementById('gdfVerifyBtn');
    const openBtn = document.getElementById('gdfOpenBtn');
    const dismissBtn = document.getElementById('gdfDismissBtn');
    verifyBtn.disabled = true;
    openBtn.disabled = true;
    dismissBtn.disabled = true;
    const oldLabel = verifyBtn.textContent;
    verifyBtn.textContent = 'Bezig...';
    try {
      let pos;
      try {
        pos = await helper.request(true);
      } catch (err) {
        pos = helper.cached(60*60*1000);
        if (!pos) throw err;
        document.getElementById('gdfBody').insertAdjacentHTML('beforeend','<div class="gdf-meta">Verse locatie kwam niet door; laatst bekende locatie gebruikt.</div>');
      }
      helper.startWatch();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_drink_event`, {
        method:'POST',
        headers: headers(),
        body: JSON.stringify({
          session_token: token(),
          drink_event_id: Number(item.id),
          lat: isSecretKingLike(item)?null:pos.coords.latitude,
          lng: isSecretKingLike(item)?null:pos.coords.longitude,
          accuracy: isSecretKingLike(item)?null:pos.coords.accuracy,
          approve: !!approve
        })
      });
      await parse(res);
      localStorage.removeItem(APPROVED_KEY);
      dismissEvent(`${item.kind||'drink'}:${item.id}`);
      hideBox();
    } finally {
      verifyBtn.disabled = false;
      openBtn.disabled = false;
      dismissBtn.disabled = false;
      verifyBtn.textContent = oldLabel;
    }
  }

  async function verifySpeedEvent(item, approve=true){
    const helper = window.GEJAST_GEO;
    if (!helper) throw new Error('Geolocatie helper ontbreekt.');
    const verifyBtn = document.getElementById('gdfVerifyBtn');
    const openBtn = document.getElementById('gdfOpenBtn');
    const dismissBtn = document.getElementById('gdfDismissBtn');
    verifyBtn.disabled = true; openBtn.disabled = true; dismissBtn.disabled = true;
    const oldLabel = verifyBtn.textContent; verifyBtn.textContent = 'Bezig...';
    try {
      let pos;
      try { pos = await helper.request(true); } catch (err) { pos = helper.cached(60*60*1000); if (!pos) throw err; }
      helper.startWatch();
      const workflow = window.GEJAST_DRINKS_WORKFLOW; if (workflow && workflow.verifySpeedAttempt) { await workflow.verifySpeedAttempt({ session_token: token(), attempt_id: Number(item.id), lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, approve: !!approve }); } else { const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_drink_speed_attempt`, { method:'POST', headers: headers(), body: JSON.stringify({ session_token: token(), attempt_id: Number(item.id), lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, approve: !!approve }) }); await parse(res); }
      localStorage.removeItem(APPROVED_KEY);
      dismissEvent(`speed:${item.id}`);
      hideBox();
    } finally { verifyBtn.disabled=false; openBtn.disabled=false; dismissBtn.disabled=false; verifyBtn.textContent=oldLabel; }
  }

  function countdownText(item){ const base=item.vote_window_ends_at||item.window_ends_at||item.pending_until||''; if(base){ const end=new Date(base).getTime(); if(Number.isFinite(end)){ const diff=Math.max(0, Math.round((end-Date.now())/1000)); if(diff>0) return `Nog ${diff}s open voor stemmen`; } } const created=item.first_vote_at||item.created_at; if(created && String(item.status||'pending')==='pending'){ const diff=Math.max(0, Math.round(((new Date(created).getTime()+180000)-Date.now())/1000)); if(diff>0) return `Nog ${diff}s open voor stemmen`; } return ''; }

  function maybeVibrate(item){
    try {
      const last = localStorage.getItem(LAST_ALERT_KEY);
      const currentKey = `${item.kind||'drink'}:${item.id}`;
      if (last === currentKey) return;
      localStorage.setItem(LAST_ALERT_KEY, currentKey);
      if (navigator.vibrate && document.visibilityState === 'visible') { navigator.vibrate([220,80,220,80,320]); setTimeout(()=>{ try{ navigator.vibrate([180,60,220]); }catch(_){ } }, 700); }
    } catch(_){}
  }

  function renderPrompt(item){
    if (activePromptId === item.id && activePromptKind === (item.kind||'drink')) return;
    activePromptId = item.id;
    activePromptKind = item.kind || 'drink';
    activePromptItem = item;
    activePromptSeenAt = Date.now();
    activePromptGraceUntil = Math.max(activePromptGraceUntil, Date.now() + 180000);
    maybeVibrate(item);
    const box = ensureBox();
    const notifyPermission = window.GEJAST_GEO && window.GEJAST_GEO.notificationPermission ? window.GEJAST_GEO.notificationPermission() : 'unsupported';
    const locationBits = [];
    if (item.location_text) locationBits.push(item.location_text);
    if (item.distance_m != null) locationBits.push(`${Math.round(item.distance_m)}m afstand`);
    if (item.lat != null && item.lng != null) locationBits.push(`(${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)})`);
    document.getElementById('gdfVerifyBtn').style.display = 'inline-flex';
    document.getElementById('gdfRejectBtn').style.display = 'inline-flex';
    const promptLabel = item.kind==='speed' ? `${item.event_type_label || item.speed_type_label} · ${Number(item.duration_seconds||0).toFixed(1)}s` : `${item.event_type_label}`;
    document.getElementById('gdfTitle').textContent = item.kind==='speed' ? 'Snelheid verificatie' : 'Drinks verificatie';
    document.getElementById('gdfOpenBtn').textContent = item.kind==='speed' ? 'Open snelheid' : 'Open drinks';
    document.getElementById('gdfBody').innerHTML = `<strong>${item.player_name} · ${promptLabel}</strong><div class="gdf-meta">${Number(item.total_units||0).toFixed(1)} units${item.kind==='speed' ? ` · ${Number(item.duration_seconds||0).toFixed(1)}s` : ''}${locationBits.length ? ' · ' + locationBits.join(' · ') : ''}</div><div class="gdf-meta">${Number(item.approve_votes||0)} voor · ${Number(item.reject_votes||0)} tegen${countdownText(item)?` · ${countdownText(item)}`:''}</div><div class="gdf-meta">${item.kind==='speed' ? 'Open snelheid om alle verificaties en status te zien.' : 'Open drinks om alle verificaties en status te zien.'}</div>${notifyPermission !== 'granted' ? '<div class="gdf-meta">Tip: zet meldingen aan met de belknop naast je locatieknop.</div>' : ''}`;
    document.getElementById('gdfVerifyBtn').onclick = async () => { const body = document.getElementById('gdfBody'); body.querySelectorAll('.gdf-meta.error').forEach((n)=>n.remove()); try { await (item.kind==='speed' ? verifySpeedEvent(item, true) : verifyDrinkEvent(item, true)); } catch (err) { body.insertAdjacentHTML('beforeend', `<div class="gdf-meta error">${(err && err.message) || 'Bevestigen mislukt.'}</div>`); } };
    document.getElementById('gdfRejectBtn').onclick = async () => { const body = document.getElementById('gdfBody'); body.querySelectorAll('.gdf-meta.error').forEach((n)=>n.remove()); try { await (item.kind==='speed' ? verifySpeedEvent(item, false) : verifyDrinkEvent(item, false)); } catch (err) { body.insertAdjacentHTML('beforeend', `<div class="gdf-meta error">${(err && err.message) || 'Afkeuren mislukt.'}</div>`); } };
    document.getElementById('gdfOpenBtn').onclick = () => { location.href = item.kind==='speed' ? './drinks_speed.html' : './drinks_pending.html'; };
    document.getElementById('gdfDismissBtn').onclick = () => dismissEvent(`${item.kind||'drink'}:${item.id}`);
    showBox();
  }

  async function poll(){
    if (pollBusy || !token() || !SUPABASE_URL || !KEY) return;
    if (document.visibilityState === 'hidden' && (Date.now() - lastHiddenPollAt) < HIDDEN_POLL_MS) return;
    pollBusy = true;
    try {
      if (document.visibilityState === 'hidden') lastHiddenPollAt = Date.now();
      const pos = await getGeoForPolling(false);
      let item = null;
      try {
        const speedRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_drink_speed_page_public`, {
          method:'POST', headers: headers(),
          body: JSON.stringify({session_token: token(), viewer_lat: pos?.coords?.latitude ?? null, viewer_lng: pos?.coords?.longitude ?? null})
        });
        const speedRaw = await parse(speedRes);
        const speedData = speedRaw?.get_drink_speed_page_public || speedRaw || {};
        const speedItem = Array.isArray(speedData.verify_queue) ? speedData.verify_queue[0] : null;
        if (speedItem && canShowFor(`speed:${speedItem.id}`)) { speedItem.kind = 'speed'; item = speedItem; }
      } catch (_) {}
      if (!item) {
        try{
          const allRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_all_pending_drink_event_verifications_public`, {
            method:'POST',
            headers: headers(),
            body: JSON.stringify({session_token: token()})
          });
          const allRaw = await parse(allRes);
          const allRows = allRaw?.get_all_pending_drink_event_verifications_public || allRaw || {};
          const drinkItem = Array.isArray(allRows) ? allRows[0] : null;
          if (drinkItem && canShowFor(`drink:${drinkItem.id}`)) { drinkItem.kind = 'drink'; item = drinkItem; }
        }catch(_){}
      }
      if (!item) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_drink_event_vote_queue_public`, {
          method:'POST',
          headers: headers(),
          body: JSON.stringify({session_token: token(), viewer_lat: pos?.coords?.latitude ?? null, viewer_lng: pos?.coords?.longitude ?? null})
        });
        const raw = await parse(res);
        const data = raw?.get_drink_event_vote_queue_public || raw || {};
        const drinkItem = Array.isArray(data.verify_queue) ? data.verify_queue[0] : null;
        if (drinkItem && canShowFor(`drink:${drinkItem.id}`)) { drinkItem.kind = 'drink'; item = drinkItem; }
      }
      if (!item || !canShowFor(`${item.kind||'drink'}:${item.id}`)) {
        const withinGrace = activePromptItem && activePromptId && activePromptId !== '__approved__' && Date.now() < activePromptGraceUntil;
        if (withinGrace) {
          const box = ensureBox();
    const notifyPermission = window.GEJAST_GEO && window.GEJAST_GEO.notificationPermission ? window.GEJAST_GEO.notificationPermission() : 'unsupported';
          document.getElementById('gdfVerifyBtn').style.display = 'none';
      document.getElementById('gdfRejectBtn').style.display = 'none';
          document.getElementById('gdfTitle').textContent = activePromptItem.kind==='speed' ? 'Snelheid verificatie' : 'Drinks verificatie';
          document.getElementById('gdfOpenBtn').textContent = activePromptItem.kind==='speed' ? 'Open snelheid' : 'Open drinks';
          document.getElementById('gdfBody').innerHTML = `<strong>${activePromptItem.player_name} · ${activePromptItem.event_type_label || activePromptItem.speed_type_label}</strong><div class="gdf-meta">Deze verificatie blijft nog even open zodat meerdere mensen kunnen stemmen voordat het oordeel wordt vastgezet.</div><div class="gdf-meta">${Number(activePromptItem.approve_votes||0)} voor · ${Number(activePromptItem.reject_votes||0)} tegen${countdownText(activePromptItem)?` · ${countdownText(activePromptItem)}`:''}</div><div class="gdf-meta">${activePromptItem.kind==='speed' ? 'Open snelheid om de actuele status en extra stemmen te zien.' : 'Open drinks om de actuele status en extra stemmen te zien.'}</div>`;
          document.getElementById('gdfOpenBtn').onclick = () => { location.href = activePromptItem.kind==='speed' ? './drinks_speed.html' : './drinks_pending.html'; };
          document.getElementById('gdfDismissBtn').onclick = () => dismissEvent(`${activePromptItem.kind||'drink'}:${activePromptItem.id}`);
          showBox();
        } else if (activePromptId && activePromptId !== '__approved__') hideBox();
        pollBusy = false;
        return;
      }
      void notifyIfNeeded(item);
      if (document.visibilityState === 'hidden') { pollBusy = false; return; }
      renderPrompt(item);
    } catch {}
    pollBusy = false;
  }

  function init(){
    ensureGeoButton();
    setGeoButtonState(!!(window.GEJAST_GEO && window.GEJAST_GEO.cached()));
    // native notification permission is now driven by the explicit bell button
    try { window.GEJAST_GEO && window.GEJAST_GEO.startMonitor && window.GEJAST_GEO.startMonitor({ intervalMs: HIDDEN_POLL_MS }); } catch(_){}
    window.addEventListener('gejast:geo-update', (ev)=>{ setGeoButtonState(!!(ev && ev.detail)); });
    window.addEventListener('gejast:geo-error', ()=>{ if (!(window.GEJAST_GEO && window.GEJAST_GEO.cached())) setGeoButtonState(false); });
    showApprovedToast();
    poll();
    window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('focus', poll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
