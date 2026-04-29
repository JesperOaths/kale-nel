(function(){
  const CANONICAL_SPEED_TYPES = [
    { key:'bier', label:'1 Bak' },
    { key:'2bakken', label:'2 Bakken' },
    { key:'liter_bier', label:'Liter Bier' },
    { key:'ice', label:'Ice' },
    { key:'wijnfles', label:'Fles Wijn' }
  ];
  const CACHE = {
    global: { key:'gejast_drinks_global_stats_v1', ttl: 30 * 1000 },
    player: (name)=>({ key:`gejast_drinks_player_bundle_v1:${String(name||'').toLowerCase()}`, ttl: 20 * 1000 }),
    speed: (player)=>({ key:`gejast_drinks_speed_bundle_v1:${String(player||'').toLowerCase()}`, ttl: 20 * 1000 })
  };

  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function headers(){
    const c = cfg();
    return {
      'Content-Type':'application/json',
      apikey:c.SUPABASE_PUBLISHABLE_KEY||'',
      Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`,
      Accept:'application/json'
    };
  }
  async function parse(res){
    const t = await res.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { throw new Error(t || `HTTP ${res.status}`); }
    if (!res.ok) throw new Error(d?.message || d?.error || d?.hint || `HTTP ${res.status}`);
    return d;
  }
  function esc(v){ return String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function fmtUnits(v){ const n=Number(v||0); return Number.isFinite(n)?n.toFixed(1):'0.0'; }
  function fmtSeconds(v){ const n=Number(v||0); return Number.isFinite(n)?n.toFixed(1):'0.0'; }
  function dateLabel(v){ if(!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('nl-NL'); }
  function readCache(info){
    try {
      const raw = sessionStorage.getItem(info.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || (Date.now() - Number(parsed.at)) > info.ttl) return null;
      return parsed.value || null;
    } catch (_) { return null; }
  }
  function writeCache(info, value){
    try { sessionStorage.setItem(info.key, JSON.stringify({ at: Date.now(), value })); } catch (_) {}
    return value;
  }
  async function rpc(name, body){
    const c = cfg();
    const raw = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, { method:'POST', headers:headers(), body:JSON.stringify(body||{}) }).then(parse);
    return raw?.[name] || raw || {};
  }
  async function cached(loadInfo, loader){
    const cachedValue = readCache(loadInfo);
    if (cachedValue) return cachedValue;
    return writeCache(loadInfo, await loader());
  }

  function normalizeSpeedKey(raw){
    const value = String(raw||'').trim().toLowerCase();
    if (!value) return '';
    if (['shot','shots'].includes(value)) return 'shot';
    if (['bier','bak','1bak','1_bak','1 bak'].includes(value)) return 'bier';
    if (['2bakken','2 bakken','2bak','2_bakken','2 bak','2 bier','2_bier'].includes(value)) return '2bakken';
    if (['liter_bier','literbier','liter bier','liter'].includes(value)) return 'liter_bier';
    if (['ice'].includes(value)) return 'ice';
    if (['wijnfles','wijn fles','fles_wijn','fles wijn','wijn'].includes(value)) return 'wijnfles';
    return value;
  }
  function canonicalSpeedSets(sets){
    const byKey = new Map();
    (Array.isArray(sets)?sets:[]).forEach((entry)=>{
      const key = normalizeSpeedKey(entry.key || entry.speed_type_key || entry.label || entry.speed_type_label || '');
      if (!key || key === 'shot') return;
      const label = entry.label || entry.speed_type_label || (CANONICAL_SPEED_TYPES.find((row)=>row.key===key)||{}).label || key;
      const rows = Array.isArray(entry.rows) ? entry.rows : [];
      byKey.set(key, { key, label, rows });
    });
    CANONICAL_SPEED_TYPES.forEach((entry)=>{ if (!byKey.has(entry.key)) byKey.set(entry.key, { key:entry.key, label:entry.label, rows:[] }); });
    return CANONICAL_SPEED_TYPES.map((entry)=>byKey.get(entry.key)).filter(Boolean);
  }

  async function getGlobalStats(limit=120){
    return cached(CACHE.global, async()=>{
      try {
        const data = await rpc('get_drinks_global_stats_public', { history_limit: limit });
        data.history = Array.isArray(data.history) ? data.history : [];
        data.top_players = Array.isArray(data.top_players) ? data.top_players : [];
        data.top_units = Array.isArray(data.top_units) ? data.top_units : data.top_players;
        data.top_count_all = Array.isArray(data.top_count_all) ? data.top_count_all : [];
        data.top_count_month = Array.isArray(data.top_count_month) ? data.top_count_month : [];
        data.top_count_week = Array.isArray(data.top_count_week) ? data.top_count_week : [];
        data.big_nights = Array.isArray(data.big_nights) ? data.big_nights : [];
        data.by_type = Array.isArray(data.by_type) ? data.by_type : [];
        data.by_location = Array.isArray(data.by_location) ? data.by_location : [];
        data.fairness_cards = Array.isArray(data.fairness_cards) ? data.fairness_cards : [];
        return data;
      } catch (_) {
        const history = await rpc('get_verified_drinks_history_public', { limit_count: limit });
        const rows = Array.isArray(history) ? history : [];
        const playerMap = new Map(), typeMap = new Map(), locationMap = new Map();
        let allUnits = 0;
        rows.forEach((row)=>{
          const player = String(row.player_name||'').trim() || 'Onbekend';
          const typeKey = String(row.event_type_key||'').trim() || 'overig';
          const typeLabel = String(row.event_type_label||row.event_type_key||'Onbekend').trim();
          const location = String(row.location_label||'Locatie onbekend').trim();
          const units = Number(row.total_units||0) || 0;
          allUnits += units;
          if (!playerMap.has(player)) playerMap.set(player, { player_name:player, units:0, events:0 });
          const p = playerMap.get(player); p.units += units; p.events += 1;
          if (!typeMap.has(typeKey)) typeMap.set(typeKey, { event_type_key:typeKey, event_type_label:typeLabel, units:0, events:0 });
          const t = typeMap.get(typeKey); t.units += units; t.events += 1;
          if (!locationMap.has(location)) locationMap.set(location, { location_label:location, units:0, events:0 });
          const l = locationMap.get(location); l.units += units; l.events += 1;
        });
        return {
          totals: { all_events: rows.length, all_units: allUnits, week_events: 0, month_events: 0 },
          history: rows,
          top_players: [...playerMap.values()].sort((a,b)=>b.units-a.units||b.events-a.events).slice(0,12),
          top_units: [...playerMap.values()].sort((a,b)=>b.units-a.units||b.events-a.events).slice(0,12),
          top_count_all: [...playerMap.values()].sort((a,b)=>b.events-a.events||b.units-a.units).slice(0,12),
          top_count_month: [],
          top_count_week: [],
          big_nights: [],
          by_type: [...typeMap.values()].sort((a,b)=>b.units-a.units||b.events-a.events),
          by_location: [...locationMap.values()].sort((a,b)=>b.units-a.units||b.events-a.events),
          fairness_cards: []
        };
      }
    });
  }

  async function getPlayerBundle(playerName, limit=40){
    return cached(CACHE.player(playerName), async()=>{
      try {
        const data = await rpc('get_drink_player_bundle_public', { player_name_input: playerName, history_limit: limit });
        data.summary = data.summary || { events:0, units:0, avg_night_units:0, favorite_type:'—' };
        data.by_type = Array.isArray(data.by_type) ? data.by_type : [];
        data.recent = Array.isArray(data.recent) ? data.recent : [];
        data.verifiers = Array.isArray(data.verifiers) ? data.verifiers : [];
        return data;
      } catch (_) {
        const raw = await rpc('get_drink_player_public', { player_name_input: playerName });
        return {
          summary: raw.summary || { events:0, units:0, avg_night_units:0, favorite_type:'—' },
          by_type: Array.isArray(raw.by_type) ? raw.by_type : [],
          recent: Array.isArray(raw.recent) ? raw.recent : [],
          verifiers: Array.isArray(raw.verifiers) ? raw.verifiers : []
        };
      }
    });
  }

  async function getSpeedBundle(sessionToken='', targetPlayerName=''){
    return cached(CACHE.speed(targetPlayerName), async()=>{
      const body = { session_token: sessionToken || '', target_player_name: targetPlayerName || null };
      try {
        const data = await rpc('get_drink_speed_stats_bundle_public', body);
        data.rankings_by_type = canonicalSpeedSets(data.rankings_by_type || []);
        data.player_type_top5 = canonicalSpeedSets(data.player_type_top5 || []);
        data.players = Array.isArray(data.players) ? data.players : [];
        data.recent_attempts = Array.isArray(data.recent_attempts) ? data.recent_attempts : [];
        data.extra_boxes = Array.isArray(data.extra_boxes) ? data.extra_boxes : [];
        data.player_summary = data.player_summary || { verified_attempt_count:0, best_overall_seconds:null };
        return data;
      } catch (_) {
        const legacy = await rpc('get_drink_speed_stats_public', body);
        legacy.rankings_by_type = canonicalSpeedSets(legacy.rankings_by_type || []);
        legacy.player_type_top5 = canonicalSpeedSets(legacy.player_type_top5 || []);
        legacy.players = Array.isArray(legacy.players) ? legacy.players : [];
        legacy.recent_attempts = Array.isArray(legacy.recent_attempts) ? legacy.recent_attempts : [];
        legacy.extra_boxes = Array.isArray(legacy.extra_boxes) ? legacy.extra_boxes : [];
        legacy.player_summary = legacy.player_summary || { verified_attempt_count:0, best_overall_seconds:null };
        return legacy;
      }
    });
  }

  window.GEJAST_DRINKS_ANALYTICS = {
    CANONICAL_SPEED_TYPES,
    normalizeSpeedKey,
    canonicalSpeedSets,
    getGlobalStats,
    getPlayerBundle,
    getSpeedBundle,
    fmtUnits,
    fmtSeconds,
    dateLabel,
    esc
  };
})();

(function(root){
  const api = root.GEJAST_DRINKS_ANALYTICS || {};
  const cfg = root.GEJAST_CONFIG || {};
  if (!api || api.__v638SpeedPatched) return;
  const originalGetSpeedBundle = api.getSpeedBundle;
  async function parse(res){ const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null;}catch(_){throw new Error(text||`HTTP ${res.status}`);} if(!res.ok) throw new Error(data?.message||data?.error||data?.hint||text||`HTTP ${res.status}`); return data; }
  function headers(){ return { apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'', Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  api.getSpeedBundle = async function(sessionToken, playerName){
    if (cfg.SUPABASE_URL && cfg.DRINKS_SPEED_PAGE_RPC_V638) {
      try {
        const raw = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${cfg.DRINKS_SPEED_PAGE_RPC_V638}`, { method:'POST', mode:'cors', cache:'no-store', headers:headers(), body:JSON.stringify({ session_token:sessionToken||null, player_name_input:playerName||null }) }).then(parse);
        const data = raw && raw[cfg.DRINKS_SPEED_PAGE_RPC_V638] !== undefined ? raw[cfg.DRINKS_SPEED_PAGE_RPC_V638] : raw;
        if (data && !data.error) return data;
      } catch (_) {}
    }
    return originalGetSpeedBundle ? originalGetSpeedBundle.call(api, sessionToken, playerName) : { players:[], rankings_by_type:[], recent_attempts:[] };
  };
  api.__v638SpeedPatched = true;
})(window);
