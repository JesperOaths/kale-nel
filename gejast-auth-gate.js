(function(){
  'use strict';
  const root=document.documentElement;
  const SESSION_KEY='jas_session_token_v11';
  const LEGACY_SESSION_KEY='jas_session_token_v10';
  const ACTIVITY_KEY='jas_last_activity_at_v1';
  const SERVER_TOUCH_KEY='jas_last_server_touch_at_v1';
  const CONFIG_SRC='/gejast-config.js?v814';
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

  const nativeFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;
  const allowedUsernameSourceCache=new Map();
  const boundedProtectedReadRpcs=new Set(['get_game_player_names_fast_v687','get_profiles_fast_v687']);
  function normalizeName(value){return String(value||'').replace(/\s+/g,' ').trim();}
  function extractActiveNames(raw){
    const values=[];
    const queue=[raw];
    const seen=new Set();
    while(queue.length){
      const value=queue.shift();
      if(value==null) continue;
      if(typeof value==='string'){values.push(value);continue;}
      if(Array.isArray(value)){queue.push(...value);continue;}
      if(typeof value!=='object'||seen.has(value)) continue;
      seen.add(value);
      const direct=value.display_name||value.public_display_name||value.chosen_username||value.nickname||value.player_name||value.name||value.label||value.desired_name||'';
      if(direct) values.push(direct);
      for(const key of ['names','players','profiles','items','rows','data','active_names','activated_names','login_names']){
        if(value[key]!=null) queue.push(value[key]);
      }
    }
    const unique=[];
    const keys=new Set();
    for(const value of values){
      const name=normalizeName(value);
      const key=name.toLowerCase();
      if(!name||keys.has(key)) continue;
      keys.add(key);
      unique.push(name);
    }
    return unique;
  }
  async function secureActiveNameRows(){
    const scope=requestedScope();
    if(allowedUsernameSourceCache.has(scope)) return allowedUsernameSourceCache.get(scope);
    const task=(async()=>{
      if(!nativeFetch) return null;
      let cfg;
      try{cfg=await loadConfig();}catch(_){return null;}
      const base=String(cfg.SUPABASE_URL||'').replace(/\/+$/,'');
      const key=String(cfg.SUPABASE_PUBLISHABLE_KEY||'').trim();
      if(!base||!key) return null;
      const attempts=[
        ['get_login_active_names_v687',{site_scope_input:scope}],
        ['get_player_selector_source_v1',{site_scope_input:scope}],
        ['get_player_selector_source_v1',{session_token:null,site_scope_input:scope}]
      ];
      for(const [name,payload] of attempts){
        const controller=typeof AbortController!=='undefined'?new AbortController():null;
        const timer=controller?setTimeout(()=>{try{controller.abort();}catch(_){}},2200):null;
        try{
          const response=await nativeFetch(base+'/rest/v1/rpc/'+name,{
            method:'POST',mode:'cors',cache:'no-store',
            headers:{'Content-Type':'application/json',Accept:'application/json',apikey:key,Authorization:'Bearer '+key},
            body:JSON.stringify(payload),signal:controller?controller.signal:undefined
          });
          if(!response.ok) continue;
          const raw=await response.json();
          const names=extractActiveNames(raw&&raw[name]!==undefined?raw[name]:raw);
          if(names.length){
            return names.map(display_name=>({display_name,status:'active',site_scope:scope}));
          }
        }catch(_){ }
        finally{if(timer) clearTimeout(timer);}
      }
      return null;
    })();
    allowedUsernameSourceCache.set(scope,task);
    return task;
  }
  function protectedReadRpcName(url){
    const match=String(url||'').match(/\/rest\/v1\/rpc\/([^/?#]+)/i);
    const name=match?decodeURIComponent(match[1]):'';
    return boundedProtectedReadRpcs.has(name)?name:'';
  }
  async function boundedProtectedRead(input,init){
    const options=Object.assign({},init||{});
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timer=controller?setTimeout(()=>{try{controller.abort();}catch(_){}},6500):null;
    if(controller) options.signal=controller.signal;
    else delete options.signal;
    try{return await nativeFetch(input,options);}
    finally{if(timer) clearTimeout(timer);}
  }
  if(nativeFetch){
    window.fetch=function(input,init){
      let url='';
      try{url=typeof input==='string'?input:(input&&input.url)||'';}catch(_){ }
      if(/\/rest\/v1\/allowed_usernames(?:[?#]|$)/i.test(String(url))){
        return secureActiveNameRows().then(rows=>{
          const safeRows=Array.isArray(rows)?rows:[];
          const source=Array.isArray(rows)?'v813-secure-active-name-rpc':'v813-secure-active-name-rpc-empty';
          return new Response(JSON.stringify(safeRows),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Gejast-Compatibility':source}});
        });
      }
      if(protectedReadRpcName(url)) return boundedProtectedRead(input,init);
      return nativeFetch(input,init);
    };
    window.GEJAST_DIRECT_READ_COMPAT_V813={source:'active-login-rpc',direct_allowed_usernames_network:false,bounded_profile_reads:true};
  }

  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function validateOnce(token){
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
  async function validate(token){
    let lastError=null;
    for(let attempt=1;attempt<=3;attempt++){
      try{
        return await validateOnce(token);
      }catch(error){
        lastError=error;
        root.setAttribute('data-gejast-auth-attempt',String(attempt));
        if(attempt<3) await sleep(attempt===1?250:700);
      }
    }
    throw lastError||new Error('auth_validation_failed');
  }

  const token=readToken();
  if(!token){deny();return;}
  window.GEJAST_AUTH_GATE=validate(token).then(ok=>{if(ok)reveal();else deny({clear:true});return ok;}).catch(()=>{deny();return false;});
})();
