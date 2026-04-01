(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || '';
  const KEY = cfg.SUPABASE_PUBLISHABLE_KEY || '';
  const SESSION_KEYS = ['jas_session_token_v11','jas_session_token_v10'];
  const COOLDOWN_MS = 5 * 60 * 1000;
  const POLL_MS = 6000;
  const DISMISS_KEY = 'gejast_verify_float_dismiss';
  const APPROVED_KEY = 'gejast_verify_float_last_approved';
  const LAST_ALERT_KEY = 'gejast_verify_float_last_alert';
  let activePromptId = null;
  let pollBusy = false;

  function token(){ for (const key of SESSION_KEYS){ const value = localStorage.getItem(key) || sessionStorage.getItem(key); if (value) return value; } return ''; }
  function headers(){ return {'Content-Type':'application/json', apikey:KEY, Authorization:`Bearer ${KEY}`, Accept:'application/json'}; }
  async function parse(res){ const t = await res.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { throw new Error(t || `HTTP ${res.status}`); } if (!res.ok) throw new Error(d?.message || d?.error || `HTTP ${res.status}`); return d; }

  function ensureBox(){
    let box = document.getElementById('globalDrinksVerifyFloat');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'globalDrinksVerifyFloat';
    box.innerHTML = '<div class="gdf-card"><div class="gdf-title">Drinks verificatie</div><div id="gdfBody" class="gdf-body"></div><div class="gdf-actions"><button id="gdfVerifyBtn" class="gdf-btn">Bevestigen</button><button id="gdfOpenBtn" class="gdf-btn alt">Open drinks</button><button id="gdfDismissBtn" class="gdf-btn alt">Later</button></div></div>';
    const style = document.createElement('style');
    style.textContent = '#globalDrinksVerifyFloat{position:fixed;right:14px;bottom:74px;z-index:10000;max-width:340px;opacity:0;transform:translate3d(160%,48px,0) scale(.92);pointer-events:none}#globalDrinksVerifyFloat.show{opacity:1;transform:translate3d(0,0,0) scale(1);pointer-events:auto;animation:gdf-in .52s cubic-bezier(.2,.9,.2,1)}@keyframes gdf-in{0%{opacity:0;transform:translate3d(160%,58px,0) scale(.88)}65%{opacity:1;transform:translate3d(-10px,-4px,0) scale(1.02)}100%{opacity:1;transform:translate3d(0,0,0) scale(1)}}.gdf-card{background:rgba(17,17,17,.95);color:#fff;border:1px solid rgba(212,175,55,.34);border-radius:18px;padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.34);backdrop-filter:blur(8px)}.gdf-title{font-weight:900;margin-bottom:8px}.gdf-body{font-size:14px;line-height:1.4;color:rgba(255,255,255,.92)}.gdf-meta{font-size:12px;color:rgba(255,255,255,.72);margin-top:6px}.gdf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.gdf-btn{appearance:none;border:0;border-radius:999px;padding:9px 12px;font:inherit;font-weight:800;background:#d4af37;color:#111;cursor:pointer}.gdf-btn[disabled]{opacity:.6;cursor:wait}.gdf-btn.alt{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.12)}@media(max-width:640px){#globalDrinksVerifyFloat{left:10px;right:10px;bottom:88px;max-width:none}}';
    document.body.appendChild(style);
    document.body.appendChild(box);
    return box;
  }

  function showBox(){ const box = ensureBox(); box.classList.remove('show'); void box.offsetWidth; requestAnimationFrame(()=> box.classList.add('show')); }
  function hideBox(){ const box = document.getElementById('globalDrinksVerifyFloat'); if (box) box.classList.remove('show'); activePromptId = null; }

  function showApprovedToast(){
    const raw = localStorage.getItem(APPROVED_KEY);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (!payload || Date.now() - payload.at > 15000) return;
      activePromptId = '__approved__';
      const box = ensureBox();
      document.getElementById('gdfBody').innerHTML = `<strong>Verificatie goedgekeurd</strong><div class="gdf-meta">${payload.text || 'Je bevestiging is gebruikt.'}</div>`;
      document.getElementById('gdfVerifyBtn').style.display = 'none';
      document.getElementById('gdfOpenBtn').onclick = () => { location.href = './drinks.html'; };
      document.getElementById('gdfDismissBtn').onclick = () => { hideBox(); localStorage.removeItem(APPROVED_KEY); };
      showBox();
    } catch {}
  }

  function canShowFor(eventId){
    if (!eventId) return false;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return true;
    try {
      const data = JSON.parse(raw);
      if (data.id !== eventId) return true;
      return (Date.now() - data.at) > COOLDOWN_MS;
    } catch { return true; }
  }

  function dismissEvent(eventId){
    localStorage.setItem(DISMISS_KEY, JSON.stringify({id:eventId, at:Date.now()}));
    hideBox();
  }

  async function getGeoForPolling(){
    const helper = window.GEJAST_GEO;
    if (!helper) return null;
    try {
      const pos = await helper.ensure(false, { silent:true });
      if (pos) helper.startWatch();
      return pos || helper.cached();
    } catch {
      return helper.cached();
    }
  }

  async function verifyEvent(item){
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
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          approve: true
        })
      });
      await parse(res);
      localStorage.setItem(APPROVED_KEY, JSON.stringify({at:Date.now(), text:`${item.player_name} · ${item.event_type_label}`}));
      dismissEvent(item.id);
      showApprovedToast();
    } finally {
      verifyBtn.disabled = false;
      openBtn.disabled = false;
      dismissBtn.disabled = false;
      verifyBtn.textContent = oldLabel;
    }
  }

  function maybeVibrate(item){
    try {
      const last = localStorage.getItem(LAST_ALERT_KEY);
      if (last === String(item.id)) return;
      localStorage.setItem(LAST_ALERT_KEY, String(item.id));
      if (navigator.vibrate && document.visibilityState === 'visible') navigator.vibrate([120,60,120]);
    } catch(_){}
  }

  function renderPrompt(item){
    if (activePromptId === item.id) return;
    activePromptId = item.id;
    maybeVibrate(item);
    const box = ensureBox();
    const locationBits = [];
    if (item.location_text) locationBits.push(item.location_text);
    if (item.distance_m != null) locationBits.push(`${Math.round(item.distance_m)}m afstand`);
    if (item.lat != null && item.lng != null) locationBits.push(`(${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)})`);
    document.getElementById('gdfVerifyBtn').style.display = 'inline-flex';
    document.getElementById('gdfBody').innerHTML = `<strong>${item.player_name} · ${item.event_type_label}</strong><div class="gdf-meta">${Number(item.total_units||0).toFixed(1)} units${locationBits.length ? ' · ' + locationBits.join(' · ') : ''}</div><div class="gdf-meta">Open drinks om alle verificaties en status te zien.</div>`;
    document.getElementById('gdfVerifyBtn').onclick = async () => { const body = document.getElementById('gdfBody'); body.querySelectorAll('.gdf-meta.error').forEach((n)=>n.remove()); try { await verifyEvent(item); } catch (err) { body.insertAdjacentHTML('beforeend', `<div class="gdf-meta error">${(err && err.message) || 'Bevestigen mislukt.'}</div>`); } };
    document.getElementById('gdfOpenBtn').onclick = () => { location.href = './drinks.html#verifyPanel'; };
    document.getElementById('gdfDismissBtn').onclick = () => dismissEvent(item.id);
    showBox();
  }

  async function poll(){
    if (pollBusy || !token() || !SUPABASE_URL || !KEY) return;
    pollBusy = true;
    try {
      const pos = await getGeoForPolling();
      if (!pos) { pollBusy = false; return; }
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_drinks_page_public`, {
        method:'POST',
        headers: headers(),
        body: JSON.stringify({session_token: token(), viewer_lat: pos.coords.latitude, viewer_lng: pos.coords.longitude})
      });
      const raw = await parse(res);
      const data = raw?.get_drinks_page_public || raw || {};
      const item = Array.isArray(data.verify_queue) ? data.verify_queue[0] : null;
      if (!item || !canShowFor(item.id)) {
        if (activePromptId && activePromptId !== '__approved__') hideBox();
        pollBusy = false;
        return;
      }
      renderPrompt(item);
    } catch {}
    pollBusy = false;
  }

  function init(){
    showApprovedToast();
    poll();
    window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('focus', poll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
