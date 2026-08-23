from pathlib import Path

p=Path('cloudflare/workers/admin-gate/src/worker.js')
s=p.read_text()
s=s.replace("const ADMIN_BUILD = 'v778-security-live-autostart-ui';", "const ADMIN_BUILD = 'v779-security-stable-live-relay';", 1)
needle="""  let response = null;
  let directFailed = false;
  try {
    // Prefer the direct tunnel so successful traffic does not consume Supabase
"""
insert="""  // Long-lived MJPEG is the one path where Cloudflare Worker -> Quick Tunnel
  // HTTP/2 streams have proven fragile. Route live video intentionally through
  // the authenticated relay; short status/control/clip traffic still prefers
  // the direct tunnel below so normal usage does not consume Supabase egress.
  if (String(upstreamPath || '').endsWith('/live.mjpg')) {
    const relayTarget = securityRelayTarget(upstreamPath);
    const relayToken = String(media?.mediaToken || '');
    if (!relayTarget || relayToken.length < 32 || relayToken.length > 256) {
      return securityJson({ ok:false, error:'camera_origin_unavailable' }, 502);
    }
    const relayHeaders = new Headers({ 'X-Kalenel-Media-Token': relayToken });
    let relayResponse;
    try { relayResponse = await fetch(relayTarget, { method: request.method, headers: relayHeaders, redirect:'follow' }); }
    catch { return securityJson({ ok:false, error:'camera_origin_unavailable' }, 502); }
    if (relayResponse.status === 401 || relayResponse.status === 403) {
      return securityJson({ ok:false, error:'security_unlock_required' }, 401, true);
    }
    return securityProxyResponse(relayResponse, request.method, 'supabase-live');
  }

  let response = null;
  let directFailed = false;
  try {
    // Prefer the direct tunnel so successful traffic does not consume Supabase
"""
if needle not in s:
    raise SystemExit('proxy insertion marker not found')
s=s.replace(needle,insert,1)
p.write_text(s)
