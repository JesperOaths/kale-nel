(function(){
  var cfg = window.GEJAST_CONFIG || {};
  var VERSION = 'v747';
  var root = document.documentElement;
  if (root && root.hasAttribute('data-gejast-auth-state')) {
    window.GEJAST_HOME_GATE = { VERSION: VERSION, delegated: 'gejast-auth-gate' };
    return;
  }
  try {
    document.documentElement.classList.add('gejast-auth-pending');
    var style = document.createElement('style');
    style.setAttribute('data-gejast-auth-gate', 'true');
    style.textContent = 'html.gejast-auth-pending body{visibility:hidden!important}html.gejast-auth-ready body{visibility:visible!important}';
    (document.head || document.documentElement).appendChild(style);
  } catch(_) {}
  function isAdminSurface(){
    try {
      var file = ((location.pathname || '').split('/').pop() || '').toLowerCase();
      return file === 'admin' || file === 'admin.html' || /^admin_.*\.html$/i.test(file);
    } catch(_) { return false; }
  }
  function getToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function currentScope(){ try{ if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); }catch(_){} try{ return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; }catch(_){ return 'friends'; } }
  function currentTarget(){ try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget((location.pathname||'').split('/').pop() || 'index.html') : ((location.pathname||'').split('/').pop() || 'index.html') + (location.search||'') + (location.hash||''); }catch(_){ return 'index.html'; } }
  function loginUrl(){ try{ return cfg.buildLoginUrl ? cfg.buildLoginUrl(currentTarget(), currentScope()) : './login.html?return_to=' + encodeURIComponent(currentTarget()) + (currentScope()==='family'?'&scope=family':''); }catch(_){ return './login.html'; } }
  function headers(){ return { 'Content-Type':'application/json', apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''), Authorization:'Bearer ' + (cfg.SUPABASE_PUBLISHABLE_KEY||'') }; }
  function showPage(){ try{ document.documentElement.classList.remove('gejast-auth-pending'); document.documentElement.classList.add('gejast-auth-ready'); if(document.body){ document.body.classList.remove('boot-pending'); document.body.classList.remove('page-loading'); }}catch(_){} }
  async function parse(res){ var txt=await res.text(); var data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||('HTTP '+res.status)); } if(!res.ok) throw new Error(data&& (data.message||data.error) || ('HTTP '+res.status)); return data; }
  async function rpc(name,payload,ms){
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(_){} }, ms || 1600) : null;
    try{ return await fetch((cfg.SUPABASE_URL||'') + '/rest/v1/rpc/' + name,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{}),signal:controller?controller.signal:undefined}).then(parse); }
    catch(e){ if(e && e.name === 'AbortError') throw new Error('session_check_timeout'); throw e; }
    finally{ if(timer) clearTimeout(timer); }
  }
  function normalizeName(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
  function validState(data){
    var name=normalizeName(data&& (data.my_name || data.display_name || data.player_name || (data.viewer&&data.viewer.display_name) || (data.player&&data.player.display_name) || ''));
    return !!(name || (data && (data.viewer || data.player || data.session_valid === true || data.is_logged_in === true)));
  }
  function invalidState(data){ return !!(data && (data.session_valid === false || data.is_logged_in === false || data.valid === false)); }
  async function fetchViewerState(token){
    try {
      var data = await rpc('account_public_state_v687', {
        session_token: token,
        session_token_input: token,
        site_scope_input: currentScope()
      }, 1800);
      var responseScope = String(data && data.site_scope || '').trim().toLowerCase() === 'family' ? 'family' : 'friends';
      if (validState(data) && responseScope === currentScope()) return { ok:true, data:data };
      if (invalidState(data)) return { ok:false, hardInvalid:true };
      return { ok:false, transient:true };
    } catch(_) {
      return { ok:false, transient:true };
    }
  }
  function redirectToLogin(){ try{ location.replace(loginUrl()); }catch(_){ location.href='./login.html'; } }
  if (isAdminSurface()) { showPage(); window.GEJAST_HOME_GATE = { VERSION: VERSION, skipped: 'admin-surface' }; return; }
  var token = getToken();
  if(!token){ redirectToLogin(); return; }
  try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:false }); }catch(_){}
  fetchViewerState(token).then(function(result){
    if(result && result.ok) { showPage(); return; }
    if(result && result.hardInvalid) { clearTokens(); redirectToLogin(); return; }
    showPage();
  }).catch(function(){ showPage(); });
  window.GEJAST_HOME_GATE = { VERSION: VERSION };
})();
