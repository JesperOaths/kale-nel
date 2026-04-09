(function(){
  const CANONICAL_DRINK_TYPES = [
    { key:'bier', label:'1 Bak', unit_value:1 },
    { key:'2bakken', label:'2 Bakken', unit_value:2 },
    { key:'liter_bier', label:'Liter Bier', unit_value:2.5 },
    { key:'shot', label:'Shot', unit_value:0.5 },
    { key:'ice', label:'Ice', unit_value:1 },
    { key:'wijnfles', label:'Fles Wijn', unit_value:5 }
  ];
  const CANONICAL_SPEED_TYPES = [
    { key:'bier', label:'1 Bak' },
    { key:'2bakken', label:'2 Bakken' },
    { key:'liter_bier', label:'Liter Bier' },
    { key:'ice', label:'Ice' },
    { key:'wijnfles', label:'Fles Wijn' }
  ];
  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function token(){ try{ return cfg().getPlayerSessionToken ? cfg().getPlayerSessionToken() : ''; }catch(_){ return ''; } }
  function headers(){ const c=cfg(); return {'Content-Type':'application/json',apikey:c.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'}; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`);} if(!res.ok) throw new Error(d?.message||d?.error||d?.hint||`HTTP ${res.status}`); return d; }
  async function rpc(name, body){ const c=cfg(); return fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body||{})}).then(parse); }
  function randomClientId(){ try{ const raw=new Uint8Array(8); crypto.getRandomValues(raw); return 'spd_' + Array.from(raw).map((v)=>v.toString(16).padStart(2,'0')).join(''); }catch(_){ return 'spd_' + Math.random().toString(36).slice(2) + Date.now().toString(36); } }
  async function rpcFirst(candidates){ let lastErr=null; for(const [name,payload] of candidates){ try{ return await rpc(name,payload); }catch(err){ lastErr=err; const msg=String(err&&err.message||err||''); if(/does not exist|schema cache|could not find the function/i.test(msg)) continue; throw err; } } throw lastErr || new Error('Geen passende drinks-RPC gevonden.'); }
  function canonicalDrinkTypes(types){
    const existing = Array.isArray(types) ? types : [];
    const byKey = new Map(existing.map((s)=>[String(s.key||s.event_type_key||'').trim(), { key:String(s.key||s.event_type_key||'').trim(), label:s.label||s.event_type_label||String(s.key||s.event_type_key||''), unit_value:Number(s.unit_value ?? s.units ?? s.quantity ?? 0) || 0 }]));
    CANONICAL_DRINK_TYPES.forEach((entry)=>{ if(!byKey.has(entry.key)) byKey.set(entry.key,{ key:entry.key, label:entry.label, unit_value:entry.unit_value }); });
    return Array.from(byKey.values()).filter((row)=>row && row.key).sort((a,b)=>{
      const ai = CANONICAL_DRINK_TYPES.findIndex((row)=>row.key===a.key);
      const bi = CANONICAL_DRINK_TYPES.findIndex((row)=>row.key===b.key);
      return (ai===-1?999:ai) - (bi===-1?999:bi) || String(a.label||a.key).localeCompare(String(b.label||b.key),'nl');
    });
  }
  function canonicalSpeedSets(sets){
    const existing = Array.isArray(sets) ? sets.filter((s)=>String(s.key||s.speed_type_key||'').toLowerCase()!=='shot') : [];
    const byKey = new Map(existing.map((s)=>[String(s.key||s.speed_type_key||''), { key:String(s.key||s.speed_type_key||''), label:s.label||s.speed_type_label||String(s.key||s.speed_type_key||''), rows:Array.isArray(s.rows)?s.rows:[] }]));
    CANONICAL_SPEED_TYPES.forEach((entry)=>{ if(!byKey.has(entry.key)) byKey.set(entry.key,{ key:entry.key, label:entry.label, rows:[] }); });
    return CANONICAL_SPEED_TYPES.map((entry)=>byKey.get(entry.key)).filter(Boolean);
  }
  async function fallback(opts={}){
    const session_token = opts.session_token || token();
    const payload = { session_token, viewer_lat: opts.viewer_lat ?? null, viewer_lng: opts.viewer_lng ?? null };
    const [pageRaw, verifyRaw, mineRaw, historyRaw, speedRaw] = await Promise.allSettled([
      rpc('get_drinks_page_public', payload),
      rpc('get_all_pending_drink_event_verifications_public', { session_token }),
      rpc('get_my_pending_drink_requests_public', { session_token }),
      rpc('get_verified_drinks_history_public', { limit_count: opts.history_limit ?? 40 }),
      rpc('get_drink_speed_page_public', payload)
    ]);
    const page = pageRaw.status==='fulfilled' ? (pageRaw.value?.get_drinks_page_public||pageRaw.value||{}) : {};
    const verify_queue = verifyRaw.status==='fulfilled' ? (verifyRaw.value?.get_all_pending_drink_event_verifications_public||verifyRaw.value||[]) : (page.verify_queue||[]);
    const my_pending_events = mineRaw.status==='fulfilled' ? (mineRaw.value?.get_my_pending_drink_requests_public||mineRaw.value||[]) : (page.my_pending_events||[]);
    const verified_history = historyRaw.status==='fulfilled' ? (historyRaw.value?.get_verified_drinks_history_public||historyRaw.value||[]) : (page.recent_verified||[]);
    const speed_page = speedRaw.status==='fulfilled' ? (speedRaw.value?.get_drink_speed_page_public||speedRaw.value||{}) : {};
    return {
      page,
      verify_queue,
      my_pending_events,
      verified_history,
      speed_page,
      event_types: canonicalDrinkTypes(Array.isArray(page.event_types) ? page.event_types : []),
      speed_leaderboards: canonicalSpeedSets(speed_page.leaderboards||page.speed_leaderboards||[]),
      recent_verified: Array.isArray(page.recent_verified) ? page.recent_verified : verified_history.slice(0,8),
      recent_rejected: Array.isArray(page.recent_rejected) ? page.recent_rejected : (Array.isArray(page.recent_events) ? page.recent_events.filter((r)=>String(r.status||'').toLowerCase()==='rejected') : [])
    };
  }
  function shapePendingView(data){
    const page = data?.page || {};
    return {
      page,
      verifyQueue: Array.isArray(data?.verify_queue) ? data.verify_queue : [],
      myPendingEvents: Array.isArray(data?.my_pending_events) ? data.my_pending_events : [],
      verifiedHistory: Array.isArray(data?.verified_history) ? data.verified_history : [],
      recentRejected: Array.isArray(data?.recent_rejected) ? data.recent_rejected : [],
      recentVerified: Array.isArray(data?.recent_verified) ? data.recent_verified : []
    };
  }
  function shapeAddView(data){
    const page = data?.page || {};
    return {
      page,
      eventTypes: canonicalDrinkTypes(Array.isArray(data?.event_types) ? data.event_types : []),
      verifyQueue: Array.isArray(data?.verify_queue) ? data.verify_queue : [],
      myPendingEvents: Array.isArray(data?.my_pending_events) ? data.my_pending_events : [],
      recentVerified: Array.isArray(data?.recent_verified) ? data.recent_verified : [],
      recentRejected: Array.isArray(data?.recent_rejected) ? data.recent_rejected : []
    };
  }
  function shapeSpeedView(data){
    return {
      speedPage: data?.speed_page || {},
      eventTypes: canonicalDrinkTypes(Array.isArray(data?.event_types) ? data.event_types : []),
      speedLeaderboards: canonicalSpeedSets(data?.speed_leaderboards || data?.speed_page?.leaderboards || [])
    };
  }
  async function load(opts={}){
    const session_token = opts.session_token || token();
    try{
      const raw = await rpc('get_drinks_workflow_public', { session_token, viewer_lat: opts.viewer_lat ?? null, viewer_lng: opts.viewer_lng ?? null, history_limit: opts.history_limit ?? 40 });
      const data = raw?.get_drinks_workflow_public || raw || {};
      data.page = data.page || {};
      data.verify_queue = Array.isArray(data.verify_queue) ? data.verify_queue : [];
      data.my_pending_events = Array.isArray(data.my_pending_events) ? data.my_pending_events : [];
      data.verified_history = Array.isArray(data.verified_history) ? data.verified_history : [];
      data.speed_page = data.speed_page || {};
      data.speed_leaderboards = canonicalSpeedSets(data.speed_leaderboards || data.speed_page.leaderboards || []);
      data.event_types = canonicalDrinkTypes(Array.isArray(data.event_types) ? data.event_types : (Array.isArray(data.page.event_types) ? data.page.event_types : []));
      data.recent_verified = Array.isArray(data.recent_verified) ? data.recent_verified : (Array.isArray(data.page.recent_verified) ? data.page.recent_verified : data.verified_history.slice(0,8));
      data.recent_rejected = Array.isArray(data.recent_rejected) ? data.recent_rejected : (Array.isArray(data.page.recent_rejected) ? data.page.recent_rejected : []);
      return data;
    }catch(err){
      return fallback(opts);
    }
  }
async function createDrinkEvent(opts={}){
  const session_token = opts.session_token || token();
  const event_type_key = opts.event_type_key || opts.speed_type_key || '';
  const quantity = opts.quantity ?? 1;
  const lat = opts.lat ?? null;
  const lng = opts.lng ?? null;
  const accuracy = opts.accuracy ?? null;
  return rpcFirst([
    ['create_drink_event', { session_token, event_type_key, quantity, lat, lng, accuracy }],
    ['create_drink_event', { session_token, speed_type_key: event_type_key, quantity, lat, lng, accuracy }],
    ['create_drink_event', { session_token_input: session_token, event_type_key_input: event_type_key, quantity_input: quantity, lat_input: lat, lng_input: lng, accuracy_input: accuracy }],
    ['create_drink_event', { session_token_input: session_token, speed_type_key_input: event_type_key, quantity_input: quantity, lat_input: lat, lng_input: lng, accuracy_input: accuracy }]
  ]);
}
async function verifyDrinkEvent(opts={}){
  return rpc('verify_drink_event_public', {
    session_token: opts.session_token || token(),
    drink_event_id: Number(opts.drink_event_id || opts.id || 0),
    approved: opts.approved !== false
  });
}
async function cancelDrinkEvent(opts={}){
  return rpc('cancel_my_pending_drink_event', {
    session_token: opts.session_token || token(),
    drink_event_id: Number(opts.drink_event_id || opts.id || 0)
  });
}
async function createSpeedAttempt(opts={}){
  const session_token = opts.session_token || token();
  const client_attempt_id = opts.client_attempt_id || randomClientId();
  const event_type_key = opts.event_type_key || opts.speed_type_key || '';
  const quantity = opts.quantity ?? 1;
  const duration_seconds = opts.duration_seconds;
  const lat = opts.lat ?? null;
  const lng = opts.lng ?? null;
  const accuracy = opts.accuracy ?? null;
  return rpcFirst([
    ['create_combined_drink_speed_attempt', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_combined_drink_speed_attempt', { session_token, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_combined_drink_speed_attempt', { session_token, client_attempt_id, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_combined_drink_speed_attempt', { session_token, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_drink_speed_attempt', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_drink_speed_attempt', { session_token, client_attempt_id, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
    ['create_drink_speed_attempt', { session_token_input: session_token, client_attempt_id_input: client_attempt_id, event_type_key_input: event_type_key, quantity_input: quantity, duration_seconds_input: duration_seconds, lat_input: lat, lng_input: lng, accuracy_input: accuracy }],
    ['create_drink_speed_attempt', { session_token_input: session_token, client_attempt_id_input: client_attempt_id, speed_type_key_input: event_type_key, quantity_input: quantity, duration_seconds_input: duration_seconds, lat_input: lat, lng_input: lng, accuracy_input: accuracy }]
  ]);
}
async function verifySpeedAttempt(opts={}){
  return rpc('verify_drink_speed_attempt', {
    session_token: opts.session_token || token(),
    attempt_id: Number(opts.attempt_id || opts.id || 0),
    lat: opts.lat ?? null,
    lng: opts.lng ?? null,
    accuracy: opts.accuracy ?? null,
    approve: opts.approve !== false
  });
}
async function cancelSpeedAttempt(opts={}){
  return rpc('cancel_my_speed_attempt', {
    session_token: opts.session_token || token(),
    attempt_id: Number(opts.attempt_id || opts.id || 0)
  });
}

  async function forPending(opts={}){ return shapePendingView(await load(opts)); }
  async function forAdd(opts={}){ return shapeAddView(await load(opts)); }
  async function forSpeed(opts={}){ return shapeSpeedView(await load(opts)); }
  window.GEJAST_DRINKS_WORKFLOW = { CANONICAL_DRINK_TYPES, CANONICAL_SPEED_TYPES, canonicalDrinkTypes, canonicalSpeedSets, load, fallback, token, headers, forPending, forAdd, forSpeed, createDrinkEvent, verifyDrinkEvent, cancelDrinkEvent, createSpeedAttempt, verifySpeedAttempt, cancelSpeedAttempt, rpcFirst };
})();
