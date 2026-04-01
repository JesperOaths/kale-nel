(function(){
  const CACHE_KEY = 'gejast_geo_cache_v4';
  const ADDRESS_KEY = 'gejast_geo_address_cache_v1';
  let watchId = null;
  let lastPos = null;
  let lastError = null;

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
    lastError = null;
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

  function classify(err){
    const code = err && typeof err.code === 'number' ? err.code : null;
    const raw = String((err && err.message) || '').toLowerCase();
    if (code === 1 || raw.includes('denied') || raw.includes('permission')) return 'permission';
    if (code === 2 || raw.includes('position unavailable') || raw.includes('unavailable')) return 'unavailable';
    if (code === 3 || raw.includes('timeout')) return 'timeout';
    return 'unknown';
  }

  function message(err){
    if (!window.isSecureContext) return 'Geolocatie werkt alleen via een beveiligde https-verbinding.';
    if (!navigator.geolocation) return 'Geolocatie wordt niet ondersteund op dit apparaat of in deze browser.';
    const kind = classify(err);
    if (kind === 'permission') return 'De browser gaf geolocatie nog niet vrij. Controleer browser-sitepermissie en apparaatlocatie, en probeer daarna opnieuw.';
    if (kind === 'unavailable') return 'Locatie is nu niet beschikbaar. Controleer of gps of locatievoorzieningen aanstaan en probeer opnieuw.';
    if (kind === 'timeout') return 'Locatie opvragen duurde te lang. We proberen daarom ook een minder strikte locatielezing.';
    return 'Geolocatie ophalen is mislukt. Controleer toestemming, gps en browserinstellingen en probeer opnieuw.';
  }

  function currentPosition(options){
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error(message()));
      if (!navigator.geolocation) return reject(new Error(message()));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(save(pos, 'live')),
        async(err) => {
          lastError = { code: err && err.code, raw: String(err && err.message || ''), permission_state: await permissionState() };
          reject(new Error(message(err)));
        },
        options
      );
    });
  }

  function watchOnce(options){
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext || !navigator.geolocation) return reject(new Error(message()));
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { navigator.geolocation.clearWatch(wid); } catch(_){}
        reject(new Error('watch timeout'));
      }, (options.timeout || 12000) + 1500);
      const wid = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { navigator.geolocation.clearWatch(wid); } catch(_){}
          resolve(save(pos, 'watch-once'));
        },
        async(err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { navigator.geolocation.clearWatch(wid); } catch(_){}
          lastError = { code: err && err.code, raw: String(err && err.message || ''), permission_state: await permissionState() };
          reject(new Error(message(err)));
        },
        options
      );
    });
  }

  async function request(forceFresh=false){
    if (!window.isSecureContext) throw new Error(message(null));
    if (!navigator.geolocation) throw new Error(message(null));

    const maxAge = forceFresh ? 0 : 120000;
    try {
      return await currentPosition({ enableHighAccuracy:true, timeout:15000, maximumAge:maxAge });
    } catch (err) {
      const kind = classify(lastError || err);
      try {
        return await watchOnce({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 });
      } catch (_) {}
      if (kind === 'timeout' || kind === 'unavailable' || kind === 'permission' || kind === 'unknown') {
        try {
          return await currentPosition({ enableHighAccuracy:false, timeout:14000, maximumAge:5*60*1000 });
        } catch (_) {}
      }
      throw err;
    }
  }

  async function ensure(forceFresh=false, opts={}){
    const silent = !!opts.silent;
    if (!forceFresh) {
      const c = cached();
      if (c) return c;
    }
    if (silent) return null;
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
    } catch(_){ }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`, { headers: { Accept:'application/json' } });
      const data = await res.json();
      const address = data?.display_name || '';
      if (address) {
        try {
          const cachedMap = JSON.parse(localStorage.getItem(ADDRESS_KEY) || '{}');
          cachedMap[key] = { address, at: Date.now() };
          localStorage.setItem(ADDRESS_KEY, JSON.stringify(cachedMap));
        } catch(_){ }
      }
      return address;
    } catch(_) { return ''; }
  }

  function formatCoords(pos){
    if (!pos || !pos.coords) return '';
    return `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} · nauwkeurigheid ${Math.round(pos.coords.accuracy || 0)}m`;
  }

  function getLastError(){ return lastError; }

  window.GEJAST_GEO = { cached, ensure, request, startWatch, permissionState, message, reverseGeocode, formatCoords, getLastError };
})();
