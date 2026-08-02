const bust = `proof=${Date.now()}`;
const tests = [
  { name: 'admin root unauth', url: 'https://admin.kalenel.nl/', expect: r => r.status === 401 },
  { name: 'admin html unauth', url: 'https://admin.kalenel.nl/admin.html', expect: r => r.status === 401 },
  { name: 'admin js unauth', url: 'https://admin.kalenel.nl/admin.js', expect: r => r.status === 401 },
  { name: 'login starts GitHub OAuth', url: 'https://admin.kalenel.nl/login?return_to=/admin.html', expect: r => r.status === 302 && /^https:\/\/github\.com\/login\/oauth\/authorize\?/.test(r.location || '') && isValidRedactedGithubOAuthLocation(r.rawLocation || '') && r.setCookie.includes('__Host-kalenel_admin_oauth') && r.setCookie.includes('__Host-kalenel_admin_attempts') },
  { name: 'callback mismatch denied', url: 'https://admin.kalenel.nl/oauth/callback?state=replay-or-mismatch&code=fake', expect: r => r.status === 403 && r.cacheControl === 'no-store' },
  { name: 'tampered session denied', url: 'https://admin.kalenel.nl/admin.html', cookie: '__Host-kalenel_admin_session=tampered.cookie', expect: r => r.status === 401 },
  { name: 'public admin redirects to admin host', url: `https://kalenel.nl/admin.html?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/admin.html') },
  { name: 'admin support js redirects', url: `https://kalenel.nl/admin-session-sync.js?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/admin-session-sync.js') },
  { name: 'gejast admin js redirects', url: `https://kalenel.nl/gejast-admin-rpc.js?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/gejast-admin-rpc.js') },
  { name: 'boerenbridge vault redirects', url: `https://kalenel.nl/boerenbridge_vault.html?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/boerenbridge_vault.html') },
  { name: 'toepen vault redirects', url: `https://kalenel.nl/toepen_vault.html?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/toepen_vault.html') },
  { name: 'generic vault redirects', url: `https://kalenel.nl/vault.html?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/vault.html') },
  { name: 'root markdown artifact redirects', url: `https://kalenel.nl/ADMIN_PERIMETER_V761_PROOF_2026-07-27.md?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/ADMIN_PERIMETER_V761_PROOF_2026-07-27.md') },
  { name: 'sql artifact redirects', url: `https://kalenel.nl/sql/nonexistent.sql?${bust}`, expect: r => r.status === 302 && r.location.startsWith('https://admin.kalenel.nl/sql/nonexistent.sql') },
  { name: 'home remains public', url: `https://kalenel.nl/home.html?${bust}`, expect: r => r.status === 200 && /GEJAST Home/.test(r.title || '') },
  { name: 'login remains public', url: `https://kalenel.nl/login.html?${bust}`, expect: r => r.status === 200 && /Inloggen/.test(r.title || '') },
  { name: 'activate remains public', url: `https://kalenel.nl/activate.html?${bust}`, expect: r => r.status === 200 && /Account activeren/.test(r.title || '') },
  { name: 'request remains public', url: `https://kalenel.nl/request.html?${bust}`, expect: r => r.status === 200 && /Naam claimen/.test(r.title || '') },
  { name: 'paardenrace remains public', url: `https://kalenel.nl/paardenrace.html?${bust}`, expect: r => r.status === 200 && /Paardenrace Lobby/.test(r.title || '') },
  { name: 'toepen scorer remains public', url: `https://kalenel.nl/toepen.html?${bust}`, expect: r => r.status === 200 && /Toepen scorer/.test(r.title || '') }
];
const out = [];
for (const t of tests) {
  const headers = t.cookie ? { Cookie: t.cookie } : {};
  const res = await fetch(t.url, { redirect: 'manual', headers });
  const text = await res.text();
  const title = (text.match(/<title>(.*?)<\/title>/i) || [,''])[1];
  const r = {
    name: t.name,
    url: t.url.replace(/proof=\d+/g, 'proof=[cache-bust]'),
    status: res.status,
    rawLocation: res.headers.get('location') || '',
    location: (res.headers.get('location') || '').replace(/client_id=[^&]+/g, 'client_id=[redacted]').replace(/state=[^&]+/g, 'state=[redacted]'),
    cacheControl: res.headers.get('cache-control') || '',
    failClosed: res.headers.get('x-kalenel-fail-closed') || '',
    workerGate: res.headers.get('x-kalenel-admin-gate') || '',
    setCookie: summarizeSetCookie(res.headers.get('set-cookie') || ''),
    title,
    bodyHasAdminHtml: /Beheerhub|GEJAST_ADMIN|admin-session-sync|jas_admin_session_v8/.test(text),
    bodyHasWorkerLogin: /Admin login vereist|GitHub/.test(text)
  };
  r.pass = !!t.expect(r);
  delete r.rawLocation;
  out.push(r);
}
const summary = { checkedAt: new Date().toISOString(), workerRoutes: ['admin.kalenel.nl/*', 'kalenel.nl/*'], zeroTrustOrPaidServicesUsed: false, passed: out.filter(x => x.pass).length, failed: out.filter(x => !x.pass).map(x => x.name), results: out };
console.log(JSON.stringify(summary, null, 2));
if (summary.failed.length) process.exitCode = 1;

function isValidRedactedGithubOAuthLocation(value) {
  try {
    const url = new URL(value);
    const clientId = url.searchParams.get('client_id') || '';
    return /^[A-Za-z0-9_.-]{10,128}$/.test(clientId) && url.searchParams.get('redirect_uri') === 'https://admin.kalenel.nl/oauth/callback';
  } catch {
    return false;
  }
}

function summarizeSetCookie(value) {
  if (!value) return '';
  const names = [...value.matchAll(/(?:^|,\s*)([^=;,\s]+)=/g)].map(m => m[1]).filter(Boolean);
  const flags = ['HttpOnly', 'Secure', 'SameSite=Strict'].filter(flag => value.toLowerCase().includes(flag.toLowerCase()));
  return [...new Set(names)].join(',') + (flags.length ? `; ${flags.join('; ')}` : '');
}
