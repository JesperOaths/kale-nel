from pathlib import Path


def replace_exact(text, old, new, expected=1, label="replace"):
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected}, found {count}")
    return text.replace(old, new, expected)


worker = Path("cloudflare/workers/admin-gate/src/worker.js")
s = worker.read_text(encoding="utf-8")

s = replace_exact(
    s,
    "const ATTEMPT_COOKIE = '__Host-kalenel_admin_attempts';\n",
    "const ATTEMPT_COOKIE = '__Host-kalenel_admin_attempts';\nconst SECURITY_COOKIE = '__Secure-kalenel_security_session';\n",
    label="security cookie const",
)
s = replace_exact(s, "const ADMIN_BUILD = 'v763';", "const ADMIN_BUILD = 'v764-security';", label="build")
s = replace_exact(s, "return handlePublicApex(request, url);", "return await handlePublicApex(request, env, url);", label="public handler call")
s = replace_exact(
    s,
    "async function handlePublicApex(request, url) {\n  if (!isSafePath(url.pathname)) return notFound();\n",
    "async function handlePublicApex(request, env, url) {\n  if (!isSafePath(url.pathname)) return notFound();\n  if (isSecurityPath(url.pathname)) return await handlePublicSecurity(request, env, url);\n",
    label="public security dispatch",
)

security_handler = r'''
async function handlePublicSecurity(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  if (url.pathname === '/security') return canonicalRedirect('/security/');
  const session = await readSignedCookie(request, env, SECURITY_COOKIE);
  if (!session || session.kind !== 'security-session' || session.exp <= now() || !isAllowedGithubAccount(env, session.github)) {
    const target = new URL('/login', `https://${ADMIN_HOST}`);
    target.searchParams.set('return_to', '/security/');
    return new Response(null, {
      status: 302,
      headers: secureHeaders({ Location: target.toString(), 'Cache-Control': 'no-store' })
    });
  }
  return await serveSecurityAsset(request, env);
}

'''
s = replace_exact(s, "\nasync function handleAdminHost(request, env, url) {", "\n" + security_handler + "async function handleAdminHost(request, env, url) {", label="security handler insert")

canonical_marker = '''function canonicalizeAdminReturnTo(value) {
  const safe = sanitizeReturnTo(value) || '/admin.html';
  if (safe === '/admin' || safe === '/admin/') return '/admin.html';
  if (safe.startsWith('/admin?')) return `/admin.html${safe.slice('/admin'.length)}`;
  return safe;
}
'''
s = replace_exact(
    s,
    canonical_marker,
    canonical_marker + "function isSecurityPath(pathname) { return pathname === '/security' || pathname === '/security/'; }\n"
    + "function isSecurityReturnTo(value) { return value === '/security' || value === '/security/'; }\n",
    label="security path helpers",
)

oauth_cookie_line = "  headers.append('Set-Cookie', await signedCookie(env, SESSION_COOKIE, session, SESSION_TTL_SECONDS));\n"
oauth_cookie_new = oauth_cookie_line + '''  if (isSecurityReturnTo(returnTo)) {
    const securitySession = { ...session, kind: 'security-session' };
    headers.append('Set-Cookie', await signedDomainCookie(env, SECURITY_COOKIE, securitySession, SESSION_TTL_SECONDS, '/security/'));
  }
'''
s = replace_exact(s, oauth_cookie_line, oauth_cookie_new, label="oauth security cookie")

logout_line = "  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));\n  return new Response(null, { status: 302, headers });\n}\n\nasync function serveProtectedAsset"
logout_new = "  headers.append('Set-Cookie', expireCookie(ATTEMPT_COOKIE));\n  headers.append('Set-Cookie', expireDomainCookie(SECURITY_COOKIE, '/security/'));\n  return new Response(null, { status: 302, headers });\n}\n\nasync function serveProtectedAsset"
s = replace_exact(s, logout_line, logout_new, label="logout security cookie")

