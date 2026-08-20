from pathlib import Path
import re

worker_path = Path('cloudflare/workers/admin-gate/src/worker.js')
viewer_path = Path('security/index.html')
worker = worker_path.read_text()
viewer = viewer_path.read_text()


def once(old: str, new: str, label: str) -> None:
    global worker
    count = worker.count(old)
    if count != 1:
        raise SystemExit(f'BLOCKER={label}_COUNT_{count}')
    worker = worker.replace(old, new, 1)


once("const ADMIN_BUILD = 'v765-security-proxy';", "const ADMIN_BUILD = 'v766-dual-camera-security';", 'BUILD')
once(
    "      target.searchParams.set('return_to', '/security/');",
    "      target.searchParams.set('return_to', securityPageReturnTo(url.pathname));",
    'OUTER_RETURN',
)
once(
    "  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n  if (url.pathname === '/security/') return await serveSecurityAsset(request, env);\n\n  const media = await readEncryptedCookie(request, env, SECURITY_MEDIA_COOKIE);",
    "  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();\n  if (url.pathname === '/security/new-clips') return canonicalRedirect('/security/new-clips/');\n  if (url.pathname === '/security/s3-clips') return canonicalRedirect('/security/s3-clips/');\n  if (url.pathname === '/security/' || url.pathname === '/security/new-clips/' || url.pathname === '/security/s3-clips/') {\n    return await serveSecurityAsset(request, env);\n  }\n\n  const media = await readEncryptedCookie(request, env, SECURITY_MEDIA_COOKIE);",
    'SECURITY_PAGE_ROUTING',
)
once(
    "function isSecurityPath(pathname) { return pathname === '/security' || pathname.startsWith('/security/'); }\nfunction isSecurityReturnTo(value) { return value === '/security' || value === '/security/'; }",
    "function isSecurityPath(pathname) { return pathname === '/security' || pathname.startsWith('/security/'); }\nfunction securityPageReturnTo(value) {\n  const path = String(value || '').split('?', 1)[0];\n  if (path === '/security/new-clips' || path === '/security/new-clips/') return '/security/new-clips/';\n  if (path === '/security/s3-clips' || path === '/security/s3-clips/') return '/security/s3-clips/';\n  return '/security/';\n}\nfunction isSecurityReturnTo(value) {\n  const path = String(value || '').split('?', 1)[0];\n  return path === '/security' || path === '/security/' ||\n    path === '/security/new-clips' || path === '/security/new-clips/' ||\n    path === '/security/s3-clips' || path === '/security/s3-clips/';\n}",
    'SECURITY_RETURN_HELPERS',
)
once(
    "  const destination = isSecurityReturnTo(safeReturnTo) ? `https://${PUBLIC_HOST}/security/` : safeReturnTo;",
    "  const destination = isSecurityReturnTo(safeReturnTo) ? `https://${PUBLIC_HOST}${securityPageReturnTo(safeReturnTo)}` : safeReturnTo;",
    'OAUTH_DESTINATION',
)

old_router = "function securityUpstreamPath(pathname) {\n  if (pathname === '/security/api/events') return '/api/events';\n  if (pathname === '/security/api/status') return '/api/status';\n  if (pathname === '/security/live.mjpg') return '/live.mjpg';\n  if (pathname.startsWith('/security/snap/')) {\n    const name = cleanSecurityFilename(pathname.slice('/security/snap/'.length));\n    return name ? `/snap/${encodeURIComponent(name)}` : '';\n  }\n  if (pathname.startsWith('/security/clip/')) {\n    const name = cleanSecurityFilename(pathname.slice('/security/clip/'.length), '.mp4');\n    return name ? `/clip/${encodeURIComponent(name)}` : '';\n  }\n  return '';\n}"
new_router = "function securityUpstreamPath(pathname) {\n  for (const camera of ['s3', 'new']) {\n    const prefix = `/security/${camera}`;\n    if (pathname === `${prefix}/api/events`) return `/${camera}/api/events`;\n    if (pathname === `${prefix}/api/status`) return `/${camera}/api/status`;\n    if (pathname === `${prefix}/live.mjpg`) return `/${camera}/live.mjpg`;\n    if (pathname.startsWith(`${prefix}/snap/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/snap/`.length));\n      return name ? `/${camera}/snap/${encodeURIComponent(name)}` : '';\n    }\n    if (pathname.startsWith(`${prefix}/clip/`)) {\n      const name = cleanSecurityFilename(pathname.slice(`${prefix}/clip/`.length), '.mp4');\n      return name ? `/${camera}/clip/${encodeURIComponent(name)}` : '';\n    }\n  }\n  // Backwards compatibility: pre-v766 unprefixed security media remains S3.\n  if (pathname === '/security/api/events') return '/api/events';\n  if (pathname === '/security/api/status') return '/api/status';\n  if (pathname === '/security/live.mjpg') return '/live.mjpg';\n  if (pathname.startsWith('/security/snap/')) {\n    const name = cleanSecurityFilename(pathname.slice('/security/snap/'.length));\n    return name ? `/snap/${encodeURIComponent(name)}` : '';\n  }\n  if (pathname.startsWith('/security/clip/')) {\n    const name = cleanSecurityFilename(pathname.slice('/security/clip/'.length), '.mp4');\n    return name ? `/clip/${encodeURIComponent(name)}` : '';\n  }\n  return '';\n}"
once(old_router, new_router, 'UPSTREAM_ROUTER')

worker_path.write_text(worker)

required_worker = [
    "ADMIN_BUILD = 'v766-dual-camera-security'",
    "'/security/new-clips/'",
    "'/security/s3-clips/'",
    "for (const camera of ['s3', 'new'])",
    "securityPageReturnTo",
    "`/${camera}/live.mjpg`",
]
for marker in required_worker:
    if marker not in worker:
        raise SystemExit(f'BLOCKER=WORKER_MARKER_{marker}')

required_viewer = [
    '/security/new-clips/',
    '/security/s3-clips/',
    "`/security/${camera}/live.mjpg",
    "`/security/${camera}${p}`",
    'security-4 · dual camera',
]
for marker in required_viewer:
    if marker not in viewer:
        raise SystemExit(f'BLOCKER=VIEWER_MARKER_{marker}')
for forbidden in ['trycloudflare.com', '192.168.', 'media_token', 'hmac_secret', 'service_role']:
    if forbidden.lower() in viewer.lower():
        raise SystemExit(f'BLOCKER=VIEWER_FORBIDDEN_{forbidden}')

match = re.search(r'<script>(.*?)</script>', viewer, re.S)
if not match:
    raise SystemExit('BLOCKER=INLINE_SCRIPT_NOT_FOUND')
Path('/tmp/security-inline.js').write_text(match.group(1))

print('DUAL_CAMERA_WORKER_PATCH=APPLIED')
print(f'WORKER_BYTES={worker_path.stat().st_size}')
print(f'VIEWER_BYTES={viewer_path.stat().st_size}')
