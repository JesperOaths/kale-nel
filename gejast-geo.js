(function(){
  const CACHE_KEY = 'gejast_geo_cache_v1';
  let watchId = null;
  function save(pos){ try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || null, at: Date.now() })); } catch(_){} return pos; }
  function cached(maxAgeMs=10*60*1000){ try { const raw = JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); if (!raw || !raw.at || (Date.now()-raw.at)>maxAgeMs) return null; return { coords: { latitude: raw.lat, longitude: raw.lng, accuracy: raw.accuracy||null } }; } catch(_) { return null; } }
  async function permissionState(){ try { if (!navigator.permissions || !navigator.permissions.query) return 'unknown'; const r = await navigator.permissions.query({ name:'geolocation' }); return r.state || 'unknown'; } catch(_) { return 'unknown'; } }
  function message(err, state='unknown'){
    if (!window.isSecureContext) return 'Geolocatie werkt alleen via een beveiligde https-verbinding.';
    if (!navigator.geolocation) return 'Geolocatie wordt niet ondersteund op dit apparaat of in deze browser.';
    const code = err && typeof err.code === 'number' ? err.code : null;
    const raw = String((err && err.message) || '').toLowerCase();
    if (code === 1 || raw.includes('denied') || raw.includes('permission')) {
      if (state === 'denied') return 'Locatie kwam niet door. Dit kan komen door een eerdere browser/sitekeuze, Android-locatie-instellingen of een prompt die niet is doorgekomen. Gebruik Geolocatie opnieuw proberen en controleer eventueel site-permissies.';
      return 'Locatie kwam niet door. Probeer Geolocatie opnieuw proberen en controleer eventueel browser- en Android-locatie-instellingen.';
    }
    if (code === 2 || raw.includes('position unavailable') || raw.includes('unavailable')) return 'Locatie is nu niet beschikbaar. Controleer of locatie/gps op je toestel aanstaat en probeer opnieuw.';
    if (code === 3 || raw.includes('timeout')) return 'Locatie opvragen duurde te lang. Probeer opnieuw met betere gps of verbinding.';
    return 'Geolocatie ophalen is mislukt. Controleer toestemming, gps en browserinstellingen en probeer opnieuw.';
  }
  async function request(forceFresh=false){
    const state = await permissionState();
    return new Promise((resolve,reject)=>{
      if (!window.isSecureContext) return reject(new Error(message(null,state)));
      if (!navigator.geolocation) return reject(new Error(message(null,state)));
      navigator.geolocation.getCurrentPosition((pos)=>resolve(save(pos)), async(err)=>reject(new Error(message(err, await permissionState()))), { enableHighAccuracy:true, timeout:10000, maximumAge: forceFresh ? 0 : 60000 });
    });
  }
  async function ensure(forceFresh=false){ if (!forceFresh) { const c = cached(); if (c) return c; } return request(forceFresh); }
  function startWatch(){ if (!navigator.geolocation || watchId !== null) return; watchId = navigator.geolocation.watchPosition((pos)=>save(pos), ()=>{}, { enableHighAccuracy:true, maximumAge:60000, timeout:15000 }); }
  window.GEJAST_GEO = { cached, ensure, request, startWatch, permissionState, message };
})();
