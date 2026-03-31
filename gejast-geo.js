(function(){
  const CACHE_KEY = 'gejast_geo_cache_v3';
  const ADDRESS_KEY = 'gejast_geo_address_cache_v1';
  let watchId = null;
  let lastPos = null;

  function normalize(pos, source='live'){
    if (!pos || !pos.coords) return null;
    return {
      source,
      coords: {
        latitude: Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude),
        accuracy: pos.coords.accuracy == null ? null : Number(pos.coords.accuracy)
      },
      timestamp: pos.timestamp || Date.now()
    };
  }

  function save(pos, source='live'){
    const out = normalize(pos, source);
    if (!out) return null;
    lastPos = out;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        lat: out.coords.latitude,
        lng: out.coords.longitude,
        accuracy: out.coords.accuracy,
        at: Date.now()
      }));
    } catch(_){}
    return out;
  }

  function cached(maxAgeMs=10*60*1000){
    if (lastPos && Date.now() - (lastPos.timestamp || 0) <= maxAgeMs) return lastPos;
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || !raw.at || (Date.now() - raw.at) > maxAgeMs) return null;
      return normalize({ coords: { latitude: raw.lat, longitude: raw.lng, accuracy: raw.accuracy }, timestamp: raw.at }, 'cache');
    } catch(_) { return null; }
  }

  async function permissionState(){
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const r = await navigator.permissions.query({ name:'geolocation' });
      return r.state || 'unknown';
    } catch(_) { return 'unknown'; }
  }

  function message(err, state='unknown'){
    if (!window.isSecureContext) return 'Geolocatie werkt alleen via een beveiligde https-verbinding.';
    if (!navigator.geolocation) return 'Geolocatie wordt niet ondersteund op dit apparaat of in deze browser.';
    const code = err && typeof err.code === 'number' ? err.code : null;
    const raw = String((err && err.message) || '').toLowerCase();
    if (code === 1 || raw.includes('denied') || raw.includes('permission')) {
      if (state === 'denied') return 'Locatie staat voor deze site of browser uit. Zet locatietoegang weer aan in browser- of Android-instellingen en probeer daarna opnieuw.';
      return 'Het locatieverzoek kwam niet goed door. Vaak komt dit door browser/site-permissies, Android-locatie-instellingen of doordat de prompt niet zichtbaar werd.';
    }
    if (code === 2 || raw.includes('position unavailable') || raw.includes('unavailable')) return 'Locatie is nu niet beschikbaar. Controleer of gps of locatievoorzieningen aanstaan en probeer opnieuw.';
    if (code === 3 || raw.includes('timeout')) return 'Locatie opvragen duurde te lang. We proberen daarom beter te vallen op een minder strikte locatielezing.';
    return 'Geolocatie ophalen is mislukt. Controleer toestemming, gps en browserinstellingen en probeer opnieuw.';
  }

  function currentPosition(options){
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error(message()));
      if (!navigator.geolocation) return reject(new Error(message()));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(save(pos, 'live')),
        async(err) => reject(new Error(message(err, await permissionState()))),
        options
      );
    });
  }

  async function request(forceFresh=false){
    const state = await permissionState();
    if (!window.isSecureContext) throw new Error(message(null, state));
    if (!navigator.geolocation) throw new Error(message(null, state));

    const maxAge = forceFresh ? 0 : 120000;
    try {
      return await currentPosition({ enableHighAccuracy:true, timeout:15000, maximumAge:maxAge });
    } catch (err) {
      const msg = String(err && err.message || '').toLowerCase();
      const isMaybeTimeout = msg.includes('duurde te lang') || msg.includes('timeout') || msg.includes('niet beschikbaar') || msg.includes('unavailable');
      if (!isMaybeTimeout) throw err;
      return currentPosition({ enableHighAccuracy:false, timeout:12000, maximumAge:5*60*1000 });
    }
  }

  async function ensure(forceFresh=false, opts={}){
    const silent = !!opts.silent;
    if (!forceFresh) {
      const c = cached();
      if (c) return c;
    }
    const state = await permissionState();
    if (silent && state !== 'granted') return null;
    try {
      return await request(forceFresh);
    } catch (err) {
      const c = cached(60*60*1000);
      if (c) return c;
      throw err;
    }
  }

  function startWatch(){
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(
      (pos)=>save(pos, 'watch'),
      ()=>{},
      { enableHighAccuracy:false, maximumAge:5*60*1000, timeout:20000 }
    );
  }

  function coordsKey(lat,lng){ return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`; }

  async function reverseGeocode(lat,lng){
    const key = coordsKey(lat,lng);
    try {
      const cachedMap = JSON.parse(localStorage.getItem(ADDRESS_KEY) || '{}');
      if (cachedMap[key] && (Date.now() - cachedMap[key].at) < 24*60*60*1000) return cachedMap[key].address;
    } catch(_){}
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`, {
        headers: { Accept:'application/json' }
      });
      const data = await res.json();
      const address = data?.display_name || '';
      if (address) {
        try {
          const cachedMap = JSON.parse(localStorage.getItem(ADDRESS_KEY) || '{}');
          cachedMap[key] = { address, at: Date.now() };
          localStorage.setItem(ADDRESS_KEY, JSON.stringify(cachedMap));
        } catch(_){}
      }
      return address;
    } catch(_) { return ''; }
  }

  function formatCoords(pos){
    if (!pos || !pos.coords) return '';
    return `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} · nauwkeurigheid ${Math.round(pos.coords.accuracy || 0)}m`;
  }

  window.GEJAST_GEO = { cached, ensure, request, startWatch, permissionState, message, reverseGeocode, formatCoords };
})();