security_asset = r'''async function serveSecurityAsset(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return failClosed(new Error('ASSETS binding missing'));
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/security/index.html';
  assetUrl.search = '';
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!response || response.status === 404) return notFound();
  const headers = new Headers(response.headers);
  applySecurityViewerHeaders(headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Kalenel-Security-Gate', 'github+totp');
  headers.set('X-Kalenel-Admin-Build', ADMIN_BUILD);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

'''
s = replace_exact(s, "async function serveProtectedAsset(request, env, pathname) {", security_asset + "async function serveProtectedAsset(request, env, pathname) {", label="security asset server")

s = replace_exact(
    s,
    '''function oauthCompletePage(returnTo) {
  const safeReturnTo = canonicalizeAdminReturnTo(returnTo);
  const href = escapeHtml(safeReturnTo);
''',
    '''function oauthCompletePage(returnTo) {
  const safeReturnTo = canonicalizeAdminReturnTo(returnTo);
  const destination = isSecurityReturnTo(safeReturnTo) ? `https://${PUBLIC_HOST}/security/` : safeReturnTo;
  const href = escapeHtml(destination);
''',
    label="oauth destination",
)

cookie_marker = '''async function signedCookie(env, name, value, maxAge, sameSite = 'Strict') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`; }
function expireCookie(name) { return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
'''
cookie_new = '''async function signedCookie(env, name, value, maxAge, sameSite = 'Strict') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`; }
async function signedDomainCookie(env, name, value, maxAge, path = '/') { const payload = btoa(JSON.stringify(value)).replace(/[+/=]/g, (m) => ({ '+': '-', '/': '_', '=': '' }[m])); const sig = await hmac(env, payload); return `${name}=${payload}.${sig}; Max-Age=${maxAge}; Domain=${PUBLIC_HOST}; Path=${path}; HttpOnly; Secure; SameSite=Strict`; }
function expireCookie(name) { return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`; }
function expireDomainCookie(name, path = '/') { return `${name}=; Max-Age=0; Domain=${PUBLIC_HOST}; Path=${path}; HttpOnly; Secure; SameSite=Strict`; }
'''
s = replace_exact(s, cookie_marker, cookie_new, label="domain cookie helpers")

security_headers = r'''function applySecurityViewerHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://uiqntazgnrxwliaidkmy.supabase.co https://*.trycloudflare.com; img-src 'self' data: blob: https://*.trycloudflare.com; media-src 'self' blob: https://*.trycloudflare.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

'''
s = replace_exact(s, "function applySecurityHeaders(headers) {", security_headers + "function applySecurityHeaders(headers) {", label="security csp")
worker.write_text(s, encoding="utf-8")

page = Path("security/index.html")
h = page.read_text(encoding="utf-8")

old_css = ".error{padding:14px 16px;border:1px solid #713b3b;background:#261515;border-radius:14px;color:#ffd0d0;margin-bottom:14px}.hidden"
new_css = ".error{padding:14px 16px;border:1px solid #713b3b;background:#261515;border-radius:14px;color:#ffd0d0;margin-bottom:14px}.login-card{max-width:660px;margin:42px auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px}.login-card h2{margin:0 0 6px}.login-card p{color:var(--muted);margin:0 0 16px}.login-grid{display:grid;gap:10px}.login-grid input{width:100%;padding:12px;border-radius:11px;border:1px solid var(--line);background:#071018;color:var(--text);font:inherit}.hidden"
h = replace_exact(h, old_css, new_css, label="login css")

marker = '    <div id="errorBox" class="error hidden"></div>\n'
login_html = '''    <div id="errorBox" class="error hidden"></div>
    <section id="innerLogin" class="login-card hidden">
      <h2>Private security login</h2>
      <p>GitHub perimeter passed. Confirm the existing Kalenel admin password and 6-digit authenticator code.</p>
      <form id="innerLoginForm" class="login-grid">
        <input id="usernameInput" type="text" autocomplete="username" placeholder="Username" required>
        <input id="passwordInput" type="password" autocomplete="current-password" placeholder="Password" required>
        <input id="totpInput" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Authenticator code" required>
        <button class="button" type="submit">Unlock security</button>
      </form>
    </section>
    <div id="securityApp" class="hidden">
'''
h = replace_exact(h, marker, login_html, label="inner login html")

