(function(){
  var cfg = window.GEJAST_CONFIG || {};
  var VERSION = 'v686';
  function getToken(){ try { return (cfg.getPlayerSessionToken && cfg.getPlayerSessionToken()) || ''; } catch(_){ return ''; } }
  function clearTokens(){ try{ cfg.clearPlayerSessionTokens && cfg.clearPlayerSessionTokens(); }catch(_){} }
  function currentScope(){ try{ if (window.GEJAST_SCOPE_UTILS && typeof window.GEJAST_SCOPE_UTILS.getScope === 'function') return window.GEJAST_SCOPE_UTILS.getScope(); }catch(_){} try{ return new URLSearchParams(location.search).get('scope') === 'family' ? 'family' : 'friends'; }catch(_){ return 'friends'; } }
  function currentTarget(){ try{ return cfg.currentReturnTarget ? cfg.currentReturnTarget((location.pathname||'').split('/').pop() || 'index.html') : ((location.pathname||'').split('/').pop() || 'index.html') + (location.search||'') + (location.hash||''); }catch(_){ return 'index.html'; } }
  function loginUrl(){ try{ return cfg.buildLoginUrl ? cfg.buildLoginUrl(currentTarget(), currentScope()) : './login.html?return_to=' + encodeURIComponent(currentTarget()) + (currentScope()==='family'?'&scope=family':''); }catch(_){ return './login.html'; } }
  function headers(){ return { 'Content-Type':'application/json', apikey:(cfg.SUPABASE_PUBLISHABLE_KEY||''), Authorization:'Bearer ' + (cfg.SUPABASE_PUBLISHABLE_KEY||'') }; }
  function showPage(){ try{ if(document.body){ document.body.classList.remove('boot-pending'); document.body.classList.remove('page-loading'); }}catch(_){} }
  async function parse(res){ var txt=await res.text(); var data=null; try{ data=txt?JSON.parse(txt):null; }catch(_){ throw new Error(txt||('HTTP '+res.status)); } if(!res.ok) throw new Error(data&& (data.message||data.error) || ('HTTP '+res.status)); return data; }
  async function rpc(name,payload,ms){
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ try{ controller.abort(); }catch(_){} }, ms || 1600) : null;
    try{ return await fetch((cfg.SUPABASE_URL||'') + '/rest/v1/rpc/' + name,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload||{}),signal:controller?controller.signal:undefined}).then(parse); }
    catch(e){ if(e && e.name === 'AbortError') throw new Error('session_check_timeout'); throw e; }
    finally{ if(timer) clearTimeout(timer); }
  }
  function normalizeName(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
  async function fetchViewerState(token){
    var attempts=[['get_public_state',{session_token:token}],['get_public_state',{session_token_input:token}],['account_public_state_v686',{session_token_input:token}]];
    for(var i=0;i<attempts.length;i++){
      try{
        var data=await rpc(attempts[i][0], attempts[i][1], 1500);
        var name=normalizeName(data&& (data.my_name || data.display_name || data.player_name || (data.viewer&&data.viewer.display_name) || ''));
        if(name || (data && (data.viewer || data.player || data.session_valid === true || data.is_logged_in === true))) return { ok:true, name:name, data:data };
      }catch(_){}
    }
    return { ok:false, transient:true };
  }
  function redirectToLogin(){ try{ location.replace(loginUrl()); }catch(_){ location.href='./login.html'; } }
  showPage();
  var token = getToken();
  if(!token){ redirectToLogin(); return; }
  try{ cfg.touchPlayerActivity && cfg.touchPlayerActivity({ force:false }); }catch(_){}
  // Do not block page rendering. If the backend is slow/unavailable, keep the page open and let page RPCs report their own errors.
  Promise.race([fetchViewerState(token), new Promise(function(resolve){ setTimeout(function(){ resolve({ ok:true, timeout:true }); }, 1700); })]).then(function(result){
    if(result && result.ok) return;
    if(result && result.transient) return;
    clearTokens();
    redirectToLogin();
  }).catch(function(){ /* transient verification failures do not kill navigation */ });
  window.GEJAST_HOME_GATE = { VERSION: VERSION };
})();
