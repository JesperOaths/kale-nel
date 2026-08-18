(function(){
  'use strict';
  const root=document.documentElement;
  const SESSION_KEY='jas_session_token_v11';
  const LEGACY_SESSION_KEY='jas_session_token_v10';
  const ACTIVITY_KEY='jas_last_activity_at_v1';
  const SERVER_TOUCH_KEY='jas_last_server_touch_at_v1';
  const CONFIG_SRC='/gejast-config.js?v810';
  root.setAttribute('data-gejast-auth-state','checking');
  root.style.setProperty('visibility','hidden','important');

  function requestedScope(){
    try{
      const params=new URLSearchParams(location.search||'');
      const explicit=String(params.get('scope')||'').toLowerCase();
      if(explicit==='family'||explicit==='familie') return 'family';
      if(/^\/familie(?:\/|\.html|$)/i.test(location.pathname||'')) return 'family';
    }catch(_){ }
    return 'friends';
  }
  function loginTarget(){
    return '/login.html'+(requestedScope()==='family'?'?scope=family':'');
  }
  function readToken(){
    try{
      return String(
        localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||
        localStorage.getItem(LEGACY_SESSION_KEY)||sessionStorage.getItem(LEGACY_SESSION_KEY)||''
      ).trim();
    }catch(_){return '';}
  }
  function clearSession(){
    try{window.GEJAST_CONFIG?.clearPlayerSessionTokens?.();}catch(_){ }
    for(const storage of [localStorage,sessionStorage]){
      try{
        storage.removeItem(SESSION_KEY);
        storage.removeItem(LEGACY_SESSION_KEY);
        storage.removeItem(ACTIVITY_KEY);
        storage.removeItem(SERVER_TOUCH_KEY);
      }catch(_){ }
    }
  }
  function deny({clear=false}={}){
    if(clear) clearSession();
    root.setAttribute('data-gejast-auth-state','denied');
    location.replace(loginTarget());
  }
  function reveal(){
    try{localStorage.setItem(ACTIVITY_KEY,String(Date.now()));}catch(_){ }
    root.setAttribute('data-gejast-auth-state','authenticated');
    root.style.removeProperty('visibility');
  }
  function loadConfig(){
    if(window.GEJAST_CONFIG?.SUPABASE_URL&&window.GEJAST_CONFIG?.SUPABASE_PUBLISHABLE_KEY) return Promise.resolve(window.GEJAST_CONFIG);
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(s=>/\/gejast-config\.js(?:[?#]|$)/.test(s.src||''));
      const script=existing||document.createElement('script');
      let settled=false;
      const done=()=>{
        if(settled) return;
        if(window.GEJAST_CONFIG?.SUPABASE_URL&&window.GEJAST_CONFIG?.SUPABASE_PUBLISHABLE_KEY){settled=true;resolve(window.GEJAST_CONFIG);}
      };
      const fail=()=>{if(!settled){settled=true;reject(new Error('auth_config_unavailable'));}};
      script.addEventListener('load',done,{once:true});
      script.addEventListener('error',fail,{once:true});
      if(!existing){script.src=CONFIG_SRC;script.async=false;(document.head||document.documentElement).appendChild(script);}
      queueMicrotask(done);
      setTimeout(fail,8000);
    });
  }
  async function validate(token){
    const cfg=await loadConfig();
    const url=String(cfg.SUPABASE_URL||'').replace(/\/+$/,'')+'/rest/v1/rpc/account_public_state_v687';
    const key=String(cfg.SUPABASE_PUBLISHABLE_KEY||'').trim();
    if(!url||!key) throw new Error('auth_config_invalid');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json',Accept:'application/json',apikey:key,Authorization:'Bearer '+key},
        body:JSON.stringify({session_token:token,session_token_input:token,site_scope_input:requestedScope()}),
        signal:controller.signal,
        cache:'no-store'
      });
      if(!response.ok) throw new Error('auth_rpc_http_'+response.status);
      const data=await response.json();
      const responseScope=String(data&&data.site_scope||'').trim().toLowerCase()==='family'?'family':'friends';
      return data&&data.ok===true&&responseScope===requestedScope();
    }finally{clearTimeout(timeout);}
  }

  const token=readToken();
  if(!token){deny();return;}
  window.GEJAST_AUTH_GATE=validate(token).then(ok=>{if(ok)reveal();else deny({clear:true});return ok;}).catch(()=>{deny();return false;});
})();