end = '    </section>\n  </main>'
pos = h.rfind(end)
if pos < 0:
    raise SystemExit("security page closing marker missing")
h = h[:pos] + end.replace('\n  </main>', '\n    </div>\n  </main>') + h[pos + len(end):]

h = replace_exact(
    h,
    "  const LOGIN = '/admin.html?return_to=security/';",
    "  const SUPABASE_URL='https://uiqntazgnrxwliaidkmy.supabase.co';\n"
    "  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA';",
    label="supabase constants",
)

login_fn = r'''  function rpcHeaders(){return {apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`,'content-type':'application/json',accept:'application/json'};}
  async function parseResponse(res){const text=await res.text();let data={};try{data=text?JSON.parse(text):{};}catch{throw new Error(text||`HTTP ${res.status}`);}if(!res.ok)throw new Error(data?.message||data?.error||data?.details||`HTTP ${res.status}`);return Array.isArray(data)?(data[0]||{}):data;}
  function showInnerLogin(message=''){ $('innerLogin').classList.remove('hidden');$('securityApp').classList.add('hidden');setConnection(false,'Locked');if(message)showError(message); }
  function showSecurityApp(){ $('innerLogin').classList.add('hidden');$('securityApp').classList.remove('hidden');clearError(); }
  async function adminLogin(){
    const username=$('usernameInput').value.trim(),password=$('passwordInput').value,totp=$('totpInput').value.replace(/\D/g,'').trim();
    if(!username||!password||!/^\d{6}$/.test(totp)) throw new Error('Enter username, password and the 6-digit authenticator code.');
    const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_login`,{method:'POST',cache:'no-store',headers:rpcHeaders(),body:JSON.stringify({input_username:username,input_password:password,input_totp_code:totp})});
    const data=await parseResponse(res),token=data.admin_session_token||data.token;
    if(!token) throw new Error('Admin login returned no session.');
    saveAdminToken(token); return data;
  }
'''
h = replace_exact(h, "  function login(){ location.replace(LOGIN); }\n", login_fn, label="inline admin login")
h = replace_exact(h, "    if(!token) return login();", "    if(!token) throw new Error('admin_session_required');", label="no token")
h = replace_exact(h, "      clearAdminToken(); return login();", "      clearAdminToken(); throw new Error('admin_session_invalid');", label="invalid token")

old_boot = '''  refresh();
  state.refreshTimer=setInterval(()=>{ if(!document.hidden) refresh(); },60000);
'''
new_boot = '''  async function boot(){
    if(!adminToken()){showInnerLogin();return;}
    try{await openSession(true);showSecurityApp();await refresh();}
    catch(err){clearAdminToken();showInnerLogin('Admin session expired. Authenticate again.');}
  }
  $('innerLoginForm').addEventListener('submit',async(e)=>{
    e.preventDefault();clearError();
    try{setConnection(false,'Authenticating…');await adminLogin();await openSession(true);showSecurityApp();await refresh();}
    catch(err){showInnerLogin(err?.message||'Login failed.');}
  });
  boot();
  state.refreshTimer=setInterval(()=>{ if(!document.hidden && !$('securityApp').classList.contains('hidden')) refresh(); },60000);
'''
h = replace_exact(h, old_boot, new_boot, label="boot")
h = replace_exact(
    h,
    "document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopLive(); else refresh(); });",
    "document.addEventListener('visibilitychange',()=>{ if(document.hidden) stopLive(); else if(!$('securityApp').classList.contains('hidden')) refresh(); });",
    label="visibility",
)
h = replace_exact(h, "Kalenel · security-1", "Kalenel · security-2", label="watermark")
page.write_text(h, encoding="utf-8")
