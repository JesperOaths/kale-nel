(function(){
  const ADMIN_SESSION_KEY = 'jas_admin_session_v8';
  const ADMIN_DEVICE_KEY = 'jas_admin_device_v1';
  const ADMIN_USER_KEY = 'jas_admin_user_v1';
  const ADMIN_DEADLINE_KEY = 'jas_admin_deadline_v1';
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL || 'https://uiqntazgnrxwliaidkmy.supabase.co';
  const SUPABASE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';
  function headers(){ return { apikey: SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Accept:'application/json' }; }
  async function parse(res){ const txt=await res.text(); let data=null; try{ data=txt?JSON.parse(txt):null; }catch{ throw new Error(txt||`HTTP ${res.status}`); } if(!res.ok) throw new Error(data?.message||data?.error||data?.hint||`HTTP ${res.status}`); return data; }
  function getToken(){ return sessionStorage.getItem(ADMIN_SESSION_KEY) || localStorage.getItem(ADMIN_SESSION_KEY) || ''; }
  function getUsername(){ return sessionStorage.getItem(ADMIN_USER_KEY) || localStorage.getItem(ADMIN_USER_KEY) || ''; }
  function getDevice(){ return localStorage.getItem(ADMIN_DEVICE_KEY) || ''; }
  function getDeadline(){ return Number(sessionStorage.getItem(ADMIN_DEADLINE_KEY) || localStorage.getItem(ADMIN_DEADLINE_KEY) || '0'); }
  function setBundle(token, username='', persist=true, deviceToken=''){ if(token){ sessionStorage.setItem(ADMIN_SESSION_KEY, token); if(persist) localStorage.setItem(ADMIN_SESSION_KEY, token); } if(username){ sessionStorage.setItem(ADMIN_USER_KEY, username); localStorage.setItem(ADMIN_USER_KEY, username); } if(deviceToken){ localStorage.setItem(ADMIN_DEVICE_KEY, deviceToken); } const until = Date.now() + 8*60*60*1000; sessionStorage.setItem(ADMIN_DEADLINE_KEY, String(until)); localStorage.setItem(ADMIN_DEADLINE_KEY, String(until)); }
  function clearBundle(){ [ADMIN_SESSION_KEY,ADMIN_DEVICE_KEY,ADMIN_USER_KEY,ADMIN_DEADLINE_KEY].forEach((k)=>{ sessionStorage.removeItem(k); localStorage.removeItem(k); }); }
  async function validate(){ const token=getToken(); if(!token) throw new Error('Geen adminsessie gevonden.'); if(getDeadline() && Date.now()>getDeadline()){ clearBundle(); throw new Error('Adminsessie verlopen.'); } const device=getDevice(); const username=getUsername(); const rpc = (device && username) ? 'admin_check_session_with_device' : 'admin_check_session'; const payload = (device && username) ? { admin_session_token:token, admin_username:username, raw_device_token:device, device_fingerprint:(window.GEJAST_ADMIN_DEVICE&&window.GEJAST_ADMIN_DEVICE.fingerprint?window.GEJAST_ADMIN_DEVICE.fingerprint():'') } : { admin_session_token:token };
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`,{method:'POST',mode:'cors',cache:'no-store',headers:headers(),body:JSON.stringify(payload)});
    const data=await parse(res); if(data?.admin_session_token){ setBundle(data.admin_session_token, data.admin_username || username, true, device); } return data; }
  window.GEJAST_ADMIN_SESSION = { getToken, getUsername, getDevice, getDeadline, setBundle, clearBundle, validate };
})();