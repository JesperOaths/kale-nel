(function(){
  const CACHE_KEY = 'gejast_geo_cache_v5';
  const ADDRESS_KEY = 'gejast_geo_address_cache_v1';
  let watchId = null;
  let lastPos = null;
  let lastError = null;
  let monitorId = null;
  let visibilityBound = false;

  function normalize(pos, source='live'){
    if (!pos || !pos.coords) return null;
    return { source, coords: { latitude: Number(pos.coords.latitude), longitude: Number(pos.coords.longitude), accuracy: pos.coords.accuracy == null ? null : Number(pos.coords.accuracy) }, timestamp: pos.timestamp || Date.now() };
  }
  function announce(type, detail){ try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch(_){} }
  function save(pos, source='live'){
    const out = normalize(pos, source); if (!out) return null;
    lastPos = out; lastError = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat: out.coords.latitude, lng: out.coords.longitude, accuracy: out.coords.accuracy, at: Date.now() })); } catch(_){}
    announce('gejast:geo-update', out); return out;
  }
  function cached(maxAgeMs=10*60*1000){
    if (lastPos && Date.now() - (lastPos.timestamp || 0) <= maxAgeMs) return lastPos;
    try { const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (!raw || !raw.at || (Date.now() - raw.at) > maxAgeMs) return null; return normalize({ coords:{ latitude: raw.lat, longitude: raw.lng, accuracy: raw.accuracy }, timestamp: raw.at }, 'cache'); } catch(_) { return null; }
  }
  async function permissionState(){ try { if (!navigator.permissions || !navigator.permissions.query) return 'unknown'; const r = await navigator.permissions.query({ name:'geolocation' }); return r.state || 'unknown'; } catch(_) { return 'unknown'; } }
  function classify(err){ const code = err && typeof err.code === 'number' ? err.code : null; const raw = String((err && err.message) || '').toLowerCase(); if (code===1||raw.includes('denied')||raw.includes('permission')) return 'permission'; if (code===2||raw.includes('unavailable')) return 'unavailable'; if (code===3||raw.includes('timeout')) return 'timeout'; return 'unknown'; }
  function message(err){ if (!window.isSecureContext) return 'Geolocatie werkt alleen via een beveiligde https-verbinding.'; if (!navigator.geolocation) return 'Geolocatie wordt niet ondersteund op dit apparaat of in deze browser.'; const kind = classify(err); if (kind==='permission') return 'De browser gaf geolocatie nog niet vrij. Controleer browser-sitepermissie en apparaatlocatie, en probeer daarna opnieuw.'; if (kind==='unavailable') return 'Locatie is nu niet beschikbaar. Controleer of gps of locatievoorzieningen aanstaan en probeer opnieuw.'; if (kind==='timeout') return 'Locatie opvragen duurde te lang. We proberen daarom ook een minder strikte locatielezing.'; return 'Geolocatie ophalen is mislukt. Controleer toestemming, gps en browserinstellingen en probeer opnieuw.'; }
  function currentPosition(options){ return new Promise((resolve, reject)=>{ if (!window.isSecureContext) return reject(new Error(message())); if (!navigator.geolocation) return reject(new Error(message())); navigator.geolocation.getCurrentPosition((pos)=>resolve(save(pos,'live')), async(err)=>{ lastError = { code: err && err.code, raw: String(err && err.message || ''), permission_state: await permissionState() }; reject(new Error(message(err))); }, options); }); }
  function watchOnce(options){ return new Promise((resolve, reject)=>{ if (!window.isSecureContext || !navigator.geolocation) return reject(new Error(message())); let settled=false; const wid=navigator.geolocation.watchPosition((pos)=>{ if (settled) return; settled=true; clearTimeout(timer); try { navigator.geolocation.clearWatch(wid); } catch(_){} resolve(save(pos,'watch-once')); }, async(err)=>{ if (settled) return; settled=true; clearTimeout(timer); try { navigator.geolocation.clearWatch(wid); } catch(_){} lastError={ code: err&&err.code, raw:String(err&&err.message||''), permission_state: await permissionState() }; reject(new Error(message(err))); }, options); const timer=setTimeout(()=>{ if (settled) return; settled=true; try { navigator.geolocation.clearWatch(wid); } catch(_){} reject(new Error('watch timeout')); }, (options.timeout||12000)+1500); }); }
  async function request(forceFresh=false){ const maxAge=forceFresh?0:120000; try { return await currentPosition({ enableHighAccuracy:true, timeout:15000, maximumAge:maxAge }); } catch (err) { try { return await watchOnce({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 }); } catch(_){} try { return await currentPosition({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 }); } catch(_){} throw err; } }
  async function ensure(forceFresh=false, opts={}){ if (!forceFresh) { const c = cached(); if (c) return c; } if (opts.silent) return null; try { return await request(forceFresh); } catch (err) { const c = cached(60*60*1000); if (c) return c; throw err; } }
  function stopWatch(){ if (watchId === null || !navigator.geolocation) return; try { navigator.geolocation.clearWatch(watchId); } catch(_){} watchId = null; }
  function startWatch(){ if (!navigator.geolocation || watchId !== null) return; watchId = navigator.geolocation.watchPosition((pos)=>save(pos,'watch'), async(err)=>{ lastError = { code: err&&err.code, raw:String(err&&err.message||''), permission_state: await permissionState() }; announce('gejast:geo-error', lastError); }, { enableHighAccuracy:false, maximumAge:90*1000, timeout:12000 }); }
  function shouldExclude(){ const path = String((window.location && window.location.pathname) || '').toLowerCase(); return ['login.html','request.html','activate.html','scorer.html','boerenbridge.html','beerpong.html'].some((name)=>path.endsWith('/'+name) || path.endsWith(name)) || /\/admin[^/]*\.html$/.test(path); }
  function syncWatch(){ if (shouldExclude()) return stopWatch(); if (document.visibilityState === 'visible') startWatch(); else stopWatch(); }
  function startMonitor(options={}){
    if (shouldExclude()) return;
    const intervalMs = Math.max(45000, Number(options.intervalMs || 90000));
    syncWatch();
    if (!visibilityBound){ visibilityBound = true; document.addEventListener('visibilitychange', syncWatch); window.addEventListener('focus', syncWatch); }
    if (monitorId !== null) return;
    monitorId = window.setInterval(async()=>{ try { if (shouldExclude()) return stopMonitor(); const maxAge = document.visibilityState === 'visible' ? intervalMs : intervalMs * 2; if (!cached(maxAge)) await ensure(false, { silent:false }); } catch(_){} }, intervalMs);
  }
  function stopMonitor(){ if (monitorId !== null) { clearInterval(monitorId); monitorId = null; } stopWatch(); }
  function coordsKey(lat,lng){ return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`; }
  async function reverseGeocode(lat,lng){ const key=coordsKey(lat,lng); try { const map=JSON.parse(localStorage.getItem(ADDRESS_KEY)||'{}'); if (map[key] && (Date.now()-map[key].at)<86400000) return map[key].address; } catch(_){} try { const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,{headers:{Accept:'application/json'}}); const data=await res.json(); const address=data?.display_name||''; if (address) { try { const map=JSON.parse(localStorage.getItem(ADDRESS_KEY)||'{}'); map[key]={address,at:Date.now()}; localStorage.setItem(ADDRESS_KEY, JSON.stringify(map)); } catch(_){} } return address; } catch(_) { return ''; } }
  function formatCoords(pos){ if (!pos || !pos.coords) return ''; return `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} · nauwkeurigheid ${Math.round(pos.coords.accuracy || 0)}m`; }
  function getLastError(){ return lastError; }
  function ensureChromeStyle(){ if (document.getElementById('gejast-geo-chrome-style')) return; const style=document.createElement('style'); style.id='gejast-geo-chrome-style'; style.textContent=`.gejast-corner-tools{display:flex;align-items:center;gap:10px;flex:0 0 auto}.gejast-geo-button{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:999px;border:1px solid rgba(0,0,0,.08);background:#ddd3cd;color:#7d6659;box-shadow:0 10px 24px rgba(0,0,0,.08);cursor:pointer;transition:background .18s ease,color .18s ease,border-color .18s ease,transform .12s ease}.gejast-geo-button svg{width:42px;height:42px;display:block;stroke:currentColor;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}.gejast-geo-button:active{transform:translateY(1px)}.gejast-geo-button.is-ready{background:#d7dfd3;color:#627c57;border-color:rgba(98,124,87,.22)}.gejast-geo-button.is-bad{background:#ddd3cd;color:#8b6b61;border-color:rgba(139,107,97,.22)}.gejast-logo-chip{display:inline-flex;width:54px;height:54px;border-radius:999px;align-items:center;justify-content:center;background:rgba(255,251,245,.82);border:1px solid rgba(0,0,0,.08);box-shadow:0 10px 22px rgba(0,0,0,.08)}.gejast-logo-chip img{width:48px;height:48px;display:block;object-fit:contain}.gejast-top-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:nowrap}.gejast-top-row>:first-child{min-width:0}@media(max-width:640px){.gejast-corner-tools{gap:8px}.gejast-geo-button{width:58px;height:58px}.gejast-geo-button svg{width:38px;height:38px}.gejast-logo-chip{width:48px;height:48px}.gejast-logo-chip img{width:42px;height:42px}}`; document.head.appendChild(style); }
  function bindGeoButton(btn){ if (!btn || btn.dataset.geoBound==='1') return; btn.dataset.geoBound='1'; btn.addEventListener('click', async()=>{ try { const pos = await request(true); if (pos) startMonitor(); setButtonState(!!pos); } catch(_) { setButtonState(false); } }); }
  function createButton(){ const btn=document.createElement('button'); btn.type='button'; btn.className='gejast-geo-button is-bad'; btn.setAttribute('data-gejast-geo-button','1'); btn.setAttribute('aria-label','Geolocatie opnieuw proberen'); btn.title='Geolocatie opnieuw proberen'; btn.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v8M32 50v8M6 32h8M50 32h8"/><circle cx="32" cy="32" r="20" fill="none"/><circle cx="32" cy="32" r="9" fill="currentColor" stroke="none"/></svg>'; bindGeoButton(btn); return btn; }
  function ensureCornerTools(){
    if (shouldExclude()) return null;
    ensureChromeStyle();
    let existing=document.querySelector('.gejast-corner-tools');
    if (existing){ existing.querySelectorAll('[data-gejast-geo-button]').forEach(bindGeoButton); return existing; }
    const row=document.querySelector('.topbar,.top,.hero-head,.page-head,.header-row,.page-header,.header-shell');
    existing=document.createElement('div'); existing.className='gejast-corner-tools'; existing.appendChild(createButton());
    if (row){
      row.classList.add('gejast-top-row');
      let logoLink = row.querySelector('.gejast-logo-chip, a.brand, a.brand-link, a[href="./index.html"] img[src*="logo"], a[aria-label*="Home"] img[src*="logo"]');
      if (logoLink && logoLink.tagName === 'IMG') logoLink = logoLink.closest('a');
      if (logoLink && logoLink.tagName === 'A') {
        logoLink.classList.add('gejast-logo-chip');
        existing.appendChild(logoLink);
      } else {
        const logo=document.createElement('a'); logo.className='gejast-logo-chip'; logo.href='./index.html'; logo.setAttribute('aria-label','Home'); logo.innerHTML='<img src="./logo.png" alt="Despinoza logo" />'; existing.appendChild(logo);
      }
      row.appendChild(existing); return existing;
    }
    const logo=document.createElement('a'); logo.className='gejast-logo-chip'; logo.href='./index.html'; logo.setAttribute('aria-label','Home'); logo.innerHTML='<img src="./logo.png" alt="Despinoza logo" />'; existing.appendChild(logo);
    const host=document.querySelector('.shell,.sheet,.card,.hero-card,.page-shell,.panel,.wrap>.card,.wrap>.sheet');
    if (!host) return null; if (getComputedStyle(host).position==='static') host.style.position='relative'; existing.style.position='absolute'; existing.style.top='18px'; existing.style.right='18px'; host.appendChild(existing); return existing;
  }
  function setButtonState(ready){ document.querySelectorAll('[data-gejast-geo-button]').forEach((btn)=>{ btn.classList.toggle('is-ready',!!ready); btn.classList.toggle('is-bad',!ready); btn.title = ready ? 'Geolocatie actief' : 'Geolocatie opnieuw proberen'; btn.setAttribute('aria-pressed', ready ? 'true' : 'false'); }); }
  window.GEJAST_GEO = { cached, ensure, request, startWatch, stopWatch, startMonitor, stopMonitor, permissionState, message, reverseGeocode, formatCoords, getLastError, setButtonState, ensureCornerTools };
  function init(){ if (!shouldExclude()) ensureCornerTools(); setButtonState(!!cached()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})();
