from pathlib import Path

worker = Path('cloudflare/workers/admin-gate/src/worker.js')
test = Path('scripts/test-security-viewer-gate-v813.mjs')

w = worker.read_text()
t = test.read_text()

repls = [
("const ADMIN_BUILD = 'v776-security-direct-relay-fallback';", "const ADMIN_BUILD = 'v777-security-dedicated-unlock';"),
("  if (url.pathname === '/security') {\n    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n    return canonicalRedirect('/security/');\n  }", "  if (url.pathname === '/security') {\n    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n    return canonicalRedirect('/security/');\n  }\n  if (url.pathname === '/security/unlock') {\n    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n    return canonicalRedirect('/security/unlock/');\n  }"),
("  if (url.pathname === '/security/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/') {", "  if (url.pathname === '/security/' || url.pathname === '/security/unlock/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/') {"),
("        Location: `https://${PUBLIC_HOST}/security/`,", "        Location: `https://${PUBLIC_HOST}/security/unlock/`,"),
("  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';", "  if (path === '/security/unlock' || path === '/security/unlock/') return '/security/unlock/';\n  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';"),
("  return path === '/security' || path === '/security/' ||\n    path === '/security/new-clips'", "  return path === '/security' || path === '/security/' ||\n    path === '/security/unlock' || path === '/security/unlock/' ||\n    path === '/security/new-clips'")
]
for old,new in repls:
    if old not in w:
        raise SystemExit('worker patch anchor missing: '+old[:100])
    w = w.replace(old,new,1)

anchor = "assert.equal(canonical.headers.get('Location'), '/security/');\n"
insert = """

const unlockCanonical = await req('https://kalenel.nl/security/unlock', { redirect: 'manual' });
assert.equal(unlockCanonical.status, 302);
assert.equal(unlockCanonical.headers.get('Location'), '/security/unlock/');

const anonymousUnlock = await req('https://kalenel.nl/security/unlock/', { redirect: 'manual' });
assert.equal(anonymousUnlock.status, 302);
assert.equal(anonymousUnlock.headers.get('Location'), 'https://admin.kalenel.nl/login?return_to=%2Fsecurity%2Funlock%2F');
assert.equal(anonymousUnlock.headers.get('Cache-Control'), 'no-store');
"""
if anchor not in t: raise SystemExit('test canonical anchor missing')
t = t.replace(anchor, anchor+insert, 1)

anchor2 = "assert.match(page.headers.get('Content-Security-Policy') || '', /connect-src 'self'/);\n"
insert2 = """
const unlockPage = await req('https://kalenel.nl/security/unlock/', { headers: { Cookie: outerCookie } });
assert.equal(unlockPage.status, 200);
assert.equal(unlockPage.headers.get('X-Kalenel-Security-Gate'), 'github+totp');
assert.equal(unlockPage.headers.get('Cache-Control'), 'no-store');
"""
if anchor2 not in t: raise SystemExit('test page anchor missing')
t = t.replace(anchor2, anchor2+insert2, 1)

worker.write_text(w)
test.write_text(t)
print('V777_PATCH=PASS')
