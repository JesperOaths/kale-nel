
(function(){
  const cfg = window.GEJAST_CONFIG || {};
  const SUPABASE_URL = cfg.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = cfg.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;
  const VISITOR_KEY = 'gejast_visitor_id_v1';
  const SESSION_KEY = 'gejast_visit_session_id_v1';
  const TRACKED_KEY = 'gejast_last_tracked_path_v1';
  const EVENT_TIMEOUT_MS = 30 * 60 * 1000;
  const now = Date.now();

  function randomId(prefix){
    try {
      const raw = new Uint8Array(16);
      crypto.getRandomValues(raw);
      return prefix + Array.from(raw).map(v => v.toString(16).padStart(2,'0')).join('');
    } catch (_) {
      return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }
  function getOrSet(storage, key, prefix){
    let value = storage.getItem(key);
    if (!value) {
      value = randomId(prefix);
      storage.setItem(key, value);
    }
    return value;
  }
  function detectDeviceType(){
    const ua = navigator.userAgent || '';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    if (/mobi|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function detectBrowser(){
    const ua = navigator.userAgent || '';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/edg/i.test(ua)) return 'Edge';
    if (/chrome|crios/i.test(ua)) return 'Chrome';
    if (/safari/i.test(ua) && !/chrome|crios|edg/i.test(ua)) return 'Safari';
    return 'Onbekend';
  }
  function detectOS(){
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac os/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Onbekend';
  }
  const visitorId = getOrSet(localStorage, VISITOR_KEY, 'vis_');
  let sessionMeta = null;
  try { sessionMeta = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}
  if (!sessionMeta || !sessionMeta.id || !sessionMeta.started_at || (now - Number(sessionMeta.started_at) > EVENT_TIMEOUT_MS)) {
    sessionMeta = { id: randomId('ses_'), started_at: now };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionMeta));
  }
  const path = location.pathname.replace(/\/+/g,'/');
  const trackKey = path + '|' + sessionMeta.id;
  if (sessionStorage.getItem(TRACKED_KEY) === trackKey) return;
  sessionStorage.setItem(TRACKED_KEY, trackKey);

  const payload = {
    event_name: 'page_view',
    page_path: path,
    page_title: document.title || '',
    referrer_url: document.referrer || '',
    visitor_id: visitorId,
    session_id: sessionMeta.id,
    device_type: detectDeviceType(),
    browser_name: detectBrowser(),
    os_name: detectOS(),
    viewport_width: window.innerWidth || null,
    viewport_height: window.innerHeight || null,
    language_code: navigator.language || null,
    time_zone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
    user_agent: navigator.userAgent || null,
    extra: { host: location.host }
  };

  fetch(`${SUPABASE_URL}/rest/v1/rpc/track_site_event`, {
    method: 'POST',
    mode: 'cors',
    keepalive: true,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
})();
