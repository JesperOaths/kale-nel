from pathlib import Path


def patch_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"BLOCKER={label}_COUNT_{count}")
    return text.replace(old, new, 1)


worker_path = Path("cloudflare/workers/admin-gate/src/worker.js")
worker = worker_path.read_text()

worker = patch_once(
    worker,
    "const MAX_LOGIN_ATTEMPTS = 8;\nconst ADMIN_BUILD = 'v779-security-stable-live-relay';",
    "const MAX_LOGIN_ATTEMPTS = 8;\nconst SECURITY_LOGIN_UPSTREAM_TIMEOUT_MS = 9000;\nconst SECURITY_MEDIA_SESSION_TIMEOUT_MS = 12000;\nconst ADMIN_BUILD = 'v780-security-login-resilience';",
    "WORKER_BUILD_AND_TIMEOUTS",
)

worker = patch_once(
    worker,
    "function securityMethodNotAllowed(allow) {\n  return new Response('Method not allowed', { status: 405, headers: securityResponseHeaders({ Allow: allow, 'Content-Type': 'text/plain; charset=utf-8' }) });\n}\nasync function securityInnerLogin(request, env, outer) {",
    "function securityMethodNotAllowed(allow) {\n  return new Response('Method not allowed', { status: 405, headers: securityResponseHeaders({ Allow: allow, 'Content-Type': 'text/plain; charset=utf-8' }) });\n}\nasync function securityFetchWithTimeout(url, init = {}, timeoutMs = SECURITY_LOGIN_UPSTREAM_TIMEOUT_MS) {\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), timeoutMs);\n  try {\n    return await fetch(url, { ...init, signal: controller.signal });\n  } finally {\n    clearTimeout(timer);\n  }\n}\nfunction isTransientSecurityUpstreamStatus(status) {\n  return status === 408 || status === 429 || status >= 500;\n}\nasync function securityInnerLogin(request, env, outer) {",
    "WORKER_FETCH_TIMEOUT_HELPER",
)

worker = patch_once(
    worker,
    "  const loginRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_login`, {\n    method: 'POST',\n    headers: {\n      apikey: SUPABASE_PUBLISHABLE_KEY,\n      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,\n      'Content-Type': 'application/json',\n      Accept: 'application/json'\n    },\n    body: JSON.stringify({ input_username: username, input_password: password, input_totp_code: totp })\n  });\n  const loginText = await loginRes.text();",
    "  let loginRes;\n  try {\n    loginRes = await securityFetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/admin_login`, {\n      method: 'POST',\n      headers: {\n        apikey: SUPABASE_PUBLISHABLE_KEY,\n        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,\n        'Content-Type': 'application/json',\n        Accept: 'application/json'\n      },\n      body: JSON.stringify({ input_username: username, input_password: password, input_totp_code: totp })\n    }, SECURITY_LOGIN_UPSTREAM_TIMEOUT_MS);\n  } catch {\n    return securityJson({ ok:false, error:'authentication_service_unavailable' }, 503);\n  }\n  if (isTransientSecurityUpstreamStatus(loginRes.status)) {\n    return securityJson({ ok:false, error:'authentication_service_unavailable' }, 503);\n  }\n  const loginText = await loginRes.text();",
    "WORKER_ADMIN_LOGIN_FETCH",
)

worker = patch_once(
    worker,
    "  const mediaRes = await fetch(SECURITY_MEDIA_SESSION_URL, {\n    method: 'POST',\n    headers: { Origin: `https://${PUBLIC_HOST}`, 'Content-Type': 'application/json', Accept: 'application/json' },\n    body: JSON.stringify({ admin_session_token: adminToken })\n  });\n  const mediaData = await mediaRes.json().catch(() => ({}));",
    "  let mediaRes;\n  try {\n    mediaRes = await securityFetchWithTimeout(SECURITY_MEDIA_SESSION_URL, {\n      method: 'POST',\n      headers: { Origin: `https://${PUBLIC_HOST}`, 'Content-Type': 'application/json', Accept: 'application/json' },\n      body: JSON.stringify({ admin_session_token: adminToken })\n    }, SECURITY_MEDIA_SESSION_TIMEOUT_MS);\n  } catch {\n    return securityJson({ ok:false, error:'camera_origin_unavailable' }, 503);\n  }\n  if (isTransientSecurityUpstreamStatus(mediaRes.status)) {\n    return securityJson({ ok:false, error:'camera_origin_unavailable' }, 503);\n  }\n  const mediaData = await mediaRes.json().catch(() => ({}));",
    "WORKER_MEDIA_SESSION_FETCH",
)

