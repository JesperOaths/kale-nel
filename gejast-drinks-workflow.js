(function(){
  const CANONICAL_DRINK_TYPES = [
    { key:'bier', label:'1 Bak', unit_value:1 },
    { key:'2bakken', label:'2 Bakken', unit_value:2 },
    { key:'liter_bier', label:'Liter Bier', unit_value:3 },
    { key:'shot', label:'Shot', unit_value:1 },
    { key:'ice', label:'Ice', unit_value:2.8 },
    { key:'wijnfles', label:'Fles Wijn', unit_value:9 }
  ];
  const CANONICAL_SPEED_TYPES = [
    { key:'bier', label:'1 Bak' },
    { key:'2bakken', label:'2 Bakken' },
    { key:'liter_bier', label:'Liter Bier' },
    { key:'ice', label:'Ice' },
    { key:'wijnfles', label:'Fles Wijn' }
  ];
  const BLOCKED_NON_DRINK_KEYS = new Set(['drydock','dry_dock','droogdok','droog_dok']);

  function cfg(){ return window.GEJAST_CONFIG || {}; }
  function token(){ try{ return cfg().getPlayerSessionToken ? cfg().getPlayerSessionToken() : ''; }catch(_){ return ''; } }
  function headers(){ const c=cfg(); return {'Content-Type':'application/json',apikey:c.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${c.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'}; }
  async function parse(res){ const t=await res.text(); let d=null; try{ d=t?JSON.parse(t):null; }catch{ throw new Error(t||`HTTP ${res.status}`);} if(!res.ok) throw new Error(d?.message||d?.error||d?.hint||`HTTP ${res.status}`); return d; }
  async function rpc(name, body){ const c=cfg(); return fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body||{})}).then(parse); }
  function randomClientId(){ try{ const raw=new Uint8Array(8); crypto.getRandomValues(raw); return 'spd_' + Array.from(raw).map((v)=>v.toString(16).padStart(2,'0')).join(''); }catch(_){ return 'spd_' + Math.random().toString(36).slice(2) + Date.now().toString(36); } }
  function inferScope(){ try{ const qs=new URLSearchParams(location.search||''); return cfg().normalizeScope ? cfg().normalizeScope(qs.get('scope')) : ((String(qs.get('scope')||'').toLowerCase()==='family') ? 'family' : 'friends'); }catch(_){ return 'friends'; } }

  function normalizeTypeKey(value){
    return String(value || '').trim().toLowerCase();
  }
  function isBlockedNonDrinkKey(value){
    return BLOCKED_NON_DRINK_KEYS.has(normalizeTypeKey(value));
  }
  function isVerifiedSpeedRow(row){
    const status = normalizeTypeKey(row?.status || '');
    return status === 'verified' || !!row?.verified_at || !!row?.verified_by;
  }

  async function contractWrite(action, payload){
    const base = { session_token: payload?.session_token || token(), action, payload: payload || {}, site_scope_input: inferScope() };
    const attempts = [cfg().DRINKS_CONTRACT_WRITE_RPC_V664 || 'contract_drinks_write_v664','contract_drinks_write_v663','contract_drinks_write_v391','contract_drinks_write_v386','contract_drinks_write_v1'];
    let lastErr = null;
    for (const name of attempts){
      try {
        const raw = await rpc(name, base);
        if (raw && typeof raw.ok === 'boolean') { if (!raw.ok) throw new Error(raw?.error?.message || raw?.message || 'Contract write mislukt.'); return raw.data || {}; }
        return raw || {};
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error('Contract write mislukt.');
  }

  async function rpcFirst(candidates){
    let lastErr=null;
    for(const [name,payload] of candidates){
      try{ return await rpc(name,payload); }
      catch(err){
        lastErr=err;
        const msg=String(err&&err.message||err||'');
        if(/does not exist|schema cache|could not find the function|could not choose the best candidate function/i.test(msg)) continue;
        throw err;
      }
    }
    throw lastErr || new Error('Geen passende drinks-RPC gevonden.');
  }

  function canonicalDrinkTypes(types){
    const existing = Array.isArray(types) ? types : [];
    const filtered = existing.filter((s)=>{
      const key = normalizeTypeKey(s.key || s.event_type_key || '');
      return key && !isBlockedNonDrinkKey(key);
    });
    const byKey = new Map(filtered.map((s)=>[
      String(s.key||s.event_type_key||'').trim(),
      {
        key:String(s.key||s.event_type_key||'').trim(),
        label:s.label||s.event_type_label||String(s.key||s.event_type_key||''),
        unit_value:Number(s.unit_value ?? s.units ?? s.quantity ?? 0) || 0
      }
    ]));
    CANONICAL_DRINK_TYPES.forEach((entry)=>{
      if(!byKey.has(entry.key)) byKey.set(entry.key,{ key:entry.key, label:entry.label, unit_value:entry.unit_value });
    });
    return Array.from(byKey.values()).filter((row)=>row && row.key).sort((a,b)=>{
      const ai = CANONICAL_DRINK_TYPES.findIndex((row)=>row.key===a.key);
      const bi = CANONICAL_DRINK_TYPES.findIndex((row)=>row.key===b.key);
      return (ai===-1?999:ai) - (bi===-1?999:bi) || String(a.label||a.key).localeCompare(String(b.label||b.key),'nl');
    });
  }

  function canonicalSpeedSets(sets){
    const existing = Array.isArray(sets) ? sets : [];
    const filtered = existing.filter((s)=>{
      const key = normalizeTypeKey(s.key || s.speed_type_key || '');
      return key && key !== 'shot' && !isBlockedNonDrinkKey(key);
    });
    const byKey = new Map(filtered.map((s)=>[
      String(s.key||s.speed_type_key||''),
      {
        key:String(s.key||s.speed_type_key||''),
        label:s.label||s.speed_type_label||String(s.key||s.speed_type_key||''),
        rows:(Array.isArray(s.rows)?s.rows:[]).filter(isVerifiedSpeedRow)
      }
    ]));
    CANONICAL_SPEED_TYPES.forEach((entry)=>{
      if(!byKey.has(entry.key)) byKey.set(entry.key,{ key:entry.key, label:entry.label, rows:[] });
    });
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

  function normalizeLoadedData(raw){
    const data = raw && typeof raw.ok === 'boolean' ? (raw.data || {}) : (raw || {});
    data.page = data.page || data.bundle || {};
    data.verify_queue = Array.isArray(data.verify_queue) ? data.verify_queue : [];
    data.my_pending_events = Array.isArray(data.my_pending_events) ? data.my_pending_events : [];
    data.verified_history = Array.isArray(data.verified_history) ? data.verified_history : [];
    data.speed_page = data.speed_page || {};
    data.speed_leaderboards = canonicalSpeedSets(data.speed_leaderboards || data.speed_page.leaderboards || []);
    data.event_types = canonicalDrinkTypes(Array.isArray(data.event_types) ? data.event_types : (Array.isArray(data.page.event_types) ? data.page.event_types : []));
    data.recent_verified = Array.isArray(data.recent_verified) ? data.recent_verified : (Array.isArray(data.page.recent_verified) ? data.page.recent_verified : data.verified_history.slice(0,8));
    data.recent_rejected = Array.isArray(data.recent_rejected) ? data.recent_rejected : (Array.isArray(data.page.recent_rejected) ? data.page.recent_rejected : []);
    return data;
  }

  async function load(opts={}){
    const session_token = opts.session_token || token();
    const viewer_lat = opts.viewer_lat ?? null;
    const viewer_lng = opts.viewer_lng ?? null;
    const history_limit = opts.history_limit ?? 40;
    const site_scope_input = inferScope();
    const attempts = [
      [cfg().DRINKS_CONTRACT_READ_RPC_V664 || 'contract_drinks_read_v664', { session_token, viewer_lat, viewer_lng, history_limit, site_scope_input }],
      ['contract_drinks_read_v663', { session_token, viewer_lat, viewer_lng, history_limit, site_scope_input }],
      ['contract_drinks_read_v386', { session_token, viewer_lat, viewer_lng, history_limit, site_scope_input }],
      ['contract_drinks_read_v1', { session_token, viewer_lat, viewer_lng, history_limit, site_scope_input }],
      ['get_drinks_page_bundle_public_scoped', { session_token, viewer_lat, viewer_lng, history_limit, site_scope_input }],
      ['get_drinks_workflow_public', { session_token, viewer_lat, viewer_lng, history_limit }]
    ];
    let lastErr = null;
    for (const [name, payload] of attempts){
      try {
        return normalizeLoadedData(await rpc(name, payload));
      } catch (err) {
        lastErr = err;
      }
    }
    return fallback(opts).catch(() => { throw lastErr || new Error('Drinks workflow laden mislukt.'); });
  }

  function normalizePushRequestKind(kind){
    const raw = normalizeTypeKey(kind);
    return raw.includes('speed') ? 'speed' : 'drink';
  }

  async function queueNearbyForCreated(kind, id, opts={}){
    const numericId = Number(id || 0);
    if (!numericId) return { ok:false, queued_count:0, reason:'missing-request-id' };
    const requestKind = normalizePushRequestKind(kind);
    const session_token = opts.session_token || token();
    const site_scope_input = inferScope();

    if (window.GEJAST_PUSH_RUNTIME && typeof window.GEJAST_PUSH_RUNTIME.queueNearbyVerificationPushes === 'function') {
      try {
        const viaRuntime = await window.GEJAST_PUSH_RUNTIME.queueNearbyVerificationPushes({
          session_token_input: session_token,
          request_kind_input: requestKind,
          request_id_input: numericId,
          site_scope_input
        });
        if (viaRuntime && viaRuntime.ok !== false) return viaRuntime;
      } catch (_) {}
    }

    const attempts = [
      ['contract_drinks_queue_nearby_v664', { session_token, request_kind: requestKind, request_id: numericId, site_scope_input }],
      [cfg().WEB_PUSH_QUEUE_NEARBY_RPC_V3 || 'queue_nearby_verification_pushes_v3', { session_token_input: session_token, request_kind_input: requestKind, request_id_input: numericId, site_scope_input }],
      [cfg().WEB_PUSH_QUEUE_NEARBY_RPC_V3 || 'queue_nearby_verification_pushes_v3', { request_kind_input: requestKind, request_id_input: numericId, cooldown_seconds_input: 300 }]
    ];
    let last = null;
    for (const [name, body] of attempts) {
      try {
        const out = await rpc(name, body);
        if (out && out.ok !== false) return out;
        last = out;
      } catch (err) { last = { ok:false, queued_count:0, reason:err?.message || 'queue-failed' }; }
    }
    return last || { ok:false, queued_count:0, reason:'queue-failed' };
  }

  async function createDrinkEvent(opts={}){
    const session_token = opts.session_token || token();
    const event_type_key = opts.event_type_key || opts.speed_type_key || '';
    const quantity = opts.quantity ?? 1;
    const lat = opts.lat ?? null;
    const lng = opts.lng ?? null;
    const accuracy = opts.accuracy ?? null;
    try {
      const out = await contractWrite('create_event', { session_token, event_type_key, quantity, lat, lng, accuracy });
      await queueNearbyForCreated('drink', out?.drink_event_id || out?.event_id || out?.id, {session_token, lat, lng, accuracy});
      return out;
    } catch (_) {}
    const out = await rpcFirst([
      ['create_drink_event_v382', { session_token, event_type_key, quantity, lat, lng, accuracy }],
      ['create_drink_event', { session_token, event_type_key, quantity, lat, lng, accuracy }],
      ['create_drink_event', { session_token, speed_type_key: event_type_key, quantity, lat, lng, accuracy }],
      ['create_drink_event', { session_token_input: session_token, event_type_key_input: event_type_key, quantity_input: quantity, lat_input: lat, lng_input: lng, accuracy_input: accuracy }],
      ['create_drink_event', { session_token_input: session_token, speed_type_key_input: event_type_key, quantity_input: quantity, lat_input: lat, lng_input: lng, accuracy_input: accuracy }]
    ]);
    await queueNearbyForCreated('drink', out?.drink_event_id || out?.event_id || out?.id, {session_token, lat, lng, accuracy});
    return out;
  }

  async function verifyDrinkEvent(opts={}){
    const payload = {
      session_token: opts.session_token || token(),
      drink_event_id: Number(opts.drink_event_id || opts.id || 0),
      approve: opts.approved !== false,
      approved: opts.approved !== false,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      accuracy: opts.accuracy ?? null
    };
    try {
      return await contractWrite('verify_event', payload);
    } catch (_) {}
    return rpc('verify_drink_event_public', {
      session_token: payload.session_token,
      drink_event_id: payload.drink_event_id,
      approved: payload.approve
    });
  }

  async function cancelDrinkEvent(opts={}){
    const payload = {
      session_token: opts.session_token || token(),
      drink_event_id: Number(opts.drink_event_id || opts.id || 0)
    };
    try {
      return await contractWrite('cancel_event', payload);
    } catch (_) {}
    return rpc('cancel_my_pending_drink_event', payload);
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
    try {
      const out = await contractWrite('create_speed_attempt', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy });
      await queueNearbyForCreated('speed', out?.attempt_id || out?.speed_attempt_id || out?.id, {session_token, lat, lng, accuracy});
      return out;
    } catch (_) {}
    const out = await rpcFirst([
      ['create_drink_speed_attempt_v382', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_combined_drink_speed_attempt', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_combined_drink_speed_attempt', { session_token, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_combined_drink_speed_attempt', { session_token, client_attempt_id, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_combined_drink_speed_attempt', { session_token, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_drink_speed_attempt', { session_token, client_attempt_id, event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_drink_speed_attempt', { session_token, client_attempt_id, speed_type_key: event_type_key, quantity, duration_seconds, lat, lng, accuracy }],
      ['create_drink_speed_attempt', { session_token_input: session_token, client_attempt_id_input: client_attempt_id, event_type_key_input: event_type_key, quantity_input: quantity, duration_seconds_input: duration_seconds, lat_input: lat, lng_input: lng, accuracy_input: accuracy }],
      ['create_drink_speed_attempt', { session_token_input: session_token, client_attempt_id_input: client_attempt_id, speed_type_key_input: event_type_key, quantity_input: quantity, duration_seconds_input: duration_seconds, lat_input: lat, lng_input: lng, accuracy_input: accuracy }]
    ]);
    await queueNearbyForCreated('speed', out?.attempt_id || out?.speed_attempt_id || out?.id, {session_token, lat, lng, accuracy});
    return out;
  }

  async function verifySpeedAttempt(opts={}){
    const payload = {
      session_token: opts.session_token || token(),
      attempt_id: Number(opts.attempt_id || opts.id || 0),
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      accuracy: opts.accuracy ?? null,
      approve: opts.approve !== false
    };
    try {
      return await contractWrite('verify_speed_attempt', payload);
    } catch (_) {}
    return rpc('verify_drink_speed_attempt', payload);
  }

  async function cancelSpeedAttempt(opts={}){
    const payload = {
      session_token: opts.session_token || token(),
      attempt_id: Number(opts.attempt_id || opts.id || 0)
    };
    try {
      return await contractWrite('cancel_speed_attempt', payload);
    } catch (_) {}
    return rpc('cancel_my_speed_attempt', payload);
  }

  async function forPending(opts={}){ return shapePendingView(await load(opts)); }
  async function forAdd(opts={}){ return shapeAddView(await load(opts)); }
  async function forSpeed(opts={}){ return shapeSpeedView(await load(opts)); }

  window.GEJAST_DRINKS_WORKFLOW = {
    CANONICAL_DRINK_TYPES,
    CANONICAL_SPEED_TYPES,
    canonicalDrinkTypes,
    canonicalSpeedSets,
    load,
    fallback,
    token,
    headers,
    forPending,
    forAdd,
    forSpeed,
    createDrinkEvent,
    verifyDrinkEvent,
    cancelDrinkEvent,
    createSpeedAttempt,
    verifySpeedAttempt,
    cancelSpeedAttempt,
    queueNearbyForCreated,
    rpcFirst
  };
})();