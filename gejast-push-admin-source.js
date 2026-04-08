(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_PUSH_ADMIN_SOURCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  function cfg() {
    const config = root.GEJAST_CONFIG || {};
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('GEJAST_CONFIG ontbreekt of is incompleet.');
    }
    return config;
  }

  function adminToken() {
    if (root.GEJAST_ADMIN_SESSION && typeof root.GEJAST_ADMIN_SESSION.getToken === 'function') {
      return root.GEJAST_ADMIN_SESSION.getToken() || '';
    }
    return sessionStorage.getItem('jas_admin_session_v8') || localStorage.getItem('jas_admin_session_v8') || '';
  }

  function currentScope() {
    if (root.GEJAST_SCOPE_UTILS && typeof root.GEJAST_SCOPE_UTILS.getScope === 'function') {
      return root.GEJAST_SCOPE_UTILS.getScope();
    }
    return 'friends';
  }

  function rpcHeaders() {
    const c = cfg();
    return {
      apikey: c.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${c.SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  async function parseJson(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(data?.message || data?.error || text || `HTTP ${response.status}`);
    return data;
  }

  async function rpc(name, payload) {
    const c = cfg();
    const response = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: rpcHeaders(),
      body: JSON.stringify(payload || {})
    });
    return parseJson(response);
  }

  async function loadDiagnostics(options) {
    const opts = Object.assign({ activeMinutes: 5, scope: currentScope() }, options || {});
    return rpc('admin_get_web_push_diagnostics_v2', {
      admin_session_token: adminToken(),
      active_minutes: Math.max(1, Math.min(60, Number(opts.activeMinutes || 5))),
      site_scope_input: opts.scope || currentScope()
    });
  }

  async function queueBroadcast(options) {
    const opts = Object.assign({ title: '', body: '', targetUrl: './index.html', activeMinutes: 5, scope: currentScope() }, options || {});
    return rpc('admin_queue_active_web_push_v2', {
      admin_session_token: adminToken(),
      title_input: String(opts.title || '').trim(),
      body_input: String(opts.body || '').trim(),
      target_url_input: String(opts.targetUrl || './index.html').trim(),
      active_minutes: Math.max(1, Math.min(60, Number(opts.activeMinutes || 5))),
      site_scope_input: opts.scope || currentScope()
    });
  }

  return {
    loadDiagnostics,
    queueBroadcast
  };
});
