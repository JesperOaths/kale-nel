(function(){
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
      event_types: Array.isArray(page.event_types) ? page.event_types : [],
      speed_leaderboards: canonicalSpeedSets(speed_page.leaderboards||page.speed_leaderboards||[]),
      recent_verified: Array.isArray(page.recent_verified) ? page.recent_verified : verified_history.slice(0,8),
      recent_rejected: Array.isArray(page.recent_rejected) ? page.recent_rejected : (Array.isArray(page.recent_events) ? page.recent_events.filter((r)=>String(r.status||'').toLowerCase()==='rejected') : [])
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
      data.event_types = Array.isArray(data.event_types) ? data.event_types : (Array.isArray(data.page.event_types) ? data.page.event_types : []);
      data.recent_verified = Array.isArray(data.recent_verified) ? data.recent_verified : (Array.isArray(data.page.recent_verified) ? data.page.recent_verified : data.verified_history.slice(0,8));
      data.recent_rejected = Array.isArray(data.recent_rejected) ? data.recent_rejected : (Array.isArray(data.page.recent_rejected) ? data.page.recent_rejected : []);
      return data;
    }catch(err){
      return fallback(opts);
    }
  }
  window.GEJAST_DRINKS_WORKFLOW = { CANONICAL_SPEED_TYPES, canonicalSpeedSets, load, fallback, token, headers };
})();
