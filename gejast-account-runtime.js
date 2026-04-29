(function(){
  if (window.GEJAST_ACCOUNT_RUNTIME && window.GEJAST_ACCOUNT_RUNTIME.VERSION === 'v690') return;
  const cfg = window.GEJAST_CONFIG || {};
  const VERSION = 'v690';
  const SESSION_KEYS = (Array.isArray(cfg.PLAYER_SESSION_KEYS) && cfg.PLAYER_SESSION_KEYS.length) ? cfg.PLAYER_SESSION_KEYS : ['jas_session_token_v11','jas_session_token_v10'];
  const ADMIN_KEYS = ['jas_admin_session_v8','gejast_admin_session_token','jas_admin_session_token'];
  const LOGIN_CACHE_PREFIX = 'gejast_login_active_names_v687_';
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function scope(){ try{ if(window.GEJAST_SCOPE_UTILS&&window.GEJAST_SCOPE_UTILS.getScope) return window.GEJAST_SCOPE_UTILS.getScope(); }catch(_){} try{ const q=new URLSearchParams(location.search).get('scope'); return q==='family'?'family':'friends'; }catch(_){ return 'friends'; } }
  function headers(){ return {'Content-Type':'application/json',apikey:cfg.SUPABASE_PUBLISHABLE_KEY||'',Authorization:`Bearer ${cfg.SUPABASE_PUBLISHABLE_KEY||''}`,Accept:'application/json'}; }
  async function parse(res){ const txt=await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||`HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message||data?.error||data?.details||data?.hint||`HTTP ${res.status}`); return data; }
  async function rpc(name, payload, options){
    if(!cfg.SUPABASE_URL) throw new Error('Supabase URL ontbreekt.');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller && options && options.timeoutMs ? setTimeout(()=>{ try{ controller.abort(); }catch(_){} }, options.timeoutMs) : null;
    try{
      const raw=await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{}),signal:controller?controller.signal:undefined}).then(parse);
      return raw && raw[name] !== undefined ? raw[name] : raw;
    } catch(err){ if(err && err.name === 'AbortError') throw new Error('RPC timeout'); throw err; }
    finally{ if(timeout) clearTimeout(timeout); }
  }
  async function rpcFirst(calls){ let last=null; for(const c of calls){ try{ return await rpc(c.name,c.body||{},c.options||{}); }catch(err){ last=err; } } throw last || new Error('RPC mislukt.'); }
  function playerToken(){ try{ if(cfg.getPlayerSessionToken) return String(cfg.getPlayerSessionToken()||'').trim(); }catch(_){} for(const k of SESSION_KEYS){ const v=localStorage.getItem(k)||sessionStorage.getItem(k); if(v) return String(v).trim(); } return ''; }
  function setPlayerToken(token){ if(!token) return; try{ if(cfg.setPlayerSessionToken) cfg.setPlayerSessionToken(token); }catch(_){} localStorage.setItem('jas_session_token_v11', token); sessionStorage.setItem('jas_session_token_v11', token); }
  function clearPlayerToken(){ try{ if(cfg.clearPlayerSessionTokens) cfg.clearPlayerSessionTokens(); }catch(_){} SESSION_KEYS.forEach((k)=>{localStorage.removeItem(k);sessionStorage.removeItem(k);}); }
  function adminToken(){ try{ if(window.GEJAST_ADMIN_SESSION&&window.GEJAST_ADMIN_SESSION.getToken) return String(window.GEJAST_ADMIN_SESSION.getToken()||'').trim(); }catch(_){} for(const k of ADMIN_KEYS){ const v=sessionStorage.getItem(k)||localStorage.getItem(k); if(v) return String(v).trim(); } return ''; }
  function normalizeNameValue(row){ return String(typeof row==='string'?row:(row && (row.display_name||row.name||row.desired_name||row.player_name||row.public_display_name||row.nickname||''))).replace(/\s+/g,' ').trim(); }
  function normalizeNames(rows){ const out=[]; const seen=new Set(); (Array.isArray(rows)?rows:[]).forEach((row)=>{ const name=normalizeNameValue(row); const key=name.toLowerCase(); if(name&&!seen.has(key)){ seen.add(key); out.push(name); } }); return out.sort((a,b)=>a.localeCompare(b,'nl')); }
  function friendly(err){ const msg=String(err&&err.message?err.message:err||'Er ging iets mis'); if(msg==='Failed to fetch') return 'Netwerk/CORS-fout bij contact met Supabase.'; if(/timeout/i.test(msg)) return 'Supabase reageerde te traag. Probeer opnieuw.'; if(/player_not_found_or_not_active|Speler niet gevonden|not found/i.test(msg)) return 'Deze naam staat niet als actieve login-speler in de database. Hij stond eerder in een naam-/scope-lijst, maar login vereist een actieve speler met pincode. Open admin_account_runtime.html voor diagnose of activeer/reset deze speler.'; if(/pincode|pin|password|Onjuiste/i.test(msg)) return 'Pincode klopt niet.'; if(/could not find|schema cache|function/i.test(msg)) return 'Backend-RPC ontbreekt of Supabase schema cache is nog niet ververst. Draai de laatste SQL en refresh Supabase schema cache.'; return msg; }
  function setStatus(id,msg,tone=''){ const el=$(id)||$('status')||$('statusBox'); if(!el) return; el.className = (`status ${tone} show`).trim(); el.textContent = msg||''; }
  function emailOk(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim()); }
  function setBusy(form,busy){ if(!form) return; form.querySelectorAll('input,select,textarea,button').forEach((el)=>el.disabled=!!busy); }
  function cacheKey(){ return LOGIN_CACHE_PREFIX + scope(); }
  function readLoginCache(){ try{ const raw=localStorage.getItem(cacheKey())||sessionStorage.getItem(cacheKey())||''; if(!raw) return []; const parsed=JSON.parse(raw); const age=Date.now()-Number(parsed.at||0); if(age > 24*60*60*1000) return []; return normalizeNames(parsed.names||[]); }catch(_){ return []; } }
  function writeLoginCache(names){ const clean=normalizeNames(names); if(!clean.length) return clean; const payload=JSON.stringify({at:Date.now(),names:clean,version:VERSION}); try{ localStorage.setItem(cacheKey(),payload); }catch(_){} try{ sessionStorage.setItem(cacheKey(),payload); }catch(_){} try{ if(cfg.writeCachedLoginNames) cfg.writeCachedLoginNames(clean, scope()); }catch(_){} return clean; }

  function extractNameRows(raw){
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const out = [];
    const queue = [raw];
    const seen = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      ['names','players','profiles','items','rows','data','leaderboard','active_names','activated_names','login_names'].forEach((key)=>{ if (Array.isArray(value[key])) out.push(...value[key]); });
      ['bundle','viewer','player','unified','runtime','homepage','profiles'].forEach((key)=>{ if (value[key] && typeof value[key] === 'object') queue.push(value[key]); });
      if (value.games && typeof value.games === 'object') queue.push(value.games);
    }
    return out;
  }
  function rowScopeMatches(row){ if (!row || typeof row !== 'object') return true; const raw = String(row.site_scope || row.scope || row.player_site_scope || '').trim().toLowerCase(); return !raw || raw === scope(); }
  function activeNameSignal(row){
    if (typeof row === 'string') return true;
    if (!row || typeof row !== 'object') return true;
    if (row.login_active === false || row.active === false || row.approved === false || row.is_active === false) return false;
    const status = String(row.status || row.account_status || row.activation_status || row.player_status || row.state || '').trim().toLowerCase();
    if (!status) return true;
    return ['active','activated','approved','claimed','ok'].includes(status) || !!row.activated_at || !!row.has_pin || !!row.pin_is_set || row.login_active === true || row.is_active === true;
  }
  function namesFromPayload(raw){ return normalizeNames(extractNameRows(raw).filter((row)=>rowScopeMatches(row) && activeNameSignal(row))); }

  async function fetchLoginNamesFromConfig(){
    const loaders = [
      cfg.getActivatedPlayerNamesForScope,
      cfg.fetchScopedActivePlayerNames
    ].filter((fn)=>typeof fn === 'function');
    for (const loader of loaders) {
      try {
        const names = normalizeNames(await loader(scope()));
        if (names.length) return names;
      } catch (_) {}
    }
    try {
      if (window.GEJAST_LOGIN_NAMES_FALLBACK && typeof window.GEJAST_LOGIN_NAMES_FALLBACK.load === 'function') {
        const names = normalizeNames(await window.GEJAST_LOGIN_NAMES_FALLBACK.load());
        if (names.length) return names;
      }
    } catch (_) {}
    return [];
  }

  async function getLoginNames(){
    const cached = readLoginCache();
    // One fast authoritative call first, then the committed selector RPC, then the shared config loader.
    // Do not use requestable/scope-only names; those caused the polluted dropdown.
    const attempts = [
      { name:'get_login_active_names_v687', body:{site_scope_input:scope()}, options:{timeoutMs:1200} },
      { name:'get_player_selector_source_v1', body:{site_scope_input:scope()}, options:{timeoutMs:1600} },
      { name:'get_player_selector_source_v1', body:{session_token:null, site_scope_input:scope()}, options:{timeoutMs:1600} }
    ];
    for (const attempt of attempts) {
      try {
        const names = namesFromPayload(await rpc(attempt.name, attempt.body, attempt.options));
        const clean = writeLoginCache(names);
        if (clean.length) return clean;
      } catch (_) {}
    }
    const configNames = await fetchLoginNamesFromConfig();
    if (configNames.length) return writeLoginCache(configNames);
    return cached;
  }

  async function getRequestableNames(){
    const data = await rpcFirst([
      {name:'get_requestable_names_v687', body:{site_scope_input:scope()}},
      {name:'get_requestable_names', body:{site_scope_input:scope()}},
      {name:'get_requestable_names', body:{}}
    ]);
    return normalizeNames(Array.isArray(data)?data:(data?.names||data?.items||data?.rows||data?.requestable_names||[]));
  }
  async function requestClaim(input){
    const meta = activePlayerMeta({event:'request_claim_submit', desired_name:input.desiredName, requester_email_domain:String(input.email||'').split('@')[1]||''});
    return await rpcFirst([
      {name:'account_request_claim_v687', body:{desired_name_input:input.desiredName, requester_email_input:input.email, requester_note_input:input.note||'', site_scope_input:scope(), requester_meta_input:input.meta||meta, active_player_meta_input:meta}},
      {name:'account_request_claim_v687', body:{desired_name_input:input.desiredName, requester_email_input:input.email, requester_note_input:input.note||'', site_scope_input:scope(), requester_meta_input:input.meta||meta, active_player_meta_input:meta}},
      {name:'account_request_claim_v687', body:{desired_name_input:input.desiredName, requester_email_input:input.email, requester_note_input:input.note||'', site_scope_input:scope(), requester_meta_input:input.meta||meta}},
      {name:'request_claim_action', body:{desired_name:input.desiredName, requester_email:input.email, requester_note:input.note||'', requester_meta:input.meta||meta, site_scope_input:scope()}}
    ]);
  }
  async function getActivationContext(token){ return await rpcFirst([{name:'account_get_activation_context_v687', body:{activation_token_input:token}},{name:'get_activation_link_context', body:{token}},{name:'get_activation_link_context', body:{activation_token:token}}]); }
  async function activateAccount(token,pin){
    const meta = activePlayerMeta({event:'account_activation_submit', activation_token_present:!!token});
    const out = await rpcFirst([
      {name:'account_activate_v687', body:{activation_token_input:token, new_pin_input:pin, activation_meta_input:meta}},
      {name:'account_activate_v687', body:{activation_token_input:token, new_pin_input:pin, activation_meta_input:meta}},
      {name:'account_activate_v687', body:{activation_token_input:token, new_pin_input:pin}},
      {name:'activate_player_from_email_link', body:{token, new_pin:pin}},
      {name:'activate_player_from_email_link', body:{activation_token:token, new_pin:pin}}
    ]);
    try { await storeActivePlayerMetadata({player_name_input: out?.display_name || out?.player_name || null, event_type_input:'activation_client_success', event_source_input:'activate.html', activation_token_input: token, session_token_input: out?.session_token || null, metadata_input:meta}); } catch (_) {}
    return out;
  }
  async function login(input){
    const name=input.name, pin=input.pin;
    const data = await rpcFirst([
      {name:'account_login_bridge_v687', body:{display_name_input:name, pin_input:pin, site_scope_input:scope()}, options:{timeoutMs:3200}},
      {name:'account_login_bridge_v687', body:{display_name_input:name, pin_input:pin, site_scope_input:scope()}, options:{timeoutMs:3200}},
      {name:'account_login_bridge_v687', body:{display_name_input:name, pin_input:pin, site_scope_input:scope()}, options:{timeoutMs:3200}},
      {name:'account_login_v687', body:{display_name_input:name, pin_input:pin, site_scope_input:scope()}, options:{timeoutMs:3200}},
      {name:'login_player', body:{desired_name:name, entered_pin:pin}, options:{timeoutMs:3200}},
      {name:'login_player', body:{input_username:name, entered_pin:pin}, options:{timeoutMs:3200}},
      {name:'login_player', body:{input_display_name:name, input_pin:pin}, options:{timeoutMs:3200}}
    ]);
    if(data && data.session_token) setPlayerToken(data.session_token);
    try { await storeActivePlayerMetadata({player_name_input:data?.display_name||data?.player_name||name, event_type_input:'login_success', event_source_input:'login.html', session_token_input:data?.session_token||null, metadata_input:activePlayerMeta({event:'login_success'})}); } catch (_) {}
    return data;
  }
  async function getPublicState(){ const token=playerToken(); if(!token) return null; try{ return await rpcFirst([{name:'get_public_state', body:{session_token:token}, options:{timeoutMs:1200}},{name:'account_public_state_v687', body:{session_token_input:token}, options:{timeoutMs:1200}}]); }catch(_){ return null; } }
  function storageProbe(kind){
    try {
      const s = kind === 'session' ? sessionStorage : localStorage;
      const k = '__gejast_meta_probe__';
      s.setItem(k, '1');
      s.removeItem(k);
      return true;
    } catch (_) { return false; }
  }
  function visitorMeta(extra){
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    const nav = navigator || {};
    const uaData = nav.userAgentData || null;
    const screenObj = window.screen || {};
    const meta = {
      captured_by: 'gejast-account-runtime',
      captured_version: VERSION,
      captured_at: new Date().toISOString(),
      site_scope: scope(),
      user_agent: nav.userAgent || '',
      user_agent_data: uaData ? {
        brands: uaData.brands || [],
        mobile: !!uaData.mobile,
        platform: uaData.platform || ''
      } : null,
      language: nav.language || '',
      languages: Array.isArray(nav.languages) ? nav.languages : [],
      platform: uaData?.platform || nav.platform || '',
      vendor: nav.vendor || '',
      timezone: tz,
      screen: {
        width: screenObj.width || 0,
        height: screenObj.height || 0,
        avail_width: screenObj.availWidth || 0,
        avail_height: screenObj.availHeight || 0,
        color_depth: screenObj.colorDepth || 0,
        pixel_depth: screenObj.pixelDepth || 0,
        device_pixel_ratio: window.devicePixelRatio || 1
      },
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0
      },
      referrer: document.referrer || '',
      page_url: location.href,
      pathname: location.pathname || '',
      search: location.search || '',
      max_touch_points: nav.maxTouchPoints || 0,
      do_not_track: nav.doNotTrack || window.doNotTrack || '',
      cookie_enabled: !!nav.cookieEnabled,
      local_storage_available: storageProbe('local'),
      session_storage_available: storageProbe('session'),
      secure_context: !!window.isSecureContext,
      online: !!nav.onLine
    };
    return Object.assign(meta, extra || {});
  }
  function activePlayerMeta(extra){
    return visitorMeta(Object.assign({
      metadata_policy: 'new_active_users_v687_plus_scope_override_v687',
      active_login_rule: 'active=true + pin_hash + site_scope + not ghost/deleted/disabled; current legacy users may predate stored metadata',
      legacy_approved_required: false
    }, extra || {}));
  }
  async function storeActivePlayerMetadata(payload){
    try {
      return await rpc('store_active_player_metadata_v687', Object.assign({
        site_scope_input: scope(),
        metadata_input: activePlayerMeta({event_hint: payload && payload.event_type_input || 'metadata'})
      }, payload || {}), {timeoutMs:2600});
    } catch (_) {
      return null;
    }
  }
  function fillSelect(sel,names){ if(!sel) return; const current=sel.value; const clean=normalizeNames(names); sel.innerHTML='<option value="">Kies je naam</option>'+clean.map((n)=>`<option value="${esc(n)}">${esc(n)}</option>`).join(''); if(clean.includes(current)) sel.value=current; }

  function safeReturnTarget(raw){
    const value = String(raw || '').trim();
    if (!value || /^(?:[a-z]+:)?\/\//i.test(value) || value.includes('..') || value.includes('\\')) return './index.html';
    return value.startsWith('./') ? value : './' + value.replace(/^\/+/, '');
  }
  function loginReturnTarget(){
    try { return safeReturnTarget(new URLSearchParams(location.search).get('return_to') || 'index.html'); } catch (_) { return './index.html'; }
  }

  async function bootLoginPage(){
    const form=$('loginForm'), sel=$('playerNameInput'), pin=$('pinInput'); if(!form) return;
    const cached = readLoginCache();
    if (cached.length) { fillSelect(sel, cached); setStatus('statusBox',`Namen direct uit snelle cache geladen; live controle op achtergrond...`,''); }
    else setStatus('statusBox','Actieve loginnamen laden...','');
    getLoginNames().then((names)=>{ fillSelect(sel,names); if(names.length) setStatus('statusBox',`${names.length} actieve loginspeler(s) geladen.`,'ok'); else setStatus('statusBox','Geen actieve loginnamen ontvangen. Controleer of de login-SQL is uitgerold of open Naam aanvragen als je nog geen pincode hebt.','warn'); }).catch((err)=>{ setStatus('statusBox', cached.length ? 'Kon namen niet live verversen; cache blijft zichtbaar.' : friendly(err), cached.length ? '' : 'warn'); });
    getPublicState().then((st)=>{ if(st?.my_name||st?.display_name||st?.player_name) setStatus('statusBox',`Deze browser heeft al een sessie voor ${st.my_name||st.display_name||st.player_name}.`,'ok'); }).catch(()=>{});
    form.addEventListener('submit', async(ev)=>{ ev.preventDefault(); const name=String(sel.value||'').trim(); const p=String(pin.value||'').replace(/\D/g,'').slice(0,4); if(!name) return setStatus('statusBox','Kies eerst je naam.','warn'); if(!/^\d{4}$/.test(p)) return setStatus('statusBox','Voer je 4-cijferige pincode in.','warn'); try{ setBusy(form,true); setStatus('statusBox','Inloggen...'); const out=await login({name,pin:p}); setStatus('statusBox',`Ingelogd als ${out.display_name||out.player_name||name}.`,'ok'); setTimeout(()=>location.href=loginReturnTarget(),350); }catch(err){ setStatus('statusBox',friendly(err),'warn'); }finally{ setBusy(form,false); } });
    const logout=$('logoutBtn'); if(logout) logout.addEventListener('click',()=>{ clearPlayerToken(); setStatus('statusBox','Sessie gewist.','ok'); });
    if(pin) pin.addEventListener('input',()=>{ pin.value=pin.value.replace(/\D/g,'').slice(0,4); });
  }
  async function bootRequestPage(){ const form=$('requestForm'), sel=$('requestNameSelect'); if(!form) return; try{ fillSelect(sel, await getRequestableNames()); }catch(err){ setStatus('status',friendly(err),'warn'); } form.addEventListener('submit', async(ev)=>{ ev.preventDefault(); const desiredName=String(sel.value||'').trim(); const email=String(($('requestEmailInput')||{}).value||'').trim().toLowerCase(); const note=String(($('requestNoteInput')||{}).value||'').trim(); if(!desiredName) return setStatus('status','Kies eerst een naam.','warn'); if(!emailOk(email)) return setStatus('status','Vul een geldig e-mailadres in.','warn'); try{ setBusy(form,true); setStatus('status','Aanvraag versturen...'); const out=await requestClaim({desiredName,email,note,meta:visitorMeta()}); setStatus('status',out?.message||'Aanvraag verstuurd. Na goedkeuring ontvang je een activatielink.','ok'); form.reset(); try{ fillSelect(sel, await getRequestableNames()); }catch(_){} }catch(err){ setStatus('status',friendly(err),'warn'); }finally{ setBusy(form,false); } }); }
  async function bootActivatePage(){ const form=$('activateForm'); if(!form) return; const token=new URLSearchParams(location.search).get('token')||new URLSearchParams(location.search).get('activation_token')||''; if(!token) setStatus('status','Deze activatielink mist een token.','warn'); try{ const ctx=await getActivationContext(token); if($('approvedName')) $('approvedName').textContent=ctx?.display_name||ctx?.player_name||ctx?.desired_name||'Onbekend'; if($('approvedEmail')) $('approvedEmail').textContent=ctx?.requester_email||ctx?.email||'Onbekend'; }catch(err){ setStatus('status',friendly(err),'warn'); } form.addEventListener('submit', async(ev)=>{ ev.preventDefault(); const p=String(($('pinInput')||{}).value||'').replace(/\D/g,'').slice(0,4); const p2=String(($('pinConfirmInput')||{}).value||'').replace(/\D/g,'').slice(0,4); if(!/^\d{4}$/.test(p)) return setStatus('status','Kies een pincode van precies 4 cijfers.','warn'); if(p!==p2) return setStatus('status','De twee pincodes komen niet overeen.','warn'); try{ setBusy(form,true); setStatus('status','Account activeren...'); const out=await activateAccount(token,p); if(out?.session_token) setPlayerToken(out.session_token); setStatus('status','Account geactiveerd. Je gaat naar de homepage.','ok'); setTimeout(()=>location.href='./index.html',700); }catch(err){ setStatus('status',friendly(err),'warn'); }finally{ setBusy(form,false); } }); ['pinInput','pinConfirmInput'].forEach((id)=>{ const el=$(id); if(el) el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,4);}); }); }

  async function adminAudit(){ return await rpcFirst([{name:'admin_get_active_player_metadata_audit_v687', body:{admin_session_token_input:adminToken(),site_scope_input:scope()}},{name:'admin_get_active_player_metadata_audit_v687', body:{admin_session_token_input:adminToken(),site_scope_input:scope()}},{name:'admin_get_account_runtime_audit_v687', body:{admin_session_token:adminToken(),site_scope_input:scope()}}]); }
  async function adminMail(){ return await rpc('admin_get_mail_diagnostics',{admin_session_token:adminToken(),site_scope_input:scope()}); }
  async function adminDiagnoseLogin(name){ return await rpcFirst([{name:'diagnose_login_name_v687', body:{player_name_input:name,site_scope_input:scope()}},{name:'diagnose_login_name_v687', body:{player_name_input:name,site_scope_input:scope()}},{name:'diagnose_login_name_v687', body:{player_name_input:name,site_scope_input:scope()}}]); }
  async function adminRepairLogin(name,pin){ return await rpcFirst([{name:'admin_reset_login_player_pin_v687', body:{admin_session_token_input:adminToken(),player_name_input:name,new_pin_input:pin,site_scope_input:scope(),admin_meta_input:activePlayerMeta({event:'admin_reset_login_player_pin', admin_page:'admin_account_runtime.html'})}},{name:'admin_reset_login_player_pin_v687', body:{admin_session_token_input:adminToken(),player_name_input:name,new_pin_input:pin,site_scope_input:scope(),admin_meta_input:activePlayerMeta({event:'admin_reset_login_player_pin', admin_page:'admin_account_runtime.html'})}},{name:'admin_reset_login_player_pin_v687', body:{admin_session_token_input:adminToken(),player_name_input:name,new_pin_input:pin,site_scope_input:scope()}}]); }
  async function adminAddName(name){ return await rpc('admin_add_requestable_name_v687',{admin_session_token_input:adminToken(),display_name_input:name,site_scope_input:scope()}); }
  async function adminApprove(id){ return await rpcFirst([{name:'admin_approve_account_claim_v687', body:{admin_session_token_input:adminToken(),claim_id_input:id,site_scope_input:scope(),admin_meta_input:activePlayerMeta({event:'admin_approve_claim', admin_page:'admin_account_runtime.html'})}},{name:'admin_approve_account_claim_v687', body:{admin_session_token_input:adminToken(),claim_id_input:id,site_scope_input:scope(),admin_meta_input:activePlayerMeta({event:'admin_approve_claim', admin_page:'admin_account_runtime.html'})}},{name:'admin_approve_account_claim_v687', body:{admin_session_token_input:adminToken(),claim_id_input:id,site_scope_input:scope()}}]); }
  async function adminReject(id,reason){ return await rpc('admin_reject_account_claim_v687',{admin_session_token_input:adminToken(),claim_id_input:id,reject_reason_input:reason||'',site_scope_input:scope()}); }
  async function bootAdminPage(){
    const out=$('accountAuditOutput'); if(!out) return;
    async function refresh(){ const data=await adminAudit(); out.textContent=JSON.stringify(data,null,2); renderClaims(data.claims||[]); renderNames(data.names||[]); renderMail(data.mail||{}); renderMetadata(data.metadata||[]); }
    function renderNames(rows){ const box=$('accountNamesBox'); if(!box) return; box.innerHTML=(rows||[]).length?`<table><thead><tr><th>Naam</th><th>Status</th><th>Scope</th></tr></thead><tbody>${rows.map((r)=>`<tr><td>${esc(r.display_name)}</td><td>${esc(r.status)}</td><td>${esc(r.site_scope)}</td></tr>`).join('')}</tbody></table>`:'Geen namen.'; }
    function renderClaims(rows){ const box=$('accountClaimsBox'); if(!box) return; box.innerHTML=(rows||[]).length?`<table><thead><tr><th>ID</th><th>Naam</th><th>Email</th><th>Status</th><th>Actie</th></tr></thead><tbody>${rows.map((r)=>`<tr><td>${esc(r.id)}</td><td>${esc(r.display_name)}</td><td>${esc(r.requester_email)}</td><td>${esc(r.status)}</td><td>${r.status==='pending'?`<button data-approve="${esc(r.id)}">Approve</button> <button data-reject="${esc(r.id)}">Reject</button>`:''}</td></tr>`).join('')}</tbody></table>`:'Geen claims.'; box.querySelectorAll('[data-approve]').forEach((b)=>b.onclick=async()=>{ b.disabled=true; await adminApprove(b.getAttribute('data-approve')); await refresh(); }); box.querySelectorAll('[data-reject]').forEach((b)=>b.onclick=async()=>{ b.disabled=true; await adminReject(b.getAttribute('data-reject'), prompt('Reden?')||''); await refresh(); }); }
    
    function renderMetadata(rows){ const box=$('accountMetadataBox'); if(!box) return; box.innerHTML=(rows||[]).length?`<table><thead><tr><th>Naam</th><th>Event</th><th>Scope</th><th>Bron</th><th>Tijd</th></tr></thead><tbody>${rows.map((r)=>`<tr><td>${esc(r.player_name||'')}</td><td>${esc(r.event_type||'')}</td><td>${esc(r.site_scope||'')}</td><td>${esc(r.event_source||'')}</td><td>${esc(r.created_at||'')}</td></tr>`).join('')}</tbody></table>`:'Nog geen v687 metadata-events.'; }
    function renderMail(mail){ const box=$('accountMailBox'); if(!box) return; const jobs=mail.jobs||[]; box.innerHTML=`<div class="metric-row"><span>Queued: ${mail.queued_count||0}</span><span>Blocked: ${mail.blocked_count||0}</span><span>Failed: ${mail.failed_count||0}</span><span>Sent: ${mail.sent_count||0}</span></div>`+(jobs.length?`<table><thead><tr><th>ID</th><th>Status</th><th>To</th><th>Subject</th><th>Guard/error</th></tr></thead><tbody>${jobs.map((j)=>`<tr><td>${esc(j.id)}</td><td>${esc(j.status)}</td><td>${esc(j.recipient_email||j.to_email)}</td><td>${esc(j.subject)}</td><td>${esc(j.failure_reason||j.last_error||'')}</td></tr>`).join('')}</tbody></table>`:''); }
    const add=$('addNameBtn'); if(add) add.onclick=async()=>{ const name=String(($('newNameInput')||{}).value||'').trim(); if(!name) return; await adminAddName(name); $('newNameInput').value=''; await refresh(); };
    const diag=$('diagnoseLoginBtn'); if(diag) diag.onclick=async()=>{ const name=String(($('loginDiagName')||{}).value||'').trim(); if(!name) return; const data=await adminDiagnoseLogin(name); const box=$('loginDiagOutput'); if(box) box.textContent=JSON.stringify(data,null,2); };
    const repair=$('repairLoginBtn'); if(repair) repair.onclick=async()=>{ const name=String(($('loginDiagName')||{}).value||'').trim(); const pin=String(($('loginRepairPin')||{}).value||'').replace(/\D/g,'').slice(0,4); if(!name || !/^\d{4}$/.test(pin)) return alert('Vul naam en 4-cijferige PIN in.'); if(!confirm(`Activeer/reset login voor ${name}?`)) return; const data=await adminRepairLogin(name,pin); const box=$('loginDiagOutput'); if(box) box.textContent=JSON.stringify(data,null,2); await refresh(); };
    const refreshBtn=$('refreshBtn'); if(refreshBtn) refreshBtn.onclick=()=>refresh().catch((err)=>{ out.textContent=friendly(err); });
    await refresh().catch((err)=>{ out.textContent=friendly(err); });
  }
  async function bootMailAuditPage(){ const out=$('mailAuditOutput'); if(!out) return; async function refresh(){ const data=await adminMail(); out.textContent=JSON.stringify(data,null,2); const box=$('jobsBox'); if(box) box.innerHTML=(data.jobs||[]).length?`<table><thead><tr><th>ID</th><th>Status</th><th>To</th><th>Subject</th><th>Guard/error</th><th>Created</th></tr></thead><tbody>${data.jobs.map((j)=>`<tr><td>${esc(j.id)}</td><td>${esc(j.status)}</td><td>${esc(j.recipient_email||j.to_email)}</td><td>${esc(j.subject)}</td><td>${esc(j.failure_reason||j.last_error||'')}</td><td>${esc(j.created_at||'')}</td></tr>`).join('')}</tbody></table>`:'Geen recente jobs.'; } const btn=$('refreshBtn'); if(btn) btn.onclick=()=>refresh().catch((err)=>{ out.textContent=friendly(err); }); await refresh().catch((err)=>{ out.textContent=friendly(err); }); }
  function boot(){ const page=(location.pathname||'').split('/').pop(); if(page==='login.html') bootLoginPage(); else if(page==='request.html') bootRequestPage(); else if(page==='activate.html') bootActivatePage(); else if(page==='admin_account_runtime.html') bootAdminPage(); else if(page==='admin_mail_audit.html') bootMailAuditPage(); }
  window.GEJAST_ACCOUNT_RUNTIME={VERSION,rpc,rpcFirst,scope,playerToken,setPlayerToken,clearPlayerToken,adminToken,getLoginNames,getRequestableNames,requestClaim,getActivationContext,activateAccount,login,getPublicState,visitorMeta,activePlayerMeta,storeActivePlayerMetadata,adminAudit,adminMail,adminDiagnoseLogin,adminRepairLogin,adminAddName,adminApprove,adminReject,bootLoginPage,bootRequestPage,bootActivatePage,bootAdminPage,bootMailAuditPage};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
