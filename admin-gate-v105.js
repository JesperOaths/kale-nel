(function(){
  const ADMIN_SESSION_KEY = 'jas_admin_session_v8';
  const ADMIN_DEVICE_KEY = 'jas_admin_device_v1';
  const ADMIN_USER_KEY = 'jas_admin_user_v1';
  const ADMIN_DEADLINE_KEY = 'jas_admin_deadline_v1';
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  function token(){ return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY) || ''; }
  function device(){ return localStorage.getItem(ADMIN_DEVICE_KEY) || ''; }
  function username(){ return localStorage.getItem(ADMIN_USER_KEY) || sessionStorage.getItem(ADMIN_USER_KEY) || ''; }
  function deadline(){ return Number(localStorage.getItem(ADMIN_DEADLINE_KEY) || sessionStorage.getItem(ADMIN_DEADLINE_KEY) || '0'); }
  function setSession(v,u){ if(v){ sessionStorage.setItem(ADMIN_SESSION_KEY,v); localStorage.setItem(ADMIN_SESSION_KEY,v); } if(u){ sessionStorage.setItem(ADMIN_USER_KEY,u); localStorage.setItem(ADMIN_USER_KEY,u); } const until=Date.now() + 8*60*60*1000; sessionStorage.setItem(ADMIN_DEADLINE_KEY,String(until)); localStorage.setItem(ADMIN_DEADLINE_KEY,String(until)); }
  function clearAll(){ [ADMIN_SESSION_KEY,ADMIN_DEVICE_KEY,ADMIN_USER_KEY,ADMIN_DEADLINE_KEY].forEach((k)=>{ sessionStorage.removeItem(k); localStorage.removeItem(k); }); }
  function headers(){ return { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const txt=await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch{ throw new Error(txt||`HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message||data?.error||data?.hint||`HTTP ${res.status}`); return data; }
  function fingerprint(){ const p=[navigator.userAgent||'', navigator.language||'', Intl.DateTimeFormat().resolvedOptions().timeZone||'', String(screen?.width||0), String(screen?.height||0), navigator.platform||'']; return p.join('|').slice(0,500); }
  function addLogout(){ if(document.getElementById('globalAdminLogoutBtn')) return; const btn=document.createElement('button'); btn.id='globalAdminLogoutBtn'; btn.textContent='Uitloggen'; btn.style.cssText='position:fixed;top:14px;right:14px;z-index:10001;background:#111;color:#fff;border:1px solid rgba(212,175,55,.35);border-radius:14px;padding:10px 14px;font:700 14px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 24px rgba(0,0,0,.18);cursor:pointer;'; btn.onclick=()=>{ clearAll(); window.location.href='./admin.html'; }; document.body.appendChild(btn); }
  function redirectToAdmin(reason='device_required'){ const here=encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search + window.location.hash); window.location.href=`./admin.html?reason=${encodeURIComponent(reason)}&return_to=${here}`; }
  async function gate(){
    const t=token(), d=device(), u=username();
    if(!t || !u || (deadline() && Date.now()>deadline())){ clearAll(); redirectToAdmin('device_required'); return; }
    try {
      const rpcName = d ? 'admin_check_session_with_device' : 'admin_check_session';
      const payload = d ? { admin_session_token:t, admin_username:u, raw_device_token:d, device_fingerprint:fingerprint() } : { admin_session_token:t };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, { method:'POST', mode:'cors', cache:'no-store', headers: headers(), body: JSON.stringify(payload) });
      const data = await parse(res);
      if(data?.admin_session_token) setSession(data.admin_session_token, data.admin_username || u);
      document.documentElement.classList.remove('admin-gate-pending');
      addLogout();
    } catch(err){
      console.warn('Admin gate blocked page', err);
      clearAll();
      redirectToAdmin('device_required');
    }
  }
  window.GEJAST_ADMIN_DEVICE = { fingerprint, clearAll, setSession, ensure: gate };
  window.addEventListener('DOMContentLoaded', gate);
})();