worker_path.write_text(worker)

html_path = Path("security/index.html")
html = html_path.read_text()

html = patch_once(
    html,
    ".nav a.active{background:var(--text);color:var(--bg);border-color:var(--text)}.nav .spacer{flex:1}",
    ".nav a.active{background:var(--text);color:var(--bg);border-color:var(--text)}.button:disabled{opacity:.55;cursor:wait}.nav .spacer{flex:1}",
    "HTML_DISABLED_BUTTON_STYLE",
)

html = patch_once(
    html,
    '<button class="button" type="submit">Unlock security</button>',
    '<button id="unlockBtn" class="button" type="submit">Unlock security</button>',
    "HTML_UNLOCK_BUTTON_ID",
)

html = patch_once(
    html,
    '<div class="watermark">v778 - Kalenel Security · protected live auto-start</div>',
    '<div class="watermark">v780 - Kalenel Security · resilient protected login</div>',
    "HTML_WATERMARK",
)

html = patch_once(
    html,
    "const state={unlocked:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},autoStarted:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;",
    "const state={unlocked:false,authPending:false,events:[],retries:{new:null,s3:null},liveTimers:{new:null,s3:null},liveRequested:{new:false,s3:false},autoStarted:{new:false,s3:false},sourceOnline:{new:false,s3:false},statusTimer:null,controlsAt:{new:0,s3:0}},$=id=>document.getElementById(id),enc=encodeURIComponent;",
    "HTML_AUTH_PENDING_STATE",
)

html = patch_once(
    html,
    "  async function readJson(res){const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{}return {res,data}}\n  async function unlock(){const username=$('usernameInput').value.trim(),password=$('passwordInput').value,totp=$('totpInput').value.replace(/\\D/g,'');if(!username||!password||!/^\\d{6}$/.test(totp))throw new Error('Enter username, password and the 6-digit authenticator code.');const {res,data}=await readJson(await fetch('/security/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({username,password,totp})}));$('passwordInput').value='';$('totpInput').value='';if(!res.ok||data.ok!==true)throw new Error(res.status===401?'Authentication failed.':(data.error||`Security login failed (${res.status})`))}",
    "  async function readJson(res){const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{}return {res,data}}\n  async function loginRequest(payload){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);try{return await readJson(await fetch('/security/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal}))}catch(err){if(controller.signal.aborted)throw new Error('Security login timed out. The authentication service is temporarily unavailable.');throw new Error('Security login service is temporarily unavailable.')}finally{clearTimeout(timer)}}\n  async function unlock(){const username=$('usernameInput').value.trim(),password=$('passwordInput').value,totp=$('totpInput').value.replace(/\\D/g,'');if(!username||!password||!/^\\d{6}$/.test(totp))throw new Error('Enter username, password and the 6-digit authenticator code.');let packet;try{packet=await loginRequest({username,password,totp})}finally{$('passwordInput').value='';$('totpInput').value=''}const {res,data}=packet;if(!res.ok||data.ok!==true){if(res.status===502||res.status===503||data.error==='authentication_service_unavailable'||data.error==='camera_origin_unavailable')throw new Error('Security login service is temporarily unavailable.');throw new Error(res.status===401?'Authentication failed.':(data.error||`Security login failed (${res.status})`))}}",
    "HTML_BOUNDED_LOGIN_FETCH",
)

html = patch_once(
    html,
    "  $('innerLoginForm').addEventListener('submit',async e=>{e.preventDefault();clearError();try{setConnection(false,'Authenticating…');await unlock();showApp();await refresh()}catch(err){showInnerLogin(err?.message||'Login failed.')}});",
    "  $('innerLoginForm').addEventListener('submit',async e=>{e.preventDefault();if(state.authPending)return;state.authPending=true;const button=$('unlockBtn');button.disabled=true;clearError();try{setConnection(false,'Authenticating…');await unlock();showApp();await refresh()}catch(err){showInnerLogin(err?.message||'Login failed.')}finally{state.authPending=false;button.disabled=false;if(!state.unlocked)setConnection(false,'Locked')}});",
    "HTML_DUPLICATE_SUBMIT_GUARD",
)

html_path.write_text(html)

print("PATCH_V780=PASS")
